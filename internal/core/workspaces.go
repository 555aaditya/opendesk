package core

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/text/unicode/norm"

	"github.com/opendesk/opendesk/internal/audit"
	"github.com/opendesk/opendesk/internal/auth"
	"github.com/opendesk/opendesk/internal/billing"
	"github.com/opendesk/opendesk/internal/crypto"
	"github.com/opendesk/opendesk/internal/db"
	"github.com/opendesk/opendesk/internal/displayname"
	"github.com/opendesk/opendesk/internal/events"
	"github.com/opendesk/opendesk/internal/httpx"
	"github.com/opendesk/opendesk/internal/ids"
	"github.com/opendesk/opendesk/internal/plan"
)

// CoreWorkspaceSettings are the agent-editable workspace options (contracts/api.md).
// Other keys in workspaces.settings (for example "widget") belong to other areas and
// are preserved on update.
type CoreWorkspaceSettings struct {
	BrandColor        *string `json:"brand_color,omitempty" doc:"Hex colour, #RRGGBB"`
	Timezone          *string `json:"timezone,omitempty" doc:"IANA time zone"`
	HelpCenterEnabled *bool   `json:"help_center_enabled,omitempty"`
	HelpCenterTitle   *string `json:"help_center_title,omitempty" maxLength:"100"`
	CSATEnabled       *bool   `json:"csat_enabled,omitempty"`
	AutoAssign        *string `json:"auto_assign,omitempty" enum:"none,round_robin"`
}

type CoreWorkspace struct {
	ID        uuid.UUID             `json:"id"`
	Name      string                `json:"name"`
	Slug      string                `json:"slug"`
	WidgetKey string                `json:"widget_key"`
	Settings  CoreWorkspaceSettings `json:"settings"`
	CreatedAt time.Time             `json:"created_at"`
}

type CoreMembership struct {
	Workspace CoreWorkspace `json:"workspace"`
	Role      string        `json:"role" enum:"owner,admin,agent,viewer"`
}

const workspaceCols = `w.id, w.name, w.slug, w.widget_key, w.settings, w.created_at`

func scanWorkspace(row pgx.Row, extra ...any) (CoreWorkspace, error) {
	var w CoreWorkspace
	var raw []byte
	err := row.Scan(append([]any{&w.ID, &w.Name, &w.Slug, &w.WidgetKey, &raw, &w.CreatedAt}, extra...)...)
	if err != nil {
		return w, err
	}
	_ = json.Unmarshal(raw, &w.Settings)
	return w, nil
}

func loadWorkspace(ctx context.Context, q db.Querier, wid uuid.UUID) (CoreWorkspace, error) {
	return scanWorkspace(q.QueryRow(ctx, `SELECT `+workspaceCols+` FROM workspaces w WHERE w.id = $1`, wid))
}

func loadMemberships(ctx context.Context, q db.Querier, uid uuid.UUID) ([]CoreMembership, error) {
	rows, err := q.Query(ctx, `SELECT `+workspaceCols+`, m.role FROM members m JOIN workspaces w ON w.id = m.workspace_id
		WHERE m.user_id = $1 ORDER BY m.created_at LIMIT 200`, uid)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (CoreMembership, error) {
		var m CoreMembership
		w, err := scanWorkspace(r, &m.Role)
		m.Workspace = w
		return m, err
	})
	if out == nil {
		out = []CoreMembership{}
	}
	return out, err
}

var (
	hexColorRe = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
	slugDashRe = regexp.MustCompile(`-+`)
)

// validateSettings checks a settings patch and returns the JSON object to merge.
func validateSettings(s *CoreWorkspaceSettings) (map[string]any, error) {
	out := map[string]any{}
	if s.BrandColor != nil {
		if *s.BrandColor != "" && !hexColorRe.MatchString(*s.BrandColor) {
			return nil, httpx.Validation("brand_color must be a hex colour like #0A0A0A.")
		}
		out["brand_color"] = strings.ToUpper(*s.BrandColor)
	}
	if s.Timezone != nil {
		if _, err := time.LoadLocation(*s.Timezone); err != nil || *s.Timezone == "" || *s.Timezone == "Local" {
			return nil, httpx.Validation("timezone must be an IANA time zone like Europe/Berlin.")
		}
		out["timezone"] = *s.Timezone
	}
	if s.HelpCenterEnabled != nil {
		out["help_center_enabled"] = *s.HelpCenterEnabled
	}
	if s.HelpCenterTitle != nil {
		t := displayname.Normalize(*s.HelpCenterTitle)
		if utf8.RuneCountInString(t) > 100 || strings.ContainsAny(t, "<>`") || strings.IndexFunc(t, unicode.IsControl) >= 0 {
			return nil, httpx.Validation("help_center_title must be 100 characters or less, without markup.")
		}
		out["help_center_title"] = t
	}
	if s.CSATEnabled != nil {
		out["csat_enabled"] = *s.CSATEnabled
	}
	if s.AutoAssign != nil {
		if *s.AutoAssign != "none" && *s.AutoAssign != "round_robin" {
			return nil, httpx.Validation("auto_assign must be none or round_robin.")
		}
		out["auto_assign"] = *s.AutoAssign
	}
	return out, nil
}

// slugify makes a URL slug from a workspace name.
func slugify(name string) string {
	var b strings.Builder
	for _, r := range norm.NFKD.String(strings.ToLower(name)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case unicode.Is(unicode.Mn, r):
		default:
			b.WriteByte('-')
		}
	}
	s := strings.Trim(slugDashRe.ReplaceAllString(b.String(), "-"), "-")
	if len(s) > 40 {
		s = strings.Trim(s[:40], "-")
	}
	if len(s) < 2 {
		s = "workspace"
	}
	return s
}

func newWidgetKey() string { return "wk_" + crypto.RandomString(24) }

// newWidgetSecret returns the plaintext widget secret and its sealed form. The widget
// verifies user_hash = hex(HMAC-SHA256(secret, user_id)) with the plaintext as key.
func (s *svc) newWidgetSecret() (string, []byte, error) {
	secret := "wsec_" + crypto.RandomToken(32)
	sealed, err := s.d.Box.Seal([]byte(secret))
	return secret, sealed, err
}

// createWorkspace creates a workspace owned by uid and seeds its defaults.
func (s *svc) createWorkspace(ctx context.Context, tx pgx.Tx, p *auth.Principal, name string) (CoreWorkspace, error) {
	wid := ids.New()
	_, sealed, err := s.newWidgetSecret()
	if err != nil {
		return CoreWorkspace{}, err
	}
	base := slugify(name)
	slug := base
	for i := 0; ; i++ {
		var taken bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM workspaces WHERE slug = $1)`, slug).Scan(&taken); err != nil {
			return CoreWorkspace{}, err
		}
		if !taken {
			break
		}
		if i > 8 {
			return CoreWorkspace{}, httpx.Conflict("Could not pick a unique address for this workspace. Try another name.")
		}
		slug = base + "-" + crypto.RandomString(4)
	}
	settings := map[string]any{"timezone": "UTC", "help_center_enabled": true, "help_center_title": name + " help center",
		"csat_enabled": false, "auto_assign": "none"}
	if utf8.RuneCountInString(settings["help_center_title"].(string)) > 100 {
		settings["help_center_title"] = "Help center"
	}
	if _, err := tx.Exec(ctx, `INSERT INTO workspaces (id, name, slug, widget_key, widget_secret_enc, settings) VALUES ($1, $2, $3, $4, $5, $6)`,
		wid, name, slug, newWidgetKey(), sealed, settings); err != nil {
		return CoreWorkspace{}, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, wid, p.UserID); err != nil {
		return CoreWorkspace{}, err
	}
	if err := plan.Ensure(ctx, tx, wid); err != nil {
		return CoreWorkspace{}, err
	}
	views := []struct {
		name    string
		filters map[string]any
	}{
		{"Unassigned", map[string]any{"status": []string{"open", "pending"}, "assignee": "none"}},
		{"My open tickets", map[string]any{"status": []string{"open", "pending"}, "assignee": "me"}},
		{"All open", map[string]any{"status": []string{"open"}}},
	}
	for i, v := range views {
		if _, err := tx.Exec(ctx, `INSERT INTO views (id, workspace_id, user_id, name, filters, position) VALUES ($1, $2, NULL, $3, $4, $5)`,
			ids.New(), wid, v.name, v.filters, i); err != nil {
			return CoreWorkspace{}, err
		}
	}
	for _, t := range []string{"billing", "bug", "feature request", "question"} {
		if _, err := tx.Exec(ctx, `INSERT INTO tags (id, workspace_id, name) VALUES ($1, $2, $3)`, ids.New(), wid, t); err != nil {
			return CoreWorkspace{}, err
		}
	}
	if _, err := tx.Exec(ctx, `INSERT INTO sla_policies (id, workspace_id, name, priority, first_response_minutes, resolution_minutes, enabled, position)
		VALUES ($1, $2, 'Default', NULL, 240, 2880, true, 0)`, ids.New(), wid); err != nil {
		return CoreWorkspace{}, err
	}
	if err := audit.Log(ctx, tx, p, wid, "workspace.created", "workspace", &wid, map[string]any{"name": name}); err != nil {
		return CoreWorkspace{}, err
	}
	return loadWorkspace(ctx, tx, wid)
}

// fileKeys lists the stored objects of a workspace, removed after the rows are.
func fileKeys(ctx context.Context, q db.Querier, wid uuid.UUID) ([]string, error) {
	rows, err := q.Query(ctx, `SELECT storage_key FROM attachments WHERE workspace_id = $1
		UNION ALL SELECT raw_storage_key FROM inbound_emails WHERE workspace_id = $1`, wid)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// purgeFiles deletes stored objects in the background after their rows are gone.
func (s *svc) purgeFiles(keys []string) {
	if len(keys) == 0 || s.d.Storage == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		failed := 0
		for _, k := range keys {
			if k == "" {
				continue
			}
			if err := s.d.Storage.Delete(ctx, k); err != nil {
				failed++
			}
		}
		if failed > 0 {
			s.d.Log.Warn("purge files", "failed", failed, "total", len(keys))
		}
	}()
}

// deleteWorkspace removes a workspace and everything it owns. It returns the members
// to disconnect and the stored files to purge.
func (s *svc) deleteWorkspace(ctx context.Context, tx pgx.Tx, wid uuid.UUID) ([]uuid.UUID, []string, error) {
	rows, err := tx.Query(ctx, `SELECT user_id FROM members WHERE workspace_id = $1`, wid)
	if err != nil {
		return nil, nil, err
	}
	members, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, nil, err
	}
	keys, err := fileKeys(ctx, tx, wid)
	if err != nil {
		return nil, nil, err
	}
	if err := billing.EnqueueCancel(ctx, s.d, tx, wid); err != nil {
		return nil, nil, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM workspaces WHERE id = $1`, wid); err != nil {
		return nil, nil, err
	}
	return members, keys, nil
}

func (s *svc) registerWorkspaces(api huma.API) {
	tags := []string{"Workspace"}

	register(s, api, huma.Operation{OperationID: "create-workspace", Method: http.MethodPost, Path: "/v1/workspaces",
		Summary: "Create a workspace", Tags: tags, DefaultStatus: http.StatusCreated},
		func(ctx context.Context, in *struct {
			Body struct {
				Name string `json:"name" maxLength:"200"`
			}
		}) (*struct{ Body CoreWorkspace }, error) {
			p, err := auth.RequireUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			if err := s.limit("workspace:create:"+p.UserID.String(), 10, time.Hour); err != nil {
				return nil, err
			}
			name, err := displayname.Validate("Workspace name", in.Body.Name, displayname.Workspace, false)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			var w CoreWorkspace
			err = s.tx(ctx, func(tx pgx.Tx) error {
				w, err = s.createWorkspace(ctx, tx, p, name)
				return err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			s.d.Analytics.Capture(p.UserID.String(), w.ID.String(), "workspace_created", nil)
			return &struct{ Body CoreWorkspace }{w}, nil
		})

	register(s, api, huma.Operation{OperationID: "get-workspace", Method: http.MethodGet, Path: "/v1/workspace",
		Summary: "Get the current workspace", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*struct{ Body CoreWorkspace }, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleViewer, auth.ScopeSettingsRead)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			w, err := loadWorkspace(ctx, s.d.DB.Pool, p.WorkspaceID)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body CoreWorkspace }{w}, nil
		})

	register(s, api, huma.Operation{OperationID: "update-workspace", Method: http.MethodPatch, Path: "/v1/workspace",
		Summary: "Update the current workspace", Tags: tags},
		func(ctx context.Context, in *struct {
			Body struct {
				Name     *string                `json:"name,omitempty" maxLength:"200"`
				Settings *CoreWorkspaceSettings `json:"settings,omitempty"`
			}
		}) (*struct{ Body CoreWorkspace }, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAdmin, auth.ScopeSettingsWrite)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			var name *string
			if in.Body.Name != nil {
				n, err := displayname.Validate("Workspace name", *in.Body.Name, displayname.Workspace, false)
				if err != nil {
					return nil, httpx.Wrap(err)
				}
				name = &n
			}
			patch := map[string]any{}
			if in.Body.Settings != nil {
				if patch, err = validateSettings(in.Body.Settings); err != nil {
					return nil, err
				}
			}
			var w CoreWorkspace
			err = s.tx(ctx, func(tx pgx.Tx) error {
				if _, err := tx.Exec(ctx, `UPDATE workspaces SET name = COALESCE($2, name), settings = settings || $3::jsonb, updated_at = now()
					WHERE id = $1`, p.WorkspaceID, name, patch); err != nil {
					return err
				}
				changed := make([]string, 0, len(patch)+1)
				if name != nil {
					changed = append(changed, "name")
				}
				for k := range patch {
					changed = append(changed, "settings."+k)
				}
				if len(changed) > 0 {
					if err := audit.Log(ctx, tx, p, p.WorkspaceID, "workspace.updated", "workspace", &p.WorkspaceID,
						map[string]any{"changes": changed}); err != nil {
						return err
					}
				}
				w, err = loadWorkspace(ctx, tx, p.WorkspaceID)
				return err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body CoreWorkspace }{w}, nil
		})

	register(s, api, huma.Operation{OperationID: "delete-workspace", Method: http.MethodDelete, Path: "/v1/workspace",
		Summary: "Delete the current workspace and all its data", Tags: tags, DefaultStatus: http.StatusNoContent},
		func(ctx context.Context, in *struct {
			Body struct {
				ConfirmName string `json:"confirm_name" maxLength:"200"`
			}
		}) (*struct{}, error) {
			p, err := requireUserWorkspace(ctx, auth.RoleOwner)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			if err := s.requireMFA(ctx, p); err != nil {
				return nil, httpx.Wrap(err)
			}
			if err := requireRecentLogin(ctx, s.d.DB.Pool, p); err != nil {
				return nil, httpx.Wrap(err)
			}
			var members []uuid.UUID
			var keys []string
			err = s.tx(ctx, func(tx pgx.Tx) error {
				var name string
				if err := tx.QueryRow(ctx, `SELECT name FROM workspaces WHERE id = $1 FOR UPDATE`, p.WorkspaceID).Scan(&name); err != nil {
					return err
				}
				if strings.TrimSpace(in.Body.ConfirmName) != name {
					return httpx.E(422, "confirm_name_mismatch", "Type the workspace name exactly to confirm.")
				}
				members, keys, err = s.deleteWorkspace(ctx, tx, p.WorkspaceID)
				return err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			s.d.Log.Info("workspace deleted", "workspace_id", p.WorkspaceID, "actor_user_id", p.UserID, "ip", p.IP)
			s.purgeFiles(keys)
			for _, uid := range members {
				s.disconnect(uid, uuid.Nil)
			}
			return nil, nil
		})

	register(s, api, huma.Operation{OperationID: "transfer-workspace", Method: http.MethodPost, Path: "/v1/workspace/transfer",
		Summary: "Transfer workspace ownership", Tags: tags},
		func(ctx context.Context, in *struct {
			Body struct {
				UserID uuid.UUID `json:"user_id"`
			}
		}) (*struct{ Body CoreMember }, error) {
			p, err := requireUserWorkspace(ctx, auth.RoleOwner)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			if err := s.requireMFA(ctx, p); err != nil {
				return nil, httpx.Wrap(err)
			}
			if err := requireRecentLogin(ctx, s.d.DB.Pool, p); err != nil {
				return nil, httpx.Wrap(err)
			}
			if in.Body.UserID == p.UserID {
				return nil, httpx.Validation("You already own this workspace.")
			}
			var m CoreMember
			err = s.tx(ctx, func(tx pgx.Tx) error {
				var role string
				if err := tx.QueryRow(ctx, `SELECT role FROM members WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE`,
					p.WorkspaceID, in.Body.UserID).Scan(&role); err != nil {
					if db.IsNotFound(err) {
						return httpx.NotFound("Member")
					}
					return err
				}
				if _, err := tx.Exec(ctx, `UPDATE members SET role = 'admin' WHERE workspace_id = $1 AND user_id = $2`, p.WorkspaceID, p.UserID); err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `UPDATE members SET role = 'owner' WHERE workspace_id = $1 AND user_id = $2`, p.WorkspaceID, in.Body.UserID); err != nil {
					return err
				}
				for _, uid := range []uuid.UUID{p.UserID, in.Body.UserID} {
					mm, err := loadMember(ctx, tx, p.WorkspaceID, uid)
					if err != nil {
						return err
					}
					if _, err := events.Publish(ctx, tx, events.Event{WorkspaceID: p.WorkspaceID, Type: "member.updated",
						Topics: []string{events.UserTopic(uid)}, Data: map[string]any{"member": mm}}); err != nil {
						return err
					}
					if uid == in.Body.UserID {
						m = mm
					}
				}
				return audit.Log(ctx, tx, p, p.WorkspaceID, "workspace.transferred", "user", &in.Body.UserID,
					map[string]any{"from_user_id": p.UserID, "previous_role": role})
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body CoreMember }{m}, nil
		})

	register(s, api, huma.Operation{OperationID: "rotate-widget-secret", Method: http.MethodPost, Path: "/v1/workspace/widget-secret/rotate",
		Summary: "Rotate the chat widget identity secret", Tags: tags},
		func(ctx context.Context, _ *struct{}) (*struct {
			CacheControl string `header:"Cache-Control"`
			Body         struct {
				Secret string `json:"secret"`
			}
		}, error) {
			p, err := requireUserWorkspace(ctx, auth.RoleAdmin)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			if err := s.requireMFA(ctx, p); err != nil {
				return nil, httpx.Wrap(err)
			}
			if err := requireRecentLogin(ctx, s.d.DB.Pool, p); err != nil {
				return nil, httpx.Wrap(err)
			}
			secret, sealed, err := s.newWidgetSecret()
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			err = s.tx(ctx, func(tx pgx.Tx) error {
				if _, err := tx.Exec(ctx, `UPDATE workspaces SET widget_secret_enc = $2, updated_at = now() WHERE id = $1`, p.WorkspaceID, sealed); err != nil {
					return err
				}
				return audit.Log(ctx, tx, p, p.WorkspaceID, "workspace.widget_secret_rotated", "workspace", &p.WorkspaceID, nil)
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			out := &struct {
				CacheControl string `header:"Cache-Control"`
				Body         struct {
					Secret string `json:"secret"`
				}
			}{CacheControl: "no-store"}
			out.Body.Secret = secret
			return out, nil
		})
}
