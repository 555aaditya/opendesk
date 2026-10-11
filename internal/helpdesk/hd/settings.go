package hd

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"

	"github.com/opendesk/opendesk/internal/db"
)

// WidgetSettings lives in workspaces.settings.widget.
type WidgetSettings struct {
	Greeting       string   `json:"greeting"`
	RequireEmail   bool     `json:"require_email"`
	Enabled        bool     `json:"enabled"`
	AllowedOrigins []string `json:"allowed_origins"`
}

// Settings is the helpdesk's view of workspaces.settings. Unknown keys are kept by
// writers that patch individual keys with jsonb operators.
type Settings struct {
	BrandColor        string `json:"brand_color"`
	Timezone          string `json:"timezone"`
	HelpCenterEnabled bool   `json:"help_center_enabled"`
	HelpCenterTitle   string `json:"help_center_title"`
	CSATEnabled       bool   `json:"csat_enabled"`
	AutoAssign        string `json:"auto_assign"`
	// AutoAwayMinutes marks an online member away after this long unseen; 0 = off.
	AutoAwayMinutes int `json:"auto_away_minutes"`
	// BusinessHoursRaw is settings.business_hours; read it with Hours().
	BusinessHoursRaw json.RawMessage `json:"business_hours"`
	// Locale is the default language (BCP 47) of customer-facing pages; "" = the visitor's browser.
	Locale string `json:"locale"`
	// AutoCloseDays closes solved tickets after this many days; nil = 7, 0 = never.
	AutoCloseDays *int            `json:"auto_close_days"`
	Widget        *WidgetSettings `json:"widget"`
	// AIRaw is settings.ai; read it with AI().
	AIRaw json.RawMessage `json:"ai"`
}

// DefaultAutoCloseDays applies when settings.auto_close_days is not set.
const DefaultAutoCloseDays = 7

// AutoClose returns the auto-close delay in days (0 = disabled).
func (s Settings) AutoClose() int {
	if s.AutoCloseDays == nil {
		return DefaultAutoCloseDays
	}
	if *s.AutoCloseDays < 0 {
		return 0
	}
	return *s.AutoCloseDays
}

// WidgetOrDefault returns the widget settings with defaults filled in.
func (s Settings) WidgetOrDefault() WidgetSettings {
	if s.Widget == nil {
		return WidgetSettings{Greeting: "Hi! How can we help?", Enabled: true, AllowedOrigins: []string{}}
	}
	w := *s.Widget
	if w.AllowedOrigins == nil {
		w.AllowedOrigins = []string{}
	}
	return w
}

// Location returns the workspace timezone, UTC when unset or unknown.
func (s Settings) Location() *time.Location {
	if s.Timezone != "" {
		if loc, err := time.LoadLocation(s.Timezone); err == nil {
			return loc
		}
	}
	return time.UTC
}

// ParseSettings decodes a settings document leniently: a malformed key falls back to
// its zero value rather than failing the request.
func ParseSettings(raw []byte) Settings {
	var s Settings
	if len(raw) == 0 {
		return s
	}
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var m map[string]json.RawMessage
	if json.Unmarshal(raw, &m) != nil {
		return Settings{}
	}
	s = Settings{}
	field := func(k string, v any) {
		if r, ok := m[k]; ok {
			_ = json.Unmarshal(r, v)
		}
	}
	field("brand_color", &s.BrandColor)
	field("timezone", &s.Timezone)
	field("help_center_enabled", &s.HelpCenterEnabled)
	field("help_center_title", &s.HelpCenterTitle)
	field("csat_enabled", &s.CSATEnabled)
	field("auto_assign", &s.AutoAssign)
	field("auto_away_minutes", &s.AutoAwayMinutes)
	field("business_hours", &s.BusinessHoursRaw)
	field("auto_close_days", &s.AutoCloseDays)
	field("ai", &s.AIRaw)
	var w WidgetSettings
	if r, ok := m["widget"]; ok && json.Unmarshal(r, &w) == nil {
		s.Widget = &w
	}
	return s
}

// LoadSettings reads a workspace's settings.
func LoadSettings(ctx context.Context, q db.Querier, wid uuid.UUID) (Settings, error) {
	var raw []byte
	if err := q.QueryRow(ctx, `SELECT settings FROM workspaces WHERE id = $1`, wid).Scan(&raw); err != nil {
		return Settings{}, err
	}
	return ParseSettings(raw), nil
}
