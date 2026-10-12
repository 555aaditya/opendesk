package knowledge

import (
	"context"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/useopendesk/opendesk/internal/ai"
	"github.com/useopendesk/opendesk/internal/audit"
	"github.com/useopendesk/opendesk/internal/auth"
	"github.com/useopendesk/opendesk/internal/db"
	"github.com/useopendesk/opendesk/internal/displayname"
	"github.com/useopendesk/opendesk/internal/helpdesk/hd"
	"github.com/useopendesk/opendesk/internal/httpx"
	"github.com/useopendesk/opendesk/internal/ids"
	"github.com/useopendesk/opendesk/internal/netsafe"
)

// WebsiteInput creates a website source.
type WebsiteInput struct {
	URL      string   `json:"url" minLength:"1" maxLength:"2000" doc:"The site to crawl (https)"`
	MaxPages int      `json:"max_pages,omitempty" minimum:"1" maximum:"500" doc:"At most this many pages, default 100"`
	Include  []string `json:"include,omitempty" maxItems:"20" doc:"Only crawl paths starting with one of these prefixes"`
	Exclude  []string `json:"exclude,omitempty" maxItems:"20" doc:"Skip paths starting with one of these prefixes"`
	Recrawl  string   `json:"recrawl,omitempty" enum:"off,weekly" doc:"Re-sync weekly, default weekly"`
}

// WebsitePatch changes a website source; absent members keep their value.
type WebsitePatch struct {
	URL      *string  `json:"url,omitempty" maxLength:"2000"`
	MaxPages *int     `json:"max_pages,omitempty" minimum:"1" maximum:"500"`
	Include  []string `json:"include,omitempty" maxItems:"20"`
	Exclude  []string `json:"exclude,omitempty" maxItems:"20"`
	Recrawl  *string  `json:"recrawl,omitempty" enum:"off,weekly"`
}

// SnippetInput creates a snippet.
type SnippetInput struct {
	Question string `json:"question" minLength:"3" maxLength:"300"`
	Answer   string `json:"answer" minLength:"1" maxLength:"4000" doc:"Markdown"`
}

// SnippetPatch changes a snippet; absent members keep their value.
type SnippetPatch struct {
	Question *string `json:"question,omitempty" minLength:"3" maxLength:"300"`
	Answer   *string `json:"answer,omitempty" minLength:"1" maxLength:"4000"`
}

// CreateInput is POST /v1/ai/knowledge.
type CreateInput struct {
	Kind    string        `json:"kind" enum:"website,snippet"`
	Name    string        `json:"name,omitempty" maxLength:"100"`
	Website *WebsiteInput `json:"website,omitempty"`
	Snippet *SnippetInput `json:"snippet,omitempty"`
}

// PatchInput is PATCH /v1/ai/knowledge/{id}.
type PatchInput struct {
	Name    *string       `json:"name,omitempty" maxLength:"100"`
	Enabled *bool         `json:"enabled,omitempty"`
	Website *WebsitePatch `json:"website,omitempty"`
	Snippet *SnippetPatch `json:"snippet,omitempty"`
}

type sourceList struct {
	Data []Source `json:"data"`
}

type uploadForm struct {
	File huma.FormFile `form:"file" required:"true" doc:"PDF, DOCX, TXT, Markdown, HTML or CSV, at most 20 MB"`
	Name string        `form:"name" required:"false" doc:"Display name, default the file name"`
}

// maxUploadBody leaves room for the multipart envelope around a 20 MB file.
const maxUploadBody = maxFileBytes + 1<<20

func (s *Service) register(api huma.API) {
	tags := []string{"AI"}
	read := func(ctx context.Context) (*auth.Principal, error) {
		p, err := auth.RequireWorkspace(ctx, auth.RoleViewer, auth.ScopeSettingsRead)
		return p, httpx.Wrap(err)
	}
	write := func(ctx context.Context) (*auth.Principal, error) {
		p, err := auth.RequireWorkspace(ctx, auth.RoleAdmin, auth.ScopeSettingsWrite)
		return p, httpx.Wrap(err)
	}

	huma.Register(api, huma.Operation{OperationID: "list-knowledge-sources", Method: http.MethodGet, Path: "/v1/ai/knowledge",
		Summary: "List knowledge sources", Description: "Websites, files and snippets the AI answers from, newest first.", Tags: tags},
		func(ctx context.Context, in *struct {
			Kind string `query:"kind" doc:"website, file or snippet"`
		}) (*struct{ Body sourceList }, error) {
			p, err := read(ctx)
			if err != nil {
				return nil, err
			}
			if in.Kind != "" && in.Kind != KindWebsite && in.Kind != KindFile && in.Kind != KindSnippet {
				return nil, httpx.Validation("kind must be website, file or snippet")
			}
			list, err := listSources(ctx, s.d.DB.Pool, p.WorkspaceID, in.Kind)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body sourceList }{sourceList{Data: list}}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "create-knowledge-source", Method: http.MethodPost, Path: "/v1/ai/knowledge",
		Summary: "Add a website or snippet", Description: "A website starts syncing at once; a snippet is ready at once.",
		Tags: tags, DefaultStatus: http.StatusCreated},
		func(ctx context.Context, in *struct{ Body CreateInput }) (*struct{ Body Source }, error) {
			p, err := write(ctx)
			if err != nil {
				return nil, err
			}
			src, err := s.create(ctx, p, in.Body)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body Source }{src}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "upload-knowledge-file", Method: http.MethodPost, Path: "/v1/ai/knowledge/files",
		Summary: "Upload a knowledge file", Description: "PDF, DOCX, TXT, Markdown, HTML or CSV, at most 20 MB. Its text is extracted in the background.",
		Tags: tags, DefaultStatus: http.StatusCreated, MaxBodyBytes: maxUploadBody, Middlewares: huma.Middlewares{limitBody(api)}},
		func(ctx context.Context, in *struct {
			RawBody huma.MultipartFormFiles[uploadForm]
		}) (*struct{ Body Source }, error) {
			if in.RawBody.Form != nil {
				defer func(f *multipart.Form) { _ = f.RemoveAll() }(in.RawBody.Form)
			}
			p, err := write(ctx)
			if err != nil {
				return nil, err
			}
			data := in.RawBody.Data()
			if data == nil || !data.File.IsSet || data.File.File == nil {
				return nil, httpx.Validation("file is required")
			}
			defer data.File.Close()
			src, err := s.upload(ctx, p, data.File, data.Name)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body Source }{src}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "get-knowledge-source", Method: http.MethodGet, Path: "/v1/ai/knowledge/{id}",
		Summary: "Get a knowledge source", Tags: tags},
		func(ctx context.Context, in *struct {
			ID uuid.UUID `path:"id"`
		}) (*struct{ Body Source }, error) {
			p, err := read(ctx)
			if err != nil {
				return nil, err
			}
			src, err := loadSource(ctx, s.d.DB.Pool, p.WorkspaceID, in.ID)
			if err != nil {
				return nil, notFound(err)
			}
			return &struct{ Body Source }{src}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "update-knowledge-source", Method: http.MethodPatch, Path: "/v1/ai/knowledge/{id}",
		Summary: "Update a knowledge source", Description: "Rename, turn on or off (off takes effect at once), change a website's crawl or a snippet's text. " +
			"A changed website syncs again.", Tags: tags},
		func(ctx context.Context, in *struct {
			ID   uuid.UUID `path:"id"`
			Body PatchInput
		}) (*struct{ Body Source }, error) {
			p, err := write(ctx)
			if err != nil {
				return nil, err
			}
			src, err := s.update(ctx, p, in.ID, in.Body)
			if err != nil {
				return nil, notFound(err)
			}
			return &struct{ Body Source }{src}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "delete-knowledge-source", Method: http.MethodDelete, Path: "/v1/ai/knowledge/{id}",
		Summary: "Delete a knowledge source", Description: "Removes its documents, embeddings and stored file.", Tags: tags, DefaultStatus: http.StatusNoContent},
		func(ctx context.Context, in *struct {
			ID uuid.UUID `path:"id"`
		}) (*struct{}, error) {
			p, err := write(ctx)
			if err != nil {
				return nil, err
			}
			if err := s.delete(ctx, p, in.ID); err != nil {
				return nil, notFound(err)
			}
			return nil, nil
		})

	huma.Register(api, huma.Operation{OperationID: "sync-knowledge-source", Method: http.MethodPost, Path: "/v1/ai/knowledge/{id}/sync",
		Summary: "Sync a knowledge source", Description: "Crawls a website again or re-extracts a file. 409 while it is syncing.", Tags: tags},
		func(ctx context.Context, in *struct {
			ID uuid.UUID `path:"id"`
		}) (*struct{ Body Source }, error) {
			p, err := write(ctx)
			if err != nil {
				return nil, err
			}
			src, err := s.resync(ctx, p, in.ID)
			if err != nil {
				return nil, notFound(err)
			}
			return &struct{ Body Source }{src}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "list-knowledge-docs", Method: http.MethodGet, Path: "/v1/ai/knowledge/{id}/docs",
		Summary: "List a source's documents", Description: "The pages of a website, the parts of a file or a snippet's document.", Tags: tags},
		func(ctx context.Context, in *struct {
			ID uuid.UUID `path:"id"`
			httpx.ListParams
		}) (*struct{ Body httpx.Page[Doc] }, error) {
			p, err := read(ctx)
			if err != nil {
				return nil, err
			}
			page, err := s.docs(ctx, p.WorkspaceID, in.ID, in.ListParams)
			if err != nil {
				return nil, notFound(err)
			}
			return &struct{ Body httpx.Page[Doc] }{page}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "delete-knowledge-doc", Method: http.MethodDelete, Path: "/v1/ai/knowledge/{id}/docs/{doc_id}",
		Summary: "Remove a document", Description: "A removed website page is skipped by later crawls of the source.", Tags: tags, DefaultStatus: http.StatusNoContent},
		func(ctx context.Context, in *struct {
			ID    uuid.UUID `path:"id"`
			DocID uuid.UUID `path:"doc_id"`
		}) (*struct{}, error) {
			p, err := write(ctx)
			if err != nil {
				return nil, err
			}
			if err := s.deleteDoc(ctx, p, in.ID, in.DocID); err != nil {
				return nil, notFound(err)
			}
			return nil, nil
		})
}

// notFound maps a missing row to the source's 404.
func notFound(err error) error {
	if db.IsNotFound(err) {
		return errNotFound
	}
	return httpx.Wrap(err)
}

// limitBody caps the request body before huma parses the multipart form.
func limitBody(api huma.API) func(huma.Context, func(huma.Context)) {
	return func(ctx huma.Context, next func(huma.Context)) {
		r, w := humachi.Unwrap(ctx)
		if r.ContentLength > maxUploadBody {
			_ = huma.WriteErr(api, ctx, http.StatusRequestEntityTooLarge, "Files can be at most 20 MB.")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxUploadBody)
		next(ctx)
	}
}

// --- Validation -------------------------------------------------------------------------

// cleanName is a source's display name: normalized spaces, no control characters,
// 1..100 characters.
func cleanName(s string) (string, error) {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || unicode.In(r, unicode.Cf) {
			return ' '
		}
		return r
	}, s)
	s = displayname.Normalize(s)
	if s == "" {
		return "", httpx.Validation("name is required")
	}
	if utf8.RuneCountInString(s) > maxNameRunes {
		return "", httpx.Validation("name can be at most 100 characters")
	}
	return s, nil
}

// defaultName shortens a fallback name to the limit.
func defaultName(s string) string {
	s = cleanLine(s)
	if r := []rune(s); len(r) > maxNameRunes {
		s = strings.TrimSpace(string(r[:maxNameRunes-1])) + "…"
	}
	if s == "" {
		s = "Untitled"
	}
	return s
}

// siteURL validates a website URL for crawling: https (http on a development
// instance), a public host, and returns its normalized form.
func (s *Service) siteURL(ctx context.Context, raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	v, err := netsafe.Guard{Dev: s.dev}.ValidateURL(ctx, raw)
	if err != nil {
		return "", httpx.Validation("website.url: " + err.Error())
	}
	u, err := url.Parse(v)
	if err != nil {
		return "", httpx.Validation("website.url: Enter a full URL starting with https://.")
	}
	n, ok := normalizeURL(u)
	if !ok {
		return "", httpx.Validation("website.url: Enter a full URL starting with https://.")
	}
	return n.String(), nil
}

// prefixes validates include or exclude path prefixes.
func prefixes(field string, in []string) ([]string, error) {
	out := []string{}
	if len(in) > maxPrefixes {
		return nil, httpx.Validation("website." + field + " can have at most 20 prefixes")
	}
	for _, p := range in {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if u, err := url.Parse(p); err == nil && u.Host != "" {
			p = u.Path
		}
		if !strings.HasPrefix(p, "/") {
			p = "/" + p
		}
		if utf8.RuneCountInString(p) > 200 || strings.IndexFunc(p, unicode.IsSpace) >= 0 || strings.ContainsAny(p, "?#") {
			return nil, httpx.Validation("website." + field + " must be URL paths such as /docs")
		}
		dup := false
		for _, x := range out {
			dup = dup || x == p
		}
		if !dup {
			out = append(out, p)
		}
	}
	return out, nil
}

func (s *Service) website(ctx context.Context, in WebsiteInput) (*Website, error) {
	u, err := s.siteURL(ctx, in.URL)
	if err != nil {
		return nil, err
	}
	w := &Website{URL: u, MaxPages: in.MaxPages, Recrawl: in.Recrawl}
	if w.MaxPages == 0 {
		w.MaxPages = defaultPages
	}
	if w.MaxPages < 1 || w.MaxPages > maxPagesLimit {
		return nil, httpx.Validation("website.max_pages must be between 1 and 500")
	}
	if w.Recrawl == "" {
		w.Recrawl = "weekly"
	}
	if w.Recrawl != "off" && w.Recrawl != "weekly" {
		return nil, httpx.Validation("website.recrawl must be off or weekly")
	}
	if w.Include, err = prefixes("include", in.Include); err != nil {
		return nil, err
	}
	if w.Exclude, err = prefixes("exclude", in.Exclude); err != nil {
		return nil, err
	}
	return w, nil
}

func snippet(in SnippetInput) (*Snippet, error) {
	q := cleanLine(in.Question)
	a := strings.TrimSpace(strings.ToValidUTF8(strings.ReplaceAll(in.Answer, "\r\n", "\n"), ""))
	if n := utf8.RuneCountInString(q); n < 3 || n > 300 {
		return nil, httpx.Validation("snippet.question must be 3 to 300 characters")
	}
	if n := utf8.RuneCountInString(a); n < 1 || n > 4000 {
		return nil, httpx.Validation("snippet.answer must be 1 to 4,000 characters")
	}
	return &Snippet{Question: q, Answer: a}, nil
}

// snippetText is a snippet answer's text: its markdown rendered and read back as text.
func snippetText(md string) string {
	if t := strings.TrimSpace(hd.HTMLToText(ai.MarkdownToHTML(md))); t != "" {
		return t
	}
	return strings.TrimSpace(md)
}

// --- Writes -----------------------------------------------------------------------------

// lockWorkspace serializes limit checks of one workspace's sources.
func lockWorkspace(ctx context.Context, tx pgx.Tx, wid uuid.UUID) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1::text || ':ai_knowledge'))`, wid)
	return err
}

// checkLimits refuses a new source when the workspace is at a limit; addChars is the
// text the source brings at once.
func checkLimits(ctx context.Context, tx pgx.Tx, wid uuid.UUID, addDocs int, addChars int64) error {
	var n int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM ai_knowledge_sources WHERE workspace_id = $1`, wid).Scan(&n); err != nil {
		return err
	}
	if n >= maxSources {
		return errSources
	}
	docs, chars, err := totals(ctx, tx, wid, nil)
	if err != nil {
		return err
	}
	if docs+max(addDocs, 1) > maxDocs {
		return errDocsLimit
	}
	if chars+addChars > maxChars || chars >= maxChars {
		return errChars
	}
	return nil
}

func (s *Service) embeddings() bool { return s.vectors && s.ai.Embedder() != nil }

func (s *Service) create(ctx context.Context, p *auth.Principal, in CreateInput) (Source, error) {
	var cfg config
	var name, status string
	switch in.Kind {
	case KindWebsite:
		if in.Website == nil || in.Snippet != nil {
			return Source{}, httpx.Validation("a website source needs website (and no snippet)")
		}
		w, err := s.website(ctx, *in.Website)
		if err != nil {
			return Source{}, err
		}
		cfg.Website, status = w, StatusPending
		u, _ := url.Parse(w.URL)
		name = defaultName(u.Hostname())
	case KindSnippet:
		if in.Snippet == nil || in.Website != nil {
			return Source{}, httpx.Validation("a snippet source needs snippet (and no website)")
		}
		sn, err := snippet(*in.Snippet)
		if err != nil {
			return Source{}, err
		}
		cfg.Snippet, status = sn, StatusReady
		name = defaultName(sn.Question)
	default:
		return Source{}, httpx.Validation("kind must be website or snippet; upload files to /v1/ai/knowledge/files")
	}
	if strings.TrimSpace(in.Name) != "" {
		n, err := cleanName(in.Name)
		if err != nil {
			return Source{}, err
		}
		name = n
	}
	wid := p.WorkspaceID
	var out Source
	err := s.d.DB.Tx(ctx, func(tx pgx.Tx) error {
		if err := lockWorkspace(ctx, tx, wid); err != nil {
			return err
		}
		var title, text string
		var addChars int64
		if cfg.Snippet != nil {
			title, text = snippetDoc(*cfg.Snippet)
			addChars = int64(utf8.RuneCountInString(text))
		}
		if err := checkLimits(ctx, tx, wid, 1, addChars); err != nil {
			return err
		}
		id := ids.New()
		if _, err := tx.Exec(ctx, `INSERT INTO ai_knowledge_sources (id, workspace_id, kind, name, status, config, created_by, last_synced_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $3 = 'snippet' THEN now() END)`,
			id, wid, in.Kind, name, status, cfg, p.ActorUserID()); err != nil {
			return err
		}
		if cfg.Snippet != nil {
			if _, _, err := putDoc(ctx, tx, wid, id, "snippet", nil, title, text); err != nil {
				return err
			}
			if err := refreshCounts(ctx, tx, wid, id); err != nil {
				return err
			}
		}
		src, err := loadSource(ctx, tx, wid, id)
		if err != nil {
			return err
		}
		if err := audit.Log(ctx, tx, p, wid, "ai.knowledge_created", "ai_knowledge_source", &id, auditData(src)); err != nil {
			return err
		}
		if err := publish(ctx, tx, wid, "ai_knowledge.created", src); err != nil {
			return err
		}
		if in.Kind == KindWebsite || s.embeddings() {
			if err := s.enqueueSync(ctx, tx, wid, id); err != nil {
				return err
			}
		}
		out = src
		return nil
	})
	return out, err
}

// auditData describes a source without its content.
func auditData(src Source) map[string]any {
	m := map[string]any{"kind": src.Kind, "name": src.Name}
	if src.Website != nil {
		// Scheme, host and path only: a query string may carry a token.
		if u, err := url.Parse(src.Website.URL); err == nil {
			m["url"] = u.Scheme + "://" + u.Host + u.EscapedPath()
		}
	}
	if src.File != nil {
		m["filename"], m["size_bytes"] = src.File.Filename, src.File.SizeBytes
	}
	return m
}

func (s *Service) upload(ctx context.Context, p *auth.Principal, f huma.FormFile, rawName string) (Source, error) {
	if f.Size > maxFileBytes {
		return Source{}, errFileSize
	}
	if f.Size <= 0 {
		return Source{}, httpx.Validation("the file is empty")
	}
	filename := hd.CleanFilename(f.Filename)
	head := make([]byte, 512)
	n, err := f.ReadAt(head, 0)
	if err != nil && err != io.EOF {
		return Source{}, err
	}
	ct, ok := detectFile(head[:n], filename, f.File, f.Size)
	if !ok {
		return Source{}, errFileType
	}
	name := defaultName(filename)
	if strings.TrimSpace(rawName) != "" {
		if name, err = cleanName(rawName); err != nil {
			return Source{}, err
		}
	}
	wid := p.WorkspaceID
	// Refuse early, before storing, when the workspace is full.
	if err := s.d.DB.Tx(ctx, func(tx pgx.Tx) error { return checkLimits(ctx, tx, wid, 1, 0) }); err != nil {
		return Source{}, err
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return Source{}, err
	}
	id := ids.New()
	key := "workspaces/" + wid.String() + "/knowledge/" + id.String()
	stored := ct
	if ct == ctHTML {
		stored = "text/plain; charset=utf-8"
	}
	counter := &countingReader{r: io.LimitReader(f.File, maxFileBytes+1)}
	if err := s.d.Storage.Put(ctx, key, counter, f.Size, stored); err != nil {
		return Source{}, err
	}
	if counter.n > maxFileBytes {
		_ = s.d.Storage.Delete(context.WithoutCancel(ctx), key)
		return Source{}, errFileSize
	}
	cfg := config{File: &FileInfo{Filename: filename, ContentType: ct, SizeBytes: counter.n}}
	var out Source
	err = s.d.DB.Tx(ctx, func(tx pgx.Tx) error {
		if err := lockWorkspace(ctx, tx, wid); err != nil {
			return err
		}
		if err := checkLimits(ctx, tx, wid, 1, 0); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO ai_knowledge_sources (id, workspace_id, kind, name, status, config, storage_key, created_by)
			VALUES ($1, $2, 'file', $3, 'pending', $4, $5, $6)`, id, wid, name, cfg, key, p.ActorUserID()); err != nil {
			return err
		}
		src, err := loadSource(ctx, tx, wid, id)
		if err != nil {
			return err
		}
		if err := audit.Log(ctx, tx, p, wid, "ai.knowledge_created", "ai_knowledge_source", &id, auditData(src)); err != nil {
			return err
		}
		if err := publish(ctx, tx, wid, "ai_knowledge.created", src); err != nil {
			return err
		}
		if err := s.enqueueSync(ctx, tx, wid, id); err != nil {
			return err
		}
		out = src
		return nil
	})
	if err != nil {
		_ = s.d.Storage.Delete(context.WithoutCancel(ctx), key)
		return Source{}, err
	}
	return out, nil
}

type countingReader struct {
	r io.Reader
	n int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += int64(n)
	return n, err
}

func (s *Service) update(ctx context.Context, p *auth.Principal, id uuid.UUID, in PatchInput) (Source, error) {
	var name *string
	if in.Name != nil {
		n, err := cleanName(*in.Name)
		if err != nil {
			return Source{}, err
		}
		name = &n
	}
	var siteURL string
	if in.Website != nil && in.Website.URL != nil {
		u, err := s.siteURL(ctx, *in.Website.URL)
		if err != nil {
			return Source{}, err
		}
		siteURL = u
	}
	wid := p.WorkspaceID
	var out Source
	err := s.d.DB.Tx(ctx, func(tx pgx.Tx) error {
		src, err := lockSource(ctx, tx, wid, id)
		if err != nil {
			return err
		}
		if name != nil {
			src.Name = *name
		}
		if in.Enabled != nil {
			src.Enabled = *in.Enabled
		}
		changed, resync := false, false
		if in.Website != nil {
			if src.Kind != KindWebsite {
				return httpx.Validation("website can only be changed on a website source")
			}
			w := *src.Website
			in := in.Website
			if in.URL != nil {
				w.URL = siteURL
			}
			if in.MaxPages != nil {
				w.MaxPages = *in.MaxPages
			}
			if in.Recrawl != nil {
				w.Recrawl = *in.Recrawl
			}
			if in.Include != nil {
				if w.Include, err = prefixes("include", in.Include); err != nil {
					return err
				}
			}
			if in.Exclude != nil {
				if w.Exclude, err = prefixes("exclude", in.Exclude); err != nil {
					return err
				}
			}
			upd, err := s.websiteChecked(w)
			if err != nil {
				return err
			}
			// Only crawl settings make a new crawl; the recrawl schedule does not.
			old := *src.Website
			old.Recrawl = upd.Recrawl
			resync = !sameWebsite(old, *upd)
			changed = resync || src.Website.Recrawl != upd.Recrawl
			src.Website = upd
		}
		var snippetDocText, snippetTitle string
		if in.Snippet != nil {
			if src.Kind != KindSnippet {
				return httpx.Validation("snippet can only be changed on a snippet source")
			}
			sn := *src.Snippet
			if in.Snippet.Question != nil {
				sn.Question = *in.Snippet.Question
			}
			if in.Snippet.Answer != nil {
				sn.Answer = *in.Snippet.Answer
			}
			upd, err := snippet(SnippetInput(sn))
			if err != nil {
				return err
			}
			if *upd != *src.Snippet {
				changed = true
				src.Snippet = upd
				snippetTitle, snippetDocText = snippetDoc(*upd)
				docs, chars, err := totals(ctx, tx, wid, &id)
				if err != nil {
					return err
				}
				if docs+1 > maxDocs {
					return errDocsLimit
				}
				if chars+int64(utf8.RuneCountInString(snippetDocText)) > maxChars {
					return errChars
				}
			}
		}
		version := src.version
		status := src.Status
		if changed {
			version++
		}
		if resync {
			status = StatusPending
		}
		if _, err := tx.Exec(ctx, `UPDATE ai_knowledge_sources SET name = $3, enabled = $4, config = $5, version = $6, status = $7,
			error = CASE WHEN $8 THEN NULL ELSE error END, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
			wid, id, src.Name, src.Enabled, src.config(), version, status, resync); err != nil {
			return err
		}
		if snippetTitle != "" {
			if _, _, err := putDoc(ctx, tx, wid, id, "snippet", nil, snippetTitle, snippetDocText); err != nil {
				return err
			}
			if err := refreshCounts(ctx, tx, wid, id); err != nil {
				return err
			}
		}
		updated, err := loadSource(ctx, tx, wid, id)
		if err != nil {
			return err
		}
		if err := publish(ctx, tx, wid, "ai_knowledge.updated", updated); err != nil {
			return err
		}
		if resync || (snippetTitle != "" && s.embeddings()) {
			if err := s.enqueueSync(ctx, tx, wid, id); err != nil {
				return err
			}
		}
		out = updated
		return nil
	})
	return out, err
}

// websiteChecked validates merged website settings.
func (s *Service) websiteChecked(w Website) (*Website, error) {
	if w.MaxPages < 1 || w.MaxPages > maxPagesLimit {
		return nil, httpx.Validation("website.max_pages must be between 1 and 500")
	}
	if w.Recrawl != "off" && w.Recrawl != "weekly" {
		return nil, httpx.Validation("website.recrawl must be off or weekly")
	}
	return &w, nil
}

func sameWebsite(a, b Website) bool {
	return a.URL == b.URL && a.MaxPages == b.MaxPages && a.Recrawl == b.Recrawl &&
		strings.Join(a.Include, "\x00") == strings.Join(b.Include, "\x00") && strings.Join(a.Exclude, "\x00") == strings.Join(b.Exclude, "\x00")
}

func (s *Service) delete(ctx context.Context, p *auth.Principal, id uuid.UUID) error {
	wid := p.WorkspaceID
	var key *string
	err := s.d.DB.Tx(ctx, func(tx pgx.Tx) error {
		src, err := lockSource(ctx, tx, wid, id)
		if err != nil {
			return err
		}
		key = src.storageKey
		rows, err := tx.Query(ctx, `DELETE FROM ai_knowledge_docs WHERE workspace_id = $1 AND source_id = $2 RETURNING id`, wid, id)
		if err != nil {
			return err
		}
		docIDs, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
		if err != nil {
			return err
		}
		if err := s.dropEmbeddings(ctx, tx, wid, docIDs); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM ai_knowledge_sources WHERE workspace_id = $1 AND id = $2`, wid, id); err != nil {
			return err
		}
		if err := audit.Log(ctx, tx, p, wid, "ai.knowledge_deleted", "ai_knowledge_source", &id, auditData(src)); err != nil {
			return err
		}
		return publishDeleted(ctx, tx, wid, id)
	})
	if err != nil {
		return err
	}
	if key != nil && *key != "" {
		if err := s.d.Storage.Delete(context.WithoutCancel(ctx), *key); err != nil {
			s.d.Log.Warn("knowledge file delete failed", "source_id", id, "err", err)
		}
	}
	return nil
}

func (s *Service) resync(ctx context.Context, p *auth.Principal, id uuid.UUID) (Source, error) {
	wid := p.WorkspaceID
	var out Source
	err := s.d.DB.Tx(ctx, func(tx pgx.Tx) error {
		src, err := lockSource(ctx, tx, wid, id)
		if err != nil {
			return err
		}
		if src.Status == StatusPending || src.Status == StatusSyncing {
			return errSyncing
		}
		if src.Kind != KindSnippet {
			if src, err = scanSource(tx.QueryRow(ctx, `UPDATE ai_knowledge_sources SET status = 'pending', error = NULL, updated_at = now()
				WHERE workspace_id = $1 AND id = $2 RETURNING `+sourceCols, wid, id)); err != nil {
				return err
			}
			if err := publish(ctx, tx, wid, "ai_knowledge.updated", src); err != nil {
				return err
			}
		}
		if err := s.enqueueSync(ctx, tx, wid, id); err != nil {
			return err
		}
		out = src
		return nil
	})
	return out, err
}

func (s *Service) docs(ctx context.Context, wid, sourceID uuid.UUID, lp httpx.ListParams) (httpx.Page[Doc], error) {
	if _, err := loadSource(ctx, s.d.DB.Pool, wid, sourceID); err != nil {
		return httpx.Page[Doc]{}, err
	}
	var cur struct {
		ID *uuid.UUID `json:"id"`
	}
	if err := httpx.DecodeCursor(lp.Cursor, &cur); err != nil {
		return httpx.Page[Doc]{}, err
	}
	limit := lp.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.d.DB.Pool.Query(ctx, `SELECT id, title, url, chars, updated_at FROM ai_knowledge_docs
		WHERE workspace_id = $1 AND source_id = $2 AND ($3::uuid IS NULL OR id > $3) ORDER BY id LIMIT $4`,
		wid, sourceID, cur.ID, limit+1)
	if err != nil {
		return httpx.Page[Doc]{}, err
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Doc, error) {
		var d Doc
		return d, r.Scan(&d.ID, &d.Title, &d.URL, &d.Chars, &d.UpdatedAt)
	})
	if err != nil {
		return httpx.Page[Doc]{}, err
	}
	return httpx.NewPage(list, limit, func(d Doc) any { return map[string]any{"id": d.ID} }), nil
}

func (s *Service) deleteDoc(ctx context.Context, p *auth.Principal, sourceID, docID uuid.UUID) error {
	wid := p.WorkspaceID
	return s.d.DB.Tx(ctx, func(tx pgx.Tx) error {
		src, err := lockSource(ctx, tx, wid, sourceID)
		if err != nil {
			return err
		}
		var key string
		err = tx.QueryRow(ctx, `DELETE FROM ai_knowledge_docs WHERE workspace_id = $1 AND source_id = $2 AND id = $3 RETURNING key`,
			wid, sourceID, docID).Scan(&key)
		if db.IsNotFound(err) {
			return httpx.NotFound("Document")
		}
		if err != nil {
			return err
		}
		if src.Kind == KindWebsite {
			if _, err := tx.Exec(ctx, `INSERT INTO ai_knowledge_exclusions (source_id, workspace_id, key) VALUES ($1, $2, $3)
				ON CONFLICT DO NOTHING`, sourceID, wid, key); err != nil {
				return err
			}
		}
		if err := s.dropEmbeddings(ctx, tx, wid, []uuid.UUID{docID}); err != nil {
			return err
		}
		if err := refreshCounts(ctx, tx, wid, sourceID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE ai_knowledge_sources SET updated_at = now() WHERE workspace_id = $1 AND id = $2`, wid, sourceID); err != nil {
			return err
		}
		updated, err := loadSource(ctx, tx, wid, sourceID)
		if err != nil {
			return err
		}
		return publish(ctx, tx, wid, "ai_knowledge.updated", updated)
	})
}
