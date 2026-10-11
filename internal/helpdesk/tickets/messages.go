package tickets

import (
	"context"
	"net/http"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/opendesk/opendesk/internal/auth"
	"github.com/opendesk/opendesk/internal/db"
	"github.com/opendesk/opendesk/internal/deps"
	"github.com/opendesk/opendesk/internal/domain"
	"github.com/opendesk/opendesk/internal/helpdesk/hd"
	"github.com/opendesk/opendesk/internal/httpx"
)

type ticketMessageBody struct {
	Kind          string   `json:"kind" enum:"reply,note"`
	BodyHTML      string   `json:"body_html" maxLength:"500000"`
	Cc            []string `json:"cc,omitempty" maxItems:"20"`
	Bcc           []string `json:"bcc,omitempty" maxItems:"20"`
	AttachmentIDs []string `json:"attachment_ids,omitempty" maxItems:"20"`
	Status        *string  `json:"status,omitempty" enum:"open,pending,on_hold,solved,closed" doc:"Applied after the message is added"`
}

const activitySelect = `SELECT a.id, a.ticket_id, a.actor_type, a.type, a.data, a.created_at, u.id, u.name, u.email, u.avatar_url
FROM activities a LEFT JOIN users u ON u.id = a.actor_user_id`

func scanActivity(row pgx.Row) (domain.Activity, error) {
	var a domain.Activity
	var uID *uuid.UUID
	var uName, uEmail, uAvatar *string
	if err := row.Scan(&a.ID, &a.TicketID, &a.Actor.Type, &a.Type, &a.Data, &a.CreatedAt, &uID, &uName, &uEmail, &uAvatar); err != nil {
		return a, err
	}
	if uID != nil {
		a.Actor.User = &domain.UserRef{ID: *uID, Name: str(uName), Email: str(uEmail), AvatarURL: domain.Avatar(str(uAvatar))}
	}
	if a.Data == nil {
		a.Data = map[string]any{}
	}
	return a, nil
}

func str(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func registerMessages(d *deps.Deps, api huma.API) {
	tags := []string{"Tickets"}

	huma.Register(api, huma.Operation{OperationID: "list-ticket-messages", Method: http.MethodGet, Path: "/v1/tickets/{id}/messages",
		Summary: "List a ticket's messages", Description: "Oldest first, notes included.", Tags: tags},
		func(ctx context.Context, in *struct {
			ID string `path:"id"`
		}) (*struct {
			Body struct {
				Data []domain.Message `json:"data"`
			}
		}, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleViewer, auth.ScopeTicketsRead)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := resolveTicket(ctx, d.DB.Pool, p.WorkspaceID, in.ID)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			msgs, err := domain.ListMessages(ctx, d.DB.Pool, p.WorkspaceID, id, false)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			out := &struct {
				Body struct {
					Data []domain.Message `json:"data"`
				}
			}{}
			out.Body.Data = msgs
			return out, nil
		})

	huma.Register(api, huma.Operation{OperationID: "create-ticket-message", Method: http.MethodPost, Path: "/v1/tickets/{id}/messages",
		Summary: "Reply or add a note", Tags: tags, DefaultStatus: http.StatusCreated},
		func(ctx context.Context, in *struct {
			ID   string `path:"id"`
			Body ticketMessageBody
		}) (*struct{ Body domain.Message }, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAgent, auth.ScopeTicketsWrite)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			var msg domain.Message
			err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
				id, err := resolveTicket(ctx, tx, p.WorkspaceID, in.ID)
				if err != nil {
					return err
				}
				msg, err = postMessage(ctx, tx, d, p, id, in.Body)
				return err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body domain.Message }{msg}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "list-ticket-activities", Method: http.MethodGet, Path: "/v1/tickets/{id}/activities",
		Summary: "List a ticket's activities", Description: "Oldest first.", Tags: tags},
		func(ctx context.Context, in *struct {
			ID string `path:"id"`
		}) (*struct {
			Body struct {
				Data []domain.Activity `json:"data"`
			}
		}, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleViewer, auth.ScopeTicketsRead)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := resolveTicket(ctx, d.DB.Pool, p.WorkspaceID, in.ID)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			rows, err := d.DB.Pool.Query(ctx, activitySelect+` WHERE a.workspace_id = $1 AND a.ticket_id = $2 ORDER BY a.created_at, a.id`,
				p.WorkspaceID, id)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.Activity, error) { return scanActivity(r) })
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			out := &struct {
				Body struct {
					Data []domain.Activity `json:"data"`
				}
			}{}
			out.Body.Data = list
			if out.Body.Data == nil {
				out.Body.Data = []domain.Activity{}
			}
			return out, nil
		})

	huma.Register(api, huma.Operation{OperationID: "get-message-original", Method: http.MethodGet, Path: "/v1/messages/{id}/original",
		Summary: "Get a message with its quoted history", Tags: tags,
		Description: "full_html is the stored (sanitized) original including quoted history; the body when there is none."},
		func(ctx context.Context, in *struct {
			ID string `path:"id"`
		}) (*struct {
			Body struct {
				FullHTML string `json:"full_html"`
			}
		}, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleViewer, auth.ScopeTicketsRead)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := hd.ParseID(in.ID, "Message")
			if err != nil {
				return nil, err
			}
			out := &struct {
				Body struct {
					FullHTML string `json:"full_html"`
				}
			}{}
			err = d.DB.Pool.QueryRow(ctx, `SELECT CASE WHEN m.full_html <> '' THEN m.full_html ELSE m.body_html END
				FROM messages m JOIN tickets t ON t.id = m.ticket_id AND t.deleted_at IS NULL
				WHERE m.workspace_id = $1 AND m.id = $2`, p.WorkspaceID, id).Scan(&out.Body.FullHTML)
			if db.IsNotFound(err) {
				return nil, httpx.NotFound("Message")
			}
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return out, nil
		})
}

// postMessage adds an agent or API reply or note and applies an optional status.
func postMessage(ctx context.Context, tx pgx.Tx, d *deps.Deps, p *auth.Principal, tid uuid.UUID, b ticketMessageBody) (domain.Message, error) {
	wid := p.WorkspaceID
	actor := actorOf(p)
	var channel, subject string
	var mailboxEmail, mailboxName, contactEmail *string
	if err := tx.QueryRow(ctx, `SELECT t.channel, t.subject, mb.email, mb.display_name, c.email FROM tickets t
		LEFT JOIN mailboxes mb ON mb.id = t.mailbox_id LEFT JOIN contacts c ON c.id = t.contact_id
		WHERE t.workspace_id = $1 AND t.id = $2`, wid, tid).Scan(&channel, &subject, &mailboxEmail, &mailboxName, &contactEmail); err != nil {
		return domain.Message{}, err
	}
	bodyHTML := hd.SanitizeRich(b.BodyHTML)
	bodyText := hd.HTMLToText(bodyHTML)
	attIDs, err := hd.ParseAttachmentIDs(b.AttachmentIDs)
	if err != nil {
		return domain.Message{}, err
	}
	if bodyText == "" && len(attIDs) == 0 && !strings.Contains(bodyHTML, "<img") {
		return domain.Message{}, httpx.Validation("the message is empty")
	}
	if err := hd.CheckAttachments(ctx, tx, wid, attIDs, nil); err != nil {
		return domain.Message{}, err
	}
	nm := domain.NewMessage{WorkspaceID: wid, TicketID: tid, Kind: b.Kind, Direction: "outbound", AuthorType: actor.Type,
		AuthorUserID: actor.UserID, BodyHTML: bodyHTML, BodyText: bodyText, Subject: replySubject(subject), AttachmentIDs: attIDs}
	if b.Kind == "reply" && channel == domain.ChannelEmail {
		if contactEmail == nil || *contactEmail == "" {
			return domain.Message{}, httpx.Validation("this ticket's contact has no email address to reply to")
		}
		cc, err := cleanEmails(b.Cc)
		if err != nil {
			return domain.Message{}, err
		}
		bcc, err := cleanEmails(b.Bcc)
		if err != nil {
			return domain.Message{}, err
		}
		nm.To, nm.Cc, nm.Bcc = []string{*contactEmail}, cc, bcc
		nm.FromEmail, nm.FromName = str(mailboxEmail), str(mailboxName)
		nm.DeliveryStatus = "pending"
	} else if len(b.Cc)+len(b.Bcc) > 0 {
		return domain.Message{}, httpx.Validation("cc and bcc apply only to email replies")
	}
	if actor.UserID != nil && nm.FromName == "" {
		if u, err := domain.LoadUserRef(ctx, tx, *actor.UserID); err == nil {
			nm.FromName = u.Name
		}
	}
	msg, err := domain.AddMessage(ctx, tx, d.Jobs, nm)
	if err != nil {
		return domain.Message{}, err
	}
	if b.Kind == "note" {
		if err := notifyMentions(ctx, tx, wid, tid, msg, actor.UserID); err != nil {
			return domain.Message{}, err
		}
	}
	if b.Status != nil {
		if _, err := applyPatch(ctx, tx, d, wid, tid, actor, Patch{Status: b.Status}, applyOpts{Enqueue: true, RequireFields: true}); err != nil {
			return domain.Message{}, err
		}
	}
	return msg, nil
}

func replySubject(s string) string {
	if s == "" || strings.HasPrefix(strings.ToLower(s), "re:") {
		return s
	}
	return "Re: " + s
}

var mentionAttr = regexp.MustCompile(`data-(?:mention|id)="([0-9a-fA-F-]{36})"`)

type member struct {
	ID    uuid.UUID
	Name  string
	Email string
}

// mentionedUsers finds members mentioned in a note: a data-id (or data-mention) user id in the HTML,
// or "@" followed by a member's email or full name in the text.
func mentionedUsers(html, text string, members []member, author *uuid.UUID) []uuid.UUID {
	byID := map[uuid.UUID]bool{}
	for _, m := range members {
		byID[m.ID] = true
	}
	var out []uuid.UUID
	add := func(id uuid.UUID) {
		if (author != nil && *author == id) || !byID[id] {
			return
		}
		for _, x := range out {
			if x == id {
				return
			}
		}
		out = append(out, id)
	}
	for _, m := range mentionAttr.FindAllStringSubmatch(html, -1) {
		if id, err := uuid.Parse(m[1]); err == nil {
			add(id)
		}
	}
	lower := strings.ToLower(text)
	for _, m := range members {
		for _, handle := range []string{m.Email, m.Name} {
			handle = strings.ToLower(strings.TrimSpace(handle))
			if handle == "" {
				continue
			}
			if containsMention(lower, "@"+handle) {
				add(m.ID)
				break
			}
		}
	}
	return out
}

// containsMention reports needle in s followed by a non-word character or the end.
func containsMention(s, needle string) bool {
	for i := 0; ; {
		j := strings.Index(s[i:], needle)
		if j < 0 {
			return false
		}
		end := i + j + len(needle)
		start := i + j
		before, _ := utf8.DecodeLastRuneInString(s[:start])
		after, _ := utf8.DecodeRuneInString(s[end:])
		okBefore := start == 0 || !(unicode.IsLetter(before) || unicode.IsDigit(before))
		okAfter := end == len(s) || !(unicode.IsLetter(after) || unicode.IsDigit(after) || after == '@')
		if okBefore && okAfter {
			return true
		}
		i = start + 1
	}
}

func notifyMentions(ctx context.Context, tx pgx.Tx, wid, tid uuid.UUID, msg domain.Message, author *uuid.UUID) error {
	if !strings.Contains(msg.BodyText, "@") && !strings.Contains(msg.BodyHTML, "data-mention") && !strings.Contains(msg.BodyHTML, "data-id") {
		return nil
	}
	rows, err := tx.Query(ctx, `SELECT u.id, u.name, u.email::text FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1`, wid)
	if err != nil {
		return err
	}
	members, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (member, error) {
		var m member
		err := r.Scan(&m.ID, &m.Name, &m.Email)
		return m, err
	})
	if err != nil {
		return err
	}
	for _, uid := range mentionedUsers(msg.BodyHTML, msg.BodyText, members, author) {
		data := map[string]any{"message_id": msg.ID.String(), "by": idOrNil(author), "preview": hd.Excerpt(msg.BodyText, 140)}
		if err := hd.Notify(ctx, tx, wid, uid, hd.NotifyMentioned, &tid, data); err != nil {
			return err
		}
	}
	return nil
}
