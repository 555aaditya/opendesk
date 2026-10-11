package resources

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/useopendesk/opendesk/internal/auth"
	"github.com/useopendesk/opendesk/internal/db"
	"github.com/useopendesk/opendesk/internal/deps"
	"github.com/useopendesk/opendesk/internal/events"
	"github.com/useopendesk/opendesk/internal/helpdesk/hd"
	"github.com/useopendesk/opendesk/internal/httpx"
	"github.com/useopendesk/opendesk/internal/ids"
)

// View is the contract shape. A personal view (shared=false) belongs to its creator.
type View struct {
	ID       uuid.UUID        `json:"id"`
	Name     string           `json:"name"`
	Shared   bool             `json:"shared"`
	Filters  hd.TicketFilters `json:"filters"`
	Position int              `json:"position"`

	owner *uuid.UUID
}

type viewWriteBody struct {
	Name     *string           `json:"name,omitempty" maxLength:"100"`
	Filters  *hd.TicketFilters `json:"filters,omitempty"`
	Shared   *bool             `json:"shared,omitempty"`
	Position *int              `json:"position,omitempty" minimum:"0" maximum:"100000"`
}

type viewOut struct{ Body View }

func scanView(r pgx.Row) (View, error) {
	var v View
	var raw []byte
	if err := r.Scan(&v.ID, &v.Name, &v.owner, &raw, &v.Position); err != nil {
		return v, err
	}
	v.Shared = v.owner == nil
	_ = json.Unmarshal(raw, &v.Filters)
	return v, nil
}

const viewSelect = `SELECT id, name, user_id, filters, position FROM views`

// visibleView loads a view the caller can see: shared, or their own personal view.
func visibleView(ctx context.Context, q db.Querier, p *auth.Principal, id uuid.UUID, lock bool) (View, error) {
	sql := viewSelect + ` WHERE workspace_id = $1 AND id = $2 AND (user_id IS NULL OR user_id = $3)`
	if lock {
		sql += ` FOR UPDATE`
	}
	v, err := scanView(q.QueryRow(ctx, sql, p.WorkspaceID, id, viewer(p)))
	if db.IsNotFound(err) {
		return v, httpx.NotFound("View")
	}
	return v, err
}

// viewer is the user id personal views are matched against (nil for API keys).
func viewer(p *auth.Principal) *uuid.UUID {
	if p.Kind == auth.KindUser {
		return &p.UserID
	}
	return nil
}

// canManage checks the caller may write a view that is (or becomes) shared or personal.
func canManage(p *auth.Principal, shared bool) error {
	if shared {
		if p.Kind == auth.KindUser && !p.Role.AtLeast(auth.RoleAdmin) {
			return httpx.Forbidden()
		}
		if p.Kind == auth.KindAPIKey && !p.HasScope(auth.ScopeSettingsWrite) {
			return httpx.Forbidden()
		}
		return nil
	}
	if p.Kind != auth.KindUser {
		return httpx.E(403, "forbidden", "API keys can only manage shared views")
	}
	return nil
}

func publishView(ctx context.Context, tx pgx.Tx, wid uuid.UUID, typ string, v View, data any) error {
	var topics []string
	if v.owner != nil {
		topics = []string{events.UserTopic(*v.owner)}
	}
	_, err := events.Publish(ctx, tx, events.Event{WorkspaceID: wid, Type: typ, Topics: topics, Data: data})
	return err
}

func registerViews(d *deps.Deps, api huma.API) {
	huma.Register(api, op("list-views", http.MethodGet, "/v1/views", "List views", "Views", 0),
		func(ctx context.Context, _ *struct{}) (*struct{ Body httpx.Page[View] }, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleViewer, auth.ScopeTicketsRead)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			rows, err := d.DB.Pool.Query(ctx, viewSelect+` WHERE workspace_id = $1 AND (user_id IS NULL OR user_id = $2)
				ORDER BY position, lower(name), id`, p.WorkspaceID, viewer(p))
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (View, error) { return scanView(r) })
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body httpx.Page[View] }{list(out)}, nil
		})

	huma.Register(api, op("create-view", http.MethodPost, "/v1/views", "Create a view", "Views", http.StatusCreated),
		func(ctx context.Context, in *struct{ Body viewWriteBody }) (*viewOut, error) {
			shared := in.Body.Shared != nil && *in.Body.Shared
			minRole, scope := auth.RoleAgent, ""
			if shared {
				minRole, scope = auth.RoleAdmin, auth.ScopeSettingsWrite
			}
			p, err := auth.RequireWorkspace(ctx, minRole, scope)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			if err := canManage(p, shared); err != nil {
				return nil, err
			}
			if in.Body.Name == nil {
				return nil, httpx.Validation("name is required")
			}
			name, err := cleanName("name", *in.Body.Name, 100)
			if err != nil {
				return nil, err
			}
			v := View{ID: ids.New(), Name: name, Shared: shared}
			if !shared {
				v.owner = &p.UserID
			}
			if in.Body.Filters != nil {
				v.Filters = *in.Body.Filters
			}
			err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
				if err := v.Filters.Normalize(ctx, tx, p.WorkspaceID); err != nil {
					return err
				}
				if in.Body.Position != nil {
					v.Position = *in.Body.Position
				} else if err := tx.QueryRow(ctx, `SELECT COALESCE(max(position) + 1, 0) FROM views WHERE workspace_id = $1 AND (user_id IS NULL OR user_id = $2)`,
					p.WorkspaceID, viewer(p)).Scan(&v.Position); err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `INSERT INTO views (id, workspace_id, user_id, name, filters, position) VALUES ($1,$2,$3,$4,$5,$6)`,
					v.ID, p.WorkspaceID, v.owner, v.Name, v.Filters, v.Position); err != nil {
					return err
				}
				return publishView(ctx, tx, p.WorkspaceID, "view.created", v, map[string]any{"view": v})
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &viewOut{v}, nil
		})

	huma.Register(api, op("get-view", http.MethodGet, "/v1/views/{id}", "Get a view", "Views", 0),
		func(ctx context.Context, in *idPath) (*viewOut, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleViewer, auth.ScopeTicketsRead)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := hd.ParseID(in.ID, "View")
			if err != nil {
				return nil, err
			}
			v, err := visibleView(ctx, d.DB.Pool, p, id, false)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &viewOut{v}, nil
		})

	huma.Register(api, op("update-view", http.MethodPatch, "/v1/views/{id}", "Update a view", "Views", 0),
		func(ctx context.Context, in *struct {
			ID   string `path:"id"`
			Body viewWriteBody
		}) (*viewOut, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAgent, auth.ScopeSettingsWrite)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := hd.ParseID(in.ID, "View")
			if err != nil {
				return nil, err
			}
			var v View
			err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
				var err error
				if v, err = visibleView(ctx, tx, p, id, true); err != nil {
					return err
				}
				if err := canManage(p, v.Shared); err != nil {
					return err
				}
				if in.Body.Shared != nil && *in.Body.Shared != v.Shared {
					// Changing who sees a view is a shared-view operation either way.
					if err := canManage(p, true); err != nil {
						return err
					}
					if !*in.Body.Shared {
						if err := canManage(p, false); err != nil {
							return err
						}
					}
					v.Shared = *in.Body.Shared
					if v.Shared {
						v.owner = nil
					} else {
						v.owner = &p.UserID
					}
				}
				if in.Body.Name != nil {
					if v.Name, err = cleanName("name", *in.Body.Name, 100); err != nil {
						return err
					}
				}
				if in.Body.Filters != nil {
					v.Filters = *in.Body.Filters
					if err := v.Filters.Normalize(ctx, tx, p.WorkspaceID); err != nil {
						return err
					}
				}
				if in.Body.Position != nil {
					v.Position = *in.Body.Position
				}
				if _, err := tx.Exec(ctx, `UPDATE views SET name = $3, filters = $4, position = $5, user_id = $6, updated_at = now()
					WHERE workspace_id = $1 AND id = $2`, p.WorkspaceID, id, v.Name, v.Filters, v.Position, v.owner); err != nil {
					return err
				}
				return publishView(ctx, tx, p.WorkspaceID, "view.updated", v, map[string]any{"view": v})
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &viewOut{v}, nil
		})

	huma.Register(api, op("delete-view", http.MethodDelete, "/v1/views/{id}", "Delete a view", "Views", http.StatusNoContent),
		func(ctx context.Context, in *idPath) (*struct{}, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAgent, auth.ScopeSettingsWrite)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := hd.ParseID(in.ID, "View")
			if err != nil {
				return nil, err
			}
			err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
				v, err := visibleView(ctx, tx, p, id, true)
				if err != nil {
					return err
				}
				if err := canManage(p, v.Shared); err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `DELETE FROM views WHERE workspace_id = $1 AND id = $2`, p.WorkspaceID, id); err != nil {
					return err
				}
				return publishView(ctx, tx, p.WorkspaceID, "view.deleted", v, map[string]any{"view_id": id})
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return nil, nil
		})
}
