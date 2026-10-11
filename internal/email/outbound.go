package email

import (
	"context"
	"errors"
	"net/mail"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	xhtml "golang.org/x/net/html"
	"golang.org/x/net/html/atom"

	"github.com/useopendesk/opendesk/internal/db"
	"github.com/useopendesk/opendesk/internal/displayname"
	"github.com/useopendesk/opendesk/internal/domain"
	"github.com/useopendesk/opendesk/internal/events"
	"github.com/useopendesk/opendesk/internal/ids"
	"github.com/useopendesk/opendesk/internal/jobs"
)

type sendMessageWorker struct {
	river.WorkerDefaults[jobs.SendMessageArgs]
	s *service
}

func (w *sendMessageWorker) Work(ctx context.Context, job *river.Job[jobs.SendMessageArgs]) error {
	return w.s.sendMessage(ctx, job.Args.WorkspaceID, job.Args.MessageID, job.Attempt >= job.MaxAttempts)
}

type sendTicketEmailWorker struct {
	river.WorkerDefaults[jobs.SendTicketEmailArgs]
	s *service
}

func (w *sendTicketEmailWorker) Work(ctx context.Context, job *river.Job[jobs.SendTicketEmailArgs]) error {
	err := w.s.sendTicketEmail(ctx, job.Args)
	var se *sendError
	if errors.As(err, &se) && se.permanent {
		w.s.log.Warn("ticket email not sent", "workspace_id", job.Args.WorkspaceID, "ticket_id", job.Args.TicketID, "reason", se.msg)
		return river.JobCancel(err)
	}
	return err
}

// ticketInfo is what outbound mail needs from a ticket.
type ticketInfo struct {
	id             uuid.UUID
	number         int64
	subject        string
	mailboxID      *uuid.UUID
	contactEmail   *string
	contactBlocked bool
}

func loadTicketInfo(ctx context.Context, q db.Querier, wid, id uuid.UUID) (*ticketInfo, error) {
	var t ticketInfo
	var blocked *bool
	err := q.QueryRow(ctx, `SELECT t.id, t.number, t.subject, t.mailbox_id, c.email, c.blocked FROM tickets t
		LEFT JOIN contacts c ON c.id = t.contact_id AND c.workspace_id = t.workspace_id
		WHERE t.workspace_id = $1 AND t.id = $2 AND t.deleted_at IS NULL`, wid, id).
		Scan(&t.id, &t.number, &t.subject, &t.mailboxID, &t.contactEmail, &blocked)
	t.contactBlocked = blocked != nil && *blocked
	return &t, err
}

// sendingMailbox is the ticket's mailbox, or the workspace's first active one for
// tickets that have none (created through the API).
func (s *service) sendingMailbox(ctx context.Context, wid uuid.UUID, t *ticketInfo) (*mailboxRow, error) {
	if t.mailboxID != nil {
		m, err := loadMailbox(ctx, s.d.DB.Pool, wid, *t.mailboxID)
		if err == nil || !db.IsNotFound(err) {
			return m, err
		}
	}
	m, err := scanMailbox(s.d.DB.Pool.QueryRow(ctx, `SELECT `+mailboxColumns+` FROM mailboxes WHERE workspace_id = $1
		ORDER BY (status = 'active') DESC, created_at LIMIT 1`, wid))
	if db.IsNotFound(err) {
		return nil, permanent("No mailbox is set up to send email from.")
	}
	return m, err
}

// threadHeaders returns In-Reply-To and References for a reply on the ticket: the
// latest inbound message, or else the latest message we sent.
func threadHeaders(ctx context.Context, q db.Querier, wid, ticketID uuid.UUID, exclude uuid.UUID) (string, []string, error) {
	var id string
	var refs []string
	err := q.QueryRow(ctx, `SELECT email_message_id, "references" FROM messages
		WHERE workspace_id = $1 AND ticket_id = $2 AND id <> $3 AND kind = 'reply' AND email_message_id IS NOT NULL
		ORDER BY (direction = 'inbound') DESC, created_at DESC LIMIT 1`, wid, ticketID, exclude).Scan(&id, &refs)
	if db.IsNotFound(err) {
		return "", nil, nil
	}
	if err != nil {
		return "", nil, err
	}
	refs = append(refs, id)
	if len(refs) > 20 {
		refs = append(refs[:1], refs[len(refs)-19:]...)
	}
	return id, refs, nil
}

// addressing picks From, Reply-To and the envelope sender for a mailbox.
func (s *service) addressing(m *mailboxRow, agentName string, number int64) (from mail.Address, replyTo *mail.Address, envFrom string) {
	display := strings.TrimSpace(m.DisplayName)
	if display == "" {
		display = m.Name
	}
	name := display
	if agentName != "" {
		name = agentName + " at " + display
	}
	if m.InboundKind == InboundForwarding {
		replyTo = &mail.Address{Name: display, Address: m.ForwardingToken + "+t" + itoa(number) + "@" + s.inboundDomain()}
	}
	if m.OutboundKind == OutboundSystem {
		sys := s.systemFrom()
		if replyTo == nil {
			replyTo = &mail.Address{Name: display, Address: m.Email}
		}
		return mail.Address{Name: name, Address: sys.Address}, replyTo, sys.Address
	}
	return mail.Address{Name: name, Address: m.Email}, replyTo, m.Email
}

func messageIDFor(prefix string, id uuid.UUID, number int64, m *mailboxRow) string {
	domainPart := emailDomain(m.Email)
	if domainPart == "" {
		domainPart = "opendesk.local"
	}
	return "<" + prefix + "_" + id.String() + ".t" + itoa(number) + "@" + domainPart + ">"
}

// deliver encodes and sends out through the mailbox's outbound kind. It returns the
// Message-ID the recipient sees.
func (s *service) deliver(ctx context.Context, m *mailboxRow, out *outMessage, envFrom string) (string, error) {
	rcpts := dedupe(append(append(append([]string{}, out.To...), out.Cc...), out.Bcc...))
	if len(rcpts) == 0 {
		return "", permanent("The message has no recipient.")
	}
	switch m.OutboundKind {
	case OutboundSMTP:
		raw, err := buildMIME(out, false)
		if err != nil {
			return "", err
		}
		creds, err := s.openCreds(m)
		if err != nil {
			return "", permanent(err.Error())
		}
		ep := smtpEndpoint{host: m.Config.SMTPHost, port: m.Config.SMTPPort, mode: m.Config.SMTPTLS, user: m.Config.SMTPUsername,
			pass: creds.smtpPassword(), guarded: true, helo: s.heloName(), allowNoTLS: s.guard.allowPrivate, authRequired: true}
		return out.MessageID, s.sendSMTP(ctx, ep, &envelope{from: envFrom, rcpts: rcpts, raw: raw})
	case KindGoogle:
		raw, err := buildMIME(out, true)
		if err != nil {
			return "", err
		}
		stamped, err := s.sendGmail(ctx, m, raw)
		if stamped == "" {
			stamped = out.MessageID
		}
		return stamped, err
	case KindMicrosoft:
		raw, err := buildMIME(out, true)
		if err != nil {
			return "", err
		}
		return out.MessageID, s.sendGraph(ctx, m, raw)
	case OutboundSystem:
		raw, err := buildMIME(out, false)
		if err != nil {
			return "", err
		}
		return out.MessageID, s.sendSystem(ctx, &envelope{from: envFrom, rcpts: rcpts, raw: raw})
	}
	return "", permanent("The mailbox has no way to send email.")
}

func dedupe(list []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, a := range list {
		a = strings.ToLower(strings.TrimSpace(a))
		if validAddress(a) && !seen[a] {
			seen[a] = true
			out = append(out, a)
		}
	}
	return out
}

func wrapHTML(body, signature string) string {
	var b strings.Builder
	b.WriteString("<!doctype html><html><head><meta charset=\"utf-8\"></head><body>")
	b.WriteString(body)
	if strings.TrimSpace(signature) != "" {
		b.WriteString("<br><div>")
		b.WriteString(signature)
		b.WriteString("</div>")
	}
	b.WriteString("</body></html>")
	return b.String()
}

func withTextSignature(text, signatureHTML string) string {
	text = strings.TrimSpace(text)
	if sig := htmlToText(signatureHTML); sig != "" {
		text += "\n\n-- \n" + sig
	}
	return text + "\n"
}

// sendMessage delivers one outbound reply and records the result on the message.
func (s *service) sendMessage(ctx context.Context, wid, mid uuid.UUID, lastAttempt bool) error {
	var ticketID uuid.UUID
	var kind, direction, bodyHTML, bodyText, subject, status string
	var to, cc, bcc []string
	var authorID *uuid.UUID
	err := s.d.DB.Pool.QueryRow(ctx, `SELECT ticket_id, kind, direction, body_html, body_text, subject, to_emails, cc_emails, bcc_emails,
		delivery_status, author_user_id FROM messages WHERE workspace_id = $1 AND id = $2`, wid, mid).
		Scan(&ticketID, &kind, &direction, &bodyHTML, &bodyText, &subject, &to, &cc, &bcc, &status, &authorID)
	if db.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if status != "pending" || kind != "reply" || direction != "outbound" {
		return nil
	}
	stamped, err := s.composeAndSend(ctx, wid, mid, ticketID, bodyHTML, bodyText, subject, to, cc, bcc, authorID)
	if err == nil {
		return s.recordDelivery(ctx, wid, mid, ticketID, "sent", "", stamped)
	}
	var se *sendError
	isSend := errors.As(err, &se)
	if isSend && se.permanent || lastAttempt {
		msg := "Sending failed."
		if isSend {
			msg = se.msg
		}
		s.log.Warn("outbound message failed", "workspace_id", wid, "message_id", mid, "reason", msg)
		if rerr := s.recordDelivery(ctx, wid, mid, ticketID, "failed", msg, ""); rerr != nil {
			return rerr
		}
		if lastAttempt {
			return nil
		}
		return river.JobCancel(err)
	}
	return err
}

func (s *service) composeAndSend(ctx context.Context, wid, mid, ticketID uuid.UUID, bodyHTML, bodyText, subject string,
	to, cc, bcc []string, authorID *uuid.UUID) (string, error) {
	t, err := loadTicketInfo(ctx, s.d.DB.Pool, wid, ticketID)
	if db.IsNotFound(err) {
		return "", permanent("The ticket no longer exists.")
	}
	if err != nil {
		return "", err
	}
	m, err := s.sendingMailbox(ctx, wid, t)
	if err != nil {
		return "", err
	}
	if m.Status == "disabled" {
		return "", permanent("The mailbox is disabled.")
	}
	if len(dedupe(to)) == 0 {
		if t.contactEmail == nil || *t.contactEmail == "" {
			return "", permanent("The customer has no email address.")
		}
		to = []string{*t.contactEmail}
	}
	agent := ""
	if authorID != nil {
		if u, err := domain.LoadUserRef(ctx, s.d.DB.Pool, *authorID); err == nil {
			agent = displayname.Displayable(u.Name)
		}
	}
	from, replyTo, envFrom := s.addressing(m, agent, t.number)
	inReplyTo, refs, err := threadHeaders(ctx, s.d.DB.Pool, wid, ticketID, mid)
	if err != nil {
		return "", err
	}
	msgID := messageIDFor("m", mid, t.number, m)
	// Record our id first so a fast reply threads even before the send returns.
	if _, err := s.d.DB.Pool.Exec(ctx, `UPDATE messages SET email_message_id = $3 WHERE workspace_id = $1 AND id = $2 AND email_message_id IS NULL`,
		wid, mid, msgID); err != nil && !db.IsUniqueViolation(err, "") {
		return "", err
	}
	atts, html, err := s.outboundAttachments(ctx, wid, mid, bodyHTML)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(bodyText) == "" {
		bodyText = htmlToText(bodyHTML)
	}
	if strings.TrimSpace(subject) == "" || !subjectTagRe.MatchString(subject) {
		subject = replySubject(firstNonEmpty(subject, t.subject), t.number, inReplyTo != "")
	}
	out := &outMessage{From: from, ReplyTo: replyTo, To: to, Cc: cc, Bcc: bcc, Subject: subject, MessageID: msgID,
		InReplyTo: inReplyTo, References: refs, HTML: wrapHTML(html, m.SignatureHTML),
		Text: withTextSignature(bodyText, m.SignatureHTML), Attachments: atts}
	return s.deliver(ctx, m, out, envFrom)
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// outboundAttachments loads the message's files. Inline images the HTML references by
// their attachment URL are sent as cid: parts so they keep working in the mail client.
func (s *service) outboundAttachments(ctx context.Context, wid, mid uuid.UUID, bodyHTML string) ([]outAttachment, string, error) {
	rows, err := s.d.DB.Pool.Query(ctx, `SELECT id, filename, content_type, storage_key, size_bytes, inline FROM attachments
		WHERE workspace_id = $1 AND message_id = $2 ORDER BY created_at`, wid, mid)
	if err != nil {
		return nil, "", err
	}
	type row struct {
		id       uuid.UUID
		filename string
		ct, key  string
		size     int64
		inline   bool
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (row, error) {
		var x row
		return x, r.Scan(&x.id, &x.filename, &x.ct, &x.key, &x.size, &x.inline)
	})
	if err != nil {
		return nil, "", err
	}
	if len(list) == 0 {
		return nil, bodyHTML, nil
	}
	var total int64
	for _, a := range list {
		total += a.size
	}
	if total > maxOutboundBytes {
		return nil, "", permanent("Attachments are limited to 25 MB per message.")
	}
	doc := parseFragment(bodyHTML)
	referenced := map[uuid.UUID]string{}
	if doc != nil {
		var walk func(*xhtml.Node)
		walk = func(n *xhtml.Node) {
			if n.Type == xhtml.ElementNode && n.DataAtom == atom.Img {
				for i, a := range n.Attr {
					if !strings.EqualFold(a.Key, "src") {
						continue
					}
					for _, att := range list {
						if att.inline && strings.Contains(a.Val, "/v1/attachments/"+att.id.String()) {
							cid := att.id.String() + "@opendesk"
							n.Attr[i].Val = "cid:" + cid
							referenced[att.id] = cid
						}
					}
				}
			}
			for c := n.FirstChild; c != nil; c = c.NextSibling {
				walk(c)
			}
		}
		walk(doc)
		if len(referenced) > 0 {
			bodyHTML = render(doc)
		}
	}
	out := make([]outAttachment, 0, len(list))
	for _, a := range list {
		data, err := s.readObject(ctx, a.key, maxAttachmentBytes)
		if err != nil {
			return nil, "", err
		}
		out = append(out, outAttachment{Filename: a.filename, ContentType: a.ct, Data: data, ContentID: referenced[a.id]})
	}
	return out, bodyHTML, nil
}

// recordDelivery stores the outcome and publishes message.updated.
func (s *service) recordDelivery(ctx context.Context, wid, mid, ticketID uuid.UUID, status, detail, stamped string) error {
	return s.d.DB.Tx(ctx, func(tx pgx.Tx) error {
		if status == "sent" {
			if _, err := tx.Exec(ctx, `SAVEPOINT stamp`); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `UPDATE messages SET email_message_id = $3 WHERE workspace_id = $1 AND id = $2 AND $3 <> ''`, wid, mid, stamped)
			if err != nil {
				if !db.IsUniqueViolation(err, "") {
					return err
				}
				if _, err := tx.Exec(ctx, `ROLLBACK TO SAVEPOINT stamp`); err != nil {
					return err
				}
			}
		}
		tag, err := tx.Exec(ctx, `UPDATE messages SET delivery_status = $3, delivery_error = $4,
			sent_at = CASE WHEN $3 = 'sent' THEN now() ELSE sent_at END
			WHERE workspace_id = $1 AND id = $2 AND delivery_status = 'pending'`, wid, mid, status, truncate(detail, 500))
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return nil
		}
		msg, err := domain.LoadMessage(ctx, tx, wid, mid)
		if err != nil {
			return err
		}
		_, err = events.Publish(ctx, tx, events.Event{WorkspaceID: wid, Type: "message.updated",
			Data: map[string]any{"ticket_id": ticketID, "message": msg}})
		return err
	})
}

// sendTicketEmail sends an auto-reply or CSAT email from the ticket's mailbox.
func (s *service) sendTicketEmail(ctx context.Context, a jobs.SendTicketEmailArgs) error {
	t, err := loadTicketInfo(ctx, s.d.DB.Pool, a.WorkspaceID, a.TicketID)
	if db.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if t.contactEmail == nil || !validAddress(strings.ToLower(*t.contactEmail)) || t.contactBlocked {
		return nil
	}
	m, err := s.sendingMailbox(ctx, a.WorkspaceID, t)
	if err != nil {
		return err
	}
	if m.Status == "disabled" {
		return nil
	}
	from, replyTo, envFrom := s.addressing(m, "", t.number)
	inReplyTo, refs, err := threadHeaders(ctx, s.d.DB.Pool, a.WorkspaceID, t.id, uuid.Nil)
	if err != nil {
		return err
	}
	subject := a.Subject
	if strings.TrimSpace(subject) == "" {
		subject = replySubject(t.subject, t.number, inReplyTo != "")
	}
	text := a.Text
	if strings.TrimSpace(text) == "" {
		text = htmlToText(a.HTML)
	}
	body := a.HTML
	if !strings.Contains(strings.ToLower(body), "<html") {
		body = wrapHTML(body, "")
	}
	out := &outMessage{From: from, ReplyTo: replyTo, To: []string{strings.ToLower(*t.contactEmail)}, Subject: subject,
		MessageID: messageIDFor("a", ids.New(), t.number, m), InReplyTo: inReplyTo, References: refs,
		HTML: body, Text: text, AutoGenerated: a.AutoGenerated, Date: time.Now()}
	_, err = s.deliver(ctx, m, out, envFrom)
	return err
}
