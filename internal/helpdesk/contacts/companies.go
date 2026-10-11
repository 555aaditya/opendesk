package contacts

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/opendesk/opendesk/internal/auth"
	"github.com/opendesk/opendesk/internal/db"
	"github.com/opendesk/opendesk/internal/deps"
	"github.com/opendesk/opendesk/internal/events"
	"github.com/opendesk/opendesk/internal/helpdesk/hd"
	"github.com/opendesk/opendesk/internal/httpx"
	"github.com/opendesk/opendesk/internal/ids"
)

// Company is the contract shape.
type Company struct {
	ID           uuid.UUID      `json:"id"`
	Name         string         `json:"name"`
	Domain       string         `json:"domain"`
	Notes        string         `json:"notes"`
	Custom       map[string]any `json:"custom"`
	ContactCount int            `json:"contact_count"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
}

const companySelect = `SELECT co.id, co.name, co.domain, co.notes, co.custom,
	(SELECT count(*) FROM contacts c WHERE c.workspace_id = co.workspace_id AND c.company_id = co.id), co.created_at, co.updated_at
FROM companies co`

func scanCompany(r pgx.Row) (Company, error) {
	var c Company
	err := r.Scan(&c.ID, &c.Name, &c.Domain, &c.Notes, &c.Custom, &c.ContactCount, &c.CreatedAt, &c.UpdatedAt)
	if c.Custom == nil {
		c.Custom = map[string]any{}
	}
	return c, err
}

func loadCompany(ctx context.Context, q db.Querier, wid, id uuid.UUID) (Company, error) {
	c, err := scanCompany(q.QueryRow(ctx, companySelect+` WHERE co.workspace_id = $1 AND co.id = $2`, wid, id))
	if db.IsNotFound(err) {
		return c, httpx.NotFound("Company")
	}
	return c, err
}

type companyWriteBody struct {
	Name   *string        `json:"name,omitempty" maxLength:"200"`
	Domain *string        `json:"domain,omitempty" maxLength:"253"`
	Notes  *string        `json:"notes,omitempty" maxLength:"10000"`
	Custom map[string]any `json:"custom,omitempty"`
}

type companyRow struct {
	Name, Domain, Notes string
	Custom              map[string]any
}

func (b *companyWriteBody) apply(row *companyRow) error {
	if b.Name != nil {
		s, err := cleanText("name", *b.Name, 200, false)
		if err != nil {
			return err
		}
		if strings.ContainsAny(s, "<>") {
			return httpx.Validation("name contains characters that are not allowed")
		}
		row.Name = strings.Join(strings.Fields(s), " ")
	}
	if row.Name == "" {
		return httpx.Validation("name is required")
	}
	if b.Domain != nil {
		s, err := cleanDomain(*b.Domain)
		if err != nil {
			return err
		}
		row.Domain = s
	}
	if b.Notes != nil {
		s, err := cleanText("notes", *b.Notes, 10000, true)
		if err != nil {
			return err
		}
		row.Notes = s
	}
	if b.Custom != nil {
		m, err := cleanCustom(b.Custom)
		if err != nil {
			return err
		}
		row.Custom = m
	}
	if row.Custom == nil {
		row.Custom = map[string]any{}
	}
	return nil
}

func companyUniqueErr(err error) error {
	if db.IsUniqueViolation(err, "companies_ws_domain_uq") {
		return httpx.Conflict("A company with this domain already exists.")
	}
	return err
}

type companyOut struct{ Body Company }

type companyCursor struct {
	Name string    `json:"n"`
	ID   uuid.UUID `json:"id"`
}

func registerCompanies(d *deps.Deps, api huma.API) {
	huma.Register(api, op("list-companies", http.MethodGet, "/v1/companies", "List companies", "Companies", 0),
		func(ctx context.Context, in *struct {
			httpx.ListParams
			Q string `query:"q" maxLength:"200" doc:"Search name and domain"`
		}) (*struct{ Body httpx.Page[Company] }, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleViewer, auth.ScopeContactsRead)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			var cur companyCursor
			if err := httpx.DecodeCursor(in.Cursor, &cur); err != nil {
				return nil, err
			}
			q := strings.TrimSpace(in.Q)
			like := "%" + strings.TrimSuffix(likePrefix(q), "%") + "%"
			rows, err := d.DB.Pool.Query(ctx, companySelect+` WHERE co.workspace_id = $1
				AND ($2 = '' OR co.name ILIKE $3 OR co.domain::text ILIKE $3)
				AND (NOT $4 OR (co.name, co.id) > ($5, $6))
				ORDER BY co.name, co.id LIMIT $7`, p.WorkspaceID, q, like, in.Cursor != "", cur.Name, cur.ID, in.Limit+1)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Company, error) { return scanCompany(r) })
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			page := httpx.NewPage(list, in.Limit, func(c Company) any { return companyCursor{Name: c.Name, ID: c.ID} })
			return &struct{ Body httpx.Page[Company] }{page}, nil
		})

	huma.Register(api, op("create-company", http.MethodPost, "/v1/companies", "Create a company", "Companies", http.StatusCreated),
		func(ctx context.Context, in *struct{ Body companyWriteBody }) (*companyOut, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAgent, auth.ScopeContactsWrite)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			var row companyRow
			if err := in.Body.apply(&row); err != nil {
				return nil, err
			}
			var c Company
			err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
				id := ids.New()
				if _, err := tx.Exec(ctx, `INSERT INTO companies (id, workspace_id, name, domain, notes, custom) VALUES ($1,$2,$3,$4,$5,$6)`,
					id, p.WorkspaceID, row.Name, row.Domain, row.Notes, row.Custom); err != nil {
					return companyUniqueErr(err)
				}
				var err error
				if c, err = loadCompany(ctx, tx, p.WorkspaceID, id); err != nil {
					return err
				}
				_, err = events.Publish(ctx, tx, events.Event{WorkspaceID: p.WorkspaceID, Type: "company.created", Data: map[string]any{"company": c}})
				return err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &companyOut{c}, nil
		})

	huma.Register(api, op("get-company", http.MethodGet, "/v1/companies/{id}", "Get a company", "Companies", 0),
		func(ctx context.Context, in *struct {
			ID string `path:"id"`
		}) (*companyOut, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleViewer, auth.ScopeContactsRead)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := hd.ParseID(in.ID, "Company")
			if err != nil {
				return nil, err
			}
			c, err := loadCompany(ctx, d.DB.Pool, p.WorkspaceID, id)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &companyOut{c}, nil
		})

	huma.Register(api, op("update-company", http.MethodPatch, "/v1/companies/{id}", "Update a company", "Companies", 0),
		func(ctx context.Context, in *struct {
			ID   string `path:"id"`
			Body companyWriteBody
		}) (*companyOut, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAgent, auth.ScopeContactsWrite)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := hd.ParseID(in.ID, "Company")
			if err != nil {
				return nil, err
			}
			var c Company
			err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
				var row companyRow
				err := tx.QueryRow(ctx, `SELECT name, domain, notes, custom FROM companies WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
					p.WorkspaceID, id).Scan(&row.Name, &row.Domain, &row.Notes, &row.Custom)
				if db.IsNotFound(err) {
					return httpx.NotFound("Company")
				}
				if err != nil {
					return err
				}
				if err := in.Body.apply(&row); err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `UPDATE companies SET name = $3, domain = $4, notes = $5, custom = $6, updated_at = now()
					WHERE workspace_id = $1 AND id = $2`, p.WorkspaceID, id, row.Name, row.Domain, row.Notes, row.Custom); err != nil {
					return companyUniqueErr(err)
				}
				if c, err = loadCompany(ctx, tx, p.WorkspaceID, id); err != nil {
					return err
				}
				_, err = events.Publish(ctx, tx, events.Event{WorkspaceID: p.WorkspaceID, Type: "company.updated", Data: map[string]any{"company": c}})
				return err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &companyOut{c}, nil
		})

	huma.Register(api, op("delete-company", http.MethodDelete, "/v1/companies/{id}", "Delete a company", "Companies", http.StatusNoContent),
		func(ctx context.Context, in *struct {
			ID string `path:"id"`
		}) (*struct{}, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAgent, auth.ScopeContactsWrite)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := hd.ParseID(in.ID, "Company")
			if err != nil {
				return nil, err
			}
			err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
				tag, err := tx.Exec(ctx, `DELETE FROM companies WHERE workspace_id = $1 AND id = $2`, p.WorkspaceID, id)
				if err != nil {
					return err
				}
				if tag.RowsAffected() == 0 {
					return httpx.NotFound("Company")
				}
				_, err = events.Publish(ctx, tx, events.Event{WorkspaceID: p.WorkspaceID, Type: "company.deleted", Data: map[string]any{"company_id": id}})
				return err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return nil, nil
		})
}
