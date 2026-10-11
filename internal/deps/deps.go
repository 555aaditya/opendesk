// Package deps is the dependency container handed to every area (core, email, helpdesk).
package deps

import (
	"log/slog"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"

	"github.com/opendesk/opendesk/internal/analytics"
	"github.com/opendesk/opendesk/internal/auth"
	"github.com/opendesk/opendesk/internal/captcha"
	"github.com/opendesk/opendesk/internal/config"
	"github.com/opendesk/opendesk/internal/crypto"
	"github.com/opendesk/opendesk/internal/db"
	"github.com/opendesk/opendesk/internal/httpx"
	"github.com/opendesk/opendesk/internal/mailer"
	"github.com/opendesk/opendesk/internal/natsx"
	"github.com/opendesk/opendesk/internal/plan"
	"github.com/opendesk/opendesk/internal/storage"
)

type Deps struct {
	Cfg  *config.Config
	Log  *slog.Logger
	DB   *db.DB
	NATS *natsx.Conn
	// Jobs is set before any route or worker runs; enqueue with InsertTx inside the write's tx.
	Jobs      *river.Client[pgx.Tx]
	Storage   storage.Storage
	Mailer    mailer.Mailer
	Analytics *analytics.Client
	Box       *crypto.Box
	Tokens    *auth.Tokens
	Captcha   *captcha.Turnstile
	Limiter   *httpx.Limiter
	// Plan enforces plan limits and AI credits; unlimited when billing is disabled.
	Plan *plan.Service
}
