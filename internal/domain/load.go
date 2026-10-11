package domain

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/opendesk/opendesk/internal/crypto"
	"github.com/opendesk/opendesk/internal/db"
)

var (
	apiURL        string
	attachmentKey []byte
)

// Configure sets the public API base and the key that signs attachment links. Call once at boot.
func Configure(publicAPIURL string, secret []byte) {
	apiURL = strings.TrimRight(publicAPIURL, "/")
	attachmentKey = append([]byte("attachment-url:"), secret...)
}

// AttachmentURL is a link valid for 24h so <img> tags and downloads work without a bearer token.
func AttachmentURL(id uuid.UUID) string {
	exp := strconv.FormatInt(time.Now().Add(24*time.Hour).Truncate(time.Hour).Unix(), 10)
	return apiURL + "/v1/attachments/" + id.String() + "?exp=" + exp + "&sig=" + crypto.HMACHex(attachmentKey, id.String()+":"+exp)
}

// VerifyAttachmentSig checks a link made by AttachmentURL.
func VerifyAttachmentSig(id uuid.UUID, exp, sig string) bool {
	n, err := strconv.ParseInt(exp, 10, 64)
	if err != nil || time.Now().Unix() > n {
		return false
	}
	if _, err := hex.DecodeString(sig); err != nil {
		return false
	}
	return crypto.EqualHex(crypto.HMACHex(attachmentKey, id.String()+":"+exp), sig)
}

// TicketSelect is the column list ScanTicket reads. Append WHERE/ORDER clauses using alias t.
const TicketSelect = `SELECT t.id, t.number, t.subject, t.status, t.priority, t.channel, t.mailbox_id, t.team_id,
	t.sla_policy_id, t.first_response_due_at, t.resolution_due_at, t.first_responded_at, t.solved_at, t.snoozed_until,
	t.last_message_at, t.last_customer_message_at, t.last_message_preview, t.message_count, t.spam,
	t.csat_score, t.csat_comment, t.custom, t.created_at, t.updated_at,
	c.id, c.email, c.name, c.avatar_url,
	u.id, u.name, u.email, u.avatar_url,
	COALESCE((SELECT json_agg(json_build_object('id', g.id, 'name', g.name) ORDER BY g.name)
		FROM ticket_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.ticket_id = t.id), '[]')
FROM tickets t
LEFT JOIN contacts c ON c.id = t.contact_id
LEFT JOIN users u ON u.id = t.assignee_id`

// ScanTicket scans one row of TicketSelect.
func ScanTicket(row pgx.Row) (Ticket, error) {
	var t Ticket
	var slaID *uuid.UUID
	var frDue, resDue *time.Time
	var csatScore *int16
	var csatComment string
	var cID *uuid.UUID
	var cEmail, cName, cAvatar *string
	var uID *uuid.UUID
	var uName, uEmail, uAvatar *string
	var tags []byte
	err := row.Scan(&t.ID, &t.Number, &t.Subject, &t.Status, &t.Priority, &t.Channel, &t.MailboxID, &t.TeamID,
		&slaID, &frDue, &resDue, &t.FirstRespondedAt, &t.SolvedAt, &t.SnoozedUntil,
		&t.LastMessageAt, &t.LastCustomerMessageAt, &t.LastMessagePreview, &t.MessageCount, &t.Spam,
		&csatScore, &csatComment, &t.Custom, &t.CreatedAt, &t.UpdatedAt,
		&cID, &cEmail, &cName, &cAvatar, &uID, &uName, &uEmail, &uAvatar, &tags)
	if err != nil {
		return t, err
	}
	if cID != nil {
		t.Contact = &ContactRef{ID: *cID, Email: cEmail, Name: deref(cName), AvatarURL: deref(cAvatar)}
	}
	if uID != nil {
		t.Assignee = &UserRef{ID: *uID, Name: deref(uName), Email: deref(uEmail), AvatarURL: deref(uAvatar)}
	}
	if slaID != nil {
		now := time.Now()
		open := t.Status != StatusSolved && t.Status != StatusClosed
		breached := open && ((resDue != nil && now.After(*resDue)) ||
			(t.FirstRespondedAt == nil && frDue != nil && now.After(*frDue)))
		t.SLA = &TicketSLA{PolicyID: *slaID, FirstResponseDueAt: frDue, ResolutionDueAt: resDue, Breached: breached}
	}
	if csatScore != nil {
		t.CSAT = &CSAT{Score: int(*csatScore), Comment: csatComment}
	}
	if t.Custom == nil {
		t.Custom = map[string]any{}
	}
	t.Tags = []Tag{}
	if err := json.Unmarshal(tags, &t.Tags); err != nil {
		return t, err
	}
	return t, nil
}

// LoadTicket loads one ticket, scoped to the workspace. Deleted tickets are not found.
func LoadTicket(ctx context.Context, q db.Querier, wid, id uuid.UUID) (Ticket, error) {
	return ScanTicket(q.QueryRow(ctx, TicketSelect+` WHERE t.workspace_id = $1 AND t.id = $2 AND t.deleted_at IS NULL`, wid, id))
}

// MessageSelect is the column list scanMessage reads.
const MessageSelect = `SELECT m.id, m.ticket_id, m.kind, m.direction, m.author_type, m.body_html, m.body_text,
	m.full_html <> '', m.subject, m.from_email, m.from_name, m.to_emails, m.cc_emails, m.bcc_emails,
	m.delivery_status, m.delivery_error, m.created_at,
	u.id, u.name, u.email, u.avatar_url,
	c.id, c.email, c.name, c.avatar_url,
	COALESCE((SELECT json_agg(json_build_object('id', a.id, 'filename', a.filename, 'content_type', a.content_type,
		'size_bytes', a.size_bytes, 'inline', a.inline) ORDER BY a.created_at)
		FROM attachments a WHERE a.message_id = m.id), '[]')
FROM messages m
LEFT JOIN users u ON u.id = m.author_user_id
LEFT JOIN contacts c ON c.id = m.author_contact_id`

func ScanMessage(row pgx.Row) (Message, error) {
	var m Message
	var uID, cID *uuid.UUID
	var uName, uEmail, uAvatar, cEmail, cName, cAvatar *string
	var atts []byte
	err := row.Scan(&m.ID, &m.TicketID, &m.Kind, &m.Direction, &m.Author.Type, &m.BodyHTML, &m.BodyText,
		&m.HasQuoted, &m.Subject, &m.FromEmail, &m.FromName, &m.To, &m.Cc, &m.Bcc,
		&m.DeliveryStatus, &m.DeliveryError, &m.CreatedAt,
		&uID, &uName, &uEmail, &uAvatar, &cID, &cEmail, &cName, &cAvatar, &atts)
	if err != nil {
		return m, err
	}
	if uID != nil {
		m.Author.User = &UserRef{ID: *uID, Name: deref(uName), Email: deref(uEmail), AvatarURL: deref(uAvatar)}
	}
	if cID != nil {
		m.Author.Contact = &ContactRef{ID: *cID, Email: cEmail, Name: deref(cName), AvatarURL: deref(cAvatar)}
	}
	m.Attachments = []Attachment{}
	if err := json.Unmarshal(atts, &m.Attachments); err != nil {
		return m, err
	}
	for i := range m.Attachments {
		m.Attachments[i].URL = AttachmentURL(m.Attachments[i].ID)
	}
	for _, s := range []*[]string{&m.To, &m.Cc, &m.Bcc} {
		if *s == nil {
			*s = []string{}
		}
	}
	return m, nil
}

func LoadMessage(ctx context.Context, q db.Querier, wid, id uuid.UUID) (Message, error) {
	return ScanMessage(q.QueryRow(ctx, MessageSelect+` WHERE m.workspace_id = $1 AND m.id = $2`, wid, id))
}

// ListMessages returns a ticket's messages oldest first. publicOnly drops internal notes.
func ListMessages(ctx context.Context, q db.Querier, wid, ticketID uuid.UUID, publicOnly bool) ([]Message, error) {
	rows, err := q.Query(ctx, MessageSelect+` WHERE m.workspace_id = $1 AND m.ticket_id = $2 AND (NOT $3 OR m.kind = 'reply')
		ORDER BY m.created_at, m.id`, wid, ticketID, publicOnly)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Message, error) { return ScanMessage(r) })
	if out == nil {
		out = []Message{}
	}
	return out, err
}

const ContactSelect = `SELECT ct.id, ct.email, ct.name, ct.phone, ct.avatar_url, ct.external_id, ct.notes, ct.custom,
	ct.blocked, ct.created_at, ct.updated_at, co.id, co.name, co.domain,
	(SELECT count(*) FROM tickets tk WHERE tk.contact_id = ct.id AND tk.deleted_at IS NULL)
FROM contacts ct LEFT JOIN companies co ON co.id = ct.company_id`

func ScanContact(row pgx.Row) (Contact, error) {
	var c Contact
	var coID *uuid.UUID
	var coName, coDomain *string
	err := row.Scan(&c.ID, &c.Email, &c.Name, &c.Phone, &c.AvatarURL, &c.ExternalID, &c.Notes, &c.Custom,
		&c.Blocked, &c.CreatedAt, &c.UpdatedAt, &coID, &coName, &coDomain, &c.TicketCount)
	if err != nil {
		return c, err
	}
	if coID != nil {
		c.Company = &CompanyRef{ID: *coID, Name: deref(coName), Domain: deref(coDomain)}
	}
	if c.Custom == nil {
		c.Custom = map[string]any{}
	}
	return c, nil
}

func LoadContact(ctx context.Context, q db.Querier, wid, id uuid.UUID) (Contact, error) {
	return ScanContact(q.QueryRow(ctx, ContactSelect+` WHERE ct.workspace_id = $1 AND ct.id = $2`, wid, id))
}

// LoadUserRef loads a user's public fields.
func LoadUserRef(ctx context.Context, q db.Querier, id uuid.UUID) (UserRef, error) {
	u := UserRef{ID: id}
	err := q.QueryRow(ctx, `SELECT name, email, avatar_url FROM users WHERE id = $1`, id).Scan(&u.Name, &u.Email, &u.AvatarURL)
	return u, err
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
