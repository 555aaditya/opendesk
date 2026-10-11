// Package config loads opendesk configuration from the environment.
package config

import (
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// MinAuthSecretLength is the hard floor for AUTH_SECRET; the realtime gateway enforces the same.
const MinAuthSecretLength = 32

type Config struct {
	Env      string // development | production
	Role     string // all | api | worker
	HTTPAddr string
	DataDir  string

	// Public URLs. Self-hosted single domain: APIURL == AppURL, GatewayURL = wss://host/socket.
	APIURL     string
	AppURL     string
	GatewayURL string
	SiteURL    string
	ServeWeb   bool // serve the embedded web app and /config.js from this binary

	// DatabaseURL is the pooled connection (Neon "-pooler" host) used by request handlers.
	// DatabaseURLDirect is unpooled; migrations, River (LISTEN/NOTIFY) and the event relay use it.
	DatabaseURL       string
	DatabaseURLDirect string

	AuthSecret     []byte
	CredentialsKey []byte // 32 bytes, AES-256-GCM for mailbox credentials and webhook secrets
	CookieDomain   string
	CookieSecure   bool
	CORSOrigins    []string
	SignupEnabled  bool
	TrustProxy     bool

	NATSURL      string // empty = run NATS embedded in this process
	NATSToken    string
	NATSListen   string // embedded server listen address, e.g. 127.0.0.1:4222
	NATSStoreDir string

	StorageDriver    string // local | s3
	S3Bucket         string
	S3Region         string
	S3Endpoint       string // R2 / MinIO
	S3AccessKey      string
	S3SecretKey      string
	S3ForcePathStyle bool

	MailDriver   string // log | smtp | ses
	MailFrom     string // "opendesk <notifications@opendesk.sh>"
	SMTPHost     string
	SMTPPort     int
	SMTPUsername string
	SMTPPassword string
	SMTPTLS      string // tls | starttls | none
	SESRegion    string

	InboundDomain   string // forwarding addresses live here, e.g. in.opendesk.sh
	InboundSecret   string // shared secret for POST /v1/inbound/email
	InboundSMTPAddr string // optional built-in SMTP receiver, e.g. :2525

	GoogleClientID        string
	GoogleClientSecret    string
	MicrosoftClientID     string
	MicrosoftClientSecret string
	MicrosoftTenant       string
	GitHubClientID        string
	GitHubClientSecret    string
	OIDCIssuer            string
	OIDCClientID          string
	OIDCClientSecret      string
	OIDCName              string

	TurnstileSiteKey string
	TurnstileSecret  string
	// LogoDevToken turns on logo.dev as the first source of company logos (sends the
	// company's domain to logo.dev).
	LogoDevToken string

	PosthogKey  string
	PosthogHost string

	EventRetention time.Duration

	// Billing (opendesk Cloud). Billing is on only when STRIPE_SECRET_KEY is set; without it
	// every workspace has unlimited use, which is the self-hosted default.
	StripeSecretKey     string
	StripeWebhookSecret string
	StripePricePro      string // recurring per-seat price, monthly
	StripePriceProYear  string // optional recurring per-seat price, yearly
	StripePriceCredits  string // one-time price for an AI credit pack
	StripeTax           bool   // Stripe Tax automatic tax on Checkout
	StripeAPIURL        string // development only: a local Stripe fake or stripe-mock instead of api.stripe.com

	// AI. AIProvider: anthropic | openai (any OpenAI-compatible endpoint, e.g. Ollama) | none.
	AIProvider       string
	AnthropicAPIKey  string
	OpenAIAPIKey     string
	OpenAIBaseURL    string
	AIModel          string // drafting, summaries, answers
	AIFastModel      string // triage, classification, short rewrites
	EmbeddingsDriver string // voyage | openai | none
	VoyageAPIKey     string
	EmbeddingsModel  string

	// Decisions (contracts/ai.md "Decisions"). DecisionsProvider: typesafe (Jev) | llm | none.
	DecisionsProvider string
	TypesafeAPIKey    string
	TypesafeAPIURL    string // base URL; the API path is /v1/systemone
	TypesafeModel     string
}

// DecisionsEnabled reports whether a decision engine is configured.
func (c *Config) DecisionsEnabled() bool {
	return c.DecisionsProvider == "typesafe" || (c.DecisionsProvider == "llm" && c.AIEnabled())
}

// BillingEnabled reports whether plans, limits and credits are enforced.
func (c *Config) BillingEnabled() bool { return c.StripeSecretKey != "" }

// AIEnabled reports whether an AI provider is configured.
func (c *Config) AIEnabled() bool { return c.AIProvider != "none" && c.AIProvider != "" }

func (c *Config) IsProduction() bool { return c.Env == "production" }

// Load reads the environment. It refuses to boot on unsafe secrets.
func Load() (*Config, error) {
	c := &Config{
		Env:               env("OPENDESK_ENV", "development"),
		Role:              env("OPENDESK_ROLE", "all"),
		HTTPAddr:          env("HTTP_ADDR", ":8080"),
		DataDir:           env("DATA_DIR", "./data"),
		APIURL:            strings.TrimRight(env("API_URL", "http://localhost:8080"), "/"),
		AppURL:            strings.TrimRight(env("APP_URL", "http://localhost:5173"), "/"),
		GatewayURL:        strings.TrimRight(env("GATEWAY_URL", "ws://localhost:4000/socket"), "/"),
		SiteURL:           strings.TrimRight(env("SITE_URL", "https://opendesk.sh"), "/"),
		ServeWeb:          envBool("SERVE_WEB", false),
		DatabaseURL:       env("DATABASE_URL", "postgres://opendesk:opendesk@localhost:5432/opendesk?sslmode=disable"),
		DatabaseURLDirect: env("DATABASE_URL_DIRECT", ""),
		CookieDomain:      env("COOKIE_DOMAIN", ""),
		SignupEnabled:     envBool("SIGNUP_ENABLED", true),
		TrustProxy:        envBool("TRUST_PROXY", false),
		NATSURL:           env("NATS_URL", ""),
		NATSToken:         env("NATS_TOKEN", ""),
		NATSListen:        env("NATS_LISTEN", "127.0.0.1:4222"),
		StorageDriver:     env("STORAGE_DRIVER", "local"),
		S3Bucket:          env("S3_BUCKET", ""),
		S3Region:          env("S3_REGION", "auto"),
		S3Endpoint:        env("S3_ENDPOINT", ""),
		S3AccessKey:       env("S3_ACCESS_KEY_ID", ""),
		S3SecretKey:       env("S3_SECRET_ACCESS_KEY", ""),
		S3ForcePathStyle:  envBool("S3_FORCE_PATH_STYLE", false),
		MailDriver:        env("MAIL_DRIVER", "log"),
		MailFrom:          env("MAIL_FROM", "opendesk <notifications@localhost>"),
		SMTPHost:          env("SMTP_HOST", ""),
		SMTPPort:          envInt("SMTP_PORT", 587),
		SMTPUsername:      env("SMTP_USERNAME", ""),
		SMTPPassword:      env("SMTP_PASSWORD", ""),
		SMTPTLS:           env("SMTP_TLS", "starttls"),
		SESRegion:         env("SES_REGION", "us-east-1"),
		InboundDomain:     env("INBOUND_DOMAIN", "in.localhost"),
		InboundSecret:     env("INBOUND_SECRET", ""),
		InboundSMTPAddr:   env("INBOUND_SMTP_ADDR", ""),

		GoogleClientID:        env("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret:    env("GOOGLE_CLIENT_SECRET", ""),
		MicrosoftClientID:     env("MICROSOFT_CLIENT_ID", ""),
		MicrosoftClientSecret: env("MICROSOFT_CLIENT_SECRET", ""),
		MicrosoftTenant:       env("MICROSOFT_TENANT", "common"),
		GitHubClientID:        env("GITHUB_CLIENT_ID", ""),
		GitHubClientSecret:    env("GITHUB_CLIENT_SECRET", ""),
		OIDCIssuer:            env("OIDC_ISSUER", ""),
		OIDCClientID:          env("OIDC_CLIENT_ID", ""),
		OIDCClientSecret:      env("OIDC_CLIENT_SECRET", ""),
		OIDCName:              env("OIDC_NAME", "SSO"),

		TurnstileSiteKey: env("TURNSTILE_SITE_KEY", ""),
		TurnstileSecret:  env("TURNSTILE_SECRET", ""),
		LogoDevToken:     env("LOGO_DEV_TOKEN", ""),
		PosthogKey:       env("POSTHOG_KEY", ""),
		PosthogHost:      env("POSTHOG_HOST", "https://us.i.posthog.com"),
		EventRetention:   envDuration("EVENT_RETENTION", 7*24*time.Hour),

		StripeSecretKey:     env("STRIPE_SECRET_KEY", ""),
		StripeWebhookSecret: env("STRIPE_WEBHOOK_SECRET", ""),
		StripePricePro:      env("STRIPE_PRICE_PRO", ""),
		StripePriceProYear:  env("STRIPE_PRICE_PRO_YEARLY", ""),
		StripePriceCredits:  env("STRIPE_PRICE_CREDITS", ""),
		StripeTax:           envBool("STRIPE_TAX", true),
		StripeAPIURL:        env("STRIPE_API_URL", ""),

		AIProvider:       env("AI_PROVIDER", ""),
		AnthropicAPIKey:  env("ANTHROPIC_API_KEY", ""),
		OpenAIAPIKey:     env("OPENAI_API_KEY", ""),
		OpenAIBaseURL:    strings.TrimRight(env("OPENAI_BASE_URL", "https://api.openai.com/v1"), "/"),
		AIModel:          env("AI_MODEL", ""),
		AIFastModel:      env("AI_FAST_MODEL", ""),
		EmbeddingsDriver: env("EMBEDDINGS_DRIVER", ""),
		VoyageAPIKey:     env("VOYAGE_API_KEY", ""),
		EmbeddingsModel:  env("EMBEDDINGS_MODEL", ""),

		DecisionsProvider: strings.ToLower(env("DECISIONS_PROVIDER", "")),
		TypesafeAPIKey:    env("TYPESAFE_API_KEY", ""),
		TypesafeAPIURL:    strings.TrimRight(env("TYPESAFE_API_URL", "https://api.typesafe.ai"), "/"),
		TypesafeModel:     env("TYPESAFE_MODEL", "jev-latest"),
	}
	if c.AIProvider == "" {
		switch {
		case c.AnthropicAPIKey != "":
			c.AIProvider = "anthropic"
		case c.OpenAIAPIKey != "":
			c.AIProvider = "openai"
		default:
			c.AIProvider = "none"
		}
	}
	if c.AIModel == "" && c.AIProvider == "anthropic" {
		c.AIModel = "claude-sonnet-5-5"
	}
	if c.AIFastModel == "" && c.AIProvider == "anthropic" {
		c.AIFastModel = "claude-haiku-4-5-20251001"
	}
	if c.AIFastModel == "" {
		c.AIFastModel = c.AIModel
	}
	switch c.DecisionsProvider {
	case "":
		switch {
		case c.TypesafeAPIKey != "":
			c.DecisionsProvider = "typesafe"
		case c.AIEnabled():
			c.DecisionsProvider = "llm"
		default:
			c.DecisionsProvider = "none"
		}
	case "typesafe":
		if c.TypesafeAPIKey == "" {
			// Without a key the LLM path keeps every feature working.
			c.DecisionsProvider = "llm"
			if !c.AIEnabled() {
				c.DecisionsProvider = "none"
			}
		}
	case "llm", "none":
	default:
		return nil, fmt.Errorf("DECISIONS_PROVIDER must be typesafe, llm or none")
	}
	if c.EmbeddingsDriver == "" {
		switch {
		case c.VoyageAPIKey != "":
			c.EmbeddingsDriver = "voyage"
		case c.AIProvider == "openai":
			c.EmbeddingsDriver = "openai"
		default:
			c.EmbeddingsDriver = "none"
		}
	}
	if c.DatabaseURLDirect == "" {
		c.DatabaseURLDirect = c.DatabaseURL
	}
	c.NATSStoreDir = env("NATS_STORE_DIR", c.DataDir+"/nats")
	c.CookieSecure = envBool("COOKIE_SECURE", strings.HasPrefix(c.APIURL, "https://"))
	for _, o := range strings.Split(env("CORS_ORIGINS", c.AppURL), ",") {
		if o = strings.TrimSpace(o); o != "" {
			c.CORSOrigins = append(c.CORSOrigins, strings.TrimRight(o, "/"))
		}
	}

	switch c.Role {
	case "all", "api", "worker":
	default:
		return nil, fmt.Errorf("OPENDESK_ROLE must be all, api or worker, got %q", c.Role)
	}

	secret := os.Getenv("AUTH_SECRET")
	if secret == "" && !c.IsProduction() {
		secret = "development-only-auth-secret-change-me-0000"
	}
	if len(secret) < MinAuthSecretLength {
		return nil, fmt.Errorf("AUTH_SECRET must be at least %d bytes", MinAuthSecretLength)
	}
	c.AuthSecret = []byte(secret)

	key, err := decodeKey(os.Getenv("CREDENTIALS_KEY"))
	if err != nil {
		return nil, err
	}
	if key == nil {
		if c.IsProduction() {
			return nil, errors.New("CREDENTIALS_KEY is required in production (32 bytes, hex or base64)")
		}
		key = []byte("development-only-credentials-key")
	}
	c.CredentialsKey = key

	if c.IsProduction() && c.NATSURL == "" && c.NATSToken == "" && !strings.HasPrefix(c.NATSListen, "127.0.0.1") {
		return nil, errors.New("NATS_TOKEN is required when the embedded NATS server listens beyond localhost")
	}
	if c.IsProduction() && c.StripeAPIURL != "" {
		return nil, errors.New("STRIPE_API_URL is for development only; production talks to Stripe directly")
	}
	if c.BillingEnabled() && (c.StripeWebhookSecret == "" || c.StripePricePro == "") {
		return nil, errors.New("STRIPE_WEBHOOK_SECRET and STRIPE_PRICE_PRO are required when STRIPE_SECRET_KEY is set")
	}
	return c, nil
}

func decodeKey(s string) ([]byte, error) {
	if s == "" {
		return nil, nil
	}
	if b, err := hex.DecodeString(s); err == nil && len(b) == 32 {
		return b, nil
	}
	if b, err := base64.StdEncoding.DecodeString(s); err == nil && len(b) == 32 {
		return b, nil
	}
	return nil, errors.New("CREDENTIALS_KEY must be 32 bytes, hex or base64 encoded")
}

func env(k, def string) string {
	if v, ok := os.LookupEnv(k); ok && v != "" {
		return v
	}
	return def
}

func envBool(k string, def bool) bool {
	v, err := strconv.ParseBool(os.Getenv(k))
	if err != nil {
		return def
	}
	return v
}

func envInt(k string, def int) int {
	v, err := strconv.Atoi(os.Getenv(k))
	if err != nil {
		return def
	}
	return v
}

func envDuration(k string, def time.Duration) time.Duration {
	v, err := time.ParseDuration(os.Getenv(k))
	if err != nil {
		return def
	}
	return v
}
