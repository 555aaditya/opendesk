// Package app wires dependencies and runs the api and worker roles.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"

	"github.com/opendesk/opendesk/internal/ai"
	"github.com/opendesk/opendesk/internal/analytics"
	"github.com/opendesk/opendesk/internal/auth"
	"github.com/opendesk/opendesk/internal/billing"
	"github.com/opendesk/opendesk/internal/captcha"
	"github.com/opendesk/opendesk/internal/config"
	"github.com/opendesk/opendesk/internal/core"
	"github.com/opendesk/opendesk/internal/crypto"
	"github.com/opendesk/opendesk/internal/db"
	"github.com/opendesk/opendesk/internal/deps"
	"github.com/opendesk/opendesk/internal/domain"
	"github.com/opendesk/opendesk/internal/email"
	"github.com/opendesk/opendesk/internal/events"
	"github.com/opendesk/opendesk/internal/helpdesk"
	"github.com/opendesk/opendesk/internal/httpx"
	"github.com/opendesk/opendesk/internal/jobs"
	"github.com/opendesk/opendesk/internal/mailer"
	"github.com/opendesk/opendesk/internal/natsx"
	"github.com/opendesk/opendesk/internal/plan"
	"github.com/opendesk/opendesk/internal/storage"
	"github.com/opendesk/opendesk/internal/version"
	"github.com/opendesk/opendesk/internal/webui"
)

type area struct {
	register        func(*deps.Deps, huma.API, chi.Router)
	registerWorkers func(*deps.Deps, *river.Workers)
	periodic        func(*deps.Deps) []*river.PeriodicJob
	background      func(context.Context, *deps.Deps)
}

var areas = []area{
	{core.Register, core.RegisterWorkers, core.Periodic, core.Background},
	{email.Register, email.RegisterWorkers, email.Periodic, email.Background},
	{helpdesk.Register, helpdesk.RegisterWorkers, helpdesk.Periodic, helpdesk.Background},
	{billing.Register, billing.RegisterWorkers, billing.Periodic, billing.Background},
	{ai.Register, ai.RegisterWorkers, ai.Periodic, ai.Background},
}

// NewLogger returns a JSON logger in production and a text logger in development.
func NewLogger(cfg *config.Config) *slog.Logger {
	if cfg.IsProduction() {
		return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}
	return slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug}))
}

// Build connects everything. The caller closes the returned cleanup.
func Build(ctx context.Context, cfg *config.Config, log *slog.Logger) (*deps.Deps, func(), error) {
	database, err := db.Open(ctx, cfg.DatabaseURL, cfg.DatabaseURLDirect)
	if err != nil {
		return nil, nil, err
	}
	nc, err := natsx.Connect(natsx.Options{URL: cfg.NATSURL, Token: cfg.NATSToken, Listen: cfg.NATSListen,
		StoreDir: cfg.NATSStoreDir, Name: "opendesk-" + cfg.Role}, log)
	if err != nil {
		database.Close()
		return nil, nil, err
	}
	store, err := storage.New(ctx, storage.Options{Driver: cfg.StorageDriver, Dir: cfg.DataDir + "/files", Bucket: cfg.S3Bucket,
		Region: cfg.S3Region, Endpoint: cfg.S3Endpoint, AccessKey: cfg.S3AccessKey, SecretKey: cfg.S3SecretKey, ForcePathStyle: cfg.S3ForcePathStyle})
	if err != nil {
		return nil, nil, err
	}
	m, err := mailer.New(ctx, mailer.Options{Driver: cfg.MailDriver, From: cfg.MailFrom, Host: cfg.SMTPHost, Port: cfg.SMTPPort,
		Username: cfg.SMTPUsername, Password: cfg.SMTPPassword, TLS: cfg.SMTPTLS, Region: cfg.SESRegion}, log)
	if err != nil {
		return nil, nil, err
	}
	box, err := crypto.NewBox(cfg.CredentialsKey)
	if err != nil {
		return nil, nil, err
	}
	turnstile := captcha.NewTurnstileFromConfig(captcha.TurnstileConfig{Secret: cfg.TurnstileSecret, Disabled: cfg.TurnstileSecret == ""})
	d := &deps.Deps{Cfg: cfg, Log: log, DB: database, NATS: nc, Storage: store, Mailer: m,
		Analytics: analytics.New(cfg.PosthogKey, cfg.PosthogHost, log), Box: box, Tokens: auth.NewTokens(cfg.AuthSecret),
		Captcha: turnstile, Limiter: httpx.NewLimiter(), Plan: plan.New(cfg.BillingEnabled())}
	domain.Configure(cfg.APIURL, cfg.AuthSecret)

	workers := river.NewWorkers()
	river.AddWorker(workers, &events.PruneWorker{Pool: database.Direct, Retention: cfg.EventRetention})
	periodic := []*river.PeriodicJob{events.PrunePeriodic()}
	for _, a := range areas {
		a.registerWorkers(d, workers)
		periodic = append(periodic, a.periodic(d)...)
	}
	rc := &river.Config{Workers: workers, Logger: slog.New(minLevel{log.Handler(), slog.LevelInfo}).With("component", "river"), JobTimeout: 5 * time.Minute}
	if cfg.Role != "api" {
		rc.Queues = map[string]river.QueueConfig{
			river.QueueDefault: {MaxWorkers: 20},
			jobs.QueueEmail:    {MaxWorkers: 20},
			jobs.QueueWebhooks: {MaxWorkers: 20},
		}
		rc.PeriodicJobs = periodic
	}
	d.Jobs, err = river.NewClient[pgx.Tx](riverpgxv5.New(database.Direct), rc)
	if err != nil {
		return nil, nil, fmt.Errorf("river: %w", err)
	}
	cleanup := func() {
		d.Analytics.Close()
		nc.Close()
		database.Close()
	}
	return d, cleanup, nil
}

// Router builds the HTTP handler: middleware, the huma API, areas and the web app.
func Router(d *deps.Deps) http.Handler {
	cfg := d.Cfg
	httpx.Install(d.Log)
	r := chi.NewRouter()
	r.Use(httpx.RequestID, httpx.Logger(d.Log), httpx.SecurityHeaders(strings.HasPrefix(cfg.APIURL, "https://")),
		httpx.CORS(cfg.CORSOrigins))
	resolver := &auth.Resolver{Pool: d.DB.Pool, Tokens: d.Tokens, ClientIP: httpx.ClientIP(cfg.TrustProxy)}
	r.Use(resolver.Middleware)

	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/problem+json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"status":404,"title":"Not Found","code":"not_found","detail":"No route matches ` + r.Method + ` ` + strings.ReplaceAll(r.URL.Path, `"`, ``) + `"}`))
	})
	mountHealth(r, d)

	hc := huma.DefaultConfig("opendesk API", version.Version)
	hc.Info.Description = "The opendesk public API. The opendesk web app uses exactly this API."
	hc.OpenAPIPath = "/v1/openapi"
	hc.DocsPath = "/docs"
	hc.SchemasPath = "/v1/schemas"
	hc.Servers = []*huma.Server{{URL: cfg.APIURL}}
	hc.Components.SecuritySchemes = map[string]*huma.SecurityScheme{
		"bearer": {Type: "http", Scheme: "bearer", Description: "Access token (JWT) or API key (od_live_...)"},
	}
	hc.Security = []map[string][]string{{"bearer": {}}}
	api := humachi.New(r, hc)

	for _, a := range areas {
		a.register(d, api, r)
	}

	if cfg.ServeWeb {
		csp := webCSP(cfg)
		r.Handle("/*", webui.Handler(webui.RuntimeConfig{APIURL: cfg.APIURL, GatewayURL: cfg.GatewayURL,
			PosthogKey: os.Getenv("WEB_POSTHOG_KEY"), PosthogHost: os.Getenv("WEB_POSTHOG_HOST"),
			TurnstileSiteKey: cfg.TurnstileSiteKey, SelfHosted: true}, csp))
	}
	return r
}

func webCSP(cfg *config.Config) string {
	connect := []string{"'self'", cfg.APIURL, cfg.GatewayURL, "https://*.posthog.com", "https://challenges.cloudflare.com"}
	return strings.Join([]string{
		"default-src 'self'",
		"script-src 'self' https://challenges.cloudflare.com https://*.posthog.com",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob: https:",
		"font-src 'self' data:",
		"connect-src " + strings.Join(connect, " "),
		"frame-src https://challenges.cloudflare.com",
		"frame-ancestors 'none'",
		"base-uri 'self'",
		"form-action 'self'",
	}, "; ")
}

// Serve runs the configured role until ctx is canceled.
func Serve(ctx context.Context, d *deps.Deps) error {
	cfg := d.Cfg
	errc := make(chan error, 2)

	// Build the router before starting workers, so a registration failure exits cleanly.
	var handler http.Handler
	if cfg.Role != "worker" {
		handler = Router(d)
	}

	if cfg.Role != "api" {
		if err := d.Jobs.Start(ctx); err != nil {
			return fmt.Errorf("start river: %w", err)
		}
		relay := &events.Relay{Pool: d.DB.Direct, NATS: d.NATS.Conn, Jobs: d.Jobs, Log: d.Log.With("component", "relay")}
		go relay.Run(ctx)
		for _, a := range areas {
			go a.background(ctx, d)
		}
		d.Log.Info("worker started")
	}

	if cfg.Role == "worker" {
		// The worker serves only health checks, so orchestrators can probe it.
		handler = healthRouter(d)
	}
	srv := &http.Server{Addr: cfg.HTTPAddr, Handler: handler, ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout: 60 * time.Second, WriteTimeout: 120 * time.Second, IdleTimeout: 120 * time.Second}
	go func() {
		d.Log.Info("http listening", "addr", cfg.HTTPAddr, "version", version.Version)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errc <- err
		}
	}()

	select {
	case <-ctx.Done():
	case err := <-errc:
		return err
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdown)
	if cfg.Role != "api" {
		_ = d.Jobs.Stop(shutdown)
	}
	return nil
}

// minLevel drops records below a level (River's debug output is very chatty).
type minLevel struct {
	slog.Handler
	min slog.Level
}

func (h minLevel) Enabled(ctx context.Context, l slog.Level) bool {
	return l >= h.min && h.Handler.Enabled(ctx, l)
}

func (h minLevel) WithAttrs(a []slog.Attr) slog.Handler {
	return minLevel{h.Handler.WithAttrs(a), h.min}
}
func (h minLevel) WithGroup(n string) slog.Handler { return minLevel{h.Handler.WithGroup(n), h.min} }

func mountHealth(r chi.Router, d *deps.Deps) {
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	r.Get("/readyz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := d.DB.Pool.Ping(ctx); err != nil || !d.NATS.IsConnected() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	})
}

func healthRouter(d *deps.Deps) http.Handler {
	r := chi.NewRouter()
	mountHealth(r, d)
	return r
}
