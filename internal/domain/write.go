package domain

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"

	"github.com/opendesk/opendesk/internal/displayname"
	"github.com/opendesk/opendesk/internal/events"
	"github.com/opendesk/opendesk/internal/ids"
	"github.com/opendesk/opendesk/internal/jobs"
)

// Jobs is the River client; writes enqueue follow-up work inside the same transaction.
type Jobs = *river.Client[pgx.Tx]

// UpsertContactByEmail finds or creates the contact for an email address. A name is
// filled in only when the contact has none; untrusted names are cleaned, not refused.
func UpsertContactByEmail(ctx context.Context, tx pgx.Tx, wid uuid.UUID, email, name string) (uuid.UUID, bool, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if name = displayname.Clean(name, displayname.Person); name == "" {
		name = displayname.FromEmail(email)
	}
	var id uuid.UUID
	var created bool
	err := tx.QueryRow(ctx, `INSERT INTO contacts (id, workspace_id, email, name) VALUES ($1, $2, $3, $4)
		ON CONFLICT (workspace_id, email) WHERE email IS NOT NULL
		DO UPDATE SET name = CASE WHEN contacts.name = '' THEN EXCLUDED.name ELSE contacts.name END
		RETURNING id, (xmax = 0)`, ids.New(), wid, email, name).Scan(&id, &created)
	if err != nil {
		return uuid.Nil, false, fmt.Errorf("upsert contact: %w", err)
	}
	if created {
		c, err := LoadContact(ctx, tx, wid, id)
		if err != nil {
			return uuid.Nil, false, err
		}
		if _, err := events.Publish(ctx, tx, events.Event{WorkspaceID: wid, Type: "contact.created", Data: map[string]any{"contact": c}}); err != nil {
			return uuid.Nil, false, err
		}
	}
	return id, created, nil
}

type NewTicket struct {
	WorkspaceID uuid.UUID
	Subject     string
	Channel     string
	Status      string // default open
	Priority    string // default normal
	MailboxID   *uuid.UUID
	ContactID   *uuid.UUID
	AssigneeID  *uuid.UUID
	TeamID      *uuid.UUID
	Custom      map[string]any
	Fields      map[string]any // custom field values, validated by the caller
}

// CreateTicket inserts a ticket and publishes ticket.created. Add the first message with
// AddMessage(Trigger: jobs.TriggerTicketCreated) so automations see its body.
func CreateTicket(ctx context.Context, tx pgx.Tx, nt NewTicket) (Ticket, error) {
	if nt.Status == "" {
		nt.Status = StatusOpen
	}
	if nt.Priority == "" {
		nt.Priority = "normal"
	}
	if nt.Custom == nil {
		nt.Custom = map[string]any{}
	}
	if nt.Fields == nil {
		nt.Fields = map[string]any{}
	}
	subject := truncateRunes(strings.TrimSpace(nt.Subject), 500)
	var number int64
	if err := tx.QueryRow(ctx, `UPDATE workspaces SET ticket_seq = ticket_seq + 1 WHERE id = $1 RETURNING ticket_seq`,
		nt.WorkspaceID).Scan(&number); err != nil {
		return Ticket{}, fmt.Errorf("next ticket number: %w", err)
	}
	id := ids.New()
	_, err := tx.Exec(ctx, `INSERT INTO tickets (id, workspace_id, number, subject, status, priority, channel,
		mailbox_id, contact_id, assignee_id, team_id, custom, fields) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
		id, nt.WorkspaceID, number, subject, nt.Status, nt.Priority, nt.Channel, nt.MailboxID, nt.ContactID, nt.AssigneeID, nt.TeamID, nt.Custom, nt.Fields)
	if err != nil {
		return Ticket{}, fmt.Errorf("insert ticket: %w", err)
	}
	t, err := LoadTicket(ctx, tx, nt.WorkspaceID, id)
	if err != nil {
		return Ticket{}, err
	}
	topics := []string{}
	if t.Assignee != nil {
		topics = append(topics, events.UserTopic(t.Assignee.ID))
	}
	if _, err := events.Publish(ctx, tx, events.Event{WorkspaceID: nt.WorkspaceID, Type: "ticket.created", Topics: topics,
		Data: map[string]any{"ticket": t}}); err != nil {
		return Ticket{}, err
	}
	return t, nil
}

type NewMessage struct {
	WorkspaceID     uuid.UUID
	TicketID        uuid.UUID
	Kind            string // reply | note
	Direction       string // inbound | outbound
	AuthorType      string // contact | user | system | api
	AuthorUserID    *uuid.UUID
	AuthorContactID *uuid.UUID
	BodyHTML        string // already sanitized by the caller
	BodyText        string
	FullHTML        string // inbound: the full original including quoted history
	Subject         string
	FromEmail       string
	FromName        string
	To, Cc, Bcc     []string
	EmailMessageID  *string
	InReplyTo       string
	References      []string
	InboundEmailID  *uuid.UUID
	AttachmentIDs   []uuid.UUID // previously uploaded, unattached attachments to link
	// DeliveryStatus: "pending" queues an email send for outbound replies on email tickets.
	DeliveryStatus string
	// Trigger overrides the job trigger: "" derives it, "none" skips automations.
	Trigger   string
	CreatedAt time.Time
	// AI marks a reply written by the widget answer bot (messages.ai).
	AI bool
}

// AddMessage inserts a message, updates the ticket's activity fields, publishes events and
// queues the email send and ticket triggers, all in tx.
func AddMessage(ctx context.Context, tx pgx.Tx, jc Jobs, nm NewMessage) (Message, error) {
	var channel, status string
	var firstResponded *time.Time
	var contactID *uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT channel, status, first_responded_at, contact_id FROM tickets
		WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`, nm.WorkspaceID, nm.TicketID).
		Scan(&channel, &status, &firstResponded, &contactID); err != nil {
		return Message{}, fmt.Errorf("lock ticket: %w", err)
	}
	if nm.DeliveryStatus == "" {
		nm.DeliveryStatus = "none"
	}
	if nm.CreatedAt.IsZero() {
		nm.CreatedAt = time.Now().UTC()
	}
	for _, s := range []*[]string{&nm.To, &nm.Cc, &nm.Bcc, &nm.References} {
		if *s == nil {
			*s = []string{}
		}
	}
	id := ids.New()
	_, err := tx.Exec(ctx, `INSERT INTO messages (id, workspace_id, ticket_id, kind, direction, author_type, author_user_id,
		author_contact_id, body_html, body_text, full_html, subject, from_email, from_name, to_emails, cc_emails, bcc_emails,
		email_message_id, in_reply_to, "references", inbound_email_id, delivery_status, created_at, ai)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
		id, nm.WorkspaceID, nm.TicketID, nm.Kind, nm.Direction, nm.AuthorType, nm.AuthorUserID, nm.AuthorContactID,
		nm.BodyHTML, nm.BodyText, nm.FullHTML, truncateRunes(nm.Subject, 500), nm.FromEmail, nm.FromName, nm.To, nm.Cc, nm.Bcc,
		nm.EmailMessageID, nm.InReplyTo, nm.References, nm.InboundEmailID, nm.DeliveryStatus, nm.CreatedAt, nm.AI)
	if err != nil {
		return Message{}, fmt.Errorf("insert message: %w", err)
	}
	if len(nm.AttachmentIDs) > 0 {
		if _, err := tx.Exec(ctx, `UPDATE attachments SET message_id = $1 WHERE workspace_id = $2 AND id = ANY($3) AND message_id IS NULL`,
			id, nm.WorkspaceID, nm.AttachmentIDs); err != nil {
			return Message{}, fmt.Errorf("link attachments: %w", err)
		}
	}

	// Ticket bookkeeping. Notes do not move the conversation forward.
	var changes []string
	if nm.Kind == "reply" {
		preview := truncateRunes(strings.Join(strings.Fields(nm.BodyText), " "), 200)
		customer := nm.Direction == "inbound"
		newStatus := status
		if customer && (status == StatusPending || status == StatusSolved || status == StatusOnHold) {
			newStatus = StatusOpen
		}
		setFirst := !customer && nm.AuthorType == "user" && firstResponded == nil
		_, err := tx.Exec(ctx, `UPDATE tickets SET last_message_at = $3, last_message_preview = $4,
			message_count = message_count + 1, updated_at = now(),
			last_customer_message_at = CASE WHEN $5 THEN $3 ELSE last_customer_message_at END,
			status = $6, solved_at = CASE WHEN $6 = 'open' THEN NULL ELSE solved_at END,
			snoozed_until = CASE WHEN $6 = 'on_hold' THEN snoozed_until ELSE NULL END,
			first_responded_at = CASE WHEN $7 THEN $3 ELSE first_responded_at END
			WHERE workspace_id = $1 AND id = $2`, nm.WorkspaceID, nm.TicketID, nm.CreatedAt, preview, customer, newStatus, setFirst)
		if err != nil {
			return Message{}, fmt.Errorf("update ticket: %w", err)
		}
		if newStatus != status {
			changes = append(changes, "status")
			if _, err := LogActivity(ctx, tx, nm.WorkspaceID, nm.TicketID, "contact", nil, "status_changed",
				map[string]any{"from": status, "to": newStatus}); err != nil {
				return Message{}, err
			}
		}
		if setFirst {
			changes = append(changes, "first_responded_at")
		}
	} else {
		if _, err := tx.Exec(ctx, `UPDATE tickets SET updated_at = now() WHERE workspace_id = $1 AND id = $2`, nm.WorkspaceID, nm.TicketID); err != nil {
			return Message{}, err
		}
	}

	msg, err := LoadMessage(ctx, tx, nm.WorkspaceID, id)
	if err != nil {
		return Message{}, err
	}
	ev := events.Event{WorkspaceID: nm.WorkspaceID, Type: "message.created", Data: map[string]any{"ticket_id": nm.TicketID, "message": msg}}
	if nm.Kind == "reply" && channel == ChannelChat && contactID != nil {
		ev.Visibility = events.VisibilityPublic
		ev.Topics = []string{events.ContactTopic(nm.WorkspaceID, *contactID)}
		ev.Data = map[string]any{"ticket_id": nm.TicketID, "message": PublicMessage(msg)}
	}
	if _, err := events.Publish(ctx, tx, ev); err != nil {
		return Message{}, err
	}
	if len(changes) > 0 || nm.Kind == "reply" {
		if err := PublishTicketUpdated(ctx, tx, nm.WorkspaceID, nm.TicketID, append(changes, "last_message_at")); err != nil {
			return Message{}, err
		}
	}

	if nm.Kind == "reply" && nm.Direction == "outbound" && channel == ChannelEmail && nm.DeliveryStatus == "pending" {
		if _, err := jc.InsertTx(ctx, tx, jobs.SendMessageArgs{WorkspaceID: nm.WorkspaceID, MessageID: id},
			&river.InsertOpts{Queue: jobs.QueueEmail, MaxAttempts: 8}); err != nil {
			return Message{}, fmt.Errorf("queue send: %w", err)
		}
	}
	trigger := nm.Trigger
	if trigger == "" {
		switch {
		case nm.Kind == "reply" && nm.Direction == "inbound":
			trigger = jobs.TriggerCustomerReplied
		case nm.Kind == "reply" && nm.AuthorType == "user":
			trigger = jobs.TriggerAgentReplied
		default:
			trigger = "none"
		}
	}
	if trigger != "none" {
		if _, err := jc.InsertTx(ctx, tx, jobs.TicketTriggerArgs{WorkspaceID: nm.WorkspaceID, TicketID: nm.TicketID,
			Trigger: trigger, MessageID: &id, ActorUserID: nm.AuthorUserID}, nil); err != nil {
			return Message{}, fmt.Errorf("queue trigger: %w", err)
		}
	}
	return msg, nil
}

// PublishTicketUpdated reloads the ticket and publishes ticket.updated with the changed fields.
func PublishTicketUpdated(ctx context.Context, tx pgx.Tx, wid, ticketID uuid.UUID, changes []string) error {
	t, err := LoadTicket(ctx, tx, wid, ticketID)
	if err != nil {
		return err
	}
	var topics []string
	if t.Assignee != nil {
		topics = append(topics, events.UserTopic(t.Assignee.ID))
	}
	_, err = events.Publish(ctx, tx, events.Event{WorkspaceID: wid, Type: "ticket.updated", Topics: topics,
		Data: map[string]any{"ticket": t, "changes": changes}})
	return err
}

// LogActivity records a timeline entry and publishes activity.created.
func LogActivity(ctx context.Context, tx pgx.Tx, wid, ticketID uuid.UUID, actorType string, actorUserID *uuid.UUID,
	typ string, data map[string]any) (Activity, error) {
	if data == nil {
		data = map[string]any{}
	}
	a := Activity{ID: ids.New(), TicketID: ticketID, Actor: ActivityActor{Type: actorType}, Type: typ, Data: data, CreatedAt: time.Now().UTC()}
	if _, err := tx.Exec(ctx, `INSERT INTO activities (id, workspace_id, ticket_id, actor_type, actor_user_id, type, data, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, a.ID, wid, ticketID, actorType, actorUserID, typ, data, a.CreatedAt); err != nil {
		return a, fmt.Errorf("insert activity: %w", err)
	}
	if actorUserID != nil {
		u, err := LoadUserRef(ctx, tx, *actorUserID)
		if err != nil {
			return a, err
		}
		a.Actor.User = &u
	}
	_, err := events.Publish(ctx, tx, events.Event{WorkspaceID: wid, Type: "activity.created",
		Data: map[string]any{"ticket_id": ticketID, "activity": a}})
	return a, err
}

func truncateRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return string(r[:n])
}
