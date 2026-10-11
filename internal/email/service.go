package email

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/opendesk/opendesk/internal/deps"
)

// Limits on what the pipeline accepts.
const (
	maxRawBytes        = 30 << 20 // one raw RFC 822 message
	maxAttachmentBytes = 25 << 20 // one attachment
	maxAttachments     = 50       // per inbound message
	maxOutboundBytes   = 25 << 20 // total attachments on one outbound message
)

// service is the email area. It is cheap to construct and holds no per-request state.
type service struct {
	d     *deps.Deps
	log   *slog.Logger
	guard *netGuard
	http  *http.Client

	providers map[string]*oauthProvider
	gmailBase string // https://gmail.googleapis.com
	graphBase string // https://graph.microsoft.com/v1.0

	// rawSend replaces the platform transport for outbound_kind=system (tests).
	rawSend func(ctx context.Context, from string, to []string, raw []byte) error
}

func newService(d *deps.Deps) *service {
	s := &service{
		d:         d,
		log:       d.Log.With("area", "email"),
		guard:     &netGuard{allowPrivate: d.Cfg.Env == "development"},
		http:      &http.Client{Timeout: httpTimeout},
		gmailBase: "https://gmail.googleapis.com",
		graphBase: "https://graph.microsoft.com/v1.0",
	}
	s.providers = defaultProviders(d.Cfg)
	return s
}
