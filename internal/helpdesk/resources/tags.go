package resources

import (
	"context"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/useopendesk/opendesk/internal/auth"
	"github.com/useopendesk/opendesk/internal/db"
	"github.com/useopendesk/opendesk/internal/deps"
	"github.com/useopendesk/opendesk/internal/events"
	"github.com/useopendesk/opendesk/internal/helpdesk/hd"
	"github.com/useopendesk/opendesk/internal/httpx"
	"github.com/useopendesk/opendesk/internal/ids"
)

type idPath struct {
	ID string `path:"id"`
}

func lockKind(ctx context.Context, tx pgx.Tx, wid uuid.UUID, kind string) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1::text || ':' || $2))`, wid, kind)
	return err
}

// SavedReply is the contract shape.
type SavedReply struct {
	ID        uuid.UUID `json:"id"`
	Title     string    `json:"title"`
	Shortcut  string    `json:"shortcut"`
	BodyHTML  string    `json:"body_html"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

const savedReplySelect = `SELECT id, title, shortcut, body_html, created_at, updated_at FROM saved_replies`

type savedReplyWriteBody struct {
	Title    *string `json:"title,omitempty" maxLength:"200"`
	Shortcut *string `json:"shortcut,omitempty" maxLength:"64"`
	BodyHTML *string `json:"body_html,omitempty" maxLength:"100000"`
}

var shortcutRe = regexp.MustCompile(`^[a-z0-9_-]{0,32}$`)

func (b *savedReplyWriteBody) apply(r *SavedReply) error {
	if b.Title != nil {
		s, err := cleanName("title", *b.Title, 200)
		if err != nil {
			return err
		}
		r.Title = s
	}
	if r.Title == "" {
		return httpx.Validation("title is required")
	}
	if b.Shortcut != nil {
		s := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(*b.Shortcut), "/"))
		if !shortcutRe.MatchString(s) {
			return httpx.Validation("shortcut may use up to 32 lowercase letters, digits, - and _")
		}
		r.Shortcut = s
	}
	if b.BodyHTML != nil {
		r.BodyHTML = hd.SanitizeRich(*b.BodyHTML)
	}
	if strings.TrimSpace(r.BodyHTML) == "" {
		return httpx.Validation("body_html is required")
	}
	return nil
}

func saveSavedReply(ctx context.Context, tx pgx.Tx, wid uuid.UUID, r *SavedReply, createdBy *uuid.UUID, create bool) error {
	if err := lockKind(ctx, tx, wid, "saved_reply"); err != nil {
		return err
	}
	if r.Shortcut != "" {
		var taken bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM saved_replies WHERE workspace_id = $1 AND shortcut = $2 AND id <> $3)`,
			wid, r.Shortcut, r.ID).Scan(&taken); err != nil {
			return err
		}
		if taken {
			return httpx.Conflict("Another saved reply uses this shortcut.")
		}
	}
	var err error
	if create {
		err = tx.QueryRow(ctx, `INSERT INTO saved_replies (id, workspace_id, title, shortcut, body_html, created_by)
			VALUES ($1,$2,$3,$4,$5,$6) RETURNING created_at, updated_at`, r.ID, wid, r.Title, r.Shortcut, r.BodyHTML, createdBy).
			Scan(&r.CreatedAt, &r.UpdatedAt)
	} else {
		err = tx.QueryRow(ctx, `UPDATE saved_replies SET title = $3, shortcut = $4, body_html = $5, updated_at = now()
			WHERE workspace_id = $1 AND id = $2 RETURNING created_at, updated_at`, wid, r.ID, r.Title, r.Shortcut, r.BodyHTML).
			Scan(&r.CreatedAt, &r.UpdatedAt)
	}
	if err != nil {
		return err
	}
	typ := "saved_reply.updated"
	if create {
		typ = "saved_reply.created"
	}
	_, err = events.Publish(ctx, tx, events.Event{WorkspaceID: wid, Type: typ, Data: map[string]any{"saved_reply": r}})
	return err
}

type savedReplyOut struct{ Body SavedReply }

type titleCursor struct {
	Title string    `json:"t"`
	ID    uuid.UUID `json:"id"`
}

func registerSavedReplies(d *deps.Deps, api huma.API) {
	scan := func(r pgx.Row) (SavedReply, error) {
		var s SavedReply
		err := r.Scan(&s.ID, &s.Title, &s.Shortcut, &s.BodyHTML, &s.CreatedAt, &s.UpdatedAt)
		return s, err
	}

	huma.Register(api, op("list-saved-replies", http.MethodGet, "/v1/saved-replies", "List saved replies", "Saved replies", 0),
		func(ctx context.Context, in *struct {
			httpx.ListParams
			Q string `query:"q" maxLength:"200" doc:"Search title and shortcut"`
		}) (*struct{ Body httpx.Page[SavedReply] }, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleViewer, auth.ScopeTicketsRead)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			var cur titleCursor
			if err := httpx.DecodeCursor(in.Cursor, &cur); err != nil {
				return nil, err
			}
			q := strings.TrimSpace(in.Q)
			like := "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q) + "%"
			rows, err := d.DB.Pool.Query(ctx, savedReplySelect+` WHERE workspace_id = $1
				AND ($2 = '' OR title ILIKE $3 OR shortcut ILIKE $3)
				AND (NOT $4 OR (lower(title), id) > (lower($5), $6))
				ORDER BY lower(title), id LIMIT $7`, p.WorkspaceID, q, like, in.Cursor != "", cur.Title, cur.ID, in.Limit+1)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (SavedReply, error) { return scan(r) })
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			page := httpx.NewPage(out, in.Limit, func(s SavedReply) any { return titleCursor{Title: s.Title, ID: s.ID} })
			return &struct{ Body httpx.Page[SavedReply] }{page}, nil
		})

	huma.Register(api, op("create-saved-reply", http.MethodPost, "/v1/saved-replies", "Create a saved reply", "Saved replies", http.StatusCreated),
		func(ctx context.Context, in *struct{ Body savedReplyWriteBody }) (*savedReplyOut, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAgent, auth.ScopeTicketsWrite)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			r := SavedReply{ID: ids.New()}
			if err := in.Body.apply(&r); err != nil {
				return nil, err
			}
			if err := d.DB.Tx(ctx, func(tx pgx.Tx) error {
				return saveSavedReply(ctx, tx, p.WorkspaceID, &r, p.ActorUserID(), true)
			}); err != nil {
				return nil, httpx.Wrap(err)
			}
			return &savedReplyOut{r}, nil
		})

	huma.Register(api, op("get-saved-reply", http.MethodGet, "/v1/saved-replies/{id}", "Get a saved reply", "Saved replies", 0),
		func(ctx context.Context, in *idPath) (*savedReplyOut, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleViewer, auth.ScopeTicketsRead)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := hd.ParseID(in.ID, "Saved reply")
			if err != nil {
				return nil, err
			}
			r, err := scan(d.DB.Pool.QueryRow(ctx, savedReplySelect+` WHERE workspace_id = $1 AND id = $2`, p.WorkspaceID, id))
			if db.IsNotFound(err) {
				return nil, httpx.NotFound("Saved reply")
			}
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &savedReplyOut{r}, nil
		})

	huma.Register(api, op("update-saved-reply", http.MethodPatch, "/v1/saved-replies/{id}", "Update a saved reply", "Saved replies", 0),
		func(ctx context.Context, in *struct {
			ID   string `path:"id"`
			Body savedReplyWriteBody
		}) (*savedReplyOut, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAgent, auth.ScopeTicketsWrite)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := hd.ParseID(in.ID, "Saved reply")
			if err != nil {
				return nil, err
			}
			var r SavedReply
			err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
				var err error
				r, err = scan(tx.QueryRow(ctx, savedReplySelect+` WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, p.WorkspaceID, id))
				if db.IsNotFound(err) {
					return httpx.NotFound("Saved reply")
				}
				if err != nil {
					return err
				}
				if err := in.Body.apply(&r); err != nil {
					return err
				}
				return saveSavedReply(ctx, tx, p.WorkspaceID, &r, nil, false)
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &savedReplyOut{r}, nil
		})

	huma.Register(api, op("delete-saved-reply", http.MethodDelete, "/v1/saved-replies/{id}", "Delete a saved reply", "Saved replies", http.StatusNoContent),
		func(ctx context.Context, in *idPath) (*struct{}, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAgent, auth.ScopeTicketsWrite)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := hd.ParseID(in.ID, "Saved reply")
			if err != nil {
				return nil, err
			}
			err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
				tag, err := tx.Exec(ctx, `DELETE FROM saved_replies WHERE workspace_id = $1 AND id = $2`, p.WorkspaceID, id)
				if err != nil {
					return err
				}
				if tag.RowsAffected() == 0 {
					return httpx.NotFound("Saved reply")
				}
				_, err = events.Publish(ctx, tx, events.Event{WorkspaceID: p.WorkspaceID, Type: "saved_reply.deleted", Data: map[string]any{"saved_reply_id": id}})
				return err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return nil, nil
		})
}
