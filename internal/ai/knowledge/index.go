package knowledge

import (
	"context"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/useopendesk/opendesk/internal/ai"
)

// indexText is the text embedded for a document: its title, then its content.
func indexText(title, content string) string {
	return strings.TrimSpace(title + "\n\n" + content)
}

// index (re)embeds one document like an article: chunked, each chunk after the first
// prefixed with the title. Unchanged text (same model and content hash) is skipped.
// Indexing is not charged.
func (s *Service) index(ctx context.Context, wid, docID uuid.UUID, title, content string) error {
	emb := s.ai.Embedder()
	if !s.vectors || emb == nil {
		return nil
	}
	text := indexText(title, content)
	if text == "" {
		return s.dropEmbeddings(ctx, s.d.DB.Pool, wid, []uuid.UUID{docID})
	}
	model := emb.Model()
	hash := ai.ContentHash(model, text)
	var current int
	if err := s.d.DB.Pool.QueryRow(ctx, `SELECT count(*) FROM ai_embeddings WHERE workspace_id = $1 AND kind = 'source' AND ref_id = $2
		AND model = $3 AND content_hash = $4`, wid, docID, model, hash).Scan(&current); err != nil {
		return err
	}
	if current > 0 {
		return nil
	}
	chunks := ai.Chunk(text)
	if len(chunks) == 0 {
		return nil
	}
	if t := strings.TrimSpace(title); t != "" {
		for i := 1; i < len(chunks); i++ {
			chunks[i] = t + "\n\n" + chunks[i]
		}
	}
	vecs, err := emb.Embed(ctx, chunks, false)
	if err != nil {
		return err
	}
	return s.d.DB.Tx(ctx, func(tx pgx.Tx) error {
		// The document may have been removed while it was embedded.
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM ai_knowledge_docs WHERE workspace_id = $1 AND id = $2 FOR SHARE)`,
			wid, docID).Scan(&exists); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM ai_embeddings WHERE workspace_id = $1 AND kind = 'source' AND ref_id = $2`, wid, docID); err != nil {
			return err
		}
		if !exists {
			return nil
		}
		for i, c := range chunks {
			if _, err := tx.Exec(ctx, `INSERT INTO ai_embeddings (workspace_id, kind, ref_id, chunk, content_hash, model, dims, content, embedding)
				VALUES ($1, 'source', $2, $3, $4, $5, $6, $7, $8::vector)`, wid, docID, i, hash, model, len(vecs[i]), c, vectorLiteral(vecs[i])); err != nil {
				return err
			}
		}
		return nil
	})
}

// indexLogged embeds a document; a failure is logged and left to the hourly backfill,
// so the document stays searchable by full text meanwhile.
func (s *Service) indexLogged(ctx context.Context, wid, sourceID, docID uuid.UUID, title, content string) {
	if err := s.index(ctx, wid, docID, title, content); err != nil && ctx.Err() == nil {
		s.d.Log.Warn("knowledge embedding failed", "source_id", sourceID, "doc_id", docID, "err", err)
	}
}

// vectorLiteral formats a vector for a ::vector cast.
func vectorLiteral(v []float32) string {
	var b strings.Builder
	b.Grow(len(v) * 10)
	b.WriteByte('[')
	for i, f := range v {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(strconv.FormatFloat(float64(f), 'g', 7, 32))
	}
	b.WriteByte(']')
	return b.String()
}
