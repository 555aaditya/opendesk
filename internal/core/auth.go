package core

import (
	"context"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"

	"github.com/useopendesk/opendesk/internal/auth"
	"github.com/useopendesk/opendesk/internal/crypto"
	"github.com/useopendesk/opendesk/internal/db"
	"github.com/useopendesk/opendesk/internal/displayname"
	"github.com/useopendesk/opendesk/internal/httpx"
	"github.com/useopendesk/opendesk/internal/ids"
	"github.com/useopendesk/opendesk/internal/jobs"
)

// Rate limits on the anonymous auth routes.
const (
	loginPerIP      = 30
	loginPerAccount = 10
	loginWindow     = 15 * time.Minute
	mfaPerUser      = 10
	registerPerIP   = 10
	forgotPerIP     = 10
	forgotPerEmail  = 3
	resetPerIP      = 20
)

func errInvalidCredentials() *httpx.Error {
	return httpx.E(401, "invalid_credentials", "The email or password is incorrect.")
}

func errInvalidToken() *httpx.Error {
	return httpx.E(400, "invalid_token", "This link is invalid or has expired.")
}

type coreAuthProvider struct {
	ID   string `json:"id" enum:"google,microsoft,github,oidc"`
	Name string `json:"name"`
}

type coreAuthConfig struct {
	Providers        []coreAuthProvider `json:"providers"`
	PasswordLogin    bool               `json:"password_login"`
	SignupEnabled    bool               `json:"signup_enabled"`
	Passkeys         bool               `json:"passkeys" doc:"Passkey sign-in is available"`
	TurnstileSiteKey *string            `json:"turnstile_site_key"`
}

type coreLoginBody struct {
	Email          string `json:"email" maxLength:"320"`
	Password       string `json:"password" maxLength:"1024"`
	TurnstileToken string `json:"turnstile_token,omitempty" maxLength:"4096"`
}

type coreRegisterBody struct {
	Email          string `json:"email" maxLength:"320"`
	Password       string `json:"password" maxLength:"1024"`
	Name           string `json:"name" maxLength:"200"`
	TurnstileToken string `json:"turnstile_token,omitempty" maxLength:"4096"`
	InviteToken    string `json:"invite_token,omitempty" maxLength:"200" doc:"Invitation token; lets an invited person register when public signup is off"`
}

func (s *svc) registerAuth(api huma.API) {
	tags := []string{"Auth"}

	register(s, api, huma.Operation{OperationID: "auth-config", Method: http.MethodGet, Path: "/v1/auth/config",
		Summary: "Sign-in options", Tags: tags, Security: []map[string][]string{}},
		func(ctx context.Context, _ *struct{}) (*struct{ Body coreAuthConfig }, error) {
			c := coreAuthConfig{Providers: []coreAuthProvider{}, PasswordLogin: true, SignupEnabled: s.d.Cfg.SignupEnabled,
				Passkeys: s.webauthn != nil}
			for _, p := range s.oauth.list {
				c.Providers = append(c.Providers, coreAuthProvider{ID: p.id, Name: p.name})
			}
			if k := s.d.Cfg.TurnstileSiteKey; k != "" {
				c.TurnstileSiteKey = &k
			}
			return &struct{ Body coreAuthConfig }{c}, nil
		})

	register(s, api, huma.Operation{OperationID: "auth-register", Method: http.MethodPost, Path: "/v1/auth/register",
		Summary: "Create an account", Tags: tags, Security: []map[string][]string{}},
		func(ctx context.Context, in *struct{ Body coreRegisterBody }) (*authOut, error) {
			return s.handleRegister(ctx, &in.Body)
		})

	register(s, api, huma.Operation{OperationID: "auth-login", Method: http.MethodPost, Path: "/v1/auth/login",
		Summary: "Sign in with email and password", Tags: tags, Security: []map[string][]string{}},
		func(ctx context.Context, in *struct{ Body coreLoginBody }) (*authOut, error) {
			return s.handleLogin(ctx, &in.Body)
		})

	register(s, api, huma.Operation{OperationID: "auth-mfa", Method: http.MethodPost, Path: "/v1/auth/mfa",
		Summary: "Complete sign-in with a second factor", Tags: tags, Security: []map[string][]string{}},
		func(ctx context.Context, in *struct {
			Body struct {
				MFAToken string `json:"mfa_token" maxLength:"2048"`
				Code     string `json:"code" maxLength:"64" doc:"6-digit code or a recovery code"`
			}
		}) (*authOut, error) {
			return s.handleMFA(ctx, in.Body.MFAToken, in.Body.Code)
		})

	register(s, api, huma.Operation{OperationID: "auth-refresh", Method: http.MethodPost, Path: "/v1/auth/refresh",
		Summary: "Rotate the refresh cookie for a new access token", Tags: tags, Security: []map[string][]string{}},
		func(ctx context.Context, in *struct {
			Refresh string `cookie:"od_refresh"`
		}) (*authOut, error) {
			out, err := s.rotateRefresh(ctx, in.Refresh, requestInfo(ctx))
			if err != nil {
				if he, ok := err.(*httpx.Error); ok && he.Status == 401 {
					return nil, huma.ErrorWithHeaders(he, s.clearRefreshCookie())
				}
				return nil, httpx.Wrap(err)
			}
			return out, nil
		})

	register(s, api, huma.Operation{OperationID: "auth-logout", Method: http.MethodPost, Path: "/v1/auth/logout",
		Summary: "Sign out this session", Tags: tags, DefaultStatus: http.StatusNoContent},
		func(ctx context.Context, in *struct {
			Refresh string `cookie:"od_refresh"`
		}) (*struct {
			SetCookie string `header:"Set-Cookie"`
		}, error) {
			var uid, sid uuid.UUID
			if p := auth.FromContext(ctx); p != nil && p.Kind == auth.KindUser {
				uid, sid = p.UserID, p.SessionID
			}
			err := s.tx(ctx, func(tx pgx.Tx) error {
				if sid == uuid.Nil && in.Refresh != "" {
					err := tx.QueryRow(ctx, `SELECT id, user_id FROM sessions WHERE refresh_hash = $1 AND revoked_at IS NULL`,
						crypto.HashToken(in.Refresh)).Scan(&sid, &uid)
					if err != nil && !db.IsNotFound(err) {
						return err
					}
				}
				if sid == uuid.Nil {
					return nil
				}
				if _, err := tx.Exec(ctx, `UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, sid, uid); err != nil {
					return err
				}
				_, err := auditUser(ctx, tx, userPrincipal(uid, requestInfo(ctx)), uid, "logout", map[string]any{"session_id": sid})
				return err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			if uid != uuid.Nil {
				s.disconnect(uid, sid)
			}
			return &struct {
				SetCookie string `header:"Set-Cookie"`
			}{s.refreshCookie("", -1)}, nil
		})

	register(s, api, huma.Operation{OperationID: "auth-password-forgot", Method: http.MethodPost, Path: "/v1/auth/password/forgot",
		Summary: "Email a password reset link", Tags: tags, DefaultStatus: http.StatusNoContent, Security: []map[string][]string{}},
		func(ctx context.Context, in *struct {
			Body struct {
				Email          string `json:"email" maxLength:"320"`
				TurnstileToken string `json:"turnstile_token,omitempty" maxLength:"4096"`
			}
		}) (*struct{}, error) {
			ri := requestInfo(ctx)
			if err := s.limit("forgot:ip:"+ri.IP, forgotPerIP, time.Hour); err != nil {
				return nil, err
			}
			if err := s.d.Captcha.Verify(ctx, in.Body.TurnstileToken, ri.IP); err != nil {
				return nil, httpx.Wrap(err)
			}
			email := normEmail(in.Body.Email)
			if email == "" || !s.d.Limiter.Allow("forgot:email:"+email, forgotPerEmail, time.Hour) {
				return nil, nil
			}
			if _, err := s.d.Jobs.Insert(ctx, forgotArgs{Email: email}, &river.InsertOpts{Queue: jobs.QueueEmail, MaxAttempts: 5}); err != nil {
				return nil, httpx.Wrap(err)
			}
			return nil, nil
		})

	register(s, api, huma.Operation{OperationID: "auth-password-reset", Method: http.MethodPost, Path: "/v1/auth/password/reset",
		Summary: "Set a new password from a reset link", Tags: tags, DefaultStatus: http.StatusNoContent, Security: []map[string][]string{}},
		func(ctx context.Context, in *struct {
			Body struct {
				Token    string `json:"token" maxLength:"200"`
				Password string `json:"password" maxLength:"1024"`
			}
		}) (*struct{}, error) {
			ri := requestInfo(ctx)
			if err := s.limit("reset:ip:"+ri.IP, resetPerIP, time.Hour); err != nil {
				return nil, err
			}
			if err := auth.CheckPassword(in.Body.Password); err != nil {
				return nil, httpx.Wrap(err)
			}
			hash, err := auth.HashPassword(in.Body.Password)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			var uid uuid.UUID
			err = s.tx(ctx, func(tx pgx.Tx) error {
				o, err := consumeOneTime(ctx, tx, ottReset, in.Body.Token)
				if db.IsNotFound(err) {
					return errInvalidToken()
				}
				if err != nil {
					return err
				}
				if o.UserID == nil {
					return errInvalidToken()
				}
				uid = *o.UserID
				tag, err := tx.Exec(ctx, `UPDATE users SET password_hash = $2, updated_at = now(),
					email_verified_at = CASE WHEN email = $3 THEN COALESCE(email_verified_at, now()) ELSE email_verified_at END
					WHERE id = $1`, uid, hash, o.Email)
				if err != nil {
					return err
				}
				if tag.RowsAffected() == 0 {
					return errInvalidToken()
				}
				if _, err := tx.Exec(ctx, `UPDATE one_time_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`, uid, ottReset); err != nil {
					return err
				}
				if err := revokeOtherSessions(ctx, tx, uid, uuid.Nil); err != nil {
					return err
				}
				_, err = auditUser(ctx, tx, userPrincipal(uid, ri), uid, "password.reset", nil)
				return err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			s.disconnect(uid, uuid.Nil)
			return nil, nil
		})

	register(s, api, huma.Operation{OperationID: "auth-email-verify", Method: http.MethodPost, Path: "/v1/auth/email/verify",
		Summary: "Confirm an email address", Tags: tags, DefaultStatus: http.StatusNoContent, Security: []map[string][]string{}},
		func(ctx context.Context, in *struct {
			Body struct {
				Token string `json:"token" maxLength:"200"`
			}
		}) (*struct{}, error) {
			ri := requestInfo(ctx)
			if err := s.limit("verify:ip:"+ri.IP, 30, time.Hour); err != nil {
				return nil, err
			}
			err := s.tx(ctx, func(tx pgx.Tx) error {
				o, err := consumeOneTime(ctx, tx, ottVerifyEmail, in.Body.Token)
				if db.IsNotFound(err) || (err == nil && o.UserID == nil) {
					return errInvalidToken()
				}
				if err != nil {
					return err
				}
				tag, err := tx.Exec(ctx, `UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
					WHERE id = $1 AND email = $2`, *o.UserID, o.Email)
				if err != nil {
					return err
				}
				if tag.RowsAffected() == 0 {
					return errInvalidToken()
				}
				return nil
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return nil, nil
		})

	register(s, api, huma.Operation{OperationID: "auth-email-resend", Method: http.MethodPost, Path: "/v1/auth/email/resend",
		Summary: "Send the confirmation email again", Tags: tags, DefaultStatus: http.StatusNoContent},
		func(ctx context.Context, _ *struct{}) (*struct{}, error) {
			p, err := auth.RequireUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			if err := s.limit("resend:"+p.UserID.String(), 3, time.Hour); err != nil {
				return nil, err
			}
			err = s.tx(ctx, func(tx pgx.Tx) error {
				u, err := loadUser(ctx, tx, p.UserID)
				if err != nil || u.EmailVerified {
					return err
				}
				return s.sendVerifyEmail(ctx, tx, u.ID, u.Email)
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return nil, nil
		})
}

func (s *svc) handleRegister(ctx context.Context, in *coreRegisterBody) (*authOut, error) {
	ri := requestInfo(ctx)
	if err := s.limit("register:ip:"+ri.IP, registerPerIP, time.Hour); err != nil {
		return nil, err
	}
	if err := s.d.Captcha.Verify(ctx, in.TurnstileToken, ri.IP); err != nil {
		return nil, httpx.Wrap(err)
	}
	email := normEmail(in.Email)
	if email == "" {
		return nil, httpx.E(422, "invalid_email", "Enter a valid email address.")
	}
	name, err := displayname.Validate("Name", in.Name, displayname.Person, false)
	if err != nil {
		return nil, httpx.Wrap(err)
	}
	if err := auth.CheckPassword(in.Password); err != nil {
		return nil, httpx.Wrap(err)
	}
	invited := false
	if in.InviteToken != "" {
		var invEmail string
		err := s.d.DB.Pool.QueryRow(ctx, `SELECT email FROM invitations WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()`,
			crypto.HashToken(in.InviteToken)).Scan(&invEmail)
		if err != nil && !db.IsNotFound(err) {
			return nil, httpx.Wrap(err)
		}
		invited = err == nil && invEmail == email
	}
	if !s.d.Cfg.SignupEnabled && !invited {
		return nil, httpx.E(403, "signup_disabled", "Sign up is by invitation only on this instance.")
	}
	hash, err := auth.HashPassword(in.Password)
	if err != nil {
		return nil, httpx.Wrap(err)
	}
	var out *authOut
	uid := ids.New()
	err = s.tx(ctx, func(tx pgx.Tx) error {
		var verified *time.Time
		if invited {
			verified = ptr(time.Now())
		}
		_, err := tx.Exec(ctx, `INSERT INTO users (id, email, name, password_hash, email_verified_at) VALUES ($1, $2, $3, $4, $5)`,
			uid, email, name, hash, verified)
		if db.IsUniqueViolation(err, "") {
			return httpx.E(409, "email_taken", "An account with this email already exists. Sign in instead.")
		}
		if err != nil {
			return err
		}
		if !invited {
			if err := s.sendVerifyEmail(ctx, tx, uid, email); err != nil {
				return err
			}
		}
		out, err = s.issueSession(ctx, tx, uid, false, ri)
		return err
	})
	if err != nil {
		return nil, httpx.Wrap(err)
	}
	s.d.Analytics.Capture(uid.String(), "", "user_signed_up", map[string]any{"method": "password", "invited": invited})
	return out, nil
}

func (s *svc) handleLogin(ctx context.Context, in *coreLoginBody) (*authOut, error) {
	ri := requestInfo(ctx)
	if err := s.limit("login:ip:"+ri.IP, loginPerIP, loginWindow); err != nil {
		return nil, err
	}
	email := normEmail(in.Email)
	if email != "" {
		if err := s.limit("login:email:"+email, loginPerAccount, loginWindow); err != nil {
			return nil, err
		}
	}
	if err := s.d.Captcha.Verify(ctx, in.TurnstileToken, ri.IP); err != nil {
		return nil, httpx.Wrap(err)
	}
	var uid uuid.UUID
	var hash *string
	var totp bool
	found := false
	if email != "" {
		err := s.d.DB.Pool.QueryRow(ctx, `SELECT id, password_hash, totp_enabled FROM users WHERE email = $1`, email).Scan(&uid, &hash, &totp)
		if err != nil && !db.IsNotFound(err) {
			return nil, httpx.Wrap(err)
		}
		found = err == nil
	}
	if !found || hash == nil {
		auth.DummyVerify(in.Password)
		s.loginFailed(ctx, uid, ri, "password")
		return nil, errInvalidCredentials()
	}
	if !auth.VerifyPassword(in.Password, *hash) {
		s.loginFailed(ctx, uid, ri, "password")
		return nil, errInvalidCredentials()
	}
	return s.completeFirstFactor(ctx, uid, totp, "password", "", ri)
}

// completeFirstFactor answers a verified first factor with tokens, or with an MFA
// challenge when the user has TOTP on.
func (s *svc) completeFirstFactor(ctx context.Context, uid uuid.UUID, totp bool, method, redirectTo string, ri reqInfo) (*authOut, error) {
	if totp {
		tok, _, err := s.d.Tokens.Sign(auth.Claims{Purpose: auth.PurposeMFA, Data: map[string]string{"method": method, "rt": redirectTo}},
			uid.String(), auth.MFATTL)
		if err != nil {
			return nil, httpx.Wrap(err)
		}
		return &authOut{CacheControl: "no-store", Body: CoreAuthResult{MFARequired: true, MFAToken: tok, RedirectTo: redirectTo}}, nil
	}
	var out *authOut
	err := s.tx(ctx, func(tx pgx.Tx) error {
		var err error
		if out, err = s.issueSession(ctx, tx, uid, false, ri); err != nil {
			return err
		}
		_, err = auditUser(ctx, tx, userPrincipal(uid, ri), uid, "login", map[string]any{"method": method, "mfa": false})
		return err
	})
	if err != nil {
		return nil, httpx.Wrap(err)
	}
	out.Body.RedirectTo = redirectTo
	s.d.Analytics.Capture(uid.String(), "", "user_logged_in", map[string]any{"method": method, "mfa": false})
	return out, nil
}

// loginFailed records a failed sign-in: an audit row in the user's workspaces when
// the account is known and has any, otherwise a log line without the address.
func (s *svc) loginFailed(ctx context.Context, uid uuid.UUID, ri reqInfo, method string) {
	wrote := false
	if uid != uuid.Nil {
		err := s.tx(context.WithoutCancel(ctx), func(tx pgx.Tx) error {
			var err error
			wrote, err = auditUser(ctx, tx, userPrincipal(uid, ri), uid, "login.failed", map[string]any{"method": method})
			return err
		})
		if err != nil {
			s.d.Log.Error("audit login failure", "err", err)
		}
	}
	if !wrote {
		attrs := []any{"method", method, "ip", ri.IP}
		if uid != uuid.Nil {
			attrs = append(attrs, "user_id", uid)
		}
		s.d.Log.Info("login failed", attrs...)
	}
}

func (s *svc) handleMFA(ctx context.Context, mfaToken, code string) (*authOut, error) {
	ri := requestInfo(ctx)
	if err := s.limit("mfa:ip:"+ri.IP, loginPerIP, loginWindow); err != nil {
		return nil, err
	}
	c, err := s.d.Tokens.Verify(mfaToken, auth.PurposeMFA)
	if err != nil {
		return nil, httpx.E(401, "invalid_mfa_token", "Your sign-in attempt expired. Start again.")
	}
	uid, err := uuid.Parse(c.Subject)
	if err != nil {
		return nil, httpx.E(401, "invalid_mfa_token", "Your sign-in attempt expired. Start again.")
	}
	if err := s.limit("mfa:user:"+uid.String(), mfaPerUser, loginWindow); err != nil {
		return nil, err
	}
	method := c.Data["method"]
	var out *authOut
	var factor string
	err = s.tx(ctx, func(tx pgx.Tx) error {
		f, err := s.checkSecondFactor(ctx, tx, uid, code)
		if err != nil {
			return err
		}
		factor = f
		if out, err = s.issueSession(ctx, tx, uid, true, ri); err != nil {
			return err
		}
		_, err = auditUser(ctx, tx, userPrincipal(uid, ri), uid, "login", map[string]any{"method": method, "mfa": true, "factor": factor})
		return err
	})
	if err != nil {
		if he, ok := err.(*httpx.Error); ok && he.Code == "invalid_code" {
			s.loginFailed(ctx, uid, ri, "mfa")
		}
		return nil, httpx.Wrap(err)
	}
	out.Body.RedirectTo = c.Data["rt"]
	s.d.Analytics.Capture(uid.String(), "", "user_logged_in", map[string]any{"method": method, "mfa": true})
	return out, nil
}
