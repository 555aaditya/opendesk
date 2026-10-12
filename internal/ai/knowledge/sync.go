package knowledge

import (
	"context"
	"errors"
	"io"
	"net/url"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/useopendesk/opendesk/internal/ai"
	"github.com/useopendesk/opendesk/internal/db"
	"github.com/useopendesk/opendesk/internal/jobs"
	"github.com/useopendesk/opendesk/internal/storage"
)

// Fixed, safe error messages shown on a source.
const (
	msgNoText      = "No text found in this file"
	msgUnreadable  = "This file could not be read."
	msgFileMissing = "The uploaded file is no longer available. Upload it again."
	msgUnreachable = "The website could not be reached."
	msgRobots      = "The site's robots.txt does not allow opendeskBot to crawl it."
	msgNoPages     = "No pages with text were found on this website."
	msgDocsLimit   = "This workspace reached its limit of 5,000 knowledge documents."
	msgCharsLimit  = "This workspace reached its limit of 20 million characters of knowledge."
	msgPartial     = "Some content was skipped: this workspace reached its knowledge limit."
	msgFailed      = "The sync could not be completed. Try again."
)

// syncOpts are the insert options of ai.knowledge_sync: one queued or running sync per
// source.
func syncOpts() *river.InsertOpts {
	return &river.InsertOpts{MaxAttempts: 3, UniqueOpts: river.UniqueOpts{ByArgs: true, ByState: []rivertype.JobState{
		rivertype.JobStateAvailable, rivertype.JobStatePending, rivertype.JobStateRetryable,
		rivertype.JobStateRunning, rivertype.JobStateScheduled}}}
}

// enqueueSync queues a sync of the source in tx.
func (s *Service) enqueueSync(ctx context.Context, tx pgx.Tx, wid, id uuid.UUID) error {
	_, err := s.d.Jobs.InsertTx(ctx, tx, jobs.AIKnowledgeSyncArgs{WorkspaceID: wid, SourceID: id}, syncOpts())
	return err
}

// SyncWorker runs ai.knowledge_sync.
type SyncWorker struct {
	river.WorkerDefaults[jobs.AIKnowledgeSyncArgs]
	S *Service
}

// Timeout allows a full crawl (500 pages at one request per second, and embeddings).
func (w *SyncWorker) Timeout(*river.Job[jobs.AIKnowledgeSyncArgs]) time.Duration { return syncTimeout }

func (w *SyncWorker) Work(ctx context.Context, job *river.Job[jobs.AIKnowledgeSyncArgs]) error {
	err := w.S.Sync(ctx, job.Args.WorkspaceID, job.Args.SourceID)
	if err != nil && job.Attempt >= job.MaxAttempts {
		// The last attempt failed: show it on the source instead of leaving it syncing.
		w.S.failSync(context.WithoutCancel(ctx), job.Args.WorkspaceID, job.Args.SourceID)
	}
	return err
}

// failSync marks a source whose sync could not complete.
func (s *Service) failSync(ctx context.Context, wid, id uuid.UUID) {
	err := s.d.DB.Tx(ctx, func(tx pgx.Tx) error {
		if err := refreshCounts(ctx, tx, wid, id); err != nil {
			return err
		}
		src, err := scanSource(tx.QueryRow(ctx, `UPDATE ai_knowledge_sources SET status = 'error', error = $3, updated_at = now()
			WHERE workspace_id = $1 AND id = $2 AND status IN ('pending', 'syncing') RETURNING `+sourceCols, wid, id, msgFailed))
		if err != nil {
			return err
		}
		return publish(ctx, tx, wid, "ai_knowledge.updated", src)
	})
	if err != nil && !db.IsNotFound(err) {
		s.d.Log.Warn("knowledge sync failure not recorded", "source_id", id, "err", err)
	}
}

// outcome is the result of one sync run.
type outcome struct {
	ok      bool   // the documents are the source's current content
	message string // error (with !ok) or note (with ok)
}

// Sync brings a source's documents up to date. A change of the source's settings while
// it runs starts it over with the new settings.
func (s *Service) Sync(ctx context.Context, wid, id uuid.UUID) error {
	for range 3 {
		src, err := loadSource(ctx, s.d.DB.Pool, wid, id)
		if db.IsNotFound(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if src.Kind != KindSnippet {
			if err := s.setStatus(ctx, wid, id, StatusSyncing); err != nil {
				if db.IsNotFound(err) {
					return nil
				}
				return err
			}
		}
		var out outcome
		switch src.Kind {
		case KindWebsite:
			out, err = s.syncWebsite(ctx, src, wid)
		case KindFile:
			out, err = s.syncFile(ctx, src, wid)
		case KindSnippet:
			out, err = s.syncSnippet(ctx, src, wid)
		}
		if err != nil {
			if isGone(err) {
				return nil
			}
			return err
		}
		done, err := s.finish(ctx, wid, src, out)
		if err != nil || done {
			return err
		}
	}
	return nil
}

// isGone reports a write that failed because the source was deleted meanwhile.
func isGone(err error) bool {
	var pe *pgconn.PgError
	return db.IsNotFound(err) || errors.As(err, &pe) && pe.Code == "23503"
}

// setStatus sets a source's status and publishes the change.
func (s *Service) setStatus(ctx context.Context, wid, id uuid.UUID, status string) error {
	return s.d.DB.Tx(ctx, func(tx pgx.Tx) error {
		src, err := scanSource(tx.QueryRow(ctx, `UPDATE ai_knowledge_sources SET status = $3, error = NULL,
			sync_started_at = CASE WHEN $3 = 'syncing' THEN now() ELSE sync_started_at END, updated_at = now()
			WHERE workspace_id = $1 AND id = $2 RETURNING `+sourceCols, wid, id, status))
		if err != nil {
			return err
		}
		return publish(ctx, tx, wid, "ai_knowledge.updated", src)
	})
}

// finish records the outcome unless the settings changed while the sync ran (then the
// caller runs it again) and reports whether it was recorded.
func (s *Service) finish(ctx context.Context, wid uuid.UUID, src Source, out outcome) (bool, error) {
	done := false
	err := s.d.DB.Tx(ctx, func(tx pgx.Tx) error {
		cur, err := lockSource(ctx, tx, wid, src.ID)
		if db.IsNotFound(err) {
			done = true
			return nil
		}
		if err != nil {
			return err
		}
		if cur.version != src.version {
			return nil
		}
		done = true
		if err := refreshCounts(ctx, tx, wid, src.ID); err != nil {
			return err
		}
		status := StatusReady
		if !out.ok {
			status = StatusError
		}
		var msg *string
		if out.message != "" {
			msg = &out.message
		}
		updated, err := scanSource(tx.QueryRow(ctx, `UPDATE ai_knowledge_sources SET status = $3, error = $4,
			last_synced_at = CASE WHEN $5 THEN now() ELSE last_synced_at END, updated_at = now()
			WHERE workspace_id = $1 AND id = $2 RETURNING `+sourceCols, wid, src.ID, status, msg, out.ok))
		if err != nil {
			return err
		}
		return publish(ctx, tx, wid, "ai_knowledge.updated", updated)
	})
	return done, err
}

// budget is what a source may still add under the workspace limits.
type budget struct {
	docs  int
	chars int64
}

func (s *Service) budgetFor(ctx context.Context, wid, sourceID uuid.UUID) (budget, error) {
	docs, chars, err := totals(ctx, s.d.DB.Pool, wid, &sourceID)
	if err != nil {
		return budget{}, err
	}
	return budget{docs: max(maxDocs-docs, 0), chars: max(maxChars-chars, 0)}, nil
}

// syncSnippet stores the snippet's one document: the question as title, the answer as
// text.
func (s *Service) syncSnippet(ctx context.Context, src Source, wid uuid.UUID) (outcome, error) {
	if src.Snippet == nil {
		return outcome{message: msgNoText}, nil
	}
	title, text := snippetDoc(*src.Snippet)
	id, _, err := putDoc(ctx, s.d.DB.Pool, wid, src.ID, "snippet", nil, title, text)
	if err != nil {
		return outcome{}, err
	}
	if err := s.deleteDocsExcept(ctx, wid, src.ID, []string{"snippet"}); err != nil {
		return outcome{}, err
	}
	s.indexLogged(ctx, wid, src.ID, id, title, text)
	return outcome{ok: true}, nil
}

// syncFile extracts the stored file's text into documents (one per 100,000 characters).
func (s *Service) syncFile(ctx context.Context, src Source, wid uuid.UUID) (outcome, error) {
	if src.File == nil || src.storageKey == nil {
		return outcome{message: msgFileMissing}, nil
	}
	rc, err := s.d.Storage.Get(ctx, *src.storageKey)
	if errors.Is(err, storage.ErrNotFound) {
		return outcome{message: msgFileMissing}, nil
	}
	if err != nil {
		return outcome{}, err
	}
	data, err := io.ReadAll(io.LimitReader(rc, maxFileBytes+1))
	rc.Close()
	if err != nil {
		return outcome{}, err
	}
	if len(data) > maxFileBytes {
		return outcome{message: msgUnreadable}, nil
	}
	title, text, err := extractFile(ctx, data, src.File.ContentType)
	switch {
	case errors.Is(err, errNoText):
		return s.clearDocs(ctx, wid, src, msgNoText)
	case err != nil:
		if ctx.Err() != nil {
			return outcome{}, ctx.Err()
		}
		return s.clearDocs(ctx, wid, src, msgUnreadable)
	}
	if title == "" {
		title = src.File.Filename
	}
	b, err := s.budgetFor(ctx, wid, src.ID)
	if err != nil {
		return outcome{}, err
	}
	parts := splitParts(text, maxDocChars)
	note := ""
	var keep []string
	type stored struct {
		id          uuid.UUID
		title, text string
	}
	var docs []stored
	for i, p := range parts {
		n := int64(len([]rune(p)))
		if b.docs <= 0 || n > b.chars {
			note = msgPartial
			break
		}
		key := "part-" + itoa(i+1)
		t := partTitle(title, i, len(parts))
		id, _, err := putDoc(ctx, s.d.DB.Pool, wid, src.ID, key, nil, t, p)
		if err != nil {
			return outcome{}, err
		}
		b.docs--
		b.chars -= n
		keep = append(keep, key)
		docs = append(docs, stored{id, t, p})
	}
	if err := s.deleteDocsExcept(ctx, wid, src.ID, keep); err != nil {
		return outcome{}, err
	}
	if len(keep) == 0 {
		return outcome{message: limitMessage(b)}, nil
	}
	for _, d := range docs {
		s.indexLogged(ctx, wid, src.ID, d.id, d.title, d.text)
	}
	return outcome{ok: true, message: note}, nil
}

func limitMessage(b budget) string {
	if b.docs <= 0 {
		return msgDocsLimit
	}
	return msgCharsLimit
}

// clearDocs removes a source's documents and fails it with msg.
func (s *Service) clearDocs(ctx context.Context, wid uuid.UUID, src Source, msg string) (outcome, error) {
	if err := s.deleteDocsExcept(ctx, wid, src.ID, nil); err != nil {
		return outcome{}, err
	}
	return outcome{message: msg}, nil
}

// syncWebsite crawls the site and stores each page as a document as it arrives. Pages
// that disappeared are removed after a crawl that reached the site; pages that failed
// this time keep their documents.
func (s *Service) syncWebsite(ctx context.Context, src Source, wid uuid.UUID) (outcome, error) {
	w := src.Website
	if w == nil || w.URL == "" {
		return outcome{message: msgUnreachable}, nil
	}
	start, err := url.Parse(w.URL)
	if err != nil {
		return outcome{message: msgUnreachable}, nil
	}
	b, err := s.budgetFor(ctx, wid, src.ID)
	if err != nil {
		return outcome{}, err
	}
	if b.docs <= 0 || b.chars <= 0 {
		return outcome{message: limitMessage(b)}, nil
	}
	excluded, err := s.exclusions(ctx, wid, src.ID)
	if err != nil {
		return outcome{}, err
	}
	maxPages := w.MaxPages
	if maxPages <= 0 {
		maxPages = defaultPages
	}
	maxPages = min(maxPages, maxPagesLimit, b.docs)
	spec := crawlSpec{start: start, maxPages: maxPages, include: w.Include, exclude: w.Exclude,
		skip: func(k string) bool { return excluded[k] }}

	var keep []string
	note := ""
	limited, restart := false, false
	emitted := 0
	c := s.newCrawler()
	res, err := c.crawl(ctx, spec, func(p crawledPage) (bool, error) {
		n := int64(len([]rune(p.Text)))
		if n > b.chars {
			note, limited = msgPartial, true
			return true, nil
		}
		u := p.URL
		id, _, err := putDoc(ctx, s.d.DB.Pool, wid, src.ID, p.URL, &u, p.Title, p.Text)
		if err != nil {
			return false, err
		}
		b.chars -= n
		keep = append(keep, p.URL)
		s.indexLogged(ctx, wid, src.ID, id, p.Title, p.Text)
		emitted++
		// Stop when the source was deleted or its settings changed.
		if emitted%10 == 0 {
			var v int
			err := s.d.DB.Pool.QueryRow(ctx, `SELECT version FROM ai_knowledge_sources WHERE workspace_id = $1 AND id = $2`, wid, src.ID).Scan(&v)
			if db.IsNotFound(err) {
				return true, errSourceGone
			}
			if err != nil {
				return false, err
			}
			if v != src.version {
				restart = true
				return true, nil
			}
		}
		return false, nil
	})
	if errors.Is(err, errSourceGone) {
		return outcome{}, pgx.ErrNoRows
	}
	if err != nil {
		return outcome{}, err
	}
	if ctx.Err() != nil {
		return outcome{}, ctx.Err()
	}
	if restart {
		// finish sees the new version and runs the sync again.
		return outcome{ok: true}, nil
	}
	if len(keep) == 0 && !limited {
		switch {
		case res.robotsDenied:
			return outcome{message: msgRobots}, nil
		case res.startErr != nil && res.fetched <= 1:
			return outcome{message: msgUnreachable}, nil
		default:
			// Nothing readable: keep the previous documents only when pages failed.
			if len(res.failed) == 0 {
				if err := s.deleteDocsExcept(ctx, wid, src.ID, nil); err != nil {
					return outcome{}, err
				}
			}
			return outcome{message: msgNoPages}, nil
		}
	}
	keep = append(keep, res.failed...)
	if err := s.deleteDocsExcept(ctx, wid, src.ID, keep); err != nil {
		return outcome{}, err
	}
	return outcome{ok: true, message: note}, nil
}

var errSourceGone = errors.New("source deleted")

// exclusions are the page keys removed through the API.
func (s *Service) exclusions(ctx context.Context, wid, sourceID uuid.UUID) (map[string]bool, error) {
	rows, err := s.d.DB.Pool.Query(ctx, `SELECT key FROM ai_knowledge_exclusions WHERE workspace_id = $1 AND source_id = $2`, wid, sourceID)
	if err != nil {
		return nil, err
	}
	keys, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	out := make(map[string]bool, len(keys))
	for _, k := range keys {
		out[k] = true
	}
	return out, nil
}

// --- Upkeep ---------------------------------------------------------------------------

// MaintainWorker runs ai.knowledge_maintain.
type MaintainWorker struct {
	river.WorkerDefaults[jobs.AIKnowledgeMaintainArgs]
	S *Service
}

func (w *MaintainWorker) Timeout(*river.Job[jobs.AIKnowledgeMaintainArgs]) time.Duration {
	return 15 * time.Minute
}

func (w *MaintainWorker) Work(ctx context.Context, _ *river.Job[jobs.AIKnowledgeMaintainArgs]) error {
	if err := w.S.queueRecrawls(ctx); err != nil {
		return err
	}
	return w.S.backfill(ctx)
}

// queueRecrawls starts weekly recrawls and restarts syncs that stalled (a lost job or a
// worker that stopped mid-crawl).
func (s *Service) queueRecrawls(ctx context.Context) error {
	rows, err := s.d.DB.Pool.Query(ctx, `SELECT workspace_id, id FROM ai_knowledge_sources WHERE
		(kind = 'website' AND config->'website'->>'recrawl' = 'weekly' AND status IN ('ready', 'error')
			AND COALESCE(sync_started_at, created_at) < now() - interval '7 days')
		OR (status = 'syncing' AND sync_started_at < now() - $1::interval)
		OR (status = 'pending' AND updated_at < now() - interval '15 minutes')
		ORDER BY updated_at LIMIT 500`, stalledSyncing.String())
	if err != nil {
		return err
	}
	type ref struct{ wid, id uuid.UUID }
	refs, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (ref, error) {
		var x ref
		return x, r.Scan(&x.wid, &x.id)
	})
	if err != nil {
		return err
	}
	for _, r := range refs {
		err := s.d.DB.Tx(ctx, func(tx pgx.Tx) error {
			src, err := scanSource(tx.QueryRow(ctx, `UPDATE ai_knowledge_sources SET status = 'pending', updated_at = now()
				WHERE workspace_id = $1 AND id = $2 RETURNING `+sourceCols, r.wid, r.id))
			if err != nil {
				return err
			}
			if err := publish(ctx, tx, r.wid, "ai_knowledge.updated", src); err != nil {
				return err
			}
			return s.enqueueSync(ctx, tx, r.wid, r.id)
		})
		if err != nil && !db.IsNotFound(err) {
			return err
		}
	}
	return nil
}

// backfill embeds documents missing embeddings for the current model (embedder outage,
// model change) and removes embeddings of documents that are gone.
func (s *Service) backfill(ctx context.Context) error {
	if !s.vectors {
		return nil
	}
	if _, err := s.d.DB.Pool.Exec(ctx, `DELETE FROM ai_embeddings e WHERE e.kind = 'source' AND NOT EXISTS
		(SELECT 1 FROM ai_knowledge_docs d WHERE d.id = e.ref_id AND d.workspace_id = e.workspace_id)`); err != nil {
		return err
	}
	emb := s.ai.Embedder()
	if emb == nil {
		return nil
	}
	rows, err := s.d.DB.Pool.Query(ctx, `SELECT d.workspace_id, d.source_id, d.id, d.title, d.content FROM ai_knowledge_docs d
		JOIN ai_knowledge_sources s ON s.id = d.source_id AND s.workspace_id = d.workspace_id
		WHERE s.status <> 'syncing' AND NOT EXISTS (SELECT 1 FROM ai_embeddings e WHERE e.workspace_id = d.workspace_id
			AND e.kind = 'source' AND e.ref_id = d.id AND e.model = $1)
		ORDER BY d.updated_at DESC LIMIT 200`, emb.Model())
	if err != nil {
		return err
	}
	type doc struct {
		wid, sid, id uuid.UUID
		title, text  string
	}
	docs, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (doc, error) {
		var x doc
		return x, r.Scan(&x.wid, &x.sid, &x.id, &x.title, &x.text)
	})
	if err != nil {
		return err
	}
	for _, d := range docs {
		if err := s.index(ctx, d.wid, d.id, d.title, d.text); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			// The embedder is failing; try again next hour.
			s.d.Log.Warn("knowledge embedding backfill failed", "source_id", d.sid, "err", err)
			return nil
		}
	}
	return nil
}

// snippetDoc is a snippet's document: the question as title, the answer as text.
func snippetDoc(sn Snippet) (string, string) {
	return sn.Question, snippetText(sn.Answer)
}

var _ ai.KnowledgeRetriever = (*Service)(nil)
