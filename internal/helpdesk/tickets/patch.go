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
}

func (p Patch) empty() bool {
	return p.Subject == nil && p.Status == nil && p.Priority == nil && !p.Assignee.Set && !p.Team.Set && !p.Snooze.Set &&
		p.Spam == nil && p.Tags == nil && len(p.AddTags) == 0 && len(p.RemoveTags) == 0 && p.Custom == nil
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
}

func lockTicket(ctx context.Context, tx pgx.Tx, wid, tid uuid.UUID) (ticketState, error) {
	var s ticketState
	err := tx.QueryRow(ctx, `SELECT number, subject, status, priority, assignee_id, team_id, snoozed_until, spam, custom
		FROM tickets WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`, wid, tid).
		Scan(&s.Number, &s.Subject, &s.Status, &s.Priority, &s.Assignee, &s.Team, &s.Snoozed, &s.Spam, &s.Custom)
	if err != nil {
		if db.IsNotFound(err) {
			return s, httpx.NotFound("Ticket")
		}
		return s, err
	}
	if s.Custom == nil {
		s.Custom = map[string]any{}
	}
	return s, nil
}

// applyOpts controls follow-up work of a patch.
type applyOpts struct {
	// Enqueue queues the ticket_updated trigger (automations do not, to avoid loops).
	Enqueue bool
}

// applyPatch validates and applies p in tx: it logs an activity per change, publishes
// ticket.updated, notifies a new assignee, requests CSAT on solve and queues the
// ticket_updated trigger. It returns the changed field names.
func applyPatch(ctx context.Context, tx pgx.Tx, d *deps.Deps, wid, tid uuid.UUID, actor Actor, p Patch, o applyOpts) ([]string, error) {
	cur, err := lockTicket(ctx, tx, wid, tid)
	if err != nil {
		return nil, err
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

	// Tags: replace, add, remove (by name).
	tagChanged := false
	if p.Tags != nil || len(p.AddTags) > 0 || len(p.RemoveTags) > 0 {
		added, removed, err := applyTags(ctx, tx, wid, tid, p)
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
			snoozed_until = $8, spam = $9, custom = $10,
			solved_at = CASE WHEN $4 IN ('solved', 'closed') THEN COALESCE(solved_at, now()) ELSE NULL END,
			closed_at = CASE WHEN $4 = 'closed' THEN COALESCE(closed_at, now()) ELSE NULL END,
			updated_at = now()
			WHERE workspace_id = $1 AND id = $2`,
			wid, tid, next.Subject, next.Status, next.Priority, next.Assignee, next.Team, next.Snoozed, next.Spam, next.Custom)
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

// applyTags changes the ticket's tags and returns the names added and removed.
func applyTags(ctx context.Context, tx pgx.Tx, wid, tid uuid.UUID, p Patch) (added, removed []string, err error) {
	rows, err := tx.Query(ctx, `SELECT g.id, g.name FROM ticket_tags tt JOIN tags g ON g.id = tt.tag_id
		WHERE tt.ticket_id = $1 AND g.workspace_id = $2`, tid, wid)
	if err != nil {
		return nil, nil, err
	}
	current := map[uuid.UUID]string{}
	for rows.Next() {
		var id uuid.UUID
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			rows.Close()
			return nil, nil, err
		}
		current[id] = name
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}

	want := map[uuid.UUID]bool{}
	if p.Tags != nil {
		if len(*p.Tags) > 50 {
			return nil, nil, httpx.Validation("a ticket can have at most 50 tags")
		}
		ids, err := hd.EnsureTags(ctx, tx, wid, *p.Tags)
		if err != nil {
			return nil, nil, err
		}
		for _, id := range ids {
			want[id] = true
		}
	} else {
		for id := range current {
			want[id] = true
		}
	}
	if len(p.AddTags) > 0 {
		ids, err := hd.EnsureTags(ctx, tx, wid, p.AddTags)
		if err != nil {
			return nil, nil, err
		}
		for _, id := range ids {
			want[id] = true
		}
	}
	for _, name := range p.RemoveTags {
		var id uuid.UUID
		err := tx.QueryRow(ctx, `SELECT id FROM tags WHERE workspace_id = $1 AND lower(name) = lower($2)`, wid, strings.TrimSpace(name)).Scan(&id)
		if err == nil {
			delete(want, id)
		} else if !db.IsNotFound(err) {
			return nil, nil, err
		}
	}
	for id := range want {
		if _, ok := current[id]; ok {
			continue
		}
		if _, err := tx.Exec(ctx, `INSERT INTO ticket_tags (ticket_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, tid, id); err != nil {
			return nil, nil, err
		}
		var name string
		if err := tx.QueryRow(ctx, `SELECT name FROM tags WHERE id = $1`, id).Scan(&name); err != nil {
			return nil, nil, err
		}
		added = append(added, name)
	}
	for id, name := range current {
		if want[id] {
			continue
		}
		if _, err := tx.Exec(ctx, `DELETE FROM ticket_tags WHERE ticket_id = $1 AND tag_id = $2`, tid, id); err != nil {
			return nil, nil, err
		}
		removed = append(removed, name)
	}
	slices.Sort(added)
	slices.Sort(removed)
	return added, removed, nil
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
