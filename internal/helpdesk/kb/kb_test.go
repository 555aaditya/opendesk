package kb_test

import (
	"slices"
	"strings"
	"testing"

	"github.com/opendesk/opendesk/internal/auth"
	"github.com/opendesk/opendesk/internal/helpdesk/hdtest"
	"github.com/opendesk/opendesk/internal/helpdesk/kb"
)

type article struct {
	ID           string  `json:"id"`
	CollectionID *string `json:"collection_id"`
	Title        string  `json:"title"`
	Slug         string  `json:"slug"`
	Excerpt      string  `json:"excerpt"`
	BodyHTML     string  `json:"body_html"`
	Status       string  `json:"status"`
	Views        int     `json:"views"`
	PublishedAt  *string `json:"published_at"`
	Author       *struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Email string `json:"email"`
	} `json:"author"`
}

type collection struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Slug         string `json:"slug"`
	ArticleCount int    `json:"article_count"`
}

func createArticle(t *testing.T, e *hdtest.Env, a hdtest.Auth, body map[string]any) article {
	t.Helper()
	var out article
	e.Do("POST", "/v1/kb/articles", a, body).Want(t, 201).JSON(t, &out)
	return out
}

func TestCollectionsCRUD(t *testing.T) {
	e := hdtest.New(t, kb.Register)
	ws := e.NewWorkspace()
	agent := ws.Agent.As(ws)
	_, seq := e.Events(ws.ID, 0)

	var c1, c2 collection
	e.Do("POST", "/v1/kb/collections", agent, map[string]any{"name": "Getting Started!", "description": "Basics"}).Want(t, 201).JSON(t, &c1)
	if c1.Slug != "getting-started" {
		t.Fatalf("slug %q", c1.Slug)
	}
	e.Do("POST", "/v1/kb/collections", agent, map[string]any{"name": "Getting started"}).Want(t, 201).JSON(t, &c2)
	if c2.Slug != "getting-started-2" {
		t.Fatalf("second slug %q", c2.Slug)
	}
	e.Do("PATCH", "/v1/kb/collections/"+c2.ID, agent, map[string]any{"slug": "getting-started"}).Want(t, 409)
	e.Do("PATCH", "/v1/kb/collections/"+c2.ID, agent, map[string]any{"slug": "Billing FAQ", "name": "Billing"}).Want(t, 200).JSON(t, &c2)
	if c2.Slug != "billing-faq" || c2.Name != "Billing" {
		t.Fatalf("patched %+v", c2)
	}
	art := createArticle(t, e, agent, map[string]any{"title": "Invoices", "body_html": "<p>x</p>", "collection_id": c2.ID})
	var list struct{ Data []collection }
	e.Do("GET", "/v1/kb/collections", ws.Viewer.As(ws), nil).Want(t, 200).JSON(t, &list)
	if len(list.Data) != 2 || list.Data[1].ArticleCount+list.Data[0].ArticleCount != 1 {
		t.Fatalf("list %+v", list.Data)
	}
	e.Do("POST", "/v1/kb/collections", ws.Viewer.As(ws), map[string]any{"name": "Nope"}).Want(t, 403)
	e.Do("DELETE", "/v1/kb/collections/"+c2.ID, agent, nil).Want(t, 204)
	var got article
	e.Do("GET", "/v1/kb/articles/"+art.ID, agent, nil).Want(t, 200).JSON(t, &got)
	if got.CollectionID != nil {
		t.Fatal("article kept its deleted collection")
	}
	types, _ := e.Events(ws.ID, seq)
	for _, want := range []string{"kb_collection.created", "kb_collection.updated", "kb_collection.deleted", "kb_article.created"} {
		if !slices.Contains(types, want) {
			t.Errorf("missing event %s in %v", want, types)
		}
	}

	// Another workspace cannot see or change it.
	other := e.NewWorkspace()
	e.Do("GET", "/v1/kb/collections/"+c1.ID, other.Admin.As(other), nil).Want(t, 404)
	e.Do("PATCH", "/v1/kb/collections/"+c1.ID, other.Admin.As(other), map[string]any{"name": "x"}).Want(t, 404)
	e.Do("DELETE", "/v1/kb/collections/"+c1.ID, other.Admin.As(other), nil).Want(t, 404)
	// Nor reference it from an article.
	e.Do("POST", "/v1/kb/articles", other.Admin.As(other), map[string]any{"title": "x", "collection_id": c1.ID}).Want(t, 422)
}

func TestArticles(t *testing.T) {
	e := hdtest.New(t, kb.Register)
	ws := e.NewWorkspace()
	agent := ws.Agent.As(ws)

	a := createArticle(t, e, agent, map[string]any{"title": "Reset your password",
		"body_html": `<p onclick="x()">Open <strong>settings</strong> and click reset.</p><script>alert(1)</script>`})
	if strings.Contains(a.BodyHTML, "script") || strings.Contains(a.BodyHTML, "onclick") || !strings.Contains(a.BodyHTML, "<strong>settings</strong>") {
		t.Fatalf("body not sanitized: %s", a.BodyHTML)
	}
	if a.Excerpt != "Open settings and click reset." {
		t.Fatalf("excerpt %q", a.Excerpt)
	}
	if a.Status != "draft" || a.PublishedAt != nil || a.Slug != "reset-your-password" {
		t.Fatalf("draft %+v", a)
	}
	if a.Author == nil || a.Author.ID != ws.Agent.ID.String() {
		t.Fatal("author not set")
	}

	// Derived excerpt follows the body; a manual one sticks.
	var p article
	e.Do("PATCH", "/v1/kb/articles/"+a.ID, agent, map[string]any{"body_html": "<p>New body text.</p>", "status": "published"}).Want(t, 200).JSON(t, &p)
	if p.Excerpt != "New body text." || p.PublishedAt == nil || p.Status != "published" {
		t.Fatalf("patched %+v", p)
	}
	first := *p.PublishedAt
	e.Do("PATCH", "/v1/kb/articles/"+a.ID, agent, map[string]any{"excerpt": "Hand <b>written</b>"}).Want(t, 200).JSON(t, &p)
	e.Do("PATCH", "/v1/kb/articles/"+a.ID, agent, map[string]any{"body_html": "<p>Another body.</p>"}).Want(t, 200).JSON(t, &p)
	if p.Excerpt != "Hand written" || *p.PublishedAt != first {
		t.Fatalf("manual excerpt or published_at changed: %+v", p)
	}

	b := createArticle(t, e, agent, map[string]any{"title": "Reset your password", "status": "published"})
	if b.Slug != "reset-your-password-2" || b.PublishedAt == nil {
		t.Fatalf("second %+v", b)
	}
	e.Do("PATCH", "/v1/kb/articles/"+b.ID, agent, map[string]any{"slug": "reset-your-password"}).Want(t, 409)

	// Roles and scopes.
	e.Do("GET", "/v1/kb/articles/"+a.ID, ws.Viewer.As(ws), nil).Want(t, 200)
	e.Do("PATCH", "/v1/kb/articles/"+a.ID, ws.Viewer.As(ws), map[string]any{"title": "x"}).Want(t, 403)
	readKey := e.APIKey(ws, auth.ScopeKBRead)
	e.Do("GET", "/v1/kb/articles", hdtest.Auth{Bearer: readKey}, nil).Want(t, 200)
	e.Do("POST", "/v1/kb/articles", hdtest.Auth{Bearer: readKey}, map[string]any{"title": "x"}).Want(t, 403)
	e.Do("GET", "/v1/kb/articles", hdtest.Auth{Bearer: e.APIKey(ws, auth.ScopeTicketsRead)}, nil).Want(t, 403)
	var byKey article
	e.Do("POST", "/v1/kb/articles", hdtest.Auth{Bearer: e.APIKey(ws, auth.ScopeKBWrite)}, map[string]any{"title": "By key"}).Want(t, 201).JSON(t, &byKey)
	if byKey.Author != nil {
		t.Fatal("api key article has an author")
	}

	// Filters, search and pagination.
	var page struct {
		Data       []article
		NextCursor *string `json:"next_cursor"`
	}
	e.Do("GET", "/v1/kb/articles?status=published", agent, nil).Want(t, 200).JSON(t, &page)
	if len(page.Data) != 2 {
		t.Fatalf("published %d", len(page.Data))
	}
	e.Do("GET", "/v1/kb/articles?q=passw", agent, nil).Want(t, 200).JSON(t, &page)
	if len(page.Data) != 2 {
		t.Fatalf("search %d", len(page.Data))
	}
	e.Do("GET", "/v1/kb/articles?limit=2", agent, nil).Want(t, 200).JSON(t, &page)
	if len(page.Data) != 2 || page.NextCursor == nil {
		t.Fatalf("page1 %d %v", len(page.Data), page.NextCursor)
	}
	seen := []string{page.Data[0].ID, page.Data[1].ID}
	e.Do("GET", "/v1/kb/articles?limit=2&cursor="+*page.NextCursor, agent, nil).Want(t, 200).JSON(t, &page)
	if len(page.Data) != 1 || slices.Contains(seen, page.Data[0].ID) || page.NextCursor != nil {
		t.Fatalf("page2 %+v", page)
	}

	other := e.NewWorkspace()
	e.Do("GET", "/v1/kb/articles/"+a.ID, other.Owner.As(other), nil).Want(t, 404)
	e.Do("DELETE", "/v1/kb/articles/"+a.ID, other.Owner.As(other), nil).Want(t, 404)
	e.Do("DELETE", "/v1/kb/articles/"+a.ID, agent, nil).Want(t, 204)
	e.Do("GET", "/v1/kb/articles/"+a.ID, agent, nil).Want(t, 404)
}

func TestPublicHelpCenter(t *testing.T) {
	e := hdtest.New(t, kb.Register)
	ws := e.NewWorkspace()
	agent := ws.Agent.As(ws)
	none := hdtest.Auth{}

	var col, empty collection
	e.Do("POST", "/v1/kb/collections", agent, map[string]any{"name": "Account"}).Want(t, 201).JSON(t, &col)
	e.Do("POST", "/v1/kb/collections", agent, map[string]any{"name": "Empty"}).Want(t, 201).JSON(t, &empty)
	titled := createArticle(t, e, agent, map[string]any{"title": "Billing invoices", "body_html": "<p>How to download.</p>",
		"status": "published", "collection_id": col.ID})
	bodied := createArticle(t, e, agent, map[string]any{"title": "Account overview", "body_html": "<p>See billing in settings.</p>",
		"status": "published", "collection_id": col.ID})
	draft := createArticle(t, e, agent, map[string]any{"title": "Billing secret draft", "body_html": "<p>billing</p>", "collection_id": col.ID})

	base := "/v1/public/help/" + ws.Slug
	e.Do("GET", base, none, nil).Want(t, 404)
	e.Do("GET", base+"/articles/"+titled.Slug, none, nil).Want(t, 404)
	e.Do("GET", base+"/search?q=billing", none, nil).Want(t, 404)
	e.Do("GET", "/v1/public/help/no-such-workspace", none, nil).Want(t, 404)

	e.SetSettings(ws, map[string]any{"help_center_enabled": true, "help_center_title": "Acme help"})
	var home struct {
		Title       string
		Collections []collection
		Featured    []article
	}
	e.Do("GET", base, none, nil).Want(t, 200).JSON(t, &home)
	if home.Title != "Acme help" || len(home.Collections) != 1 || home.Collections[0].ArticleCount != 2 || len(home.Featured) != 2 {
		t.Fatalf("home %+v", home)
	}
	for _, a := range home.Featured {
		if a.Author != nil && a.Author.Email != "" {
			t.Fatal("author email leaked")
		}
	}

	var cp struct {
		Collection collection
		Articles   []article
	}
	e.Do("GET", base+"/collections/"+col.Slug, none, nil).Want(t, 200).JSON(t, &cp)
	if len(cp.Articles) != 2 || cp.Collection.ArticleCount != 2 {
		t.Fatalf("collection %+v", cp)
	}
	e.Do("GET", base+"/articles/"+draft.Slug, none, nil).Want(t, 404)

	var got article
	e.Do("GET", base+"/articles/"+titled.Slug, none, nil).Want(t, 200)
	e.Do("GET", base+"/articles/"+titled.Slug, none, nil).Want(t, 200).JSON(t, &got)
	if got.Views != 2 || got.Author == nil || got.Author.Email != "" {
		t.Fatalf("views %d author %+v", got.Views, got.Author)
	}

	var res []article
	e.Do("GET", base+"/search?q=billing", none, nil).Want(t, 200).JSON(t, &res)
	if len(res) != 2 || res[0].ID != titled.ID || res[1].ID != bodied.ID {
		t.Fatalf("ranking %+v", res)
	}
	e.Do("GET", base+"/search?q=bill", none, nil).Want(t, 200).JSON(t, &res)
	if len(res) != 2 {
		t.Fatalf("prefix %d", len(res))
	}
	e.Do("GET", base+"/search?q=", none, nil).Want(t, 200).JSON(t, &res)
	if len(res) != 0 {
		t.Fatal("empty q returned results")
	}
	e.Do("GET", base+"/search?q="+"%27%3A*%20%26%20%21", none, nil).Want(t, 200)

	// Disabled again: gone.
	e.SetSettings(ws, map[string]any{"help_center_enabled": false})
	e.Do("GET", base, none, nil).Want(t, 404)
}
