package auth

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// Token purposes. A consumer accepts exactly one; see contracts/tokens.md.
const (
	PurposeAccess     = "access"
	PurposeWS         = "ws"
	PurposeWidgetWS   = "widget_ws"
	PurposeMFA        = "mfa"
	PurposeOAuthState = "oauth_state"
)

const (
	AccessTTL     = 15 * time.Minute
	RefreshTTL    = 30 * 24 * time.Hour
	WSTTL         = 5 * time.Minute
	MFATTL        = 5 * time.Minute
	OAuthStateTTL = 10 * time.Minute
)

// Claims is the union of fields used across purposes.
type Claims struct {
	Purpose   string `json:"purpose"`
	SessionID string `json:"sid,omitempty"`
	MFA       bool   `json:"mfa,omitempty"`
	Kind      string `json:"kind,omitempty"` // ws: user | api_key
	Workspace string `json:"wid,omitempty"`
	Role      string `json:"role,omitempty"`
	Name      string `json:"name,omitempty"`
	Avatar    string `json:"avatar,omitempty"`
	// Free-form payload for oauth_state (provider, redirect, mailbox flow).
	Data map[string]string `json:"data,omitempty"`
	jwt.RegisteredClaims
}

type Tokens struct{ secret []byte }

func NewTokens(secret []byte) *Tokens { return &Tokens{secret: secret} }

// Sign issues a token with the given purpose, subject and lifetime.
func (t *Tokens) Sign(c Claims, subject string, ttl time.Duration) (string, time.Time, error) {
	if c.Purpose == "" {
		return "", time.Time{}, errors.New("token purpose required")
	}
	now := time.Now()
	exp := now.Add(ttl)
	c.Subject = subject
	c.IssuedAt = jwt.NewNumericDate(now)
	c.ExpiresAt = jwt.NewNumericDate(exp)
	if c.ID == "" {
		c.ID = uuid.NewString()
	}
	s, err := jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(t.secret)
	return s, exp, err
}

// Verify checks signature (HS256 only), expiry and that the purpose matches.
func (t *Tokens) Verify(token, purpose string) (*Claims, error) {
	var c Claims
	_, err := jwt.ParseWithClaims(token, &c, func(*jwt.Token) (any, error) { return t.secret, nil },
		jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired())
	if err != nil {
		return nil, err
	}
	if c.Purpose == "" || c.Purpose != purpose {
		return nil, errors.New("token purpose mismatch")
	}
	return &c, nil
}
