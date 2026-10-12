// Package knowledge is the AI's knowledge sources (contracts/agent.md "Knowledge
// sources"): crawled websites, uploaded files and Q&A snippets, split into documents
// that the widget agent, drafts and copilot retrieve from. Documents are indexed with
// Postgres full-text search and, when embeddings are configured, in ai_embeddings
// (kind 'source'). The package installs itself as the ai.KnowledgeRetriever; internal/ai
// never imports it.
package knowledge

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/riverqueue/river"

	"github.com/useopendesk/opendesk/internal/ai"
	"github.com/useopendesk/opendesk/internal/auth"
	"github.com/useopendesk/opendesk/internal/core/mcpserver"
	"github.com/useopendesk/opendesk/internal/db"
	"github.com/useopendesk/opendesk/internal/deps"
	"github.com/useopendesk/opendesk/internal/httpx"
	"github.com/useopendesk/opendesk/internal/jobs"
)

// Limits for every workspace (contracts/agent.md).
const (
	maxSources     = 50
	maxDocs        = 5000
	maxChars       = 20_000_000
	maxDocChars    = 100_000 // one page or file part; longer text is split (files) or cut (pages)
	maxFileBytes   = 20 << 20
	maxNameRunes   = 100
	maxPrefixes    = 20
	defaultPages   = 100
	maxPagesLimit  = 500
	passageRunes   = 1200
	syncTimeout    = 2 * time.Hour
	stalledSyncing = 3 * time.Hour
)

// Source kinds and statuses.
const (
	KindWebsite = "website"
	KindFile    = "file"
	KindSnippet = "snippet"

	StatusPending = "pending"
	StatusSyncing = "syncing"
	StatusReady   = "ready"
	StatusError   = "error"
)

// Source is a KnowledgeSource (contracts/agent.md).
type Source struct {
	ID           uuid.UUID  `json:"id"`
	Kind         string     `json:"kind" enum:"website,file,snippet"`
	Name         string     `json:"name"`
	Status       string     `json:"status" enum:"pending,syncing,ready,error"`
	Error        *string    `json:"error"`
	Enabled      bool       `json:"enabled"`
	Website      *Website   `json:"website,omitempty"`
	File         *FileInfo  `json:"file,omitempty"`
	Snippet      *Snippet   `json:"snippet,omitempty"`
	DocCount     int        `json:"doc_count"`
	CharCount    int64      `json:"char_count"`
	LastSyncedAt *time.Time `json:"last_synced_at"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`

	version    int
	storageKey *string
}

// Website is a crawled site's settings.
type Website struct {
	URL      string   `json:"url"`
	MaxPages int      `json:"max_pages"`
	Include  []string `json:"include"`
	Exclude  []string `json:"exclude"`
	Recrawl  string   `json:"recrawl" enum:"off,weekly"`
}

// FileInfo describes an uploaded file.
type FileInfo struct {
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	SizeBytes   int64  `json:"size_bytes"`
}

// Snippet is a question and its answer (markdown).
type Snippet struct {
	Question string `json:"question"`
	Answer   string `json:"answer"`
}

// Doc is a KnowledgeDoc.
type Doc struct {
	ID        uuid.UUID `json:"id"`
	Title     string    `json:"title"`
	URL       *string   `json:"url"`
	Chars     int       `json:"chars"`
	UpdatedAt time.Time `json:"updated_at"`
}

// config is the stored form of a source's settings.
type config struct {
	Website *Website  `json:"website,omitempty"`
	File    *FileInfo `json:"file,omitempty"`
	Snippet *Snippet  `json:"snippet,omitempty"`
}

var (
	errSyncing   = httpx.E(http.StatusConflict, "knowledge_syncing", "This source is already syncing.")
	errNotFound  = httpx.NotFound("Knowledge source")
	errSources   = httpx.E(http.StatusUnprocessableEntity, "knowledge_limit", "A workspace can have at most 50 knowledge sources.")
	errDocsLimit = httpx.E(http.StatusUnprocessableEntity, "knowledge_limit", "This workspace reached its limit of 5,000 knowledge documents.")
	errChars     = httpx.E(http.StatusUnprocessableEntity, "knowledge_limit", "This workspace reached its limit of 20 million characters of knowledge.")
	errFileType  = httpx.E(http.StatusUnprocessableEntity, "file_type_refused", "Upload a PDF, DOCX, TXT, Markdown, HTML or CSV file.")
	errFileSize  = httpx.E(http.StatusRequestEntityTooLarge, "too_large", "Files can be at most 20 MB.")
)

// Service manages knowledge sources and retrieves from them.
type Service struct {
	d  *deps.Deps
	ai *ai.Service
	// dev allows http and loopback targets for crawls (development instances only).
	dev bool
	// vectors reports whether ai_embeddings exists.
	vectors bool
	// newCrawler builds the crawler for a sync (tests replace it).
	newCrawler func() *crawler
	queries    queryCache
}

var (
	mu       sync.Mutex
	services = map[*deps.Deps]*Service{}
)

// For returns the process's knowledge service for d, building it once and installing it
// as the AI service's knowledge retriever.
func For(d *deps.Deps) *Service {
	mu.Lock()
	defer mu.Unlock()
	if s, ok := services[d]; ok {
		return s
	}
	s := newService(d, ai.For(d))
	services[d] = s
	return s
}

func newService(d *deps.Deps, svc *ai.Service) *Service {
	s := &Service{d: d, ai: svc, dev: !d.Cfg.IsProduction()}
	s.newCrawler = func() *crawler { return newCrawler(s.dev) }
	s.vectors = vectorTable(context.Background(), d.DB.Pool)
	svc.SetKnowledge(s)
	mcpserver.SearchSources = func(ctx context.Context, p *auth.Principal, query string, limit int) ([]mcpserver.Passage, error) {
		ps, err := s.Retrieve(ctx, p.WorkspaceID, query, limit)
		if err != nil {
			return nil, err
		}
		out := make([]mcpserver.Passage, 0, len(ps))
		for _, x := range ps {
			out = append(out, mcpserver.Passage{SourceID: x.ID, Kind: x.Kind, Title: x.Title, URL: x.URL, Text: x.Text})
		}
		return out, nil
	}
	return s
}

func vectorTable(ctx context.Context, q db.Querier) bool {
	var ok bool
	if err := q.QueryRow(ctx, `SELECT to_regclass('public.ai_embeddings') IS NOT NULL`).Scan(&ok); err != nil {
		return false
	}
	return ok
}

// Register adds the knowledge routes.
func Register(d *deps.Deps, api huma.API, _ chi.Router) { For(d).register(api) }

// RegisterWorkers adds the sync and upkeep workers.
func RegisterWorkers(d *deps.Deps, w *river.Workers) {
	s := For(d)
	river.AddWorker(w, &SyncWorker{S: s})
	river.AddWorker(w, &MaintainWorker{S: s})
}

// Periodic returns the hourly upkeep job.
func Periodic(*deps.Deps) []*river.PeriodicJob {
	return []*river.PeriodicJob{river.NewPeriodicJob(river.PeriodicInterval(time.Hour),
		func() (river.JobArgs, *river.InsertOpts) {
			return jobs.AIKnowledgeMaintainArgs{}, &river.InsertOpts{UniqueOpts: river.UniqueOpts{ByPeriod: time.Hour}}
		}, &river.PeriodicJobOpts{RunOnStart: true})}
}

// Background: the knowledge area has no long-running loops.
func Background(context.Context, *deps.Deps) {}
