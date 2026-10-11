package ai

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"

	"github.com/opendesk/opendesk/internal/jobs"
)

// autoSummarizeMin is the message count from which auto-summarize keeps a summary.
const autoSummarizeMin = 5

// EmbedWorker runs ai.embed jobs.
type EmbedWorker struct {
	river.WorkerDefaults[jobs.AIEmbedArgs]
	S *Service
}

func (w *EmbedWorker) Work(ctx context.Context, job *river.Job[jobs.AIEmbedArgs]) error {
	if !w.S.Enabled() {
		return nil
	}
	return w.S.Index(ctx, job.Args.WorkspaceID, job.Args.Type, job.Args.RefID)
}

// MaintainArgs is the periodic AI upkeep: embedding backfill and cleanup, and queuing
// stale auto-summaries.
type MaintainArgs struct{}

func (MaintainArgs) Kind() string { return "ai.maintain" }

// MaintainWorker runs ai.maintain.
type MaintainWorker struct {
	river.WorkerDefaults[MaintainArgs]
	S *Service
}

func (w *MaintainWorker) Work(ctx context.Context, _ *river.Job[MaintainArgs]) error {
	if !w.S.Enabled() {
		return nil
	}
	if err := w.S.queueSummaries(ctx); err != nil {
		return err
	}
	return w.S.backfill(ctx)
}

func maintainPeriodic() *river.PeriodicJob {
	return river.NewPeriodicJob(river.PeriodicInterval(5*time.Minute),
		func() (river.JobArgs, *river.InsertOpts) {
			return MaintainArgs{}, &river.InsertOpts{UniqueOpts: river.UniqueOpts{ByPeriod: 5 * time.Minute}}
		}, &river.PeriodicJobOpts{RunOnStart: true})
}

// queueSummaries enqueues ai.summarize for tickets with 5+ messages whose summary is
// older than their thread, in workspaces with auto_summarize. A ticket waits until its
// conversation is quiet for two minutes, so a burst of messages costs one summary.
func (s *Service) queueSummaries(ctx context.Context) error {
	rows, err := s.d.DB.Pool.Query(ctx, `SELECT t.workspace_id, t.id FROM tickets t JOIN workspaces w ON w.id = t.workspace_id
		WHERE COALESCE((w.settings->'ai'->>'enabled')::boolean, true) AND COALESCE((w.settings->'ai'->>'auto_summarize')::boolean, false)
		AND t.deleted_at IS NULL AND NOT t.spam AND t.message_count >= $1
		AND t.last_message_at < now() - interval '2 minutes' AND t.last_message_at > now() - interval '7 days'
		AND COALESCE((t.custom->'ai_summary'->>'message_count')::int, 0) < t.message_count
		ORDER BY t.last_message_at DESC LIMIT 200`, autoSummarizeMin)
	if err != nil {
		return err
	}
	type ref struct{ wid, tid uuid.UUID }
	refs, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (ref, error) {
		var x ref
		return x, r.Scan(&x.wid, &x.tid)
	})
	if err != nil {
		return err
	}
	for _, r := range refs {
		if _, err := s.d.Jobs.Insert(ctx, jobs.AISummarizeArgs{WorkspaceID: r.wid, TicketID: r.tid},
			&river.InsertOpts{MaxAttempts: 3, UniqueOpts: river.UniqueOpts{ByArgs: true, ByPeriod: 30 * time.Minute}}); err != nil {
			return err
		}
	}
	return nil
}

// backfill indexes published articles and recently solved tickets that have no
// embeddings for the current model (new instance, model change, missed jobs), and
// removes embeddings of other models and of deleted content.
func (s *Service) backfill(ctx context.Context) error {
	if !s.semantic() {
		return nil
	}
	model := s.embedder.Model()
	if _, err := s.d.DB.Pool.Exec(ctx, `DELETE FROM ai_embeddings WHERE model <> $1`, model); err != nil {
		return err
	}
	if _, err := s.d.DB.Pool.Exec(ctx, `DELETE FROM ai_embeddings e WHERE e.kind = 'article' AND NOT EXISTS
		(SELECT 1 FROM kb_articles a WHERE a.id = e.ref_id AND a.workspace_id = e.workspace_id AND a.status = 'published')`); err != nil {
		return err
	}
	if _, err := s.d.DB.Pool.Exec(ctx, `DELETE FROM ai_embeddings e WHERE e.kind = 'ticket' AND NOT EXISTS
		(SELECT 1 FROM tickets t WHERE t.id = e.ref_id AND t.workspace_id = e.workspace_id AND t.deleted_at IS NULL)`); err != nil {
		return err
	}
	rows, err := s.d.DB.Pool.Query(ctx, `
		(SELECT a.workspace_id, 'article', a.id FROM kb_articles a WHERE a.status = 'published' AND NOT EXISTS
			(SELECT 1 FROM ai_embeddings e WHERE e.workspace_id = a.workspace_id AND e.kind = 'article' AND e.ref_id = a.id
			 AND e.model = $1 AND e.created_at >= a.updated_at) LIMIT 300)
		UNION ALL
		(SELECT t.workspace_id, 'ticket', t.id FROM tickets t WHERE t.status IN ('solved', 'closed') AND t.deleted_at IS NULL AND NOT t.spam
			AND t.solved_at > now() - interval '90 days' AND NOT EXISTS
			(SELECT 1 FROM ai_embeddings e WHERE e.workspace_id = t.workspace_id AND e.kind = 'ticket' AND e.ref_id = t.id AND e.model = $1)
			ORDER BY t.solved_at DESC LIMIT 300)`, model)
	if err != nil {
		return err
	}
	type ref struct {
		wid  uuid.UUID
		kind string
		id   uuid.UUID
	}
	refs, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (ref, error) {
		var x ref
		return x, r.Scan(&x.wid, &x.kind, &x.id)
	})
	if err != nil {
		return err
	}
	for _, r := range refs {
		if _, err := s.d.Jobs.Insert(ctx, jobs.AIEmbedArgs{WorkspaceID: r.wid, Type: r.kind, RefID: r.id},
			&river.InsertOpts{MaxAttempts: 5, UniqueOpts: river.UniqueOpts{ByArgs: true, ByPeriod: time.Hour}}); err != nil {
			return err
		}
	}
	return nil
}
