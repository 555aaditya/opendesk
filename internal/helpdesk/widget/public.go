package widget

import (
	"context"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/useopendesk/opendesk/internal/auth"
	"github.com/useopendesk/opendesk/internal/crypto"
	"github.com/useopendesk/opendesk/internal/db"
	"github.com/useopendesk/opendesk/internal/deps"
	"github.com/useopendesk/opendesk/internal/displayname"
	"github.com/useopendesk/opendesk/internal/domain"
	"github.com/useopendesk/opendesk/internal/events"
	"github.com/useopendesk/opendesk/internal/helpdesk/hd"
	"github.com/useopendesk/opendesk/internal/httpx"
	"github.com/useopendesk/opendesk/internal/ids"
	"github.com/useopendesk/opendesk/internal/images"
	"github.com/useopendesk/opendesk/internal/jobs"
)

type widgetWorkspace struct {
	ID        uuid.UUID
	Name      string
	Slug      string
	SecretEnc []byte
	Settings  hd.Settings
	Logo      domain.Avatar
	Brand     map[string]string
}

// loadByKey finds the workspace for a widget key, refusing unknown keys and disabled widgets alike.
func loadByKey(ctx context.Context, q db.Querier, key string) (widgetWorkspace, error) {
	var w widgetWorkspace
	var raw []byte
	key = strings.TrimSpace(key)
	if key == "" || len(key) > 200 {
		return w, httpx.NotFound("Widget")
	}
	err := q.QueryRow(ctx, `SELECT id, name, slug, widget_secret_enc, settings, avatar_url, brand_images FROM workspaces WHERE widget_key = $1`, key).
		Scan(&w.ID, &w.Name, &w.Slug, &w.SecretEnc, &raw, &w.Logo, &w.Brand)
	if db.IsNotFound(err) {
		return w, httpx.NotFound("Widget")
	}
	if err != nil {
		return w, err
	}
	w.Settings = hd.ParseSettings(raw)
	if !w.Settings.WidgetOrDefault().Enabled {
		return w, httpx.NotFound("Widget")
	}
	return w, nil
}

type widgetConfig struct {
	Body struct {
		WorkspaceName   string        `json:"workspace_name"`
		BrandColor      string        `json:"brand_color"`
		Greeting        string        `json:"greeting"`
		HelpCenterURL   string        `json:"help_center_url"`
		RequireEmail    bool          `json:"require_email"`
		Locale          string        `json:"locale" doc:"Workspace default language (BCP 47), empty when not set"`
		AvatarURL       domain.Avatar `json:"avatar_url" doc:"The widget brand avatar, else the workspace logo"`
		LauncherIconURL domain.Avatar `json:"launcher_icon_url"`
		Theme           string        `json:"theme" enum:"auto,light,dark"`
		Position        string        `json:"position" enum:"right,left"`
		OffsetX         int           `json:"offset_x"`
		OffsetY         int           `json:"offset_y"`
		Launcher        string        `json:"launcher" enum:"icon,label"`
		LauncherLabel   string        `json:"launcher_label"`
		Radius          string        `json:"radius" enum:"square,soft,round"`
		Title           string        `json:"title"`
		Subtitle        string        `json:"subtitle"`
		Suggestions     []string      `json:"suggestions"`
		Sound           bool          `json:"sound"`
		Team            []teamFace    `json:"team" doc:"Up to 3 team members, available first; first names only"`
		AIAnswers       bool          `json:"ai_answers" doc:"The AI agent handles new conversations"`
		Bot             struct {
			Name      string        `json:"name"`
			AvatarURL domain.Avatar `json:"avatar_url" doc:"null = the Ollie mark"`
		} `json:"bot"`
	}
}

type teamFace struct {
	Name      string        `json:"name"`
	AvatarURL domain.Avatar `json:"avatar_url"`
}

// teamFaces returns up to 3 members who can reply, available first: first names and
// pictures only.
func teamFaces(ctx context.Context, q db.Querier, wid uuid.UUID) ([]teamFace, error) {
	rows, err := q.Query(ctx, `SELECT u.name, u.avatar_url FROM members m JOIN users u ON u.id = m.user_id
		WHERE m.workspace_id = $1 AND m.role <> 'viewer'
		ORDER BY CASE m.availability WHEN 'online' THEN 0 WHEN 'away' THEN 1 ELSE 2 END, u.avatar_url IS NULL, m.created_at
		LIMIT 3`, wid)
	if err != nil {
		return nil, err
	}
	out := []teamFace{}
	_, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (struct{}, error) {
		var name string
		var avatar *string
		if err := r.Scan(&name, &avatar); err != nil {
			return struct{}{}, err
		}
		first, _, _ := strings.Cut(strings.TrimSpace(name), " ")
		face := teamFace{Name: first}
		if avatar != nil {
			face.AvatarURL = domain.Avatar(*avatar)
		}
		out = append(out, face)
		return struct{}{}, nil
	})
	return out, err
}

type widgetSessionInput struct {
	Origin    string `header:"Origin"`
	UserAgent string `header:"User-Agent"`
	Body      struct {
		Key          string `json:"key" maxLength:"200"`
		VisitorToken string `json:"visitor_token,omitempty" maxLength:"200"`
		Email        string `json:"email,omitempty" maxLength:"254"`
		Name         string `json:"name,omitempty" maxLength:"200"`
		UserID       string `json:"user_id,omitempty" maxLength:"200"`
		UserHash     string `json:"user_hash,omitempty" maxLength:"128"`
		AvatarURL    string `json:"avatar_url,omitempty" maxLength:"2000" doc:"https picture of the signed-in user; used only with a valid user_hash"`
	}
}

type widgetSession struct {
	Body struct {
		VisitorToken string            `json:"visitor_token"`
		Contact      domain.ContactRef `json:"contact"`
		WSToken      string            `json:"ws_token"`
		GatewayURL   string            `json:"gateway_url"`
	}
}

func (h *handler) registerPublic(api huma.API) {
	huma.Register(api, huma.Operation{OperationID: "widget-config", Method: http.MethodGet, Path: "/v1/widget/config",
		Summary: "Get the chat widget configuration", Tags: []string{"Widget"}, Security: []map[string][]string{}},
		func(ctx context.Context, in *struct {
			Key    string `query:"key" required:"true"`
			Origin string `header:"Origin"`
		}) (*widgetConfig, error) {
			w, err := loadByKey(ctx, h.d.DB.Pool, in.Key)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			ws := w.Settings.WidgetOrDefault()
			if err := checkOrigin(ws, in.Origin); err != nil {
				return nil, err
			}
			out := &widgetConfig{}
			out.Body.WorkspaceName = w.Name
			out.Body.BrandColor = w.Settings.BrandColor
			out.Body.Greeting = ws.Greeting
			out.Body.RequireEmail = ws.RequireEmail
			out.Body.Locale = w.Settings.Locale
			out.Body.AvatarURL = domain.Avatar(w.Brand["widget_avatar"])
			if out.Body.AvatarURL == "" {
				out.Body.AvatarURL = w.Logo
			}
			out.Body.LauncherIconURL = domain.Avatar(w.Brand["widget_launcher"])
			if hexColor.MatchString(ws.Color) {
				out.Body.BrandColor = ws.Color
			}
			out.Body.Theme, out.Body.Position, out.Body.OffsetX, out.Body.OffsetY = ws.Theme, ws.Position, ws.OffsetX, ws.OffsetY
			out.Body.Launcher, out.Body.LauncherLabel, out.Body.Radius = ws.Launcher, ws.LauncherLabel, ws.Radius
			out.Body.Title, out.Body.Subtitle, out.Body.Suggestions, out.Body.Sound = ws.Title, ws.Subtitle, ws.Suggestions, ws.Sound
			out.Body.Team = []teamFace{}
			if ws.ShowTeam {
				if out.Body.Team, err = teamFaces(ctx, h.d.DB.Pool, w.ID); err != nil {
					return nil, httpx.Wrap(err)
				}
			}
			ai := w.Settings.AI()
			out.Body.AIAnswers = h.d.Cfg.AIEnabled() && ai.Enabled && ai.WidgetAnswers
			out.Body.Bot.Name = ws.BotName
			if out.Body.Bot.Name == "" {
				out.Body.Bot.Name = "Ollie"
			}
			out.Body.Bot.AvatarURL = domain.Avatar(w.Brand["widget_bot"])
			if w.Settings.HelpCenterEnabled {
				out.Body.HelpCenterURL = h.d.Cfg.AppURL + "/help/" + w.Slug
			}
			return out, nil
		})

	huma.Register(api, huma.Operation{OperationID: "widget-session", Method: http.MethodPost, Path: "/v1/widget/session",
		Summary: "Start or resume a chat widget session", Tags: []string{"Widget"}, Security: []map[string][]string{},
		Description: "Returns a visitor token for the widget API and a short-lived realtime token. " +
			"user_hash = hex HMAC-SHA256(widget_secret, user_id) marks the visitor verified.",
		Middlewares: huma.Middlewares{h.withClientIP}},
		h.session)
}

// errInvalidHash answers a user_hash that does not verify.
var errInvalidHash = httpx.E(http.StatusUnauthorized, "invalid_user_hash", "The user_hash does not match user_id.")

func (h *handler) verifyUser(w widgetWorkspace, userID, userHash string) error {
	if userID == "" || userHash == "" {
		return httpx.Validation("user_id and user_hash must be sent together")
	}
	if len(w.SecretEnc) == 0 {
		return errInvalidHash
	}
	secret, err := h.d.Box.Open(w.SecretEnc)
	if err != nil {
		return err
	}
	if !crypto.EqualHex(crypto.HMACHex(secret, userID), strings.ToLower(strings.TrimSpace(userHash))) {
		return errInvalidHash
	}
	return nil
}

func normalizeEmail(s string) (string, error) {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" {
		return "", nil
	}
	a, err := mail.ParseAddress(s)
	if err != nil || a.Address != s || len(s) > 254 {
		return "", httpx.Validation("email is not a valid address")
	}
	return s, nil
}

func (h *handler) session(ctx context.Context, in *widgetSessionInput) (*widgetSession, error) {
	w, err := loadByKey(ctx, h.d.DB.Pool, in.Body.Key)
	if err != nil {
		return nil, httpx.Wrap(err)
	}
	if !h.d.Limiter.Allow("widget:session:"+w.ID.String()+":"+clientIP(ctx), sessionLimit, time.Minute) {
		return nil, httpx.RateLimited()
	}
	wset := w.Settings.WidgetOrDefault()
	if err := checkOrigin(wset, in.Origin); err != nil {
		return nil, err
	}
	b := in.Body
	userID := strings.TrimSpace(b.UserID)
	verified := false
	if userID != "" || b.UserHash != "" {
		if err := h.verifyUser(w, userID, b.UserHash); err != nil {
			return nil, httpx.Wrap(err)
		}
		verified = true
	}
	email, err := normalizeEmail(b.Email)
	if err != nil {
		return nil, err
	}
	name := displayname.Clean(b.Name, displayname.Person)

	out := &widgetSession{}
	err = h.d.DB.Tx(ctx, func(tx pgx.Tx) error {
		var contactID uuid.UUID
		token := ""
		if t := strings.TrimSpace(b.VisitorToken); t != "" {
			var sessContact uuid.UUID
			var sessVerified, blocked bool
			var external *string
			err := tx.QueryRow(ctx, `SELECT s.contact_id, s.verified, c.blocked, c.external_id FROM widget_sessions s
				JOIN contacts c ON c.id = s.contact_id WHERE s.workspace_id = $1 AND s.token_hash = $2`,
				w.ID, crypto.HashToken(t)).Scan(&sessContact, &sessVerified, &blocked, &external)
			switch {
			case db.IsNotFound(err):
			case err != nil:
				return err
			case blocked:
				return httpx.E(http.StatusForbidden, "blocked", "This conversation is not available.")
			case verified && (external == nil || *external != userID):
				// A different signed-in user on this browser gets a session of their own.
			default:
				contactID, token = sessContact, t
				if verified && !sessVerified {
					if _, err := tx.Exec(ctx, `UPDATE widget_sessions SET verified = true WHERE workspace_id = $1 AND token_hash = $2`,
						w.ID, crypto.HashToken(t)); err != nil {
						return err
					}
				}
				if _, err := tx.Exec(ctx, `UPDATE widget_sessions SET last_seen_at = now() WHERE workspace_id = $1 AND token_hash = $2`,
					w.ID, crypto.HashToken(t)); err != nil {
					return err
				}
			}
		}

		if contactID == uuid.Nil {
			var err error
			if verified {
				contactID, err = h.verifiedContact(ctx, tx, w.ID, userID, email, name)
			} else {
				contactID, err = h.newVisitorContact(ctx, tx, w.ID, email, name)
			}
			if err != nil {
				return err
			}
		} else if email != "" || name != "" {
			if err := h.fillContact(ctx, tx, w.ID, contactID, email, name); err != nil {
				return err
			}
		}

		if verified {
			if err := widgetPicture(ctx, h.d, tx, w.ID, contactID, strings.TrimSpace(b.AvatarURL)); err != nil {
				return err
			}
		}
		c, err := domain.LoadContact(ctx, tx, w.ID, contactID)
		if err != nil {
			return err
		}
		if c.Blocked {
			return httpx.E(http.StatusForbidden, "blocked", "This conversation is not available.")
		}
		if wset.RequireEmail && c.Email == nil && email == "" {
			return httpx.E(http.StatusUnprocessableEntity, "email_required", "Enter your email address to start a chat.")
		}
		if token == "" {
			token = "od_vis_" + crypto.RandomToken(32)
			if _, err := tx.Exec(ctx, `INSERT INTO widget_sessions (id, workspace_id, contact_id, token_hash, verified, user_agent)
				VALUES ($1,$2,$3,$4,$5,$6)`, ids.New(), w.ID, contactID, crypto.HashToken(token), verified, hd.Truncate(in.UserAgent, 400)); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE workspaces SET widget_seen_at = now() WHERE id = $1 AND widget_seen_at IS NULL`, w.ID); err != nil {
				return err
			}
		}
		wsToken, _, err := h.d.Tokens.Sign(auth.Claims{Purpose: auth.PurposeWidgetWS, Workspace: w.ID.String()}, contactID.String(), auth.WSTTL)
		if err != nil {
			return err
		}
		out.Body.VisitorToken = token
		out.Body.Contact = domain.ContactRef{ID: c.ID, Email: c.Email, Name: c.Name, AvatarURL: c.AvatarURL}
		out.Body.WSToken = wsToken
		out.Body.GatewayURL = h.d.Cfg.GatewayURL + "/widget" // the widget socket, open to any origin
		return nil
	})
	if err != nil {
		return nil, httpx.Wrap(err)
	}
	return out, nil
}

func emailTaken(ctx context.Context, tx pgx.Tx, wid uuid.UUID, email string, except uuid.UUID) (bool, error) {
	var taken bool
	err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM contacts WHERE workspace_id = $1 AND email = $2 AND id <> $3)`,
		wid, email, except).Scan(&taken)
	return taken, err
}

// insertContact creates a contact. The email is stored only when no other contact has it:
// an address a visitor types is unproven, so it never links the visitor to an existing
// contact's conversations. A claimed address that is taken is kept in custom.widget_email
// for agents to see.
func (h *handler) insertContact(ctx context.Context, tx pgx.Tx, wid uuid.UUID, externalID *string, email, name string) (uuid.UUID, error) {
	if name == "" {
		name = displayname.FromEmail(email)
	}
	if name == "" {
		name = "Visitor"
	}
	custom := map[string]any{"source": "widget"}
	var emailCol *string
	if email != "" {
		taken, err := emailTaken(ctx, tx, wid, email, uuid.Nil)
		if err != nil {
			return uuid.Nil, err
		}
		if taken {
			custom["widget_email"] = email
		} else {
			emailCol = &email
		}
	}
	id := ids.New()
	tag, err := tx.Exec(ctx, `INSERT INTO contacts (id, workspace_id, email, name, external_id, custom) VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT DO NOTHING`, id, wid, emailCol, name, externalID, custom)
	if err != nil {
		return uuid.Nil, err
	}
	if tag.RowsAffected() == 0 {
		// Lost a race on the email or external id; store without the address.
		if externalID != nil {
			var existing uuid.UUID
			if err := tx.QueryRow(ctx, `SELECT id FROM contacts WHERE workspace_id = $1 AND external_id = $2`, wid, *externalID).Scan(&existing); err == nil {
				return existing, nil
			}
		}
		custom["widget_email"] = email
		if _, err := tx.Exec(ctx, `INSERT INTO contacts (id, workspace_id, name, external_id, custom) VALUES ($1,$2,$3,$4,$5)`,
			id, wid, name, externalID, custom); err != nil {
			return uuid.Nil, err
		}
	}
	if err := publishContact(ctx, tx, wid, id, "contact.created"); err != nil {
		return uuid.Nil, err
	}
	return id, nil
}

func (h *handler) newVisitorContact(ctx context.Context, tx pgx.Tx, wid uuid.UUID, email, name string) (uuid.UUID, error) {
	return h.insertContact(ctx, tx, wid, nil, email, name)
}

// verifiedContact finds or creates the contact for a user id the customer's backend signed.
func (h *handler) verifiedContact(ctx context.Context, tx pgx.Tx, wid uuid.UUID, userID, email, name string) (uuid.UUID, error) {
	var id uuid.UUID
	err := tx.QueryRow(ctx, `SELECT id FROM contacts WHERE workspace_id = $1 AND external_id = $2`, wid, userID).Scan(&id)
	if db.IsNotFound(err) {
		return h.insertContact(ctx, tx, wid, &userID, email, name)
	}
	if err != nil {
		return uuid.Nil, err
	}
	return id, h.fillContact(ctx, tx, wid, id, email, name)
}

// fillContact sets a missing name or email on the session's own contact. The email is
// set only when the contact has none and no other contact uses it.
func (h *handler) fillContact(ctx context.Context, tx pgx.Tx, wid, id uuid.UUID, email, name string) error {
	changed := false
	if email != "" {
		taken, err := emailTaken(ctx, tx, wid, email, id)
		if err != nil {
			return err
		}
		if !taken {
			tag, err := tx.Exec(ctx, `UPDATE contacts SET email = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2 AND email IS NULL`, wid, id, email)
			if err != nil {
				return err
			}
			changed = changed || tag.RowsAffected() > 0
		}
	}
	if name != "" {
		tag, err := tx.Exec(ctx, `UPDATE contacts SET name = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2
			AND (name = '' OR name = 'Visitor') AND name <> $3`, wid, id, name)
		if err != nil {
			return err
		}
		changed = changed || tag.RowsAffected() > 0
	}
	if changed {
		return publishContact(ctx, tx, wid, id, "contact.updated")
	}
	return nil
}

func publishContact(ctx context.Context, tx pgx.Tx, wid, id uuid.UUID, typ string) error {
	c, err := domain.LoadContact(ctx, tx, wid, id)
	if err != nil {
		return err
	}
	_, err = events.Publish(ctx, tx, events.Event{WorkspaceID: wid, Type: typ, Data: map[string]any{"contact": c}})
	return err
}

// widgetPicture records a verified visitor's picture URL and queues its copy, unless an
// agent uploaded one. Only https URLs without credentials are kept.
func widgetPicture(ctx context.Context, d *deps.Deps, tx pgx.Tx, wid, cid uuid.UUID, raw string) error {
	if raw == "" || len(raw) > 2000 {
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
		return nil
	}
	var changed bool
	err = tx.QueryRow(ctx, `UPDATE contacts SET avatar_remote_url = $3, avatar_source = 'widget'
		WHERE workspace_id = $1 AND id = $2 AND avatar_source IS DISTINCT FROM 'upload' AND avatar_remote_url IS DISTINCT FROM $3
		RETURNING true`, wid, cid, raw).Scan(&changed)
	if db.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	return images.Enqueue(ctx, tx, d.Jobs, jobs.AvatarFetchArgs{Owner: images.OwnerContact, ID: cid, WorkspaceID: wid})
}
