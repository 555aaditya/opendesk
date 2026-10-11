package widget

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/google/uuid"

	"github.com/opendesk/opendesk/internal/auth"
	"github.com/opendesk/opendesk/internal/domain"
	"github.com/opendesk/opendesk/internal/helpdesk/hd"
	"github.com/opendesk/opendesk/internal/httpx"
)

// Rate limits for visitor traffic.
const (
	sessionLimit  = 20 // per IP per minute
	visitorWrites = 30 // per session per minute
	uploadLimit   = 10 // per session per minute
)

type ipKey struct{}

// withClientIP is an operation middleware that puts the caller address in the context
// for routes that run before any credential exists (session creation).
func (h *handler) withClientIP(ctx huma.Context, next func(huma.Context)) {
	r, _ := humachi.Unwrap(ctx)
	next(huma.WithValue(ctx, ipKey{}, httpx.ClientIP(h.d.Cfg.TrustProxy)(r)))
}

func clientIP(ctx context.Context) string {
	if p := auth.FromContext(ctx); p != nil && p.IP != "" {
		return p.IP
	}
	s, _ := ctx.Value(ipKey{}).(string)
	return s
}

// checkOrigin enforces settings.widget.allowed_origins: when the list is set, the browser
// Origin must be one of them.
func checkOrigin(w hd.WidgetSettings, origin string) error {
	if len(w.AllowedOrigins) == 0 {
		return nil
	}
	origin = strings.ToLower(strings.TrimRight(strings.TrimSpace(origin), "/"))
	if origin != "" && slices.Contains(w.AllowedOrigins, origin) {
		return nil
	}
	return httpx.E(http.StatusForbidden, "origin_not_allowed", "This site is not allowed to use the chat widget.")
}

// visitor resolves the visitor, checks the widget is enabled for the workspace and the
// request origin is allowed.
func (h *handler) visitor(ctx context.Context, origin string) (*auth.Principal, error) {
	p, err := auth.RequireVisitor(ctx)
	if err != nil {
		return nil, err
	}
	s, err := hd.LoadSettings(ctx, h.d.DB.Pool, p.WorkspaceID)
	if err != nil {
		return nil, err
	}
	w := s.WidgetOrDefault()
	if !w.Enabled {
		return nil, httpx.E(http.StatusForbidden, "widget_disabled", "The chat widget is turned off.")
	}
	if err := checkOrigin(w, origin); err != nil {
		return nil, err
	}
	return p, nil
}

func (h *handler) allowWrite(p *auth.Principal, bucket string, limit int) error {
	if !h.d.Limiter.Allow("widget:"+bucket+":"+p.VisitorID.String(), limit, time.Minute) {
		return httpx.RateLimited()
	}
	return nil
}

// publicMessage is the visitor-facing form of a message: no recipient lists, no
// delivery internals and no agent email addresses.
func publicMessage(m domain.Message) domain.Message {
	m.To, m.Cc, m.Bcc = []string{}, []string{}, []string{}
	m.DeliveryError = ""
	if m.Author.Type != "contact" {
		m.FromEmail = ""
	}
	if m.Author.User != nil {
		u := *m.Author.User
		u.Email = ""
		m.Author.User = &u
	}
	return m
}

// writeProblem writes an RFC 9457 body from a raw handler.
func writeProblem(w http.ResponseWriter, r *http.Request, status int, code, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"status": status, "title": http.StatusText(status), "code": code,
		"detail": detail, "request_id": httpx.RequestIDFrom(r.Context())})
}

func parseUUID(s string) (uuid.UUID, bool) {
	id, err := uuid.Parse(s)
	return id, err == nil
}
