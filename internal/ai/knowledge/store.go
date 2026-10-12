package knowledge

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/useopendesk/opendesk/internal/db"
	"github.com/useopendesk/opendesk/internal/events"
	"github.com/useopendesk/opendesk/internal/ids"
)

const sourceCols = `id, kind, name, status, error, enabled, config, version, storage_key, doc_count, char_count,
	last_synced_at, created_at, updated_at`

func scanSource(r pgx.Row) (Source, error) {
	var s Source
	var raw []byte
	err := r.Scan(&s.ID, &s.Kind, &s.Name, &s.Status, &s.Error, &s.Enabled, &raw, &s.version, &s.storageKey,
		&s.DocCount, &s.CharCount, &s.LastSyncedAt, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		return s, err
	}
	var c config
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &c)
	}
	switch s.Kind {
	case KindWebsite:
		s.Website = c.Website
		if s.Website == nil {
			s.Website = &Website{}
		}
		if s.Website.Include == nil {
			s.Website.Include = []string{}
		}
		if s.Website.Exclude == nil {
			s.Website.Exclude = []string{}
		}
	case KindFile:
		s.File = c.File
	case KindSnippet:
		s.Snippet = c.Snippet
	}
	return s, nil
}

func (s Source) config() config {
	return config{Website: s.Website, File: s.File, Snippet: s.Snippet}
}

// loadSource reads one source of the workspace.
func loadSource(ctx context.Context, q db.Querier, wid, id uuid.UUID) (Source, error) {
	return scanSource(q.QueryRow(ctx, `SELECT `+sourceCols+` FROM ai_knowledge_sources WHERE workspace_id = $1 AND id = $2`, wid, id))
}

// lockSource reads one source of the workspace for update.
func lockSource(ctx context.Context, tx pgx.Tx, wid, id uuid.UUID) (Source, error) {
	return scanSource(tx.QueryRow(ctx, `SELECT `+sourceCols+` FROM ai_knowledge_sources WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, wid, id))
}

func listSources(ctx context.Context, q db.Querier, wid uuid.UUID, kind string) ([]Source, error) {
	rows, err := q.Query(ctx, `SELECT `+sourceCols+` FROM ai_knowledge_sources WHERE workspace_id = $1 AND ($2 = '' OR kind = $2)
		ORDER BY created_at DESC, id DESC`, wid, kind)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Source, error) { return scanSource(r) })
	if err != nil {
		return nil, err
	}
	if out == nil {
		out = []Source{}
	}
	return out, nil
}

// publish writes an ai_knowledge event for the source in tx.
func publish(ctx context.Context, tx pgx.Tx, wid uuid.UUID, typ string, src Source) error {
	_, err := events.Publish(ctx, tx, events.Event{WorkspaceID: wid, Type: typ, Data: map[string]any{"source": src}})
	return err
}

func publishDeleted(ctx context.Context, tx pgx.Tx, wid, id uuid.UUID) error {
	_, err := events.Publish(ctx, tx, events.Event{WorkspaceID: wid, Type: "ai_knowledge.deleted", Data: map[string]any{"source_id": id}})
	return err
}

// totals are a workspace's document and character counts, optionally without one source.
func totals(ctx context.Context, q db.Querier, wid uuid.UUID, except *uuid.UUID) (docs int, chars int64, err error) {
	err = q.QueryRow(ctx, `SELECT count(*), COALESCE(sum(chars), 0) FROM ai_knowledge_docs
		WHERE workspace_id = $1 AND ($2::uuid IS NULL OR source_id <> $2)`, wid, except).Scan(&docs, &chars)
	return docs, chars, err
}

// refreshCounts stores a source's document and character counts.
func refreshCounts(ctx context.Context, q db.Querier, wid, id uuid.UUID) error {
	_, err := q.Exec(ctx, `UPDATE ai_knowledge_sources s SET doc_count = c.n, char_count = c.chars
		FROM (SELECT count(*) AS n, COALESCE(sum(chars), 0) AS chars FROM ai_knowledge_docs WHERE workspace_id = $1 AND source_id = $2) c
		WHERE s.workspace_id = $1 AND s.id = $2`, wid, id)
	return err
}

// docHash identifies a document's text independently of any embedding model.
func docHash(title, content string) string {
	h := sha256.Sum256([]byte(title + "\x00" + content))
	return hex.EncodeToString(h[:])
}

// putDoc inserts or updates the document key of a source and returns its id and whether
// its text changed.
func putDoc(ctx context.Context, q db.Querier, wid, sourceID uuid.UUID, key string, url *string, title, content string) (uuid.UUID, bool, error) {
	hash := docHash(title, content)
	var id uuid.UUID
	var old string
	err := q.QueryRow(ctx, `SELECT id, content_hash FROM ai_knowledge_docs WHERE source_id = $1 AND key = $2 AND workspace_id = $3`,
		sourceID, key, wid).Scan(&id, &old)
	switch {
	case err == nil && old == hash:
		return id, false, nil
	case err == nil:
		_, err = q.Exec(ctx, `UPDATE ai_knowledge_docs SET url = $3, title = $4, content = $5, chars = $6, content_hash = $7, updated_at = now()
			WHERE workspace_id = $1 AND id = $2`, wid, id, url, title, content, utf8.RuneCountInString(content), hash)
		return id, true, err
	case db.IsNotFound(err):
		err = q.QueryRow(ctx, `INSERT INTO ai_knowledge_docs (id, workspace_id, source_id, key, url, title, content, chars, content_hash)
			VALUES ($9, $1, $2, $3, $4, $5, $6, $7, $8)
			ON CONFLICT (source_id, key) DO UPDATE SET url = EXCLUDED.url, title = EXCLUDED.title, content = EXCLUDED.content,
				chars = EXCLUDED.chars, content_hash = EXCLUDED.content_hash, updated_at = now()
			RETURNING id`, wid, sourceID, key, url, title, content, utf8.RuneCountInString(content), hash, ids.New()).Scan(&id)
		return id, true, err
	}
	return id, false, err
}

// deleteDocsExcept removes a source's documents whose key is not in keep, with their
// embeddings.
func (s *Service) deleteDocsExcept(ctx context.Context, wid, sourceID uuid.UUID, keep []string) error {
	if keep == nil {
		keep = []string{}
	}
	return s.d.DB.Tx(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `DELETE FROM ai_knowledge_docs WHERE workspace_id = $1 AND source_id = $2 AND NOT (key = ANY($3))
			RETURNING id`, wid, sourceID, keep)
		if err != nil {
			return err
		}
		ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
		if err != nil {
			return err
		}
		return s.dropEmbeddings(ctx, tx, wid, ids)
	})
}

// dropEmbeddings removes the embeddings of documents.
func (s *Service) dropEmbeddings(ctx context.Context, q db.Querier, wid uuid.UUID, docIDs []uuid.UUID) error {
	if !s.vectors || len(docIDs) == 0 {
		return nil
	}
	_, err := q.Exec(ctx, `DELETE FROM ai_embeddings WHERE workspace_id = $1 AND kind = 'source' AND ref_id = ANY($2)`, wid, docIDs)
	return err
}
