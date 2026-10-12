package widget

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"

	"github.com/useopendesk/opendesk/internal/audit"
	"github.com/useopendesk/opendesk/internal/auth"
	"github.com/useopendesk/opendesk/internal/helpdesk/hd"
	"github.com/useopendesk/opendesk/internal/httpx"
)

type widgetSettingsPatch struct {
	Greeting       *string   `json:"greeting,omitempty" maxLength:"2000"`
	RequireEmail   *bool     `json:"require_email,omitempty"`
	Enabled        *bool     `json:"enabled,omitempty"`
	AllowedOrigins *[]string `json:"allowed_origins,omitempty" maxItems:"50"`
	Color          *string   `json:"color,omitempty" maxLength:"7" doc:"#rrggbb, or empty for the workspace brand colour"`
	Theme          *string   `json:"theme,omitempty" enum:"auto,light,dark"`
	Position       *string   `json:"position,omitempty" enum:"right,left"`
	OffsetX        *int      `json:"offset_x,omitempty" minimum:"0" maximum:"200"`
	OffsetY        *int      `json:"offset_y,omitempty" minimum:"0" maximum:"200"`
	Launcher       *string   `json:"launcher,omitempty" enum:"icon,label"`
	LauncherLabel  *string   `json:"launcher_label,omitempty" maxLength:"200"`
	Radius         *string   `json:"radius,omitempty" enum:"square,soft,round"`
	Title          *string   `json:"title,omitempty" maxLength:"200"`
	Subtitle       *string   `json:"subtitle,omitempty" maxLength:"400"`
	ShowTeam       *bool     `json:"show_team,omitempty"`
	Suggestions    *[]string `json:"suggestions,omitempty" maxItems:"10"`
	Sound          *bool     `json:"sound,omitempty"`
	BotName        *string   `json:"bot_name,omitempty" maxLength:"200"`
}

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// cleanLabel collapses whitespace in a short visitor-facing text and refuses markup and
// control characters.
func cleanLabel(field, s string, minLen, maxLen int) (string, error) {
	s = strings.Join(strings.Fields(s), " ")
	n := utf8.RuneCountInString(s)
	if s == "" && minLen == 0 {
		return "", nil
	}
	if n < max(minLen, 1) || n > maxLen || strings.ContainsAny(s, "<>") ||
		strings.IndexFunc(s, func(r rune) bool { return unicode.IsControl(r) || unicode.In(r, unicode.Cf) }) >= 0 {
		return "", httpx.Validation(fmt.Sprintf("%s must be up to %d characters of plain text", field, maxLen))
	}
	return s, nil
}

func cleanGreeting(s string) (string, error) {
	s = strings.TrimSpace(strings.ReplaceAll(s, "\r\n", "\n"))
	if utf8.RuneCountInString(s) > 300 {
		return "", httpx.Validation("greeting must be 300 characters or less")
	}
	for _, r := range s {
		if (unicode.IsControl(r) && r != '\n') || unicode.In(r, unicode.Cf) {
			return "", httpx.Validation("greeting contains characters that are not allowed")
		}
	}
	return s, nil
}

// cleanOrigin accepts https://host[:port], or http:// for localhost only, with no path.
func cleanOrigin(raw string) (string, error) {
	bad := httpx.Validation("allowed_origins entries must look like https://example.com")
	u, err := url.Parse(strings.TrimRight(strings.TrimSpace(raw), "/"))
	if err != nil || u.Host == "" || u.User != nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" {
		return "", bad
	}
	scheme, host := strings.ToLower(u.Scheme), strings.ToLower(u.Host)
	hostname := strings.ToLower(u.Hostname())
	switch scheme {
	case "https":
	case "http":
		if hostname != "localhost" && hostname != "127.0.0.1" && !strings.HasSuffix(hostname, ".localhost") {
			return "", httpx.Validation("allowed_origins must use https, except for localhost")
		}
	default:
		return "", bad
	}
	if port := u.Port(); port != "" {
		if _, err := net.LookupPort("tcp", port); err != nil {
			return "", bad
		}
	}
	if strings.ContainsAny(hostname, " *") {
		return "", bad
	}
	return scheme + "://" + host, nil
}

func (h *handler) registerSettings(api huma.API) {
	huma.Register(api, huma.Operation{OperationID: "get-widget-settings", Method: http.MethodGet, Path: "/v1/widget/settings",
		Summary: "Get chat widget settings", Tags: []string{"Widget"}},
		func(ctx context.Context, _ *struct{}) (*struct{ Body hd.WidgetSettings }, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAdmin, auth.ScopeSettingsRead)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			s, err := hd.LoadSettings(ctx, h.d.DB.Pool, p.WorkspaceID)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body hd.WidgetSettings }{s.WidgetOrDefault()}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "update-widget-settings", Method: http.MethodPatch, Path: "/v1/widget/settings",
		Summary: "Update chat widget settings", Tags: []string{"Widget"}},
		func(ctx context.Context, in *struct{ Body widgetSettingsPatch }) (*struct{ Body hd.WidgetSettings }, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAdmin, auth.ScopeSettingsWrite)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			var out hd.WidgetSettings
			err = h.d.DB.Tx(ctx, func(tx pgx.Tx) error {
				var raw []byte
				if err := tx.QueryRow(ctx, `SELECT settings FROM workspaces WHERE id = $1 FOR UPDATE`, p.WorkspaceID).Scan(&raw); err != nil {
					return err
				}
				w := hd.ParseSettings(raw).WidgetOrDefault()
				var fields []string
				b := in.Body
				if b.Greeting != nil {
					g, err := cleanGreeting(*b.Greeting)
					if err != nil {
						return err
					}
					w.Greeting = g
					fields = append(fields, "greeting")
				}
				if b.RequireEmail != nil {
					w.RequireEmail = *b.RequireEmail
					fields = append(fields, "require_email")
				}
				if b.Enabled != nil {
					w.Enabled = *b.Enabled
					fields = append(fields, "enabled")
				}
				if b.Color != nil {
					c := strings.TrimSpace(*b.Color)
					if c != "" && !hexColor.MatchString(c) {
						return httpx.Validation("color must look like #1a2b3c")
					}
					w.Color = strings.ToLower(c)
					fields = append(fields, "color")
				}
				for name, pair := range map[string]struct {
					in  *string
					out *string
				}{"theme": {b.Theme, &w.Theme}, "position": {b.Position, &w.Position}, "launcher": {b.Launcher, &w.Launcher}, "radius": {b.Radius, &w.Radius}} {
					if pair.in != nil {
						*pair.out = *pair.in // huma checked the enum
						fields = append(fields, name)
					}
				}
				if b.OffsetX != nil {
					w.OffsetX = *b.OffsetX
					fields = append(fields, "offset_x")
				}
				if b.OffsetY != nil {
					w.OffsetY = *b.OffsetY
					fields = append(fields, "offset_y")
				}
				for name, t := range map[string]struct {
					in  *string
					out *string
					max int
				}{"launcher_label": {b.LauncherLabel, &w.LauncherLabel, 24}, "title": {b.Title, &w.Title, 40},
					"subtitle": {b.Subtitle, &w.Subtitle, 80}, "bot_name": {b.BotName, &w.BotName, 30}} {
					if t.in == nil {
						continue
					}
					v, err := cleanLabel(name, *t.in, 0, t.max)
					if err != nil {
						return err
					}
					*t.out = v
					fields = append(fields, name)
				}
				if b.ShowTeam != nil {
					w.ShowTeam = *b.ShowTeam
					fields = append(fields, "show_team")
				}
				if b.Sound != nil {
					w.Sound = *b.Sound
					fields = append(fields, "sound")
				}
				if b.Suggestions != nil {
					out := []string{}
					for _, sg := range *b.Suggestions {
						v, err := cleanLabel("each suggestion", sg, 2, 60)
						if err != nil {
							return err
						}
						if !contains(out, v) {
							out = append(out, v)
						}
					}
					if len(out) > 4 {
						return httpx.Validation("at most 4 suggestions")
					}
					w.Suggestions = out
					fields = append(fields, "suggestions")
				}
				if b.AllowedOrigins != nil {
					if len(*b.AllowedOrigins) > 20 {
						return httpx.Validation("at most 20 allowed_origins")
					}
					origins := []string{}
					for _, o := range *b.AllowedOrigins {
						c, err := cleanOrigin(o)
						if err != nil {
							return err
						}
						if !contains(origins, c) {
							origins = append(origins, c)
						}
					}
					w.AllowedOrigins = origins
					fields = append(fields, "allowed_origins")
				}
				doc, err := json.Marshal(w)
				if err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `UPDATE workspaces SET settings = jsonb_set(settings, '{widget}', $2::jsonb, true), updated_at = now()
					WHERE id = $1`, p.WorkspaceID, string(doc)); err != nil {
					return err
				}
				if len(fields) > 0 {
					if err := audit.Log(ctx, tx, p, p.WorkspaceID, "widget.settings_updated", "workspace", &p.WorkspaceID,
						map[string]any{"fields": fields}); err != nil {
						return err
					}
				}
				out = w
				return nil
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body hd.WidgetSettings }{out}, nil
		})
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
