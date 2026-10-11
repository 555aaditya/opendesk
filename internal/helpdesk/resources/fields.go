package resources

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/useopendesk/opendesk/internal/auth"
	"github.com/useopendesk/opendesk/internal/db"
	"github.com/useopendesk/opendesk/internal/deps"
	"github.com/useopendesk/opendesk/internal/domain"
	"github.com/useopendesk/opendesk/internal/events"
	"github.com/useopendesk/opendesk/internal/helpdesk/hd"
	"github.com/useopendesk/opendesk/internal/httpx"
	"github.com/useopendesk/opendesk/internal/ids"
)

var (
	fieldKeyRe  = regexp.MustCompile(`^[a-z][a-z0-9_]{0,39}$`)
	optionIDRe  = regexp.MustCompile(`^[a-z0-9_-]{1,40}$`)
	fieldTables = map[string]string{domain.FieldEntityTicket: "tickets", domain.FieldEntityContact: "contacts", domain.FieldEntityCompany: "companies"}
)

type fieldCreateBody struct {
	Entity          string          `json:"entity" enum:"ticket,contact,company"`
	Key             string          `json:"key,omitempty" maxLength:"40" doc:"Defaults to a slug of name; never changes"`
	Name            string          `json:"name" maxLength:"100"`
	Type            string          `json:"type" enum:"text,long_text,number,select,multi_select,date,checkbox,url,email,user"`
	Options         []fieldOptionIn `json:"options,omitempty" maxItems:"200"`
	RequiredOnSolve bool            `json:"required_on_solve,omitempty" doc:"Tickets only"`
	Description     string          `json:"description,omitempty" maxLength:"300"`
	Position        *int            `json:"position,omitempty" minimum:"0" maximum:"100000"`
}

type fieldPatchBody struct {
	Name            *string          `json:"name,omitempty" maxLength:"100"`
	Options         *[]fieldOptionIn `json:"options,omitempty" maxItems:"200"`
	RequiredOnSolve *bool            `json:"required_on_solve,omitempty"`
	Description     *string          `json:"description,omitempty" maxLength:"300"`
	Position        *int             `json:"position,omitempty" minimum:"0" maximum:"100000"`
	Archived        *bool            `json:"archived,omitempty"`
}

type fieldOut struct{ Body domain.CustomField }

// fieldOptionIn is an option as written: id and color are optional.
type fieldOptionIn struct {
	ID    string `json:"id,omitempty" maxLength:"40" doc:"Defaults to a slug of label; keep it to keep stored values"`
	Label string `json:"label" maxLength:"60"`
	Color string `json:"color,omitempty" enum:"gray,red,orange,amber,yellow,lime,green,teal,cyan,blue,indigo,violet,purple,pink,rose"`
}

// cleanOptions validates select options: ids default to a slug of the label and are unique.
func cleanOptions(typ string, in []fieldOptionIn) ([]domain.FieldOption, error) {
	if typ != domain.FieldSelect && typ != domain.FieldMultiSelect {
		if len(in) > 0 {
			return nil, httpx.Validation("only select and multi_select fields have options")
		}
		return []domain.FieldOption{}, nil
	}
	if len(in) > domain.MaxFieldOptions {
		return nil, httpx.Validation(fmt.Sprintf("a field can have at most %d options", domain.MaxFieldOptions))
	}
	out := make([]domain.FieldOption, 0, len(in))
	taken := map[string]bool{}
	for _, o := range in {
		label, err := cleanName("option label", o.Label, 60)
		if err != nil {
			return nil, err
		}
		id := strings.TrimSpace(o.ID)
		if id == "" {
			base := hd.Slugify(label)
			if len(base) > 36 {
				base = strings.TrimRight(base[:36], "-")
			}
			if base == "" {
				base = "option"
			}
			id = base
			for i := 2; taken[id]; i++ {
				id = fmt.Sprintf("%s-%d", base, i)
			}
		}
		if !optionIDRe.MatchString(id) {
			return nil, httpx.Validation("option ids may use up to 40 lowercase letters, digits, - and _")
		}
		if taken[id] {
			return nil, httpx.Validation(fmt.Sprintf("option id %q repeats", id))
		}
		taken[id] = true
		color := "gray"
		if o.Color != "" {
			if color, err = checkColor("option color", o.Color); err != nil {
				return nil, err
			}
		}
		out = append(out, domain.FieldOption{ID: id, Label: label, Color: color})
	}
	return out, nil
}

func fieldAudit(f domain.CustomField) map[string]any {
	return map[string]any{"entity": f.Entity, "key": f.Key, "name": f.Name, "type": f.Type, "options": len(f.Options),
		"required_on_solve": f.RequiredOnSolve, "archived": f.Archived}
}

func loadField(ctx context.Context, q db.Querier, wid, id uuid.UUID, lock bool) (domain.CustomField, error) {
	sql := domain.CustomFieldSelect + ` WHERE workspace_id = $1 AND id = $2`
	if lock {
		sql += ` FOR UPDATE`
	}
	f, err := domain.ScanCustomField(q.QueryRow(ctx, sql, wid, id))
	if db.IsNotFound(err) {
		return f, httpx.NotFound("Custom field")
	}
	return f, err
}

func publishField(ctx context.Context, tx pgx.Tx, p *auth.Principal, verb string, f domain.CustomField) error {
	return settingsChanged(ctx, tx, p, "custom_field", verb, f.ID, map[string]any{"custom_field": f}, fieldAudit(f))
}

// clearRemovedOptions drops values that point at options a field no longer has.
func clearRemovedOptions(ctx context.Context, tx pgx.Tx, wid uuid.UUID, f domain.CustomField) error {
	table := fieldTables[f.Entity]
	keep := make([]string, 0, len(f.Options))
	for _, o := range f.Options {
		keep = append(keep, o.ID)
	}
	if f.Type == domain.FieldSelect {
		_, err := tx.Exec(ctx, `UPDATE `+table+` SET fields = fields - $2::text, updated_at = now()
			WHERE workspace_id = $1 AND fields ? $2::text AND NOT ((fields->>$2::text) = ANY($3::text[]))`, wid, f.Key, keep)
		return err
	}
	_, err := tx.Exec(ctx, `UPDATE `+table+` SET fields = CASE
			WHEN (SELECT count(*) FROM jsonb_array_elements_text(fields->$2::text) e WHERE e = ANY($3::text[])) = 0 THEN fields - $2::text
			ELSE jsonb_set(fields, ARRAY[$2::text], (SELECT jsonb_agg(e) FROM jsonb_array_elements_text(fields->$2::text) e WHERE e = ANY($3::text[])))
		END, updated_at = now()
		WHERE workspace_id = $1 AND jsonb_typeof(fields->$2::text) = 'array'
			AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(fields->$2::text) e WHERE NOT (e = ANY($3::text[])))`, wid, f.Key, keep)
	return err
}

func registerCustomFields(d *deps.Deps, api huma.API) {
	huma.Register(api, op("list-custom-fields", http.MethodGet, "/v1/custom-fields", "List custom fields", "Custom fields", 0),
		func(ctx context.Context, in *struct {
			Entity   string `query:"entity" enum:"ticket,contact,company,"`
			Archived string `query:"archived" enum:"true,false,any," doc:"Default any"`
		}) (*struct {
			Body httpx.Page[domain.CustomField]
		}, error) {
			p, err := requireDefRead(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			rows, err := d.DB.Pool.Query(ctx, domain.CustomFieldSelect+` WHERE workspace_id = $1 AND ($2 = '' OR entity = $2)
				AND ($3 IN ('', 'any') OR archived = ($3 = 'true'))
				ORDER BY array_position(ARRAY['ticket','contact','company'], entity), position, key`, p.WorkspaceID, in.Entity, in.Archived)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.CustomField, error) { return domain.ScanCustomField(r) })
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct {
				Body httpx.Page[domain.CustomField]
			}{list(out)}, nil
		})

	huma.Register(api, op("get-custom-field", http.MethodGet, "/v1/custom-fields/{id}", "Get a custom field", "Custom fields", 0),
		func(ctx context.Context, in *idPath) (*fieldOut, error) {
			p, err := requireDefRead(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := hd.ParseID(in.ID, "Custom field")
			if err != nil {
				return nil, err
			}
			f, err := loadField(ctx, d.DB.Pool, p.WorkspaceID, id, false)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &fieldOut{f}, nil
		})

	huma.Register(api, op("create-custom-field", http.MethodPost, "/v1/custom-fields", "Create a custom field", "Custom fields", http.StatusCreated),
		func(ctx context.Context, in *struct{ Body fieldCreateBody }) (*fieldOut, error) {
			p, err := requireDefWrite(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			b := in.Body
			if !slices.Contains(domain.FieldEntities, b.Entity) {
				return nil, httpx.Validation("entity must be one of " + strings.Join(domain.FieldEntities, ", "))
			}
			if !slices.Contains(domain.FieldTypes, b.Type) {
				return nil, httpx.Validation("type must be one of " + strings.Join(domain.FieldTypes, ", "))
			}
			name, err := cleanName("name", b.Name, 60)
			if err != nil {
				return nil, err
			}
			desc, err := cleanDescription(b.Description, 300)
			if err != nil {
				return nil, err
			}
			opts, err := cleanOptions(b.Type, b.Options)
			if err != nil {
				return nil, err
			}
			if b.RequiredOnSolve && b.Entity != domain.FieldEntityTicket {
				return nil, httpx.Validation("required_on_solve applies to ticket fields only")
			}
			key := strings.TrimSpace(b.Key)
			explicit := key != ""
			if !explicit {
				key = strings.ReplaceAll(hd.Slugify(name), "-", "_")
				if key == "" || key[0] < 'a' || key[0] > 'z' {
					key = "f_" + key
				}
				if len(key) > 36 {
					key = strings.TrimRight(key[:36], "_")
				}
			}
			if !fieldKeyRe.MatchString(key) {
				return nil, httpx.Validation("key must start with a letter and use up to 40 lowercase letters, digits and _")
			}
			var f domain.CustomField
			err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
				if err := lockKind(ctx, tx, p.WorkspaceID, "custom_field"); err != nil {
					return err
				}
				var n, next int
				if err := tx.QueryRow(ctx, `SELECT count(*), COALESCE(max(position) + 1, 0) FROM custom_fields WHERE workspace_id = $1 AND entity = $2`,
					p.WorkspaceID, b.Entity).Scan(&n, &next); err != nil {
					return err
				}
				if n >= domain.MaxFieldsPerEntity {
					return httpx.Validation(fmt.Sprintf("a workspace can have at most %d custom fields per entity", domain.MaxFieldsPerEntity))
				}
				if b.Position != nil {
					next = *b.Position
				}
				final := key
				for i := 2; ; i++ {
					var taken bool
					if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM custom_fields WHERE workspace_id = $1 AND entity = $2 AND key = $3)`,
						p.WorkspaceID, b.Entity, final).Scan(&taken); err != nil {
						return err
					}
					if !taken {
						break
					}
					if explicit {
						return httpx.Conflict("A custom field with this key already exists.")
					}
					final = fmt.Sprintf("%s_%d", key, i)
				}
				id := ids.New()
				if _, err := tx.Exec(ctx, `INSERT INTO custom_fields (id, workspace_id, entity, key, name, type, options, required_on_solve, description, position)
					VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, id, p.WorkspaceID, b.Entity, final, name, b.Type, opts, b.RequiredOnSolve, desc, next); err != nil {
					if db.IsUniqueViolation(err, "") {
						return httpx.Conflict("A custom field with this key already exists.")
					}
					return err
				}
				var err error
				if f, err = loadField(ctx, tx, p.WorkspaceID, id, false); err != nil {
					return err
				}
				return publishField(ctx, tx, p, "created", f)
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &fieldOut{f}, nil
		})

	huma.Register(api, op("update-custom-field", http.MethodPatch, "/v1/custom-fields/{id}", "Update a custom field", "Custom fields", 0),
		func(ctx context.Context, in *struct {
			ID   string `path:"id"`
			Body fieldPatchBody
		}) (*fieldOut, error) {
			p, err := requireDefWrite(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := hd.ParseID(in.ID, "Custom field")
			if err != nil {
				return nil, err
			}
			b := in.Body
			var f domain.CustomField
			err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
				var err error
				if f, err = loadField(ctx, tx, p.WorkspaceID, id, true); err != nil {
					return err
				}
				removed := false
				if b.Name != nil {
					if f.Name, err = cleanName("name", *b.Name, 60); err != nil {
						return err
					}
				}
				if b.Description != nil {
					if f.Description, err = cleanDescription(*b.Description, 300); err != nil {
						return err
					}
				}
				if b.Options != nil {
					opts, err := cleanOptions(f.Type, *b.Options)
					if err != nil {
						return err
					}
					for _, o := range f.Options {
						if !slices.ContainsFunc(opts, func(n domain.FieldOption) bool { return n.ID == o.ID }) {
							removed = true
						}
					}
					f.Options = opts
				}
				if b.RequiredOnSolve != nil {
					if *b.RequiredOnSolve && f.Entity != domain.FieldEntityTicket {
						return httpx.Validation("required_on_solve applies to ticket fields only")
					}
					f.RequiredOnSolve = *b.RequiredOnSolve
				}
				if b.Position != nil {
					f.Position = *b.Position
				}
				if b.Archived != nil {
					f.Archived = *b.Archived
				}
				if _, err := tx.Exec(ctx, `UPDATE custom_fields SET name = $3, options = $4, required_on_solve = $5, description = $6,
					position = $7, archived = $8, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
					p.WorkspaceID, id, f.Name, f.Options, f.RequiredOnSolve, f.Description, f.Position, f.Archived); err != nil {
					return err
				}
				if removed {
					if err := clearRemovedOptions(ctx, tx, p.WorkspaceID, f); err != nil {
						return err
					}
				}
				if f, err = loadField(ctx, tx, p.WorkspaceID, id, false); err != nil {
					return err
				}
				return publishField(ctx, tx, p, "updated", f)
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &fieldOut{f}, nil
		})

	huma.Register(api, op("delete-custom-field", http.MethodDelete, "/v1/custom-fields/{id}", "Delete a custom field", "Custom fields", http.StatusNoContent),
		func(ctx context.Context, in *idPath) (*struct{}, error) {
			p, err := requireDefWrite(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := hd.ParseID(in.ID, "Custom field")
			if err != nil {
				return nil, err
			}
			err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
				f, err := loadField(ctx, tx, p.WorkspaceID, id, true)
				if err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `UPDATE `+fieldTables[f.Entity]+` SET fields = fields - $2::text WHERE workspace_id = $1 AND fields ? $2::text`,
					p.WorkspaceID, f.Key); err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `DELETE FROM custom_fields WHERE workspace_id = $1 AND id = $2`, p.WorkspaceID, id); err != nil {
					return err
				}
				return settingsChanged(ctx, tx, p, "custom_field", "deleted", id,
					map[string]any{"custom_field_id": id, "entity": f.Entity, "key": f.Key}, fieldAudit(f))
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return nil, nil
		})

	huma.Register(api, op("reorder-custom-fields", http.MethodPost, "/v1/custom-fields/reorder", "Reorder custom fields", "Custom fields", 0),
		func(ctx context.Context, in *struct {
			Body struct {
				Entity string   `json:"entity" enum:"ticket,contact,company"`
				IDs    []string `json:"ids" minItems:"1" maxItems:"100"`
			}
		}) (*struct {
			Body httpx.Page[domain.CustomField]
		}, error) {
			p, err := requireDefWrite(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			var out []domain.CustomField
			err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
				moved, err := reorder(ctx, tx, p.WorkspaceID, "custom_fields", "entity", in.Body.Entity, in.Body.IDs, "custom field")
				if err != nil {
					return err
				}
				for _, id := range moved {
					f, err := loadField(ctx, tx, p.WorkspaceID, id, false)
					if err != nil {
						return err
					}
					if _, err := events.Publish(ctx, tx, events.Event{WorkspaceID: p.WorkspaceID, Type: "custom_field.updated",
						Data: map[string]any{"custom_field": f}}); err != nil {
						return err
					}
				}
				if len(moved) > 0 {
					if err := auditReorder(ctx, tx, p, "custom_field", len(moved)); err != nil {
						return err
					}
				}
				defs, err := domain.LoadFieldDefs(ctx, tx, p.WorkspaceID, in.Body.Entity)
				out = defs.Ordered()
				return err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct {
				Body httpx.Page[domain.CustomField]
			}{list(out)}, nil
		})
}
