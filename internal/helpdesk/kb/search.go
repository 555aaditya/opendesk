package kb

import (
	"context"

	"github.com/google/uuid"

	"github.com/opendesk/opendesk/internal/db"
)

// Search returns the workspace's best matching articles (drafts included) for the
// global search box.
func Search(ctx context.Context, q db.Querier, wid uuid.UUID, query string, limit int) ([]KbArticle, error) {
	pq := prefixQuery(query)
	if pq == "" {
		return []KbArticle{}, nil
	}
	tsq := searchQuery(2)
	rows, err := q.Query(ctx, articleSelect+` WHERE a.workspace_id = $1 AND a.search @@ `+tsq+`
		ORDER BY ts_rank(a.search, `+tsq+`) DESC, a.updated_at DESC LIMIT $4`, wid, query, pq, limit)
	return collectRows(rows, err, scanArticle)
}
