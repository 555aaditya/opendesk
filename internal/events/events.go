// Package events is the transactional outbox. See contracts/events.md.
package events

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/opendesk/opendesk/internal/ids"
)

const (
	VisibilityAgents = "agents"
	VisibilityPublic = "public"
)

// SubjectPrefix + workspace id is the NATS subject for a workspace's events.
const SubjectPrefix = "od.events."

// DisconnectSubject tells the realtime gateway to close a user's sockets.
const DisconnectSubject = "od.control.disconnect"

// Event is what a caller publishes. Topics beyond workspace:<wid> are optional.
type Event struct {
	WorkspaceID uuid.UUID
	Type        string
	Visibility  string // defaults to agents
	Topics      []string
	Data        any
}

// Envelope is the stored and transmitted form.
type Envelope struct {
	ID          uuid.UUID       `json:"id"`
	Seq         int64           `json:"seq"`
	WorkspaceID uuid.UUID       `json:"workspace_id"`
	Type        string          `json:"type"`
	Visibility  string          `json:"visibility"`
	Topics      []string        `json:"topics"`
	Data        json.RawMessage `json:"data"`
	OccurredAt  time.Time       `json:"occurred_at"`
}

// Topic helpers.
func WorkspaceTopic(wid uuid.UUID) string { return "workspace:" + wid.String() }
func UserTopic(uid uuid.UUID) string      { return "user:" + uid.String() }
func ContactTopic(wid, cid uuid.UUID) string {
	return "contact:" + wid.String() + ":" + cid.String()
}

// Publish writes ev in tx and returns the envelope. The relay delivers it after commit.
func Publish(ctx context.Context, tx pgx.Tx, ev Event) (Envelope, error) {
	if ev.Visibility == "" {
		ev.Visibility = VisibilityAgents
	}
	data, err := json.Marshal(ev.Data)
	if err != nil {
		return Envelope{}, fmt.Errorf("marshal event %s: %w", ev.Type, err)
	}
	topics := []string{WorkspaceTopic(ev.WorkspaceID)}
	for _, t := range ev.Topics {
		if !slices.Contains(topics, t) {
			topics = append(topics, t)
		}
	}
	env := Envelope{ID: ids.New(), WorkspaceID: ev.WorkspaceID, Type: ev.Type, Visibility: ev.Visibility,
		Topics: topics, Data: data, OccurredAt: time.Now().UTC()}
	if err := tx.QueryRow(ctx, `UPDATE workspaces SET event_seq = event_seq + 1 WHERE id = $1 RETURNING event_seq`,
		ev.WorkspaceID).Scan(&env.Seq); err != nil {
		return Envelope{}, fmt.Errorf("next event seq: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO events (workspace_id, seq, id, type, visibility, topics, data, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		env.WorkspaceID, env.Seq, env.ID, env.Type, env.Visibility, env.Topics, data, env.OccurredAt); err != nil {
		return Envelope{}, fmt.Errorf("insert event: %w", err)
	}
	// Wake the relay at commit; it also polls, so a lost notify only adds latency.
	if _, err := tx.Exec(ctx, `SELECT pg_notify('od_events', '')`); err != nil {
		return Envelope{}, err
	}
	return env, nil
}

// Since returns events after seq for replay. resync=true when the gap is older than retention.
func Since(ctx context.Context, q interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}, wid uuid.UUID, since int64, limit int, includeAgents bool) (out []Envelope, latest int64, resync bool, err error) {
	if err = q.QueryRow(ctx, `SELECT event_seq FROM workspaces WHERE id = $1`, wid).Scan(&latest); err != nil {
		return nil, 0, false, err
	}
	if since >= latest {
		return []Envelope{}, latest, false, nil
	}
	var oldest *int64
	if err = q.QueryRow(ctx, `SELECT min(seq) FROM events WHERE workspace_id = $1`, wid).Scan(&oldest); err != nil {
		return nil, 0, false, err
	}
	if oldest == nil || *oldest > since+1 {
		return []Envelope{}, latest, true, nil
	}
	rows, err := q.Query(ctx, `SELECT id, seq, workspace_id, type, visibility, topics, data, created_at FROM events
		WHERE workspace_id = $1 AND seq > $2 AND ($3 OR visibility = 'public') ORDER BY seq LIMIT $4`, wid, since, includeAgents, limit+1)
	if err != nil {
		return nil, 0, false, err
	}
	defer rows.Close()
	for rows.Next() {
		var e Envelope
		if err = rows.Scan(&e.ID, &e.Seq, &e.WorkspaceID, &e.Type, &e.Visibility, &e.Topics, &e.Data, &e.OccurredAt); err != nil {
			return nil, 0, false, err
		}
		out = append(out, e)
	}
	if len(out) > limit {
		// Too far behind to page through; the client should refetch.
		return []Envelope{}, latest, true, rows.Err()
	}
	if out == nil {
		out = []Envelope{}
	}
	return out, latest, false, rows.Err()
}
