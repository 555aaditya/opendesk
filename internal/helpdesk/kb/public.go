package kb

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/google/uuid"

	"github.com/opendesk/opendesk/internal/db"
	"github.com/opendesk/opendesk/internal/deps"
	"github.com/opendesk/opendesk/internal/helpdesk/hd"
	"github.com/opendesk/opendesk/internal/httpx"
)

const (
	featuredLimit     = 6
	publicSearchLimit = 20
	publicPerMinute   = 300
	searchPerMinute   = 60
)

type helpCenterHome struct {
	Title       string         `json:"title"`
	Collections []KbCollection `json:"collections"`
	Featured    []KbArticle    `json:"featured"`
}

type helpCenterCollection struct {
	Collection KbCollection `json:"collection"`
	Articles   []KbArticle  `json:"articles"`
}

// rateLimit throttles anonymous help center reads per client address; search has a
// tighter budget of its own.
func rateLimit(d *deps.Deps, key string, perMinute int) func(huma.Context, func(huma.Context)) {
	clientIP := httpx.ClientIP(d.Cfg.TrustProxy)
	return func(ctx huma.Context, next func(huma.Context)) {
		r, _ := humachi.Unwrap(ctx)
		ip := clientIP(r)
		if !d.Limiter.Allow(key+":"+ip, perMinute, time.Minute) {
			body, _ := json.Marshal(httpx.RateLimited())
			ctx.SetHeader("Content-Type", "application/problem+json")
			ctx.SetHeader("Retry-After", "60")
			ctx.SetStatus(http.StatusTooManyRequests)
			_, _ = ctx.BodyWriter().Write(body)
			return
		}
		next(ctx)
	}
}

// helpCenter resolves a workspace whose help center is enabled; anything else is 404.
func helpCenter(ctx context.Context, d *deps.Deps, slug string) (uuid.UUID, string, error) {
	var wid uuid.UUID
	var name string
	var raw []byte
	err := d.DB.Pool.QueryRow(ctx, `SELECT id, name, settings FROM workspaces WHERE slug = $1`, strings.ToLower(strings.TrimSpace(slug))).
		Scan(&wid, &name, &raw)
	if db.IsNotFound(err) {
		return uuid.Nil, "", httpx.NotFound("Help center")
	}
	if err != nil {
		return uuid.Nil, "", httpx.Wrap(err)
	}
	s := hd.ParseSettings(raw)
	if !s.HelpCenterEnabled {
		return uuid.Nil, "", httpx.NotFound("Help center")
	}
	title := strings.TrimSpace(s.HelpCenterTitle)
	if title == "" {
		title = name
	}
	return wid, title, nil
}

func registerPublic(d *deps.Deps, api huma.API) {
	limited := huma.Middlewares{rateLimit(d, "kb-public", publicPerMinute)}
	tags := []string{"Help center"}
	public1 := []map[string][]string{}

	huma.Register(api, huma.Operation{OperationID: "public-help-home", Method: http.MethodGet, Path: "/v1/public/help/{workspace_slug}",
		Summary: "Help center home", Tags: tags, Security: public1, Middlewares: limited},
		func(ctx context.Context, in *struct {
			Slug string `path:"workspace_slug"`
		}) (*struct{ Body helpCenterHome }, error) {
			wid, title, err := helpCenter(ctx, d, in.Slug)
			if err != nil {
				return nil, err
			}
			rows, err := d.DB.Pool.Query(ctx, collectionSelect+` WHERE k.workspace_id = $2 AND EXISTS
				(SELECT 1 FROM kb_articles a WHERE a.collection_id = k.id AND a.status = 'published')
				ORDER BY k.position, k.name, k.id`, true, wid)
			cols, err := collectRows(rows, err, scanCollection)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			rows, err = d.DB.Pool.Query(ctx, articleSelect+` WHERE a.workspace_id = $1 AND a.status = 'published'
				ORDER BY a.views DESC, a.published_at DESC NULLS LAST, a.id LIMIT $2`, wid, featuredLimit)
			featured, err := collectRows(rows, err, scanArticle)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body helpCenterHome }{helpCenterHome{Title: title, Collections: cols, Featured: publicList(featured)}}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "public-help-collection", Method: http.MethodGet,
		Path: "/v1/public/help/{workspace_slug}/collections/{slug}", Summary: "Help center collection", Tags: tags,
		Security: public1, Middlewares: limited},
		func(ctx context.Context, in *struct {
			WSSlug string `path:"workspace_slug"`
			Slug   string `path:"slug"`
		}) (*struct{ Body helpCenterCollection }, error) {
			wid, _, err := helpCenter(ctx, d, in.WSSlug)
			if err != nil {
				return nil, err
			}
			c, err := scanCollection(d.DB.Pool.QueryRow(ctx, collectionSelect+` WHERE k.workspace_id = $2 AND k.slug = $3`, true, wid, in.Slug))
			if db.IsNotFound(err) {
				return nil, httpx.NotFound("Collection")
			}
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			rows, err := d.DB.Pool.Query(ctx, articleSelect+` WHERE a.workspace_id = $1 AND a.collection_id = $2 AND a.status = 'published'
				ORDER BY a.position, a.title, a.id`, wid, c.ID)
			arts, err := collectRows(rows, err, scanArticle)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body helpCenterCollection }{helpCenterCollection{Collection: c, Articles: publicList(arts)}}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "public-help-article", Method: http.MethodGet,
		Path: "/v1/public/help/{workspace_slug}/articles/{slug}", Summary: "Help center article", Description: "Counts a view.",
		Tags: tags, Security: public1, Middlewares: limited},
		func(ctx context.Context, in *struct {
			WSSlug string `path:"workspace_slug"`
			Slug   string `path:"slug"`
		}) (*articleOut, error) {
			wid, _, err := helpCenter(ctx, d, in.WSSlug)
			if err != nil {
				return nil, err
			}
			var id uuid.UUID
			err = d.DB.Pool.QueryRow(ctx, `UPDATE kb_articles SET views = views + 1
				WHERE workspace_id = $1 AND slug = $2 AND status = 'published' RETURNING id`, wid, in.Slug).Scan(&id)
			if db.IsNotFound(err) {
				return nil, httpx.NotFound("Article")
			}
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			a, err := loadArticle(ctx, d.DB.Pool, wid, id)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &articleOut{public(a)}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "public-help-search", Method: http.MethodGet,
		Path: "/v1/public/help/{workspace_slug}/search", Summary: "Search the help center", Tags: tags, Security: public1,
		Middlewares: huma.Middlewares{rateLimit(d, "kb-search", searchPerMinute)}},
		func(ctx context.Context, in *struct {
			WSSlug string `path:"workspace_slug"`
			Q      string `query:"q" maxLength:"200"`
		}) (*struct{ Body []KbArticle }, error) {
			wid, _, err := helpCenter(ctx, d, in.WSSlug)
			if err != nil {
				return nil, err
			}
			q := strings.TrimSpace(in.Q)
			pq := prefixQuery(q)
			if pq == "" {
				return &struct{ Body []KbArticle }{[]KbArticle{}}, nil
			}
			tsq := searchQuery(2)
			rows, err := d.DB.Pool.Query(ctx, articleSelect+` WHERE a.workspace_id = $1 AND a.status = 'published' AND a.search @@ `+tsq+`
				ORDER BY ts_rank(a.search, `+tsq+`) DESC, a.views DESC, a.id LIMIT $4`, wid, q, pq, publicSearchLimit)
			arts, err := collectRows(rows, err, scanArticle)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body []KbArticle }{publicList(arts)}, nil
		})
}
