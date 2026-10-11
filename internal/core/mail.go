package core

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"

	"github.com/opendesk/opendesk/internal/crypto"
	"github.com/opendesk/opendesk/internal/db"
	"github.com/opendesk/opendesk/internal/ids"
	"github.com/opendesk/opendesk/internal/jobs"
	"github.com/opendesk/opendesk/internal/mailer"
)

// One-time token purposes (one_time_tokens.purpose).
const (
	ottVerifyEmail = "verify_email"
	ottReset       = "reset_password"
	ottOAuthLogin  = "oauth_login"
	ottOAuthLink   = "oauth_link"
)

const (
	verifyTTL     = 48 * time.Hour
	resetTTL      = time.Hour
	oauthCodeTTL  = 2 * time.Minute
	oauthLinkTTL  = 10 * time.Minute
	inviteTTL     = 7 * 24 * time.Hour
	emailLinkSize = 32
)

// oneTime is a consumed one-time token.
type oneTime struct {
	UserID *uuid.UUID
	Email  string
	Data   map[string]string
}

// createOneTime stores a hashed, expiring, single-use token and returns the plaintext.
func createOneTime(ctx context.Context, q db.Querier, purpose string, uid *uuid.UUID, email string, data map[string]string, ttl time.Duration) (string, error) {
	tok := crypto.RandomToken(emailLinkSize)
	if data == nil {
		data = map[string]string{}
	}
	_, err := q.Exec(ctx, `INSERT INTO one_time_tokens (id, user_id, email, purpose, token_hash, data, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`, ids.New(), uid, email, purpose, crypto.HashToken(tok), data, time.Now().Add(ttl))
	return tok, err
}

// consumeOneTime marks a token used and returns it. It fails (pgx.ErrNoRows) when the
// token is unknown, already used, expired or has a different purpose.
func consumeOneTime(ctx context.Context, q db.Querier, purpose, token string) (*oneTime, error) {
	if token == "" || len(token) > 200 {
		return nil, pgx.ErrNoRows
	}
	var o oneTime
	var raw []byte
	err := q.QueryRow(ctx, `UPDATE one_time_tokens SET used_at = now()
		WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
		RETURNING user_id, email, data`, crypto.HashToken(token), purpose).Scan(&o.UserID, &o.Email, &raw)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &o.Data); err != nil {
		return nil, err
	}
	return &o, nil
}

// appLink builds an APP_URL link with one query parameter.
func (s *svc) appLink(path, key, value string) string {
	return s.d.Cfg.AppURL + path + "?" + url.Values{key: {value}}.Encode()
}

// enqueueMail queues a system email in tx.
func (s *svc) enqueueMail(ctx context.Context, tx pgx.Tx, to, subject, html, text string) error {
	_, err := s.d.Jobs.InsertTx(ctx, tx, jobs.SystemEmailArgs{To: to, Subject: subject, HTML: html, Text: text},
		&river.InsertOpts{Queue: jobs.QueueEmail, MaxAttempts: 8})
	return err
}

func (s *svc) sendVerifyEmail(ctx context.Context, tx pgx.Tx, uid uuid.UUID, email string) error {
	tok, err := createOneTime(ctx, tx, ottVerifyEmail, &uid, email, nil, verifyTTL)
	if err != nil {
		return err
	}
	html, text := mailer.Layout("Confirm your email",
		[]string{"Confirm this address to finish setting up your opendesk account."},
		"Confirm email", s.appLink("/verify", "token", tok),
		"The link works for 48 hours. If you did not create an account, ignore this email.")
	return s.enqueueMail(ctx, tx, email, "Confirm your email", html, text)
}

func (s *svc) sendResetEmail(ctx context.Context, tx pgx.Tx, uid uuid.UUID, email string) error {
	tok, err := createOneTime(ctx, tx, ottReset, &uid, email, nil, resetTTL)
	if err != nil {
		return err
	}
	html, text := mailer.Layout("Reset your password",
		[]string{"Someone asked to reset the password for your opendesk account. Choose a new one with the button below."},
		"Choose a new password", s.appLink("/reset", "token", tok),
		"The link works for one hour and only once. If you did not ask for this, ignore this email; your password stays the same.")
	return s.enqueueMail(ctx, tx, email, "Reset your opendesk password", html, text)
}

func (s *svc) sendInviteEmail(ctx context.Context, tx pgx.Tx, email, token, workspaceName, inviterName, role string) error {
	inviter := inviterName
	if inviter == "" {
		inviter = "A teammate"
	}
	html, text := mailer.Layout("Join "+workspaceName+" on opendesk",
		[]string{fmt.Sprintf("%s invited you to the %s workspace as %s.", inviter, workspaceName, roleArticle(role))},
		"Accept invitation", s.appLink("/invite", "token", token),
		"The invitation works for 7 days. If you were not expecting it, ignore this email.")
	return s.enqueueMail(ctx, tx, email, "You are invited to "+workspaceName+" on opendesk", html, text)
}

func roleArticle(role string) string {
	if role == "admin" || role == "agent" {
		return "an " + role
	}
	return "a " + role
}

// systemEmailWorker sends platform email through the system mailer.
type systemEmailWorker struct {
	river.WorkerDefaults[jobs.SystemEmailArgs]
	s *svc
}

func (w *systemEmailWorker) Work(ctx context.Context, job *river.Job[jobs.SystemEmailArgs]) error {
	a := job.Args
	return w.s.d.Mailer.Send(ctx, mailer.Mail{To: a.To, Subject: a.Subject, HTML: a.HTML, Text: a.Text})
}

// forgotArgs asks for a reset email. The lookup runs in the worker, so the endpoint
// answers in the same time whether or not the account exists.
type forgotArgs struct {
	Email string `json:"email"`
}

func (forgotArgs) Kind() string { return "core.password_forgot" }

type forgotWorker struct {
	river.WorkerDefaults[forgotArgs]
	s *svc
}

func (w *forgotWorker) Work(ctx context.Context, job *river.Job[forgotArgs]) error {
	return w.s.tx(ctx, func(tx pgx.Tx) error {
		var uid uuid.UUID
		var email string
		err := tx.QueryRow(ctx, `SELECT id, email FROM users WHERE email = $1`, job.Args.Email).Scan(&uid, &email)
		if db.IsNotFound(err) {
			return nil
		}
		if err != nil {
			return err
		}
		var recent int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM one_time_tokens WHERE user_id = $1 AND purpose = $2
			AND created_at > now() - interval '1 hour'`, uid, ottReset).Scan(&recent); err != nil {
			return err
		}
		if recent >= 5 {
			return nil
		}
		return w.s.sendResetEmail(ctx, tx, uid, email)
	})
}

// cleanupArgs prunes expired credentials, old delivery logs and expired idempotency keys.
type cleanupArgs struct{}

func (cleanupArgs) Kind() string { return "core.cleanup" }

type cleanupWorker struct {
	river.WorkerDefaults[cleanupArgs]
	s *svc
}

func (w *cleanupWorker) Work(ctx context.Context, _ *river.Job[cleanupArgs]) error {
	pool := w.s.d.DB.Pool
	for _, q := range []string{
		`DELETE FROM one_time_tokens WHERE expires_at < now() - interval '1 day'`,
		`DELETE FROM sessions WHERE (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days') OR expires_at < now() - interval '30 days'`,
		`DELETE FROM invitations WHERE expires_at < now() - interval '30 days'`,
		`DELETE FROM webhook_deliveries WHERE created_at < now() - interval '30 days'`,
		`DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'`,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			return err
		}
	}
	return nil
}
