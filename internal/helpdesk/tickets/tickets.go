package tickets

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/opendesk/opendesk/internal/auth"
	"github.com/opendesk/opendesk/internal/deps"
	"github.com/opendesk/opendesk/internal/displayname"
	"github.com/opendesk/opendesk/internal/domain"
	"github.com/opendesk/opendesk/internal/events"
	"github.com/opendesk/opendesk/internal/helpdesk/hd"
	"github.com/opendesk/opendesk/internal/httpx"
	"github.com/opendesk/opendesk/internal/jobs"
)

type ticketOut struct{ Body domain.Ticket }

type listIn struct {
	httpx.ListParams
	Status    string `query:"status" doc:"Comma separated statuses"`
	Priority  string `query:"priority" doc:"Comma separated priorities"`
	Assignee  string `query:"assignee" doc:"me, none or a user id"`
	TeamID    string `query:"team_id"`
	MailboxID string `query:"mailbox_id"`
	Tag       string `query:"tag" doc:"Tag name"`
	Channel   string `query:"channel" enum:"email,chat,api,portal,"`
	ContactID string `query:"contact_id"`
	ViewID    string `query:"view_id" doc:"Apply a saved view's filters; explicit filters override it"`
	Q         string `query:"q" maxLength:"200" doc:"Full text over subjects and messages, or #number"`
	Spam      string `query:"spam" enum:"true,false,any," doc:"Default false (spam hidden); true lists only spam"`
	Sort      string `query:"sort" enum:"last_message_at,created_at,priority,due," doc:"Default last_message_at"`
	Order     string `query:"order" enum:"asc,desc," doc:"Default desc, asc for due"`
}

type ticketContactInput struct {
	Email string `json:"email" maxLength:"254"`
	Name  string `json:"name,omitempty" maxLength:"200"`
}

type ticketCreateBody struct {
	Subject       string              `json:"subject" minLength:"1" maxLength:"500"`
	ContactID     string              `json:"contact_id,omitempty"`
	Contact       *ticketContactInput `json:"contact,omitempty"`
	Channel       string              `json:"channel,omitempty" enum:"email,api" doc:"Default email when mailbox_id is given, otherwise api"`
	MailboxID     string              `json:"mailbox_id,omitempty"`
	BodyHTML      string              `json:"body_html,omitempty" maxLength:"500000"`
	Kind          string              `json:"kind,omitempty" enum:"reply,note" doc:"Default reply"`
	Priority      string              `json:"priority,omitempty" enum:"low,normal,high,urgent"`
	AssigneeID    string              `json:"assignee_id,omitempty"`
	TeamID        string              `json:"team_id,omitempty"`
	Tags          []string            `json:"tags,omitempty" maxItems:"50"`
	Status        string              `json:"status,omitempty" enum:"open,pending,on_hold,solved,closed"`
	Cc            []string            `json:"cc,omitempty" maxItems:"20"`
	Bcc           []string            `json:"bcc,omitempty" maxItems:"20"`
	AttachmentIDs []string            `json:"attachment_ids,omitempty" maxItems:"20"`
	Custom        map[string]any      `json:"custom,omitempty"`
}

type ticketPatchBody struct {
	Subject      *string        `json:"subject,omitempty" maxLength:"500"`
	Status       *string        `json:"status,omitempty" enum:"open,pending,on_hold,solved,closed"`
	Priority     *string        `json:"priority,omitempty" enum:"low,normal,high,urgent"`
	AssigneeID   Opt[string]    `json:"assignee_id,omitempty" doc:"User id, or null to unassign"`
	TeamID       Opt[string]    `json:"team_id,omitempty" doc:"Team id, or null"`
	SnoozedUntil Opt[time.Time] `json:"snoozed_until,omitempty" doc:"Snooze until, or null to wake"`
	Spam         *bool          `json:"spam,omitempty"`
	Tags         *[]string      `json:"tags,omitempty" maxItems:"50" doc:"Replaces the tags, by name; missing tags are created"`
	AddTags      []string       `json:"add_tags,omitempty" maxItems:"50" doc:"Adds these tags, by name, keeping the others; missing tags are created"`
	RemoveTags   []string       `json:"remove_tags,omitempty" maxItems:"50" doc:"Removes these tags, by name"`
	Custom       map[string]any `json:"custom,omitempty" doc:"Merged into custom; null values remove keys"`
}

func (b ticketPatchBody) toPatch() (Patch, error) {
	p := Patch{Subject: b.Subject, Status: b.Status, Priority: b.Priority, Spam: b.Spam, Tags: b.Tags, AddTags: b.AddTags,
		RemoveTags: b.RemoveTags, Custom: b.Custom, Snooze: b.SnoozedUntil}
	var err error
	if p.Assignee, err = optID(b.AssigneeID, "assignee_id"); err != nil {
		return p, err
	}
	if p.Team, err = optID(b.TeamID, "team_id"); err != nil {
		return p, err
	}
	return p, nil
}

func optID(o Opt[string], field string) (Opt[uuid.UUID], error) {
	if !o.Set {
		return Opt[uuid.UUID]{}, nil
	}
	if o.Null || strings.TrimSpace(o.Value) == "" {
		return Opt[uuid.UUID]{Set: true, Null: true}, nil
	}
	id, err := hd.ParseRef(o.Value, field)
	if err != nil {
		return Opt[uuid.UUID]{}, err
	}
	return Opt[uuid.UUID]{Set: true, Value: id}, nil
}

// cleanEmail validates and lowercases an address.
func cleanEmail(s string) (string, error) {
	s = strings.ToLower(strings.TrimSpace(s))
	a, err := mail.ParseAddress(s)
	if err != nil || a.Address != s || len(s) > 254 {
		return "", httpx.Validation(fmt.Sprintf("%q is not a valid email address", hd.Truncate(s, 80)))
	}
	return s, nil
}

func cleanEmails(in []string) ([]string, error) {
	out := []string{}
	for _, s := range in {
		if strings.TrimSpace(s) == "" {
			continue
		}
		e, err := cleanEmail(s)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, nil
}

func checkCustom(m map[string]any) error {
	raw, _ := json.Marshal(m)
	if len(m) > 50 || len(raw) > 16<<10 {
		return httpx.Validation("custom fields are limited to 50 keys and 16 KB")
	}
	return nil
}

func registerTickets(d *deps.Deps, api huma.API) {
	tags := []string{"Tickets"}

	huma.Register(api, huma.Operation{OperationID: "list-tickets", Method: http.MethodGet, Path: "/v1/tickets",
		Summary: "List tickets", Tags: tags},
		func(ctx context.Context, in *listIn) (*struct{ Body httpx.Page[domain.Ticket] }, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleViewer, auth.ScopeTicketsRead)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			req := hd.TicketFilters{Status: hd.SplitCSV(in.Status), Priority: hd.SplitCSV(in.Priority), Assignee: in.Assignee,
				TeamID: in.TeamID, MailboxID: in.MailboxID, Tag: in.Tag, Channel: in.Channel, Q: in.Q}
			f := req
			if in.ViewID != "" {
				view, err := loadView(ctx, d.DB.Pool, p, in.ViewID)
				if err != nil {
					return nil, httpx.Wrap(err)
				}
				f = mergeFilters(view, req)
			}
			if f.Status, err = validEnum(f.Status, domain.Statuses, "status"); err != nil {
				return nil, err
			}
			if f.Priority, err = validEnum(f.Priority, domain.Priorities, "priority"); err != nil {
				return nil, err
			}
			page, err := listTickets(ctx, d.DB.Pool, p.WorkspaceID, p.ActorUserID(), listQuery{TicketFilters: f, ContactID: in.ContactID, Spam: in.Spam},
				in.Sort, in.Order, in.Limit, in.Cursor)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body httpx.Page[domain.Ticket] }{page}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "ticket-counts", Method: http.MethodGet, Path: "/v1/tickets/counts",
		Summary: "Sidebar counts", Tags: tags,
		Description: "unassigned and mine count open, pending and on_hold tickets; status counts exclude spam; spam counts spam that is not closed; views counts each visible view."},
		func(ctx context.Context, _ *struct{}) (*struct{ Body TicketCounts }, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleViewer, auth.ScopeTicketsRead)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			c, err := ticketCounts(ctx, d.DB.Pool, p)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body TicketCounts }{c}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "create-ticket", Method: http.MethodPost, Path: "/v1/tickets",
		Summary: "Create a ticket", Tags: tags, DefaultStatus: http.StatusCreated},
		func(ctx context.Context, in *struct{ Body ticketCreateBody }) (*ticketOut, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAgent, auth.ScopeTicketsWrite)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			var t domain.Ticket
			err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
				var err error
				t, err = createTicket(ctx, tx, d, p, in.Body)
				return err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &ticketOut{t}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "get-ticket", Method: http.MethodGet, Path: "/v1/tickets/{id}",
		Summary: "Get a ticket", Tags: tags, Description: "id is the uuid, #number or number."},
		func(ctx context.Context, in *struct {
			ID string `path:"id"`
		}) (*ticketOut, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleViewer, auth.ScopeTicketsRead)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := resolveTicket(ctx, d.DB.Pool, p.WorkspaceID, in.ID)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			t, err := domain.LoadTicket(ctx, d.DB.Pool, p.WorkspaceID, id)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &ticketOut{t}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "update-ticket", Method: http.MethodPatch, Path: "/v1/tickets/{id}",
		Summary: "Update a ticket", Tags: tags},
		func(ctx context.Context, in *struct {
			ID   string `path:"id"`
			Body ticketPatchBody
		}) (*ticketOut, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAgent, auth.ScopeTicketsWrite)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			patch, err := in.Body.toPatch()
			if err != nil {
				return nil, err
			}
			var t domain.Ticket
			err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
				id, err := resolveTicket(ctx, tx, p.WorkspaceID, in.ID)
				if err != nil {
					return err
				}
				if _, err := applyPatch(ctx, tx, d, p.WorkspaceID, id, actorOf(p), patch, applyOpts{Enqueue: true}); err != nil {
					return err
				}
				t, err = domain.LoadTicket(ctx, tx, p.WorkspaceID, id)
				return err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &ticketOut{t}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "delete-ticket", Method: http.MethodDelete, Path: "/v1/tickets/{id}",
		Summary: "Delete a ticket", Tags: tags, DefaultStatus: http.StatusNoContent},
		func(ctx context.Context, in *struct {
			ID string `path:"id"`
		}) (*struct{}, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAgent, auth.ScopeTicketsWrite)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
				id, err := resolveTicket(ctx, tx, p.WorkspaceID, in.ID)
				if err != nil {
					return err
				}
				return deleteTicket(ctx, tx, p.WorkspaceID, id)
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return nil, nil
		})

	type ticketBulkBody struct {
		IDs    []string         `json:"ids" minItems:"1" maxItems:"100"`
		Patch  *ticketPatchBody `json:"patch,omitempty"`
		Delete bool             `json:"delete,omitempty"`
	}
	type ticketBulkResult struct {
		Data    []domain.Ticket `json:"data"`
		Updated int             `json:"updated"`
		Deleted int             `json:"deleted"`
	}
	huma.Register(api, huma.Operation{OperationID: "bulk-tickets", Method: http.MethodPost, Path: "/v1/tickets/bulk",
		Summary: "Update or delete many tickets", Tags: tags,
		Description: "All or nothing: a validation error on any ticket changes none. Ids not in the workspace are refused."},
		func(ctx context.Context, in *struct{ Body ticketBulkBody }) (*struct{ Body ticketBulkResult }, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAgent, auth.ScopeTicketsWrite)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			if (in.Body.Patch == nil) == !in.Body.Delete {
				return nil, httpx.Validation("send either patch or delete: true")
			}
			var patch Patch
			if in.Body.Patch != nil {
				if patch, err = in.Body.Patch.toPatch(); err != nil {
					return nil, err
				}
			}
			out := ticketBulkResult{Data: []domain.Ticket{}}
			err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
				seen := map[uuid.UUID]bool{}
				for _, raw := range in.Body.IDs {
					id, err := resolveTicket(ctx, tx, p.WorkspaceID, raw)
					if err != nil {
						return err
					}
					if seen[id] {
						continue
					}
					seen[id] = true
					if in.Body.Delete {
						if err := deleteTicket(ctx, tx, p.WorkspaceID, id); err != nil {
							return err
						}
						out.Deleted++
						continue
					}
					changes, err := applyPatch(ctx, tx, d, p.WorkspaceID, id, actorOf(p), patch, applyOpts{Enqueue: true})
					if err != nil {
						return err
					}
					if len(changes) > 0 {
						out.Updated++
					}
					t, err := domain.LoadTicket(ctx, tx, p.WorkspaceID, id)
					if err != nil {
						return err
					}
					out.Data = append(out.Data, t)
				}
				return nil
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body ticketBulkResult }{out}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "merge-ticket", Method: http.MethodPost, Path: "/v1/tickets/{id}/merge",
		Summary: "Merge a ticket into another", Tags: tags,
		Description: "Moves every message and tag into into_id and closes this ticket. Returns the target."},
		func(ctx context.Context, in *struct {
			ID   string `path:"id"`
			Body struct {
				IntoID string `json:"into_id"`
			}
		}) (*ticketOut, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAgent, auth.ScopeTicketsWrite)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			var t domain.Ticket
			err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
				src, err := resolveTicket(ctx, tx, p.WorkspaceID, in.ID)
				if err != nil {
					return err
				}
				dst, err := resolveTicket(ctx, tx, p.WorkspaceID, in.Body.IntoID)
				if err != nil {
					return httpx.Validation("into_id is not a ticket in this workspace")
				}
				if err := mergeTickets(ctx, tx, d, p.WorkspaceID, src, dst, actorOf(p)); err != nil {
					return err
				}
				t, err = domain.LoadTicket(ctx, tx, p.WorkspaceID, dst)
				return err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &ticketOut{t}, nil
		})
}

func validEnum(in, allowed []string, field string) ([]string, error) {
	var out []string
	for _, v := range in {
		ok := false
		for _, a := range allowed {
			ok = ok || a == v
		}
		if !ok {
			return nil, httpx.Validation(field + " must be one of " + strings.Join(allowed, ", "))
		}
		out = append(out, v)
	}
	return out, nil
}

func createTicket(ctx context.Context, tx pgx.Tx, d *deps.Deps, p *auth.Principal, b ticketCreateBody) (domain.Ticket, error) {
	wid := p.WorkspaceID
	actor := actorOf(p)
	nt := domain.NewTicket{WorkspaceID: wid, Subject: b.Subject, Status: b.Status, Priority: b.Priority, Custom: b.Custom}
	if strings.TrimSpace(b.Subject) == "" {
		return domain.Ticket{}, httpx.Validation("subject is required")
	}
	if b.Custom != nil {
		if err := checkCustom(b.Custom); err != nil {
			return domain.Ticket{}, err
		}
	}

	// Contact.
	var contactEmail *string
	switch {
	case b.ContactID != "":
		id, err := hd.ParseRef(b.ContactID, "contact_id")
		if err != nil {
			return domain.Ticket{}, err
		}
		if err := tx.QueryRow(ctx, `SELECT email FROM contacts WHERE workspace_id = $1 AND id = $2`, wid, id).Scan(&contactEmail); err != nil {
			return domain.Ticket{}, httpx.Validation("contact not found in this workspace")
		}
		nt.ContactID = &id
	case b.Contact != nil:
		email, err := cleanEmail(b.Contact.Email)
		if err != nil {
			return domain.Ticket{}, err
		}
		name, err := displayname.Validate("Contact name", b.Contact.Name, displayname.Person, true)
		if err != nil {
			return domain.Ticket{}, err
		}
		id, _, err := domain.UpsertContactByEmail(ctx, tx, wid, email, name)
		if err != nil {
			return domain.Ticket{}, err
		}
		nt.ContactID, contactEmail = &id, &email
	}

	// Channel and mailbox.
	var mailboxEmail, mailboxName string
	if b.MailboxID != "" {
		id, err := hd.ParseRef(b.MailboxID, "mailbox_id")
		if err != nil {
			return domain.Ticket{}, err
		}
		if err := tx.QueryRow(ctx, `SELECT email, display_name FROM mailboxes WHERE workspace_id = $1 AND id = $2`, wid, id).
			Scan(&mailboxEmail, &mailboxName); err != nil {
			return domain.Ticket{}, httpx.Validation("mailbox not found in this workspace")
		}
		nt.MailboxID = &id
	}
	nt.Channel = b.Channel
	if nt.Channel == "" {
		nt.Channel = domain.ChannelAPI
		if nt.MailboxID != nil {
			nt.Channel = domain.ChannelEmail
		}
	}
	kind := b.Kind
	if kind == "" {
		kind = "reply"
	}
	if nt.Channel == domain.ChannelEmail {
		if nt.MailboxID == nil {
			return domain.Ticket{}, httpx.Validation("an email ticket needs mailbox_id")
		}
		if kind == "reply" && (contactEmail == nil || *contactEmail == "") {
			return domain.Ticket{}, httpx.Validation("an email reply needs a contact with an email address")
		}
	}

	if b.AssigneeID != "" {
		id, err := hd.ParseRef(b.AssigneeID, "assignee_id")
		if err != nil {
			return domain.Ticket{}, err
		}
		if err := hd.CheckMember(ctx, tx, wid, id); err != nil {
			return domain.Ticket{}, err
		}
		nt.AssigneeID = &id
	}
	if b.TeamID != "" {
		id, err := hd.ParseRef(b.TeamID, "team_id")
		if err != nil {
			return domain.Ticket{}, err
		}
		if err := hd.CheckRef(ctx, tx, wid, "team", id); err != nil {
			return domain.Ticket{}, err
		}
		nt.TeamID = &id
	}
	cc, err := cleanEmails(b.Cc)
	if err != nil {
		return domain.Ticket{}, err
	}
	bcc, err := cleanEmails(b.Bcc)
	if err != nil {
		return domain.Ticket{}, err
	}
	attIDs, err := hd.ParseAttachmentIDs(b.AttachmentIDs)
	if err != nil {
		return domain.Ticket{}, err
	}
	if err := hd.CheckAttachments(ctx, tx, wid, attIDs, nil); err != nil {
		return domain.Ticket{}, err
	}
	bodyHTML := hd.SanitizeRich(b.BodyHTML)
	bodyText := hd.HTMLToText(bodyHTML)

	t, err := domain.CreateTicket(ctx, tx, nt)
	if err != nil {
		return domain.Ticket{}, err
	}
	if len(b.Tags) > 0 {
		ids, err := hd.EnsureTags(ctx, tx, wid, b.Tags)
		if err != nil {
			return domain.Ticket{}, err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO ticket_tags (ticket_id, tag_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`, t.ID, ids); err != nil {
			return domain.Ticket{}, err
		}
	}

	if bodyText != "" || len(attIDs) > 0 {
		nm := domain.NewMessage{WorkspaceID: wid, TicketID: t.ID, Kind: kind, Direction: "outbound", AuthorType: actor.Type,
			AuthorUserID: actor.UserID, BodyHTML: bodyHTML, BodyText: bodyText, Subject: t.Subject, AttachmentIDs: attIDs,
			Trigger: jobs.TriggerTicketCreated}
		if actor.Type == "api" {
			nm.AuthorType = "api"
		}
		if kind == "reply" && nt.Channel == domain.ChannelEmail {
			nm.To, nm.Cc, nm.Bcc = []string{*contactEmail}, cc, bcc
			nm.FromEmail, nm.FromName = mailboxEmail, mailboxName
			nm.DeliveryStatus = "pending"
		}
		msg, err := domain.AddMessage(ctx, tx, d.Jobs, nm)
		if err != nil {
			return domain.Ticket{}, err
		}
		if kind == "note" {
			if err := notifyMentions(ctx, tx, wid, t.ID, msg, actor.UserID); err != nil {
				return domain.Ticket{}, err
			}
		}
	} else if _, err := d.Jobs.InsertTx(ctx, tx, jobs.TicketTriggerArgs{WorkspaceID: wid, TicketID: t.ID,
		Trigger: jobs.TriggerTicketCreated, ActorUserID: actor.UserID}, nil); err != nil {
		return domain.Ticket{}, fmt.Errorf("queue trigger: %w", err)
	}
	if len(b.Tags) > 0 && (kind != "reply" || bodyText == "") {
		if err := domain.PublishTicketUpdated(ctx, tx, wid, t.ID, []string{"tags"}); err != nil {
			return domain.Ticket{}, err
		}
	}
	if nt.AssigneeID != nil && !sameID(actor.UserID, nt.AssigneeID) {
		if err := hd.Notify(ctx, tx, wid, *nt.AssigneeID, hd.NotifyAssigned, &t.ID,
			map[string]any{"by": idOrNil(actor.UserID), "actor_type": actor.Type}); err != nil {
			return domain.Ticket{}, err
		}
	}
	if nt.Status == domain.StatusSolved {
		if err := requestCSAT(ctx, tx, d, wid, t.ID); err != nil {
			return domain.Ticket{}, err
		}
	}
	return domain.LoadTicket(ctx, tx, wid, t.ID)
}

func deleteTicket(ctx context.Context, tx pgx.Tx, wid, id uuid.UUID) error {
	if _, err := tx.Exec(ctx, `UPDATE tickets SET deleted_at = now(), updated_at = now() WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL`,
		wid, id); err != nil {
		return err
	}
	_, err := events.Publish(ctx, tx, events.Event{WorkspaceID: wid, Type: "ticket.deleted", Data: map[string]any{"ticket_id": id}})
	return err
}

// mergeTickets moves src's messages and tags into dst and closes src.
func mergeTickets(ctx context.Context, tx pgx.Tx, d *deps.Deps, wid, src, dst uuid.UUID, actor Actor) error {
	if src == dst {
		return httpx.Validation("a ticket cannot be merged into itself")
	}
	// Lock in id order so concurrent merges cannot deadlock.
	first, second := src, dst
	if second.String() < first.String() {
		first, second = second, first
	}
	srcState := ticketState{}
	for _, id := range []uuid.UUID{first, second} {
		s, err := lockTicket(ctx, tx, wid, id)
		if err != nil {
			return err
		}
		if id == src {
			srcState = s
		}
	}
	var srcMerged *uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT merged_into_id FROM tickets WHERE workspace_id = $1 AND id = $2`, wid, src).Scan(&srcMerged); err != nil {
		return err
	}
	if srcMerged != nil {
		return httpx.Conflict("this ticket was already merged")
	}
	var dstNumber int64
	var dstMerged *uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT number, merged_into_id FROM tickets WHERE workspace_id = $1 AND id = $2`, wid, dst).Scan(&dstNumber, &dstMerged); err != nil {
		return err
	}
	if dstMerged != nil {
		return httpx.Validation("the target ticket was itself merged; merge into the ticket it was merged into")
	}
	if _, err := tx.Exec(ctx, `UPDATE messages SET ticket_id = $3 WHERE workspace_id = $1 AND ticket_id = $2`, wid, src, dst); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO ticket_tags (ticket_id, tag_id) SELECT $2, tag_id FROM ticket_tags WHERE ticket_id = $1
		ON CONFLICT DO NOTHING`, src, dst); err != nil {
		return err
	}
	// Recompute the target's conversation fields from its messages.
	if _, err := tx.Exec(ctx, `UPDATE tickets t SET
		message_count = s.n, last_message_at = COALESCE(s.last_at, t.last_message_at),
		last_customer_message_at = s.last_customer,
		last_message_preview = COALESCE(s.preview, t.last_message_preview),
		first_responded_at = LEAST(t.first_responded_at, (SELECT first_responded_at FROM tickets WHERE id = $3)),
		updated_at = now()
		FROM (SELECT count(*) FILTER (WHERE kind = 'reply') AS n,
			max(created_at) FILTER (WHERE kind = 'reply') AS last_at,
			max(created_at) FILTER (WHERE kind = 'reply' AND direction = 'inbound') AS last_customer,
			(SELECT left(regexp_replace(body_text, '\s+', ' ', 'g'), 200) FROM messages
				WHERE workspace_id = $1 AND ticket_id = $2 AND kind = 'reply' ORDER BY created_at DESC, id DESC LIMIT 1) AS preview
			FROM messages WHERE workspace_id = $1 AND ticket_id = $2) s
		WHERE t.workspace_id = $1 AND t.id = $2`, wid, dst, src); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE tickets SET merged_into_id = $3, message_count = 0, updated_at = now()
		WHERE workspace_id = $1 AND id = $2`, wid, src, dst); err != nil {
		return err
	}
	closed := domain.StatusClosed
	if _, err := applyPatch(ctx, tx, d, wid, src, actor, Patch{Status: &closed, Snooze: Opt[time.Time]{Set: true, Null: true}}, applyOpts{}); err != nil {
		return err
	}
	if _, err := domain.LogActivity(ctx, tx, wid, src, actor.Type, actor.UserID, "merged",
		map[string]any{"into": dst.String(), "into_number": dstNumber}); err != nil {
		return err
	}
	if _, err := domain.LogActivity(ctx, tx, wid, dst, actor.Type, actor.UserID, "merged",
		map[string]any{"from": src.String(), "from_number": srcState.Number}); err != nil {
		return err
	}
	if err := domain.PublishTicketUpdated(ctx, tx, wid, src, []string{"merged_into", "message_count"}); err != nil {
		return err
	}
	return domain.PublishTicketUpdated(ctx, tx, wid, dst, []string{"messages", "tags", "last_message_at"})
}
