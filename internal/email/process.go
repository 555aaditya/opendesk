package email

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"html"
	"io"
	"mime"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"

	"github.com/useopendesk/opendesk/internal/db"
	"github.com/useopendesk/opendesk/internal/displayname"
	"github.com/useopendesk/opendesk/internal/domain"
	"github.com/useopendesk/opendesk/internal/events"
	"github.com/useopendesk/opendesk/internal/ids"
	"github.com/useopendesk/opendesk/internal/jobs"
	"github.com/useopendesk/opendesk/internal/storage"
)

const (
	maxBodyHTML    = 1 << 20
	autoReplyEvery = 4 * time.Hour
)

type processInboundWorker struct {
	river.WorkerDefaults[jobs.ProcessInboundArgs]
	s *service
}

func (w *processInboundWorker) Work(ctx context.Context, job *river.Job[jobs.ProcessInboundArgs]) error {
	err := w.s.processInbound(ctx, job.Args.WorkspaceID, job.Args.InboundEmailID)
	if err != nil && job.Attempt >= job.MaxAttempts {
		_ = w.s.markInbound(context.WithoutCancel(ctx), job.Args.WorkspaceID, job.Args.InboundEmailID, "failed", "processing_failed")
	}
	return err
}

func (s *service) markInbound(ctx context.Context, wid, id uuid.UUID, status, reason string) error {
	_, err := s.d.DB.Pool.Exec(ctx, `UPDATE inbound_emails SET status = $3, reason = $4, processed_at = now()
		WHERE workspace_id = $1 AND id = $2`, wid, id, status, reason)
	return err
}

// preparedAttachment is a stored attachment awaiting its row.
type preparedAttachment struct {
	id          uuid.UUID
	filename    string
	contentType string
	size        int64
	key         string
	cid         string
	inline      bool
}

// threadMatch is the ticket an inbound message belongs to.
type threadMatch struct {
	ticketID uuid.UUID
	number   int64
	status   string
}

// processInbound turns a stored raw email into a ticket message.
func (s *service) processInbound(ctx context.Context, wid, inboundID uuid.UUID) error {
	var mailboxID uuid.UUID
	var key, status, rcpt string
	err := s.d.DB.Pool.QueryRow(ctx, `SELECT mailbox_id, raw_storage_key, status, rcpt_to FROM inbound_emails
		WHERE workspace_id = $1 AND id = $2`, wid, inboundID).Scan(&mailboxID, &key, &status, &rcpt)
	if db.IsNotFound(err) || err == nil && status != "pending" {
		return nil
	}
	if err != nil {
		return err
	}
	m, err := loadMailbox(ctx, s.d.DB.Pool, wid, mailboxID)
	if db.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	raw, err := s.readObject(ctx, key, maxRawBytes)
	if errors.Is(err, storage.ErrNotFound) {
		return s.markInbound(ctx, wid, inboundID, "failed", "raw_missing")
	}
	if err != nil {
		return err
	}
	pm, err := parseMail(raw)
	if err != nil {
		return s.markInbound(ctx, wid, inboundID, "failed", "unparseable")
	}
	own, err := s.ownAddresses(ctx, wid)
	if err != nil {
		return err
	}
	if reason := noiseReason(pm, own, m.Email); reason != "" {
		if reason == "bounce" {
			if err := s.recordBounce(ctx, wid, pm, raw); err != nil {
				return err
			}
		}
		return s.markInbound(ctx, wid, inboundID, "ignored", reason)
	}
	sender, senderName := pm.sender()
	if !validAddress(sender) {
		return s.markInbound(ctx, wid, inboundID, "ignored", "no_sender")
	}
	for _, a := range own {
		if strings.EqualFold(a, sender) {
			return s.markInbound(ctx, wid, inboundID, "ignored", "from_own_mailbox")
		}
	}
	var blocked, dup bool
	if err := s.d.DB.Pool.QueryRow(ctx, `SELECT
		EXISTS (SELECT 1 FROM contacts WHERE workspace_id = $1 AND email = $2 AND blocked),
		EXISTS (SELECT 1 FROM messages WHERE workspace_id = $1 AND email_message_id = $3)`,
		wid, sender, pm.MessageID).Scan(&blocked, &dup); err != nil {
		return err
	}
	if blocked {
		return s.markInbound(ctx, wid, inboundID, "ignored", "blocked_contact")
	}
	if dup {
		return s.markInbound(ctx, wid, inboundID, "ignored", "duplicate")
	}

	atts, err := s.storeAttachments(ctx, wid, pm)
	if err != nil {
		return err
	}
	cidURLs := map[string]string{}
	for _, a := range atts {
		if a.cid != "" {
			cidURLs[a.cid] = domain.AttachmentURL(a.id)
		}
	}
	body := renderBody(pm, cidURLs)
	for i := range atts {
		atts[i].inline = atts[i].cid != "" && body.usedCIDs[atts[i].cid]
	}
	spam := dmarcFailed(pm)
	suppressAuto := pm.header("X-Auto-Response-Suppress") != ""

	err = s.d.DB.Tx(ctx, func(tx pgx.Tx) error {
		match, err := s.findThread(ctx, tx, wid, m, pm, rcpt, sender)
		if err != nil {
			return err
		}
		contactID, _, err := domain.UpsertContactByEmail(ctx, tx, wid, sender, senderName)
		if err != nil {
			return err
		}
		attIDs := make([]uuid.UUID, 0, len(atts))
		for _, a := range atts {
			if _, err := tx.Exec(ctx, `INSERT INTO attachments (id, workspace_id, filename, content_type, size_bytes, storage_key, content_id, inline)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, a.id, wid, a.filename, a.contentType, a.size, a.key, a.cid, a.inline); err != nil {
				return err
			}
			attIDs = append(attIDs, a.id)
		}
		var ticket domain.Ticket
		created := false
		if match != nil && match.status != domain.StatusClosed {
			ticket.ID, ticket.Number = match.ticketID, match.number
		} else {
			custom := map[string]any{}
			subject := subjectTagRe.ReplaceAllString(pm.Subject, "")
			if match != nil {
				custom["previous_ticket_id"] = match.ticketID.String()
				subject = baseSubject(pm.Subject)
			}
			if subject = strings.Join(strings.Fields(subject), " "); subject == "" {
				subject = "(no subject)"
			}
			ticket, err = domain.CreateTicket(ctx, tx, domain.NewTicket{WorkspaceID: wid, Subject: subject, Channel: domain.ChannelEmail,
				MailboxID: &m.ID, ContactID: &contactID, TeamID: m.TeamID, Custom: custom})
			if err != nil {
				return err
			}
			created = true
			if spam {
				if _, err := tx.Exec(ctx, `UPDATE tickets SET spam = true, updated_at = now() WHERE workspace_id = $1 AND id = $2`, wid, ticket.ID); err != nil {
					return err
				}
				if err := domain.PublishTicketUpdated(ctx, tx, wid, ticket.ID, []string{"spam"}); err != nil {
					return err
				}
			}
		}
		msgID := pm.MessageID
		trigger := ""
		if created {
			trigger = jobs.TriggerTicketCreated
		}
		msg, err := domain.AddMessage(ctx, tx, s.d.Jobs, domain.NewMessage{
			WorkspaceID: wid, TicketID: ticket.ID, Kind: "reply", Direction: "inbound", AuthorType: "contact",
			AuthorContactID: &contactID, BodyHTML: body.html, BodyText: body.text, FullHTML: body.full,
			Subject: pm.Subject, FromEmail: sender, FromName: displayname.Clean(senderName, displayname.Person),
			To: pm.To, Cc: pm.Cc, EmailMessageID: &msgID, InReplyTo: pm.InReplyTo, References: pm.References,
			InboundEmailID: &inboundID, AttachmentIDs: attIDs, Trigger: trigger,
		})
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE inbound_emails SET status = 'processed', reason = '', processed_at = now()
			WHERE workspace_id = $1 AND id = $2`, wid, inboundID); err != nil {
			return err
		}
		if !spam {
			if err := s.queueAIAnswer(ctx, tx, m, ticket.ID, msg.ID, pm, sender); err != nil {
				return err
			}
		}
		if created && !spam && !suppressAuto {
			return s.queueAutoReply(ctx, tx, m, ticket, sender, senderName)
		}
		return nil
	})
	if err != nil {
		s.deleteAttachmentObjects(atts)
		if db.IsUniqueViolation(err, "messages_ws_msgid_uq") {
			return s.markInbound(ctx, wid, inboundID, "ignored", "duplicate")
		}
		return err
	}
	return nil
}

func (s *service) readObject(ctx context.Context, key string, limit int64) ([]byte, error) {
	rc, err := s.d.Storage.Get(ctx, key)
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	b, err := io.ReadAll(io.LimitReader(rc, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > limit {
		return nil, errors.New("stored object exceeds the size limit")
	}
	return b, nil
}

// ownAddresses lists the workspace's mailbox addresses, for loop detection.
func (s *service) ownAddresses(ctx context.Context, wid uuid.UUID) ([]string, error) {
	rows, err := s.d.DB.Pool.Query(ctx, `SELECT lower(email::text) FROM mailboxes WHERE workspace_id = $1
		UNION SELECT lower(config->>'oauth_email') FROM mailboxes WHERE workspace_id = $1 AND coalesce(config->>'oauth_email', '') <> ''`, wid)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func (s *service) storeAttachments(ctx context.Context, wid uuid.UUID, pm *parsedMail) ([]preparedAttachment, error) {
	var out []preparedAttachment
	for _, p := range pm.Parts {
		if len(out) >= maxAttachments {
			break
		}
		if len(p.Content) > maxAttachmentBytes {
			continue
		}
		ct := strings.ToLower(p.ContentType)
		if mt, _, err := mime.ParseMediaType(ct); err == nil {
			ct = mt
		} else {
			ct = "application/octet-stream"
		}
		a := preparedAttachment{id: ids.New(), contentType: ct, size: int64(len(p.Content)), cid: normalizeCID(p.ContentID)}
		a.filename = cleanFilename(p.FileName, ct)
		a.key = "workspaces/" + wid.String() + "/attachments/" + a.id.String()
		if err := s.d.Storage.Put(ctx, a.key, bytes.NewReader(p.Content), a.size, ct); err != nil {
			s.deleteAttachmentObjects(out)
			return nil, err
		}
		out = append(out, a)
	}
	return out, nil
}

func (s *service) deleteAttachmentObjects(atts []preparedAttachment) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	for _, a := range atts {
		_ = s.d.Storage.Delete(ctx, a.key)
	}
}

type renderedBody struct {
	html, full, text string
	usedCIDs         map[string]bool
}

// renderBody sanitizes the message, rewrites inline images and separates the new text
// from quoted history. full is set only when something was stripped.
func renderBody(pm *parsedMail, cidURLs map[string]string) renderedBody {
	src := pm.HTML
	textOnly := strings.TrimSpace(src) == ""
	if textOnly {
		src = textToHTML(pm.Text)
	}
	out := renderedBody{usedCIDs: map[string]bool{}}
	doc := parseFragment(src)
	if doc == nil {
		out.text = strings.TrimSpace(pm.Text)
		out.html = sanitizeHTML(textToHTML(out.text))
		return out
	}
	out.usedCIDs = rewriteCID(doc, cidURLs)
	full := sanitizeHTML(render(doc))
	visible, removed := full, false
	if !isForward(pm.Subject) {
		if textOnly {
			if t, ok := stripQuotesText(pm.Text); ok {
				visible, removed = sanitizeHTML(textToHTML(t)), true
			}
		} else if stripQuotesHTML(doc) {
			if cand := sanitizeHTML(render(doc)); htmlToText(cand) != "" || strings.Contains(cand, "<img") {
				visible, removed = cand, true
			}
		}
	}
	text := htmlToText(visible)
	if textOnly && !removed {
		text = strings.TrimSpace(pm.Text)
	}
	if !isForward(pm.Subject) {
		if t, ok := stripQuotesText(text); ok {
			text = t
			if !removed {
				// The text shows quoting the HTML had no marker for; keep both in step.
				visible, removed = sanitizeHTML(textToHTML(t)), true
			}
		}
	}
	if len(visible) > maxBodyHTML {
		visible = sanitizeHTML(textToHTML(truncate(text, maxBodyHTML/4)))
	}
	if len(full) > maxBodyHTML*4 {
		full = sanitizeHTML(textToHTML(truncate(htmlToText(full), maxBodyHTML)))
	}
	out.html, out.text = visible, truncate(text, 200000)
	if removed {
		out.full = full
	}
	return out
}

// findThread matches an inbound message to a ticket: our own Message-IDs in its
// References, then the "+t<n>" address tag, then a "[#n]" subject tag. The last two
// are guessable, so they only match when the sender is the ticket's contact.
func (s *service) findThread(ctx context.Context, tx pgx.Tx, wid uuid.UUID, m *mailboxRow, pm *parsedMail, rcpt, sender string) (*threadMatch, error) {
	refs := append([]string{}, pm.References...)
	if pm.InReplyTo != "" {
		refs = append(refs, pm.InReplyTo)
	}
	if len(refs) > 0 {
		var t threadMatch
		err := tx.QueryRow(ctx, `SELECT t.id, t.number, t.status FROM messages msg
			JOIN tickets t ON t.id = msg.ticket_id AND t.deleted_at IS NULL
			WHERE msg.workspace_id = $1 AND msg.email_message_id = ANY($2)
			ORDER BY msg.created_at DESC LIMIT 1`, wid, refs).Scan(&t.ticketID, &t.number, &t.status)
		if err == nil {
			return &t, nil
		}
		if !db.IsNotFound(err) {
			return nil, err
		}
		// Our own Message-ID format carries the ticket number (auto-replies are not
		// stored as messages, and some providers re-stamp the id of what we sent).
		for _, n := range ourTicketNumbers(refs) {
			if t, err := s.ticketByNumber(ctx, tx, wid, n, ""); err != nil || t != nil {
				return t, err
			}
		}
	}
	var candidates []int64
	addrs := append([]string{rcpt}, pm.To...)
	addrs = append(addrs, pm.Cc...)
	for _, h := range []string{"Delivered-To", "X-Original-To", "X-Forwarded-To"} {
		addrs = append(addrs, pm.headerValues(h)...)
	}
	for _, a := range addrs {
		token, tag, domain, ok := splitRecipient(a)
		if !ok || domain != s.inboundDomain() || token != m.ForwardingToken {
			continue
		}
		if n, ok := plusTicketNumber(tag); ok {
			candidates = append(candidates, n)
		}
	}
	if n, ok := subjectTicketNumber(pm.Subject); ok {
		candidates = append(candidates, n)
	}
	for _, n := range candidates {
		if t, err := s.ticketByNumber(ctx, tx, wid, n, sender); err != nil || t != nil {
			return t, err
		}
	}
	return nil, nil
}

// ticketByNumber loads a ticket by number; with sender set it must be the contact's.
func (s *service) ticketByNumber(ctx context.Context, tx pgx.Tx, wid uuid.UUID, n int64, sender string) (*threadMatch, error) {
	var t threadMatch
	var contactEmail *string
	err := tx.QueryRow(ctx, `SELECT t.id, t.number, t.status, c.email FROM tickets t LEFT JOIN contacts c ON c.id = t.contact_id
		WHERE t.workspace_id = $1 AND t.number = $2 AND t.deleted_at IS NULL`, wid, n).Scan(&t.ticketID, &t.number, &t.status, &contactEmail)
	if db.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if sender != "" && (contactEmail == nil || !strings.EqualFold(*contactEmail, sender)) {
		return nil, nil
	}
	return &t, nil
}

// recordBounce marks the outbound message a bounce refers to.
func (s *service) recordBounce(ctx context.Context, wid uuid.UUID, pm *parsedMail, raw []byte) error {
	refs := bounceRefs(pm, raw)
	if len(refs) == 0 {
		return nil
	}
	var msgIDs []uuid.UUID
	for _, r := range refs {
		if m := ourMsgIDRe.FindStringSubmatch(r); m != nil && strings.HasPrefix(r, "<m_") {
			if id, err := uuid.Parse(m[1]); err == nil {
				msgIDs = append(msgIDs, id)
			}
		}
	}
	detail := bounceDetail(raw)
	return s.d.DB.Tx(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `UPDATE messages SET delivery_status = 'bounced', delivery_error = $4
			WHERE workspace_id = $1 AND direction = 'outbound' AND (email_message_id = ANY($2) OR id = ANY($3))
			RETURNING id, ticket_id`, wid, refs, msgIDs, detail)
		if err != nil {
			return err
		}
		type hit struct{ id, ticket uuid.UUID }
		hits, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (hit, error) {
			var h hit
			return h, r.Scan(&h.id, &h.ticket)
		})
		if err != nil {
			return err
		}
		for _, h := range hits {
			msg, err := domain.LoadMessage(ctx, tx, wid, h.id)
			if err != nil {
				return err
			}
			if _, err := events.Publish(ctx, tx, events.Event{WorkspaceID: wid, Type: "message.updated",
				Data: map[string]any{"ticket_id": h.ticket, "message": msg}}); err != nil {
				return err
			}
		}
		return nil
	})
}

// queueAutoReply sends the mailbox auto-reply for a new ticket, at most once per
// sender per window.
func (s *service) queueAutoReply(ctx context.Context, tx pgx.Tx, m *mailboxRow, t domain.Ticket, sender, senderName string) error {
	if !m.AutoReplyEnabled || strings.TrimSpace(m.AutoReplyHTML) == "" {
		return nil
	}
	var ok bool
	err := tx.QueryRow(ctx, `INSERT INTO email_auto_replies (workspace_id, email) VALUES ($1, $2)
		ON CONFLICT (workspace_id, email) DO UPDATE SET sent_at = now()
		WHERE email_auto_replies.sent_at < now() - $3::interval RETURNING true`,
		m.WorkspaceID, sender, fmt.Sprintf("%d seconds", int(autoReplyEvery.Seconds()))).Scan(&ok)
	if db.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	name := displayname.Clean(senderName, displayname.Person)
	if name == "" {
		name = displayname.FromEmail(sender)
	}
	vars := map[string]string{"ticket.number": itoa(t.Number), "ticket.subject": t.Subject, "contact.name": name}
	htmlBody := fillTemplate(m.AutoReplyHTML, vars, true)
	subject := strings.TrimSpace(fillTemplate(m.AutoReplySubject, vars, false))
	if subject == "" {
		subject = replySubject(t.Subject, t.Number, true)
	} else if _, ok := subjectTicketNumber(subject); !ok {
		subject += " [#" + itoa(t.Number) + "]"
	}
	_, err = s.d.Jobs.InsertTx(ctx, tx, jobs.SendTicketEmailArgs{WorkspaceID: m.WorkspaceID, TicketID: t.ID, Subject: subject,
		HTML: sanitizeHTML(htmlBody), Text: htmlToText(htmlBody), AutoGenerated: true}, &river.InsertOpts{Queue: jobs.QueueEmail, MaxAttempts: 5})
	return err
}

// fillTemplate replaces {{ticket.number}}, {{ticket.subject}} and {{contact.name}}.
func fillTemplate(s string, vars map[string]string, escape bool) string {
	for k, v := range vars {
		if escape {
			v = html.EscapeString(v)
		}
		s = strings.ReplaceAll(s, "{{"+k+"}}", v)
		s = strings.ReplaceAll(s, "{{ "+k+" }}", v)
	}
	return s
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
