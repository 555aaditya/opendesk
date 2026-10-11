package kb

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/opendesk/opendesk/internal/auth"
	"github.com/opendesk/opendesk/internal/db"
	"github.com/opendesk/opendesk/internal/deps"
	"github.com/opendesk/opendesk/internal/events"
	"github.com/opendesk/opendesk/internal/helpdesk/hd"
	"github.com/opendesk/opendesk/internal/httpx"
	"github.com/opendesk/opendesk/internal/ids"
)

const (
	excerptDerived = 200
	excerptMax     = 300
	maxBodyHTML    = 200000
)

type kbArticleCreate struct {
	CollectionID *string `json:"collection_id,omitempty" doc:"Collection id, or empty for none"`
	Title        string  `json:"title" minLength:"1" maxLength:"200"`
	Slug         string  `json:"slug,omitempty" maxLength:"100"`
	BodyHTML     string  `json:"body_html,omitempty" maxLength:"200000"`
	Excerpt      *string `json:"excerpt,omitempty" maxLength:"2000" doc:"Plain text; derived from the body when empty"`
	Status       string  `json:"status,omitempty" enum:"draft,published" default:"draft"`
}

type kbArticlePatch struct {
	CollectionID *string `json:"collection_id,omitempty" doc:"Collection id; empty string removes it from its collection"`
	Title        *string `json:"title,omitempty" minLength:"1" maxLength:"200"`
	Slug         *string `json:"slug,omitempty" maxLength:"100"`
	BodyHTML     *string `json:"body_html,omitempty" maxLength:"200000"`
	Excerpt      *string `json:"excerpt,omitempty" maxLength:"2000" doc:"Plain text; empty derives it from the body"`
	Status       *string `json:"status,omitempty" enum:"draft,published"`
}

type articleOut struct{ Body KbArticle }

func cleanTitle(s string) (string, error) {
	s = strings.Join(strings.Fields(s), " ")
	if s == "" {
		return "", httpx.Validation("title is required")
	}
	return hd.Truncate(s, 200), nil
}

func deriveExcerpt(body string) string { return hd.Excerpt(hd.HTMLToText(body), excerptDerived) }

func cleanExcerpt(s string) string {
	return hd.Truncate(strings.Join(strings.Fields(hd.HTMLToText(s)), " "), excerptMax)
}

// collectionRef parses an optional collection id; "" means none.
func collectionRef(ctx context.Context, q db.Querier, wid uuid.UUID, raw string) (*uuid.UUID, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	id, err := hd.ParseRef(raw, "collection_id")
	if err != nil {
		return nil, err
	}
	if err := hd.CheckRef(ctx, q, wid, "kb_collection", id); err != nil {
		return nil, err
	}
	return &id, nil
}

type articleCursor struct {
	U time.Time `json:"u"`
	I uuid.UUID `json:"i"`
}

func registerArticles(d *deps.Deps, api huma.API) {
	huma.Register(api, huma.Operation{OperationID: "list-kb-articles", Method: http.MethodGet, Path: "/v1/kb/articles",
		Summary: "List knowledge base articles", Description: "With q, returns the best matches by rank (no further pages).",
		Tags: []string{"Knowledge base"}},
		func(ctx context.Context, in *struct {
			httpx.ListParams
			CollectionID string `query:"collection_id" doc:"Only this collection; \"none\" for articles without one"`
			Status       string `query:"status" enum:"draft,published"`
			Q            string `query:"q" maxLength:"200"`
		}) (*struct{ Body httpx.Page[KbArticle] }, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleViewer, auth.ScopeKBRead)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			limit := in.Limit
			if limit <= 0 || limit > 100 {
				limit = 50
			}
			where := []string{"a.workspace_id = $1"}
			args := []any{p.WorkspaceID}
			arg := func(v any) string {
				args = append(args, v)
				return "$" + itoaArg(len(args))
			}
			switch in.CollectionID {
			case "":
			case "none":
				where = append(where, "a.collection_id IS NULL")
			default:
				cid, err := hd.ParseRef(in.CollectionID, "collection_id")
				if err != nil {
					return nil, err
				}
				where = append(where, "a.collection_id = "+arg(cid))
			}
			if in.Status != "" {
				where = append(where, "a.status = "+arg(in.Status))
			}
			if q := strings.TrimSpace(in.Q); q != "" {
				pq := prefixQuery(q)
				if pq == "" {
					return &struct{ Body httpx.Page[KbArticle] }{httpx.Page[KbArticle]{Data: []KbArticle{}}}, nil
				}
				args = append(args, q, pq)
				tsq := searchQuery(len(args) - 1)
				sql := articleSelect + ` WHERE ` + strings.Join(where, " AND ") + ` AND a.search @@ ` + tsq +
					` ORDER BY ts_rank(a.search, ` + tsq + `) DESC, a.updated_at DESC, a.id LIMIT ` + arg(limit)
				rows, err := d.DB.Pool.Query(ctx, sql, args...)
				out, err := collectRows(rows, err, scanArticle)
				if err != nil {
					return nil, httpx.Wrap(err)
				}
				return &struct{ Body httpx.Page[KbArticle] }{httpx.Page[KbArticle]{Data: out}}, nil
			}
			var cur articleCursor
			if err := httpx.DecodeCursor(in.Cursor, &cur); err != nil {
				return nil, err
			}
			if in.Cursor != "" {
				where = append(where, "(a.updated_at, a.id) < ("+arg(cur.U)+", "+arg(cur.I)+")")
			}
			sql := articleSelect + ` WHERE ` + strings.Join(where, " AND ") + ` ORDER BY a.updated_at DESC, a.id DESC LIMIT ` + arg(limit+1)
			rows, err := d.DB.Pool.Query(ctx, sql, args...)
			out, err := collectRows(rows, err, scanArticle)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body httpx.Page[KbArticle] }{httpx.NewPage(out, limit, func(a KbArticle) any {
				return articleCursor{U: a.UpdatedAt, I: a.ID}
			})}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "get-kb-article", Method: http.MethodGet, Path: "/v1/kb/articles/{id}",
		Summary: "Get a knowledge base article", Tags: []string{"Knowledge base"}},
		func(ctx context.Context, in *struct {
			ID string `path:"id"`
		}) (*articleOut, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleViewer, auth.ScopeKBRead)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := hd.ParseID(in.ID, "Article")
			if err != nil {
				return nil, err
			}
			a, err := loadArticle(ctx, d.DB.Pool, p.WorkspaceID, id)
			if db.IsNotFound(err) {
				return nil, httpx.NotFound("Article")
			}
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &articleOut{a}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "create-kb-article", Method: http.MethodPost, Path: "/v1/kb/articles",
		Summary: "Create a knowledge base article", Tags: []string{"Knowledge base"}, DefaultStatus: http.StatusCreated},
		func(ctx context.Context, in *struct{ Body kbArticleCreate }) (*articleOut, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAgent, auth.ScopeKBWrite)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			b := in.Body
			title, err := cleanTitle(b.Title)
			if err != nil {
				return nil, err
			}
			status := b.Status
			if status == "" {
				status = "draft"
			}
			body := hd.SanitizeRich(b.BodyHTML)
			excerpt := ""
			if b.Excerpt != nil {
				excerpt = cleanExcerpt(*b.Excerpt)
			}
			if excerpt == "" {
				excerpt = deriveExcerpt(body)
			}
			var a KbArticle
			err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
				var cid *uuid.UUID
				if b.CollectionID != nil {
					if cid, err = collectionRef(ctx, tx, p.WorkspaceID, *b.CollectionID); err != nil {
						return err
					}
				}
				slug, err := pickSlug(ctx, tx, "kb_articles", p.WorkspaceID, &b.Slug, title, nil)
				if err != nil {
					return err
				}
				id := ids.New()
				if _, err := tx.Exec(ctx, `INSERT INTO kb_articles (id, workspace_id, collection_id, title, slug, excerpt, body_html,
					status, author_id, published_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $8 = 'published' THEN now() END)`,
					id, p.WorkspaceID, cid, title, slug, excerpt, body, status, p.ActorUserID()); err != nil {
					return slugConflict(err)
				}
				if a, err = loadArticle(ctx, tx, p.WorkspaceID, id); err != nil {
					return err
				}
				if status == "published" {
					if err := hd.EnqueueAIEmbed(ctx, tx, d.Jobs, d.Cfg, p.WorkspaceID, "article", id); err != nil {
						return err
					}
				}
				_, err = events.Publish(ctx, tx, events.Event{WorkspaceID: p.WorkspaceID, Type: "kb_article.created", Data: map[string]any{"kb_article": a}})
				return err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &articleOut{a}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "update-kb-article", Method: http.MethodPatch, Path: "/v1/kb/articles/{id}",
		Summary: "Update a knowledge base article", Tags: []string{"Knowledge base"}},
		func(ctx context.Context, in *struct {
			ID   string `path:"id"`
			Body kbArticlePatch
		}) (*articleOut, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAgent, auth.ScopeKBWrite)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := hd.ParseID(in.ID, "Article")
			if err != nil {
				return nil, err
			}
			b := in.Body
			var a KbArticle
			err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
				cur, err := scanArticle(tx.QueryRow(ctx, articleSelect+` WHERE a.workspace_id = $1 AND a.id = $2 FOR UPDATE OF a`, p.WorkspaceID, id))
				if db.IsNotFound(err) {
					return httpx.NotFound("Article")
				}
				if err != nil {
					return err
				}
				if b.CollectionID != nil {
					if cur.CollectionID, err = collectionRef(ctx, tx, p.WorkspaceID, *b.CollectionID); err != nil {
						return err
					}
				}
				if b.Title != nil {
					if cur.Title, err = cleanTitle(*b.Title); err != nil {
						return err
					}
				}
				if b.Slug != nil {
					if cur.Slug, err = pickSlug(ctx, tx, "kb_articles", p.WorkspaceID, b.Slug, cur.Title, &id); err != nil {
						return err
					}
				}
				// A derived excerpt follows the body; one written by hand stays until replaced.
				wasDerived := cur.Excerpt == deriveExcerpt(cur.BodyHTML)
				if b.BodyHTML != nil {
					cur.BodyHTML = hd.SanitizeRich(*b.BodyHTML)
				}
				switch {
				case b.Excerpt != nil:
					if cur.Excerpt = cleanExcerpt(*b.Excerpt); cur.Excerpt == "" {
						cur.Excerpt = deriveExcerpt(cur.BodyHTML)
					}
				case b.BodyHTML != nil && wasDerived:
					cur.Excerpt = deriveExcerpt(cur.BodyHTML)
				}
				if b.Status != nil {
					cur.Status = *b.Status
				}
				if _, err := tx.Exec(ctx, `UPDATE kb_articles SET collection_id = $3, title = $4, slug = $5, excerpt = $6,
					body_html = $7, status = $8, updated_at = now(),
					published_at = CASE WHEN $8 = 'published' AND status <> 'published' THEN now() ELSE published_at END
					WHERE workspace_id = $1 AND id = $2`,
					p.WorkspaceID, id, cur.CollectionID, cur.Title, cur.Slug, cur.Excerpt, cur.BodyHTML, cur.Status); err != nil {
					return slugConflict(err)
				}
				if a, err = loadArticle(ctx, tx, p.WorkspaceID, id); err != nil {
					return err
				}
				// Reindexes a published article; unpublishing removes its embeddings.
				if err := hd.EnqueueAIEmbed(ctx, tx, d.Jobs, d.Cfg, p.WorkspaceID, "article", id); err != nil {
					return err
				}
				_, err = events.Publish(ctx, tx, events.Event{WorkspaceID: p.WorkspaceID, Type: "kb_article.updated", Data: map[string]any{"kb_article": a}})
				return err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &articleOut{a}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "delete-kb-article", Method: http.MethodDelete, Path: "/v1/kb/articles/{id}",
		Summary: "Delete a knowledge base article", Tags: []string{"Knowledge base"}, DefaultStatus: http.StatusNoContent},
		func(ctx context.Context, in *struct {
			ID string `path:"id"`
		}) (*hd.Empty, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAgent, auth.ScopeKBWrite)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := hd.ParseID(in.ID, "Article")
			if err != nil {
				return nil, err
			}
			err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
				tag, err := tx.Exec(ctx, `DELETE FROM kb_articles WHERE workspace_id = $1 AND id = $2`, p.WorkspaceID, id)
				if err != nil {
					return err
				}
				if tag.RowsAffected() == 0 {
					return httpx.NotFound("Article")
				}
				if err := hd.EnqueueAIEmbed(ctx, tx, d.Jobs, d.Cfg, p.WorkspaceID, "article", id); err != nil {
					return err
				}
				_, err = events.Publish(ctx, tx, events.Event{WorkspaceID: p.WorkspaceID, Type: "kb_article.deleted", Data: map[string]any{"kb_article_id": id}})
				return err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return nil, nil
		})
}
