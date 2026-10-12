package hd

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/useopendesk/opendesk/internal/domain"
)

// SetAIActionStatus moves a widget agent action (contracts/agent.md "Visitor actions")
// from one of the from statuses to status, updates the card on its message and publishes
// message.updated. It reports false when the action was not in a from status (or is
// expired while pending), so a decision runs at most once.
func SetAIActionStatus(ctx context.Context, tx pgx.Tx, wid, tid, actionID uuid.UUID, status string, from ...string) (bool, error) {
	var messageID *uuid.UUID
	err := tx.QueryRow(ctx, `UPDATE ai_widget_actions SET status = $4, decided_at = COALESCE(decided_at, now())
		WHERE workspace_id = $1 AND ticket_id = $2 AND id = $3 AND status = ANY($5)
		AND (status <> 'pending' OR expires_at > now() OR $4 = 'expired')
		RETURNING message_id`, wid, tid, actionID, status, from).Scan(&messageID)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if messageID == nil {
		return true, nil
	}
	card := status
	if card == "running" {
		card = "pending" // the visitor sees a card waiting until the tool answered
	}
	if _, err := tx.Exec(ctx, `UPDATE messages SET ai_action = jsonb_set(ai_action, '{status}', to_jsonb($3::text))
		WHERE workspace_id = $1 AND id = $2 AND ai_action IS NOT NULL`, wid, *messageID, card); err != nil {
		return false, err
	}
	return true, domain.PublishMessageUpdated(ctx, tx, wid, *messageID)
}

// ExpireAIActions expires a conversation's pending actions; a new visitor message
// replaces whatever the agent was waiting for.
func ExpireAIActions(ctx context.Context, tx pgx.Tx, wid, tid uuid.UUID) error {
	rows, err := tx.Query(ctx, `SELECT id FROM ai_widget_actions WHERE workspace_id = $1 AND ticket_id = $2 AND status = 'pending'`, wid, tid)
	if err != nil {
		return err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return err
	}
	for _, id := range ids {
		if _, err := SetAIActionStatus(ctx, tx, wid, tid, id, "expired", "pending"); err != nil {
			return err
		}
	}
	return nil
}
