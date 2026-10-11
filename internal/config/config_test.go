package config

import (
	"strings"
	"testing"
)

func productionEnv(t *testing.T) {
	t.Setenv("OPENDESK_ENV", "production")
	t.Setenv("AUTH_SECRET", strings.Repeat("s", MinAuthSecretLength))
	t.Setenv("CREDENTIALS_KEY", strings.Repeat("ab", 32))
	t.Setenv("NATS_LISTEN", "127.0.0.1:4222")
}

func TestStripeAPIURLIsDevelopmentOnly(t *testing.T) {
	productionEnv(t)
	if _, err := Load(); err != nil {
		t.Fatalf("production config without STRIPE_API_URL: %v", err)
	}
	t.Setenv("STRIPE_API_URL", "http://127.0.0.1:12111")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "STRIPE_API_URL") {
		t.Fatalf("production with STRIPE_API_URL: want refusal, got %v", err)
	}
	t.Setenv("OPENDESK_ENV", "development")
	c, err := Load()
	if err != nil {
		t.Fatalf("development with STRIPE_API_URL: %v", err)
	}
	if c.StripeAPIURL != "http://127.0.0.1:12111" {
		t.Fatalf("StripeAPIURL = %q", c.StripeAPIURL)
	}
}
