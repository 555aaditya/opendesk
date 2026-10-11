package hd

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/opendesk/opendesk/internal/events"
	"github.com/opendesk/opendesk/internal/ids"
)

// Notification types.
const (
	NotifyAssigned        = "assigned"
	NotifyMentioned       = "mentioned"
	NotifyCustomerReplied = "customer_replied"
	NotifySLABreached     = "sla_breached"
)

type NotificationTicket struct {
	ID      uuid.UUID `json:"id"`
	Number  int64     `json:"number"`
	Subject string    `json:"subject"`
}

// Notification is the contract shape (contracts/api.md).
type Notification struct {
	ID        uuid.UUID           `json:"id"`
	Type      string              `json:"type"`
	Ticket    *NotificationTicket `json:"ticket"`
	Data      map[string]any      `json:"data"`
	ReadAt    *time.Time          `json:"read_at"`
	CreatedAt time.Time           `json:"created_at"`
}

// Notify stores a notification for a workspace member and publishes notification.created
// to user:<uid>. A user who is no longer a member is skipped silently.
func Notify(ctx context.Context, tx pgx.Tx, wid, userID uuid.UUID, typ string, ticketID *uuid.UUID, data map[string]any) error {
	if data == nil {
		data = map[string]any{}
	}
	var member bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM members WHERE workspace_id = $1 AND user_id = $2)`, wid, userID).Scan(&member); err != nil {
		return fmt.Errorf("notify member check: %w", err)
	}
	if !member {
		return nil
	}
	n := Notification{ID: ids.New(), Type: typ, Data: data, CreatedAt: time.Now().UTC()}
	if ticketID != nil {
		var t NotificationTicket
		err := tx.QueryRow(ctx, `SELECT id, number, subject FROM tickets WHERE workspace_id = $1 AND id = $2`, wid, *ticketID).
			Scan(&t.ID, &t.Number, &t.Subject)
		if err != nil {
			return fmt.Errorf("notify ticket: %w", err)
		}
		n.Ticket = &t
	}
	if _, err := tx.Exec(ctx, `INSERT INTO notifications (id, workspace_id, user_id, type, ticket_id, data, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`, n.ID, wid, userID, typ, ticketID, data, n.CreatedAt); err != nil {
		return fmt.Errorf("insert notification: %w", err)
	}
	_, err := events.Publish(ctx, tx, events.Event{WorkspaceID: wid, Type: "notification.created",
		Topics: []string{events.UserTopic(userID)}, Data: map[string]any{"notification": n}})
	return err
}
