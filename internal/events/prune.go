package events

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
)

// PruneArgs deletes published events older than the retention window.
type PruneArgs struct{}

func (PruneArgs) Kind() string { return "events.prune" }

type PruneWorker struct {
	river.WorkerDefaults[PruneArgs]
	Pool      *pgxpool.Pool
	Retention time.Duration
}

func (w *PruneWorker) Work(ctx context.Context, _ *river.Job[PruneArgs]) error {
	_, err := w.Pool.Exec(ctx, `DELETE FROM events WHERE published_at IS NOT NULL AND created_at < $1`, time.Now().Add(-w.Retention))
	return err
}

// PrunePeriodic schedules pruning hourly.
func PrunePeriodic() *river.PeriodicJob {
	return river.NewPeriodicJob(river.PeriodicInterval(time.Hour),
		func() (river.JobArgs, *river.InsertOpts) { return PruneArgs{}, nil }, &river.PeriodicJobOpts{RunOnStart: true})
}
