package events

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nats-io/nats.go"
	"github.com/riverqueue/river"

	"github.com/opendesk/opendesk/internal/jobs"
)

// Relay moves committed events from the outbox to NATS and queues webhook dispatch.
// Several relays can run at once; rows are claimed with SKIP LOCKED.
type Relay struct {
	Pool *pgxpool.Pool // direct (unpooled) connection: LISTEN needs a session
	NATS *nats.Conn
	Jobs *river.Client[pgx.Tx]
	Log  *slog.Logger
}

func (r *Relay) Run(ctx context.Context) {
	wake := make(chan struct{}, 1)
	go r.listen(ctx, wake)
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		for {
			n, err := r.flush(ctx)
			if err != nil {
				if ctx.Err() != nil {
					return
				}
				r.Log.Error("event relay", "err", err)
				break
			}
			if n == 0 {
				break
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-wake:
		case <-tick.C:
		}
	}
}

func (r *Relay) listen(ctx context.Context, wake chan<- struct{}) {
	for ctx.Err() == nil {
		conn, err := r.Pool.Acquire(ctx)
		if err != nil {
			time.Sleep(time.Second)
			continue
		}
		if _, err = conn.Exec(ctx, "LISTEN od_events"); err == nil {
			for {
				if _, err = conn.Conn().WaitForNotification(ctx); err != nil {
					break
				}
				select {
				case wake <- struct{}{}:
				default:
				}
			}
		}
		conn.Release()
		if ctx.Err() == nil {
			time.Sleep(time.Second)
		}
	}
}

func (r *Relay) flush(ctx context.Context) (int, error) {
	n := 0
	err := pgx.BeginFunc(ctx, r.Pool, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT id, seq, workspace_id, type, visibility, topics, data, created_at FROM events
			WHERE published_at IS NULL ORDER BY created_at, seq LIMIT 200 FOR UPDATE SKIP LOCKED`)
		if err != nil {
			return err
		}
		batch, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Envelope, error) {
			var e Envelope
			err := row.Scan(&e.ID, &e.Seq, &e.WorkspaceID, &e.Type, &e.Visibility, &e.Topics, &e.Data, &e.OccurredAt)
			return e, err
		})
		if err != nil || len(batch) == 0 {
			return err
		}
		params := make([]river.InsertManyParams, 0, len(batch))
		for _, e := range batch {
			payload, err := json.Marshal(e)
			if err != nil {
				return err
			}
			if err := r.NATS.Publish(SubjectPrefix+e.WorkspaceID.String(), payload); err != nil {
				return err
			}
			params = append(params, river.InsertManyParams{
				Args:       jobs.WebhookDispatchArgs{WorkspaceID: e.WorkspaceID, EventSeq: e.Seq},
				InsertOpts: &river.InsertOpts{Queue: jobs.QueueWebhooks},
			})
			if _, err := tx.Exec(ctx, `UPDATE events SET published_at = now() WHERE workspace_id = $1 AND seq = $2`, e.WorkspaceID, e.Seq); err != nil {
				return err
			}
		}
		if err := r.NATS.Flush(); err != nil {
			return err
		}
		if _, err := r.Jobs.InsertManyTx(ctx, tx, params); err != nil {
			return err
		}
		n = len(batch)
		return nil
	})
	return n, err
}

// Disconnect asks the gateway to close a user's sockets (all, or one session's).
func Disconnect(nc *nats.Conn, userID string, sessionID string) {
	payload, _ := json.Marshal(map[string]string{"user_id": userID, "session_id": sessionID})
	_ = nc.Publish(DisconnectSubject, payload)
}
