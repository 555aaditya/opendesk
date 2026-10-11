package widget

import (
	"context"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/opendesk/opendesk/internal/auth"
	"github.com/opendesk/opendesk/internal/db"
	"github.com/opendesk/opendesk/internal/domain"
	"github.com/opendesk/opendesk/internal/helpdesk/hd"
	"github.com/opendesk/opendesk/internal/httpx"
	"github.com/opendesk/opendesk/internal/jobs"
)

const maxBodyRunes = 10000

// Conversation is a chat ticket as the visitor sees it.
type WidgetConversation struct {
	ID                 uuid.UUID `json:"id"`
	Subject            string    `json:"subject"`
	Status             string    `json:"status" enum:"open,pending,on_hold,solved,closed"`
	LastMessagePreview string    `json:"last_message_preview"`
	LastMessageAt      time.Time `json:"last_message_at"`
	AIHandoff          bool      `json:"ai_handoff" doc:"The visitor asked for a person after an AI answer"`
}

type widgetMessageBody struct {
	Body          string   `json:"body" maxLength:"40000" doc:"Plain text, 1 to 10000 characters"`
	AttachmentIDs []string `json:"attachment_ids,omitempty" maxItems:"20"`
}

type widgetPostInput struct {
	Origin string `header:"Origin"`
	Body   widgetMessageBody
}

func cleanBody(s string) (string, error) {
	s = strings.TrimSpace(strings.ToValidUTF8(s, ""))
	if s == "" {
		return "", httpx.Validation("body is required")
	}
	if utf8.RuneCountInString(s) > maxBodyRunes {
		return "", httpx.Validation("messages can be at most 10000 characters")
	}
	return s, nil
}

const conversationCols = `SELECT id, subject, status, last_message_preview, last_message_at,
	COALESCE(custom->>'ai_handoff' = 'true', false) FROM tickets`

// loadConversation returns the visitor's own chat ticket, or not found.
func loadConversation(ctx context.Context, q db.Querier, p *auth.Principal, rawID string) (WidgetConversation, error) {
	var c WidgetConversation
	id, ok := parseUUID(rawID)
	if !ok {
		return c, httpx.NotFound("Conversation")
	}
	err := q.QueryRow(ctx, conversationCols+` WHERE workspace_id = $1 AND id = $2 AND contact_id = $3 AND channel = 'chat'
		AND deleted_at IS NULL`, p.WorkspaceID, id, p.ContactID).
		Scan(&c.ID, &c.Subject, &c.Status, &c.LastMessagePreview, &c.LastMessageAt, &c.AIHandoff)
	if db.IsNotFound(err) {
		return c, httpx.NotFound("Conversation")
	}
	return c, err
}

func (h *handler) registerConversations(api huma.API) {
	huma.Register(api, huma.Operation{OperationID: "widget-list-conversations", Method: http.MethodGet, Path: "/v1/widget/conversations",
		Summary: "List the visitor's conversations", Tags: []string{"Widget"}},
		func(ctx context.Context, in *struct {
			Origin string `header:"Origin"`
		}) (*struct {
			Body struct {
				Data []WidgetConversation `json:"data"`
			}
		}, error) {
			p, err := h.visitor(ctx, in.Origin)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			rows, err := h.d.DB.Pool.Query(ctx, conversationCols+` WHERE workspace_id = $1 AND contact_id = $2 AND channel = 'chat'
				AND deleted_at IS NULL ORDER BY last_message_at DESC, id DESC LIMIT 100`, p.WorkspaceID, p.ContactID)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (WidgetConversation, error) {
				var c WidgetConversation
				err := r.Scan(&c.ID, &c.Subject, &c.Status, &c.LastMessagePreview, &c.LastMessageAt, &c.AIHandoff)
				return c, err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			out := &struct {
				Body struct {
					Data []WidgetConversation `json:"data"`
				}
			}{}
			out.Body.Data = list
			if out.Body.Data == nil {
				out.Body.Data = []WidgetConversation{}
			}
			return out, nil
		})

	type created struct {
		Conversation WidgetConversation `json:"conversation"`
		Message      domain.Message     `json:"message"`
	}
	huma.Register(api, huma.Operation{OperationID: "widget-create-conversation", Method: http.MethodPost, Path: "/v1/widget/conversations",
		Summary: "Start a conversation", Tags: []string{"Widget"}, DefaultStatus: http.StatusCreated},
		func(ctx context.Context, in *widgetPostInput) (*struct{ Body created }, error) {
			p, err := h.visitor(ctx, in.Origin)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			if err := h.allowWrite(p, "write", visitorWrites); err != nil {
				return nil, err
			}
			body, err := cleanBody(in.Body.Body)
			if err != nil {
				return nil, err
			}
			attIDs, err := hd.ParseAttachmentIDs(in.Body.AttachmentIDs)
			if err != nil {
				return nil, err
			}
			out := &struct{ Body created }{}
			err = h.d.DB.Tx(ctx, func(tx pgx.Tx) error {
				if err := hd.CheckAttachments(ctx, tx, p.WorkspaceID, attIDs, &p.ContactID); err != nil {
					return err
				}
				t, err := domain.CreateTicket(ctx, tx, domain.NewTicket{WorkspaceID: p.WorkspaceID, Subject: hd.Excerpt(body, 80),
					Channel: domain.ChannelChat, ContactID: &p.ContactID})
				if err != nil {
					return err
				}
				m, err := domain.AddMessage(ctx, tx, h.d.Jobs, h.visitorMessage(p, t.ID, body, attIDs, jobs.TriggerTicketCreated))
				if err != nil {
					return err
				}
				if err := hd.EnqueueAIWidgetAnswer(ctx, tx, h.d.Jobs, h.d.Cfg, p.WorkspaceID, t.ID, m.ID); err != nil {
					return err
				}
				out.Body.Message = publicMessage(m)
				out.Body.Conversation, err = loadConversation(ctx, tx, p, t.ID.String())
				return err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return out, nil
		})

	type messagesOut struct {
		Data []domain.Message `json:"data"`
	}
	huma.Register(api, huma.Operation{OperationID: "widget-list-messages", Method: http.MethodGet, Path: "/v1/widget/conversations/{id}/messages",
		Summary: "List a conversation's messages", Description: "Public replies only; internal notes are never returned.", Tags: []string{"Widget"}},
		func(ctx context.Context, in *struct {
			ID     string `path:"id"`
			Origin string `header:"Origin"`
		}) (*struct{ Body messagesOut }, error) {
			p, err := h.visitor(ctx, in.Origin)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			c, err := loadConversation(ctx, h.d.DB.Pool, p, in.ID)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			msgs, err := domain.ListMessages(ctx, h.d.DB.Pool, p.WorkspaceID, c.ID, true)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			for i := range msgs {
				msgs[i] = publicMessage(msgs[i])
			}
			return &struct{ Body messagesOut }{messagesOut{msgs}}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "widget-post-message", Method: http.MethodPost, Path: "/v1/widget/conversations/{id}/messages",
		Summary: "Send a message in a conversation", Tags: []string{"Widget"}, DefaultStatus: http.StatusCreated},
		func(ctx context.Context, in *struct {
			ID     string `path:"id"`
			Origin string `header:"Origin"`
			Body   widgetMessageBody
		}) (*struct{ Body domain.Message }, error) {
			p, err := h.visitor(ctx, in.Origin)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			if err := h.allowWrite(p, "write", visitorWrites); err != nil {
				return nil, err
			}
			body, err := cleanBody(in.Body.Body)
			if err != nil {
				return nil, err
			}
			attIDs, err := hd.ParseAttachmentIDs(in.Body.AttachmentIDs)
			if err != nil {
				return nil, err
			}
			var msg domain.Message
			err = h.d.DB.Tx(ctx, func(tx pgx.Tx) error {
				c, err := loadConversation(ctx, tx, p, in.ID)
				if err != nil {
					return err
				}
				if c.Status == domain.StatusClosed {
					return httpx.E(http.StatusConflict, "conversation_closed", "This conversation is closed. Start a new one.")
				}
				if err := hd.CheckAttachments(ctx, tx, p.WorkspaceID, attIDs, &p.ContactID); err != nil {
					return err
				}
				m, err := domain.AddMessage(ctx, tx, h.d.Jobs, h.visitorMessage(p, c.ID, body, attIDs, ""))
				if err != nil {
					return err
				}
				msg = publicMessage(m)
				return hd.EnqueueAIWidgetAnswer(ctx, tx, h.d.Jobs, h.d.Cfg, p.WorkspaceID, c.ID, m.ID)
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body domain.Message }{msg}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "widget-handoff", Method: http.MethodPost, Path: "/v1/widget/conversations/{id}/handoff",
		Summary: "Ask for a person", Description: "Hands the conversation from the AI answer bot to the team. Idempotent.",
		Tags: []string{"Widget"}, DefaultStatus: http.StatusNoContent},
		func(ctx context.Context, in *struct {
			ID     string `path:"id"`
			Origin string `header:"Origin"`
		}) (*hd.Empty, error) {
			p, err := h.visitor(ctx, in.Origin)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			if err := h.allowWrite(p, "write", visitorWrites); err != nil {
				return nil, err
			}
			err = h.d.DB.Tx(ctx, func(tx pgx.Tx) error {
				c, err := loadConversation(ctx, tx, p, in.ID)
				if err != nil {
					return err
				}
				_, err = hd.MarkAIHandoff(ctx, tx, p.WorkspaceID, c.ID, "contact")
				return err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return nil, nil
		})
}

func (h *handler) visitorMessage(p *auth.Principal, ticketID uuid.UUID, body string, attIDs []uuid.UUID, trigger string) domain.NewMessage {
	return domain.NewMessage{WorkspaceID: p.WorkspaceID, TicketID: ticketID, Kind: "reply", Direction: "inbound",
		AuthorType: "contact", AuthorContactID: &p.ContactID, BodyHTML: hd.TextToHTML(body), BodyText: body,
		AttachmentIDs: attIDs, Trigger: trigger}
}
