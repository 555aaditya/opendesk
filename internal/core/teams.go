package core

import (
	"context"
	"net/http"
	"slices"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/useopendesk/opendesk/internal/audit"
	"github.com/useopendesk/opendesk/internal/auth"
	"github.com/useopendesk/opendesk/internal/db"
	"github.com/useopendesk/opendesk/internal/displayname"
	"github.com/useopendesk/opendesk/internal/events"
	"github.com/useopendesk/opendesk/internal/httpx"
	"github.com/useopendesk/opendesk/internal/ids"
)

type CoreTeam struct {
	ID        uuid.UUID   `json:"id"`
	Name      string      `json:"name"`
	MemberIDs []uuid.UUID `json:"member_ids"`
	CreatedAt time.Time   `json:"created_at"`
}

const teamSelect = `SELECT t.id, t.name, t.created_at,
	COALESCE((SELECT array_agg(tm.user_id ORDER BY tm.user_id) FROM team_members tm WHERE tm.team_id = t.id), '{}')
	FROM teams t`

func scanTeam(r pgx.Row) (CoreTeam, error) {
	var t CoreTeam
	err := r.Scan(&t.ID, &t.Name, &t.CreatedAt, &t.MemberIDs)
	if t.MemberIDs == nil {
		t.MemberIDs = []uuid.UUID{}
	}
	return t, err
}

func loadTeam(ctx context.Context, q db.Querier, wid, id uuid.UUID) (CoreTeam, error) {
	return scanTeam(q.QueryRow(ctx, teamSelect+` WHERE t.workspace_id = $1 AND t.id = $2`, wid, id))
}

// setTeamMembers replaces a team's members after checking each belongs to the workspace.
func setTeamMembers(ctx context.Context, tx pgx.Tx, wid, teamID uuid.UUID, userIDs []uuid.UUID) error {
	uniq := slices.Compact(slices.SortedFunc(slices.Values(userIDs), func(a, b uuid.UUID) int { return compareUUID(a, b) }))
	if len(uniq) > 500 {
		return httpx.Validation("A team can have at most 500 members.")
	}
	var n int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM members WHERE workspace_id = $1 AND user_id = ANY($2)`, wid, uniq).Scan(&n); err != nil {
		return err
	}
	if n != len(uniq) {
		return httpx.Validation("member_ids must all be members of this workspace.")
	}
	if _, err := tx.Exec(ctx, `DELETE FROM team_members WHERE team_id = $1`, teamID); err != nil {
		return err
	}
	if len(uniq) > 0 {
		if _, err := tx.Exec(ctx, `INSERT INTO team_members (team_id, user_id) SELECT $1, unnest($2::uuid[])`, teamID, uniq); err != nil {
			return err
		}
	}
	return nil
}

func compareUUID(a, b uuid.UUID) int {
	for i := range a {
		if a[i] != b[i] {
			if a[i] < b[i] {
				return -1
			}
			return 1
		}
	}
	return 0
}

func teamNameConflict(err error) error {
	if db.IsUniqueViolation(err, "") {
		return httpx.Conflict("A team with this name already exists.")
	}
	return err
}

func (s *svc) registerTeams(api huma.API) {
	tags := []string{"Teams"}

	register(s, api, huma.Operation{OperationID: "list-teams", Method: http.MethodGet, Path: "/v1/teams",
		Summary: "List teams", Tags: tags},
		func(ctx context.Context, in *struct{ httpx.ListParams }) (*struct{ Body httpx.Page[CoreTeam] }, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleViewer, auth.ScopeSettingsRead)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			var cur struct {
				Name string    `json:"n"`
				ID   uuid.UUID `json:"id"`
			}
			if err := httpx.DecodeCursor(in.Cursor, &cur); err != nil {
				return nil, err
			}
			rows, err := s.d.DB.Pool.Query(ctx, teamSelect+` WHERE t.workspace_id = $1 AND (t.name, t.id) > ($2, $3)
				ORDER BY t.name, t.id LIMIT $4`, p.WorkspaceID, cur.Name, cur.ID, in.Limit+1)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (CoreTeam, error) { return scanTeam(r) })
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body httpx.Page[CoreTeam] }{httpx.NewPage(list, in.Limit, func(t CoreTeam) any {
				return map[string]any{"n": t.Name, "id": t.ID}
			})}, nil
		})

	register(s, api, huma.Operation{OperationID: "get-team", Method: http.MethodGet, Path: "/v1/teams/{id}",
		Summary: "Get a team", Tags: tags},
		func(ctx context.Context, in *struct {
			ID string `path:"id"`
		}) (*struct{ Body CoreTeam }, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleViewer, auth.ScopeSettingsRead)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := parseID(in.ID, "Team")
			if err != nil {
				return nil, err
			}
			t, err := loadTeam(ctx, s.d.DB.Pool, p.WorkspaceID, id)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body CoreTeam }{t}, nil
		})

	type coreTeamBody struct {
		Name      *string      `json:"name,omitempty" maxLength:"200"`
		MemberIDs *[]uuid.UUID `json:"member_ids,omitempty" maxItems:"500"`
	}

	register(s, api, huma.Operation{OperationID: "create-team", Method: http.MethodPost, Path: "/v1/teams",
		Summary: "Create a team", Tags: tags, DefaultStatus: http.StatusCreated},
		func(ctx context.Context, in *struct{ Body coreTeamBody }) (*struct{ Body CoreTeam }, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAdmin, auth.ScopeSettingsWrite)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			raw := ""
			if in.Body.Name != nil {
				raw = *in.Body.Name
			}
			name, err := displayname.Validate("Team name", raw, displayname.Workspace, false)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			var t CoreTeam
			err = s.tx(ctx, func(tx pgx.Tx) error {
				id := ids.New()
				if _, err := tx.Exec(ctx, `INSERT INTO teams (id, workspace_id, name) VALUES ($1, $2, $3)`, id, p.WorkspaceID, name); err != nil {
					return teamNameConflict(err)
				}
				if in.Body.MemberIDs != nil {
					if err := setTeamMembers(ctx, tx, p.WorkspaceID, id, *in.Body.MemberIDs); err != nil {
						return err
					}
				}
				if t, err = loadTeam(ctx, tx, p.WorkspaceID, id); err != nil {
					return err
				}
				if _, err := events.Publish(ctx, tx, events.Event{WorkspaceID: p.WorkspaceID, Type: "team.created", Data: map[string]any{"team": t}}); err != nil {
					return err
				}
				return audit.Log(ctx, tx, p, p.WorkspaceID, "team.created", "team", &id, map[string]any{"name": name})
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body CoreTeam }{t}, nil
		})

	register(s, api, huma.Operation{OperationID: "update-team", Method: http.MethodPatch, Path: "/v1/teams/{id}",
		Summary: "Update a team", Tags: tags},
		func(ctx context.Context, in *struct {
			ID   string `path:"id"`
			Body coreTeamBody
		}) (*struct{ Body CoreTeam }, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAdmin, auth.ScopeSettingsWrite)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := parseID(in.ID, "Team")
			if err != nil {
				return nil, err
			}
			var name *string
			if in.Body.Name != nil {
				n, err := displayname.Validate("Team name", *in.Body.Name, displayname.Workspace, false)
				if err != nil {
					return nil, httpx.Wrap(err)
				}
				name = &n
			}
			var t CoreTeam
			err = s.tx(ctx, func(tx pgx.Tx) error {
				tag, err := tx.Exec(ctx, `UPDATE teams SET name = COALESCE($3, name) WHERE id = $1 AND workspace_id = $2`, id, p.WorkspaceID, name)
				if err != nil {
					return teamNameConflict(err)
				}
				if tag.RowsAffected() == 0 {
					return httpx.NotFound("Team")
				}
				if in.Body.MemberIDs != nil {
					if err := setTeamMembers(ctx, tx, p.WorkspaceID, id, *in.Body.MemberIDs); err != nil {
						return err
					}
				}
				if t, err = loadTeam(ctx, tx, p.WorkspaceID, id); err != nil {
					return err
				}
				if _, err := events.Publish(ctx, tx, events.Event{WorkspaceID: p.WorkspaceID, Type: "team.updated", Data: map[string]any{"team": t}}); err != nil {
					return err
				}
				return audit.Log(ctx, tx, p, p.WorkspaceID, "team.updated", "team", &id, nil)
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body CoreTeam }{t}, nil
		})

	register(s, api, huma.Operation{OperationID: "delete-team", Method: http.MethodDelete, Path: "/v1/teams/{id}",
		Summary: "Delete a team", Tags: tags, DefaultStatus: http.StatusNoContent},
		func(ctx context.Context, in *struct {
			ID string `path:"id"`
		}) (*struct{}, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAdmin, auth.ScopeSettingsWrite)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := parseID(in.ID, "Team")
			if err != nil {
				return nil, err
			}
			err = s.tx(ctx, func(tx pgx.Tx) error {
				tag, err := tx.Exec(ctx, `DELETE FROM teams WHERE id = $1 AND workspace_id = $2`, id, p.WorkspaceID)
				if err != nil {
					return err
				}
				if tag.RowsAffected() == 0 {
					return httpx.NotFound("Team")
				}
				if _, err := events.Publish(ctx, tx, events.Event{WorkspaceID: p.WorkspaceID, Type: "team.deleted", Data: map[string]any{"team_id": id}}); err != nil {
					return err
				}
				return audit.Log(ctx, tx, p, p.WorkspaceID, "team.deleted", "team", &id, nil)
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return nil, nil
		})
}
