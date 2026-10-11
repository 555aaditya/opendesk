package tickets

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/opendesk/opendesk/internal/auth"
	"github.com/opendesk/opendesk/internal/db"
	"github.com/opendesk/opendesk/internal/deps"
	"github.com/opendesk/opendesk/internal/domain"
	"github.com/opendesk/opendesk/internal/helpdesk/hd"
	"github.com/opendesk/opendesk/internal/httpx"
	"github.com/opendesk/opendesk/internal/jobs"
)

// Actor is who a change is attributed to on the timeline.
type Actor struct {
	Type   string // user | api | automation | system | contact
	UserID *uuid.UUID
	// Meta is merged into each activity's data (the automation that acted).
	Meta map[string]any
}

func actorOf(p *auth.Principal) Actor {
	if p.Kind == auth.KindUser && p.Assistant {
		uid := p.UserID
		return Actor{Type: "ai", UserID: &uid}
	}
	if p.Kind == auth.KindUser {
		uid := p.UserID
		return Actor{Type: "user", UserID: &uid}
	}
	return Actor{Type: "api"}
}

var systemActor = Actor{Type: "system"}

// Patch is a set of ticket changes. Nil and unset fields are left alone.
type Patch struct {
	Subject    *string
	Status     *string
	Priority   *string
	Assignee   Opt[uuid.UUID]
	Team       Opt[uuid.UUID]
	Snooze     Opt[time.Time]
	Spam       *bool
	Tags       *[]string // replaces the tag set, by name
	AddTags    []string
	RemoveTags []string
	Custom     map[string]any // shallow merge; a null value removes the key
	Fields     map[string]any // custom field values, merged; null clears
	// CreateLabels lets AddTags/Tags create missing labels (settings.label_creation).
	CreateLabels bool
}

func (p Patch) empty() bool {
	return p.Subject == nil && p.Status == nil && p.Priority == nil && !p.Assignee.Set && !p.Team.Set && !p.Snooze.Set &&
		p.Spam == nil && p.Tags == nil && len(p.AddTags) == 0 && len(p.RemoveTags) == 0 && p.Custom == nil && p.Fields == nil
}

type ticketState struct {
	Number   int64
	Subject  string
	Status   string
	Priority string
	Assignee *uuid.UUID
	Team     *uuid.UUID
	Snoozed  *time.Time
	Spam     bool
	Custom   map[string]any
	Fields   map[string]any
}

func lockTicket(ctx context.Context, tx pgx.Tx, wid, tid uuid.UUID) (ticketState, error) {
	var s ticketState
	err := tx.QueryRow(ctx, `SELECT number, subject, status, priority, assignee_id, team_id, snoozed_until, spam, custom, fields
		FROM tickets WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`, wid, tid).
		Scan(&s.Number, &s.Subject, &s.Status, &s.Priority, &s.Assignee, &s.Team, &s.Snoozed, &s.Spam, &s.Custom, &s.Fields)
	if err != nil {
		if db.IsNotFound(err) {
			return s, httpx.NotFound("Ticket")
		}
		return s, err
	}
	if s.Custom == nil {
		s.Custom = map[string]any{}
	}
	if s.Fields == nil {
		s.Fields = map[string]any{}
	}
	return s, nil
}

// applyOpts controls follow-up work of a patch.
type applyOpts struct {
	// Enqueue queues the ticket_updated trigger (automations do not, to avoid loops).
	Enqueue bool
	// RequireFields refuses solving or closing while a required_on_solve field is empty
	// (people and API keys; automations, merges and system jobs are not held back).
	RequireFields bool
	// Lenient skips unknown or not applicable labels and archived or removed fields
	// instead of refusing (automations).
	Lenient bool
}

// applyPatch validates and applies p in tx: it logs an activity per change, publishes
// ticket.updated, notifies a new assignee, requests CSAT on solve and queues the
// ticket_updated trigger. It returns the changed field names.
func applyPatch(ctx context.Context, tx pgx.Tx, d *deps.Deps, wid, tid uuid.UUID, actor Actor, p Patch, o applyOpts) ([]string, error) {
	cur, err := lockTicket(ctx, tx, wid, tid)
	if err != nil {
		return nil, err
	}
	// Snoozing puts the ticket on hold; any other status ends the snooze, so a solved
	// or reopened ticket is not woken up later.
	if p.Snooze.Set && !p.Snooze.Null && p.Status == nil {
		onHold := domain.StatusOnHold
		p.Status = &onHold
	}
	if p.Status != nil && *p.Status != domain.StatusOnHold && !p.Snooze.Set && cur.Snoozed != nil {
		p.Snooze = Opt[time.Time]{Set: true, Null: true}
	}
	next := cur
	var changes []string
	type act struct {
		typ  string
		data map[string]any
	}
	var acts []act

	if p.Subject != nil {
		s := strings.Join(strings.Fields(*p.Subject), " ")
		if s == "" {
			return nil, httpx.Validation("subject is required")
		}
		s = hd.Truncate(s, 500)
		if s != cur.Subject {
			next.Subject = s
			changes = append(changes, "subject")
			acts = append(acts, act{"subject_changed", map[string]any{"from": cur.Subject, "to": s}})
		}
	}
	if p.Status != nil {
		if !slices.Contains(domain.Statuses, *p.Status) {
			return nil, httpx.Validation("status must be one of " + strings.Join(domain.Statuses, ", "))
		}
		if *p.Status != cur.Status {
			next.Status = *p.Status
			changes = append(changes, "status")
			acts = append(acts, act{"status_changed", map[string]any{"from": cur.Status, "to": *p.Status}})
		}
	}
	if p.Priority != nil {
		if !slices.Contains(domain.Priorities, *p.Priority) {
			return nil, httpx.Validation("priority must be one of " + strings.Join(domain.Priorities, ", "))
		}
		if *p.Priority != cur.Priority {
			next.Priority = *p.Priority
			changes = append(changes, "priority")
			acts = append(acts, act{"priority_changed", map[string]any{"from": cur.Priority, "to": *p.Priority}})
		}
	}
	if p.Assignee.Set {
		to := p.Assignee.Ptr()
		if to != nil {
			if err := hd.CheckMember(ctx, tx, wid, *to); err != nil {
				return nil, err
			}
		}
		if !sameID(cur.Assignee, to) {
			next.Assignee = to
			changes = append(changes, "assignee_id")
			acts = append(acts, act{"assigned", map[string]any{"from": idOrNil(cur.Assignee), "to": idOrNil(to)}})
		}
	}
	if p.Team.Set {
		to := p.Team.Ptr()
		if to != nil {
			if err := hd.CheckRef(ctx, tx, wid, "team", *to); err != nil {
				return nil, err
			}
		}
		if !sameID(cur.Team, to) {
			next.Team = to
			changes = append(changes, "team_id")
			acts = append(acts, act{"team_changed", map[string]any{"from": idOrNil(cur.Team), "to": idOrNil(to)}})
		}
	}
	if p.Snooze.Set {
		to := p.Snooze.Ptr()
		if to != nil {
			if to.Before(time.Now().Add(-time.Minute)) {
				return nil, httpx.Validation("snoozed_until must be in the future")
			}
			u := to.UTC()
			to = &u
		}
		if !sameTime(cur.Snoozed, to) {
			next.Snoozed = to
			changes = append(changes, "snoozed_until")
			if to != nil {
				acts = append(acts, act{"snoozed", map[string]any{"until": to.Format(time.RFC3339)}})
			} else {
				acts = append(acts, act{"unsnoozed", map[string]any{}})
			}
		}
	}
	if p.Spam != nil && *p.Spam != cur.Spam {
		next.Spam = *p.Spam
		changes = append(changes, "spam")
		if *p.Spam {
			acts = append(acts, act{"marked_spam", map[string]any{}})
		} else {
			acts = append(acts, act{"unmarked_spam", map[string]any{}})
		}
	}
	if p.Custom != nil {
		merged := map[string]any{}
		for k, v := range cur.Custom {
			merged[k] = v
		}
		var keys []string
		for k, v := range p.Custom {
			k = strings.TrimSpace(k)
			if k == "" || len(k) > 64 {
				return nil, httpx.Validation("custom keys must be 1..64 characters")
			}
			keys = append(keys, k)
			if v == nil {
				delete(merged, k)
			} else {
				merged[k] = v
			}
		}
		raw, _ := json.Marshal(merged)
		if len(merged) > 50 || len(raw) > 16<<10 {
			return nil, httpx.Validation("custom fields are limited to 50 keys and 16 KB")
		}
		old, _ := json.Marshal(cur.Custom)
		if string(old) != string(raw) {
			next.Custom = merged
			slices.Sort(keys)
			changes = append(changes, "custom")
			acts = append(acts, act{"custom_updated", map[string]any{"keys": keys}})
		}
	}

	var defs domain.FieldDefs
	if p.Fields != nil || (o.RequireFields && p.Status != nil && closing(next.Status) && !closing(cur.Status)) {
		if defs, err = domain.LoadFieldDefs(ctx, tx, wid, domain.FieldEntityTicket); err != nil {
			return nil, err
		}
	}
	if p.Fields != nil {
		patch := p.Fields
		if o.Lenient {
			patch = map[string]any{}
			for k, v := range p.Fields {
				if f, ok := defs[k]; ok && !f.Archived {
					patch[k] = v
				}
			}
		}
		merged, fc, err := domain.MergeFields(defs, cur.Fields, patch, domain.MemberChecker(ctx, tx, wid))
		if err != nil {
			return nil, err
		}
		if len(fc) > 0 {
			next.Fields = merged
			changes = append(changes, "fields")
			for _, c := range fc {
				acts = append(acts, act{"field_changed", map[string]any{"key": c.Key, "name": c.Name, "from": c.From, "to": c.To}})
			}
		}
	}
	if o.RequireFields && p.Status != nil && closing(next.Status) && !closing(cur.Status) {
		if err := domain.CheckRequiredOnSolve(defs, next.Fields); err != nil {
			return nil, err
		}
	}

	// Tags: replace, add, remove (by name).
	tagChanged := false
	if p.Tags != nil || len(p.AddTags) > 0 || len(p.RemoveTags) > 0 {
		added, removed, err := domain.ApplyTags(ctx, tx, wid, domain.TicketLabels, tid, domain.TagOps{Replace: p.Tags,
			Add: p.AddTags, Remove: p.RemoveTags, Create: p.CreateLabels, Lenient: o.Lenient})
		if err != nil {
			return nil, err
		}
		for _, n := range added {
			acts = append(acts, act{"tagged", map[string]any{"tag": n}})
		}
		for _, n := range removed {
			acts = append(acts, act{"untagged", map[string]any{"tag": n}})
		}
		if len(added)+len(removed) > 0 {
			tagChanged = true
			changes = append(changes, "tags")
		}
	}

	if len(changes) == 0 {
		return nil, nil
	}
	if len(changes) > 1 || !tagChanged {
		_, err = tx.Exec(ctx, `UPDATE tickets SET subject = $3, status = $4, priority = $5, assignee_id = $6, team_id = $7,
			snoozed_until = $8, spam = $9, custom = $10, fields = $11,
			solved_at = CASE WHEN $4 IN ('solved', 'closed') THEN COALESCE(solved_at, now()) ELSE NULL END,
			closed_at = CASE WHEN $4 = 'closed' THEN COALESCE(closed_at, now()) ELSE NULL END,
			updated_at = now()
			WHERE workspace_id = $1 AND id = $2`,
			wid, tid, next.Subject, next.Status, next.Priority, next.Assignee, next.Team, next.Snoozed, next.Spam, next.Custom, next.Fields)
	} else {
		_, err = tx.Exec(ctx, `UPDATE tickets SET updated_at = now() WHERE workspace_id = $1 AND id = $2`, wid, tid)
	}
	if err != nil {
		return nil, fmt.Errorf("update ticket: %w", err)
	}
	for _, a := range acts {
		for k, v := range actor.Meta {
			a.data[k] = v
		}
		if _, err := domain.LogActivity(ctx, tx, wid, tid, actor.Type, actor.UserID, a.typ, a.data); err != nil {
			return nil, err
		}
	}
	if err := domain.PublishTicketUpdated(ctx, tx, wid, tid, changes); err != nil {
		return nil, err
	}
	if slices.Contains(changes, "assignee_id") && next.Assignee != nil && !sameID(actor.UserID, next.Assignee) {
		data := map[string]any{"by": idOrNil(actor.UserID), "actor_type": actor.Type}
		if err := hd.Notify(ctx, tx, wid, *next.Assignee, hd.NotifyAssigned, &tid, data); err != nil {
			return nil, err
		}
	}
	if slices.Contains(changes, "status") && next.Status == domain.StatusSolved {
		if err := requestCSAT(ctx, tx, d, wid, tid); err != nil {
			return nil, err
		}
		if err := hd.EnqueueAIEmbed(ctx, tx, d.Jobs, d.Cfg, wid, "ticket", tid); err != nil {
			return nil, err
		}
	}
	if o.Enqueue {
		if _, err := d.Jobs.InsertTx(ctx, tx, jobs.TicketTriggerArgs{WorkspaceID: wid, TicketID: tid, Trigger: jobs.TriggerTicketUpdated,
			ActorUserID: actor.UserID, Changes: changes}, nil); err != nil {
			return nil, fmt.Errorf("queue trigger: %w", err)
		}
	}
	return changes, nil
}

// closing reports a solved or closed status.
func closing(status string) bool {
	return status == domain.StatusSolved || status == domain.StatusClosed
}

func sameID(a, b *uuid.UUID) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func sameTime(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return a.Equal(*b)
}

func idOrNil(id *uuid.UUID) any {
	if id == nil {
		return nil
	}
	return id.String()
}
