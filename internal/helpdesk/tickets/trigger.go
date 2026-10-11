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
	"github.com/riverqueue/river"

	"github.com/opendesk/opendesk/internal/db"
	"github.com/opendesk/opendesk/internal/deps"
	"github.com/opendesk/opendesk/internal/domain"
	"github.com/opendesk/opendesk/internal/helpdesk/hd"
	"github.com/opendesk/opendesk/internal/jobs"
)

// MaxAutomationDepth bounds automation chains: changes made by automations re-run the
// ticket_updated automations in process at most this many times, and each automation
// fires at most once per chain. Automation writes never enqueue triggers.
const MaxAutomationDepth = 3

// TriggerWorker runs helpdesk.ticket_trigger jobs.
type TriggerWorker struct {
	river.WorkerDefaults[jobs.TicketTriggerArgs]
	D *deps.Deps
}

func (w *TriggerWorker) Work(ctx context.Context, job *river.Job[jobs.TicketTriggerArgs]) error {
	return RunTrigger(ctx, w.D, job.Args)
}

// RunTrigger applies SLA policies, automations, auto-assignment and reply
// notifications for one ticket change, in one transaction.
func RunTrigger(ctx context.Context, d *deps.Deps, a jobs.TicketTriggerArgs) error {
	// Auto-triage runs first, outside the trigger transaction (it calls a model), so the
	// ticket_created automations see its tags, priority and sentiment.
	if h := hd.GetAIHooks(); a.Trigger == jobs.TriggerTicketCreated && h != nil && h.AutoTriage != nil {
		if err := h.AutoTriage(ctx, a.WorkspaceID, a.TicketID); err != nil {
			d.Log.Warn("auto triage skipped", "ticket_id", a.TicketID, "err", err)
		}
	}
	return d.DB.Tx(ctx, func(tx pgx.Tx) error {
		t, err := domain.LoadTicket(ctx, tx, a.WorkspaceID, a.TicketID)
		if db.IsNotFound(err) {
			return nil // deleted since
		}
		if err != nil {
			return err
		}
		run := &triggerRun{d: d, tx: tx, wid: a.WorkspaceID, tid: a.TicketID, fired: map[uuid.UUID]bool{}}

		if a.Trigger == jobs.TriggerTicketCreated || (a.Trigger == jobs.TriggerTicketUpdated && slices.Contains(a.Changes, "priority")) {
			if err := applySLA(ctx, tx, a.WorkspaceID, a.TicketID, a.Trigger == jobs.TriggerTicketCreated); err != nil {
				return err
			}
		}
		if !t.Spam {
			if err := run.automations(ctx, a.Trigger, a.MessageID, 0); err != nil {
				return err
			}
		}
		if a.Trigger == jobs.TriggerTicketCreated || a.Trigger == jobs.TriggerCustomerReplied {
			if err := autoAssign(ctx, tx, d, a.WorkspaceID, a.TicketID, a.Trigger); err != nil {
				return err
			}
		}
		if a.Trigger == jobs.TriggerCustomerReplied {
			if err := notifyCustomerReplied(ctx, tx, a.WorkspaceID, a.TicketID, a.MessageID); err != nil {
				return err
			}
		}
		return nil
	})
}

// applySLA picks the first enabled policy for the ticket's priority (or any priority)
// by position and sets the due dates from the ticket's creation.
func applySLA(ctx context.Context, tx pgx.Tx, wid, tid uuid.UUID, created bool) error {
	var priority string
	var createdAt time.Time
	var current *uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT priority, created_at, sla_policy_id FROM tickets WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
		wid, tid).Scan(&priority, &createdAt, &current); err != nil {
		return err
	}
	var policyID *uuid.UUID
	var frMin, resMin int
	var inHours bool
	err := tx.QueryRow(ctx, `SELECT id, first_response_minutes, resolution_minutes, business_hours FROM sla_policies
		WHERE workspace_id = $1 AND enabled AND (priority = $2 OR priority IS NULL)
		ORDER BY position, (priority IS NULL), created_at LIMIT 1`, wid, priority).Scan(&policyID, &frMin, &resMin, &inHours)
	if err != nil && !db.IsNotFound(err) {
		return err
	}
	if policyID == nil && current == nil {
		return nil
	}
	if policyID == nil {
		_, err = tx.Exec(ctx, `UPDATE tickets SET sla_policy_id = NULL, first_response_due_at = NULL, resolution_due_at = NULL,
			sla_first_response_breached_at = NULL, sla_resolution_breached_at = NULL, updated_at = now()
			WHERE workspace_id = $1 AND id = $2`, wid, tid)
	} else {
		fr := createdAt.Add(time.Duration(frMin) * time.Minute)
		res := createdAt.Add(time.Duration(resMin) * time.Minute)
		if inHours {
			st, err := hd.LoadSettings(ctx, tx, wid)
			if err != nil {
				return err
			}
			bh, loc := st.Hours(), st.Location()
			fr, res = bh.AddBusinessMinutes(createdAt, frMin, loc), bh.AddBusinessMinutes(createdAt, resMin, loc)
		}
		_, err = tx.Exec(ctx, `UPDATE tickets SET sla_policy_id = $3, first_response_due_at = $4, resolution_due_at = $5,
			sla_first_response_breached_at = CASE WHEN $4 > now() THEN NULL ELSE sla_first_response_breached_at END,
			sla_resolution_breached_at = CASE WHEN $5 > now() THEN NULL ELSE sla_resolution_breached_at END,
			updated_at = now() WHERE workspace_id = $1 AND id = $2`, wid, tid, *policyID, fr, res)
	}
	if err != nil {
		return err
	}
	return domain.PublishTicketUpdated(ctx, tx, wid, tid, []string{"sla"})
}

type automation struct {
	ID         uuid.UUID
	Name       string
	Conditions []hd.Condition
	Actions    []hd.Action
}

type triggerRun struct {
	d     *deps.Deps
	tx    pgx.Tx
	wid   uuid.UUID
	tid   uuid.UUID
	fired map[uuid.UUID]bool
	defs  map[string]domain.FieldDefs
}

// automations evaluates the enabled automations for trigger in position order.
func (r *triggerRun) automations(ctx context.Context, trigger string, messageID *uuid.UUID, depth int) error {
	if depth > MaxAutomationDepth {
		return nil
	}
	rows, err := r.tx.Query(ctx, `SELECT id, name, conditions, actions FROM automations
		WHERE workspace_id = $1 AND trigger = $2 AND enabled ORDER BY position, created_at`, r.wid, trigger)
	if err != nil {
		return err
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (automation, error) {
		var a automation
		var conds, acts []byte
		if err := row.Scan(&a.ID, &a.Name, &conds, &acts); err != nil {
			return a, err
		}
		_ = json.Unmarshal(conds, &a.Conditions)
		_ = json.Unmarshal(acts, &a.Actions)
		return a, nil
	})
	if err != nil || len(list) == 0 {
		return err
	}
	var changed []string
	for _, a := range list {
		if r.fired[a.ID] {
			continue
		}
		facts, err := r.facts(ctx, messageID)
		if err != nil {
			return err
		}
		if facts.spam || !matchAll(a.Conditions, facts) {
			continue
		}
		r.fired[a.ID] = true
		c, err := r.apply(ctx, a, facts)
		if err != nil {
			return err
		}
		changed = append(changed, c...)
		if _, err := r.tx.Exec(ctx, `UPDATE automations SET run_count = run_count + 1 WHERE workspace_id = $1 AND id = $2`, r.wid, a.ID); err != nil {
			return err
		}
	}
	if len(changed) == 0 {
		return nil
	}
	if slices.Contains(changed, "priority") {
		if err := applySLA(ctx, r.tx, r.wid, r.tid, false); err != nil {
			return err
		}
	}
	return r.automations(ctx, jobs.TriggerTicketUpdated, messageID, depth+1)
}

// facts is what conditions are evaluated against.
type facts struct {
	subject, body, fromEmail, channel, mailboxID, priority, status string
	sentiment                                                      string
	tags                                                           []string
	spam                                                           bool
	contactEmail                                                   *string
	fields, contactFields                                          map[string]any
	defs                                                           map[string]domain.FieldDefs // by entity
}

func (r *triggerRun) facts(ctx context.Context, messageID *uuid.UUID) (facts, error) {
	var f facts
	var mailbox *uuid.UUID
	err := r.tx.QueryRow(ctx, `SELECT t.subject, t.channel, t.mailbox_id, t.priority, t.status, t.spam, c.email,
		COALESCE(t.custom->>'ai_sentiment', ''),
		COALESCE((SELECT array_agg(g.name) FROM ticket_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.ticket_id = t.id), '{}'),
		t.fields, COALESCE(c.fields, '{}')
		FROM tickets t LEFT JOIN contacts c ON c.id = t.contact_id AND c.workspace_id = t.workspace_id
		WHERE t.workspace_id = $1 AND t.id = $2`, r.wid, r.tid).
		Scan(&f.subject, &f.channel, &mailbox, &f.priority, &f.status, &f.spam, &f.contactEmail, &f.sentiment, &f.tags,
			&f.fields, &f.contactFields)
	if err != nil {
		return f, err
	}
	if r.defs == nil {
		r.defs = map[string]domain.FieldDefs{}
		for _, e := range []string{domain.FieldEntityTicket, domain.FieldEntityContact} {
			if r.defs[e], err = domain.LoadFieldDefs(ctx, r.tx, r.wid, e); err != nil {
				return f, err
			}
		}
	}
	f.defs = r.defs
	if mailbox != nil {
		f.mailboxID = mailbox.String()
	}
	// The body and sender are the triggering message's, else the latest customer message.
	var body, from string
	q := `SELECT body_text, from_email FROM messages WHERE workspace_id = $1 AND ticket_id = $2 AND id = $3`
	args := []any{r.wid, r.tid, messageID}
	if messageID == nil {
		q = `SELECT body_text, from_email FROM messages WHERE workspace_id = $1 AND ticket_id = $2 AND kind = 'reply'
			ORDER BY (direction = 'inbound') DESC, created_at DESC LIMIT 1`
		args = args[:2]
	}
	if err := r.tx.QueryRow(ctx, q, args...).Scan(&body, &from); err != nil && !db.IsNotFound(err) {
		return f, err
	}
	f.body, f.fromEmail = body, from
	if f.fromEmail == "" && f.contactEmail != nil {
		f.fromEmail = *f.contactEmail
	}
	return f, nil
}

// matchAll reports whether every condition holds (an empty list always matches).
func matchAll(cs []hd.Condition, f facts) bool {
	for _, c := range cs {
		if !match(c, f) {
			return false
		}
	}
	return true
}

func match(c hd.Condition, f facts) bool {
	if entity, key, ok := hd.ConditionFieldKey(c.Field); ok {
		def, ok := f.defs[entity][key]
		if !ok {
			return false // the field was deleted since the automation was saved
		}
		values := f.fields
		if entity == domain.FieldEntityContact {
			values = f.contactFields
		}
		return domain.MatchField(def, domain.NormalizeOp(c.Op), c.Value, values[key])
	}
	if c.Field == "tag" {
		if c.Op == "not_contains" || c.Op == "not_equals" {
			// "tag not_equals x" holds when no tag equals x.
			for _, t := range f.tags {
				if !compare(c.Op, t, c.Value) {
					return false
				}
			}
			return true
		}
		for _, t := range f.tags {
			if compare(c.Op, t, c.Value) {
				return true
			}
		}
		return false
	}
	var v string
	switch c.Field {
	case "subject":
		v = f.subject
	case "body":
		v = f.body
	case "from_email":
		v = f.fromEmail
	case "channel":
		v = f.channel
	case "mailbox_id":
		v = f.mailboxID
	case "priority":
		v = f.priority
	case "status":
		v = f.status
	case "sentiment":
		v = f.sentiment
	default:
		return false
	}
	return compare(c.Op, v, c.Value)
}

func compare(op, have, want string) bool {
	h, w := strings.ToLower(strings.TrimSpace(have)), strings.ToLower(strings.TrimSpace(want))
	switch op {
	case "contains":
		return strings.Contains(h, w)
	case "not_contains":
		return !strings.Contains(h, w)
	case "equals":
		return h == w
	case "not_equals":
		return h != w
	}
	return false
}

// apply runs an automation's actions, attributed to the automation, and returns the
// ticket fields it changed.
func (r *triggerRun) apply(ctx context.Context, a automation, f facts) ([]string, error) {
	actor := Actor{Type: "automation", Meta: map[string]any{"automation_id": a.ID.String(), "automation_name": a.Name}}
	var patch Patch
	var changed []string
	for _, act := range a.Actions {
		switch act.Type {
		case "set_status":
			v := act.Value
			patch.Status = &v
		case "set_priority":
			v := act.Value
			patch.Priority = &v
		case "assign_user":
			id, err := uuid.Parse(act.Value)
			if err != nil {
				continue
			}
			// A member removed since the automation was saved is skipped.
			if hd.CheckMember(ctx, r.tx, r.wid, id) != nil {
				continue
			}
			patch.Assignee = Opt[uuid.UUID]{Set: true, Value: id}
		case "assign_team":
			id, err := uuid.Parse(act.Value)
			if err != nil || hd.CheckRef(ctx, r.tx, r.wid, "team", id) != nil {
				continue
			}
			patch.Team = Opt[uuid.UUID]{Set: true, Value: id}
		case "add_tag":
			patch.AddTags = append(patch.AddTags, act.Value)
			patch.CreateLabels = true
		case "set_field":
			def, ok := f.defs[domain.FieldEntityTicket][act.Field]
			if !ok || def.Archived {
				continue // removed or archived since the automation was saved
			}
			v, err := domain.ParseFieldString(def, act.Value, domain.MemberChecker(ctx, r.tx, r.wid))
			if err != nil {
				continue
			}
			if patch.Fields == nil {
				patch.Fields = map[string]any{}
			}
			patch.Fields[act.Field] = v
		case "remove_tag":
			patch.RemoveTags = append(patch.RemoveTags, act.Value)
		case "mark_spam":
			v := act.Value != "false"
			patch.Spam = &v
		case "send_reply", "add_note":
			if err := r.addMessage(ctx, act, f); err != nil {
				return nil, err
			}
			changed = append(changed, "messages")
		case "ai_triage":
			// The hook skips (nil, nil) when AI is off, out of credits or unavailable; an
			// error is a database failure of this transaction.
			if h := hd.GetAIHooks(); h != nil && h.Triage != nil {
				c, err := h.Triage(ctx, r.tx, r.wid, r.tid)
				if err != nil {
					return nil, fmt.Errorf("automation %s: ai_triage: %w", a.ID, err)
				}
				changed = append(changed, c...)
			}
		}
	}
	if !patch.empty() {
		c, err := applyPatch(ctx, r.tx, r.d, r.wid, r.tid, actor, patch, applyOpts{Lenient: true})
		if err != nil {
			return nil, fmt.Errorf("automation %s: %w", a.ID, err)
		}
		changed = append(changed, c...)
	}
	// Messages alone do not re-run ticket_updated automations.
	var fields []string
	for _, c := range changed {
		if c != "messages" {
			fields = append(fields, c)
		}
	}
	return fields, nil
}

func (r *triggerRun) addMessage(ctx context.Context, act hd.Action, f facts) error {
	html := hd.SanitizeRich(act.Value)
	text := hd.HTMLToText(html)
	if text == "" {
		return nil
	}
	kind := "note"
	if act.Type == "send_reply" {
		kind = "reply"
	}
	nm := domain.NewMessage{WorkspaceID: r.wid, TicketID: r.tid, Kind: kind, Direction: "outbound", AuthorType: "system",
		BodyHTML: html, BodyText: text, Subject: replySubject(f.subject), Trigger: "none"}
	if kind == "reply" && f.channel == domain.ChannelEmail {
		if f.contactEmail == nil || *f.contactEmail == "" {
			return nil
		}
		var mbEmail, mbName *string
		_ = r.tx.QueryRow(ctx, `SELECT mb.email, mb.display_name FROM tickets t JOIN mailboxes mb ON mb.id = t.mailbox_id
			WHERE t.workspace_id = $1 AND t.id = $2`, r.wid, r.tid).Scan(&mbEmail, &mbName)
		nm.To = []string{*f.contactEmail}
		nm.FromEmail, nm.FromName = str(mbEmail), str(mbName)
		nm.DeliveryStatus = "pending"
	}
	_, err := domain.AddMessage(ctx, r.tx, r.d.Jobs, nm)
	return err
}

// Assignment modes (settings.auto_assign and assignment_rules.mode).
const (
	AssignNone         = "none"
	AssignRoundRobin   = "round_robin"
	AssignLoadBalanced = "load_balanced"
)

// resolveAssignMode picks the mode for a ticket: its team's rule, else its mailbox's
// rule, else the workspace default.
func resolveAssignMode(ctx context.Context, q pgx.Tx, wid uuid.UUID, team, mailbox *uuid.UUID, def string) (string, error) {
	if team != nil || mailbox != nil {
		var mode string
		err := q.QueryRow(ctx, `SELECT mode FROM assignment_rules WHERE workspace_id = $1 AND (team_id = $2 OR mailbox_id = $3)
			ORDER BY (team_id IS NULL) LIMIT 1`, wid, team, mailbox).Scan(&mode)
		if err == nil {
			return mode, nil
		}
		if !db.IsNotFound(err) {
			return "", err
		}
	}
	if def == AssignRoundRobin || def == AssignLoadBalanced {
		return def, nil
	}
	return AssignNone, nil
}

// autoAssign assigns an unassigned open ticket by the mode that applies to it
// (contracts/api.md "Assignment"). After Jev triaged a new ticket and the workspace
// turned assign_after_triage on, the assignment is attributed to ai.
func autoAssign(ctx context.Context, tx pgx.Tx, d *deps.Deps, wid, tid uuid.UUID, trigger string) error {
	s, err := hd.LoadSettings(ctx, tx, wid)
	if err != nil {
		return err
	}
	var assignee, team, mailbox *uuid.UUID
	var status string
	var spam bool
	var custom map[string]any
	if err := tx.QueryRow(ctx, `SELECT assignee_id, team_id, mailbox_id, status, spam, custom FROM tickets
		WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`, wid, tid).
		Scan(&assignee, &team, &mailbox, &status, &spam, &custom); err != nil {
		if db.IsNotFound(err) {
			return nil
		}
		return err
	}
	if assignee != nil || spam || status == domain.StatusSolved || status == domain.StatusClosed {
		return nil
	}
	mode, err := resolveAssignMode(ctx, tx, wid, team, mailbox, s.AutoAssign)
	if err != nil {
		return err
	}
	actor := Actor{Type: "system", Meta: map[string]any{"via": mode}}
	if tc := s.Triage(); trigger == jobs.TriggerTicketCreated && tc.AutoTriage && tc.AssignAfterTriage && s.AI().Enabled {
		if _, triaged := custom["ai_triaged_at"]; triaged {
			if mode == AssignNone {
				mode = AssignLoadBalanced
			}
			actor = Actor{Type: "ai", Meta: map[string]any{"via": "triage", "mode": mode}}
		}
	}
	if mode == AssignNone {
		return nil
	}
	pool := team
	if pool == nil && mailbox != nil {
		var mbTeam *uuid.UUID
		if err := tx.QueryRow(ctx, `SELECT team_id FROM mailboxes WHERE workspace_id = $1 AND id = $2`, wid, *mailbox).Scan(&mbTeam); err != nil && !db.IsNotFound(err) {
			return err
		}
		pool = mbTeam
	}
	next, err := PickAssignee(ctx, tx, wid, pool, mode)
	if err != nil || next == nil {
		return err
	}
	_, err = applyPatch(ctx, tx, d, wid, tid, actor, Patch{Assignee: Opt[uuid.UUID]{Set: true, Value: *next}}, applyOpts{})
	return err
}

type candidate struct {
	ID   uuid.UUID
	Open int
}

// PickAssignee chooses the next agent of a pool (a team, or the whole workspace) and
// moves the pool's cursor. Eligible: owners, admins and agents whose presence is
// online and who are under their open ticket cap. nil when nobody is eligible.
func PickAssignee(ctx context.Context, tx pgx.Tx, wid uuid.UUID, team *uuid.UUID, mode string) (*uuid.UUID, error) {
	key := "workspace"
	q := `SELECT m.user_id, ` + domain.OpenTicketsSQL + ` FROM members m JOIN users u ON u.id = m.user_id JOIN workspaces w ON w.id = m.workspace_id
		WHERE m.workspace_id = $1 AND m.role IN ('owner','admin','agent') AND ` + domain.PresenceSQL + ` = 'online'
		AND (m.max_open_tickets IS NULL OR ` + domain.OpenTicketsSQL + ` < m.max_open_tickets)`
	args := []any{wid}
	if team != nil {
		key = "team:" + team.String()
		q += ` AND EXISTS (SELECT 1 FROM team_members tm JOIN teams tt ON tt.id = tm.team_id
			WHERE tm.user_id = m.user_id AND tm.team_id = $2 AND tt.workspace_id = $1)`
		args = append(args, *team)
	}
	rows, err := tx.Query(ctx, q+` ORDER BY m.user_id`, args...)
	if err != nil {
		return nil, err
	}
	cands, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (candidate, error) {
		var c candidate
		return c, r.Scan(&c.ID, &c.Open)
	})
	if err != nil || len(cands) == 0 {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO round_robin_cursors (workspace_id, pool) VALUES ($1, $2) ON CONFLICT DO NOTHING`, wid, key); err != nil {
		return nil, err
	}
	var last *uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT last_user_id FROM round_robin_cursors WHERE workspace_id = $1 AND pool = $2 FOR UPDATE`, wid, key).Scan(&last); err != nil {
		return nil, err
	}
	next := chooseCandidate(cands, last, mode)
	if _, err := tx.Exec(ctx, `UPDATE round_robin_cursors SET last_user_id = $3, updated_at = now() WHERE workspace_id = $1 AND pool = $2`,
		wid, key, next); err != nil {
		return nil, err
	}
	return &next, nil
}

// chooseCandidate applies a mode to candidates sorted by id: round robin takes the
// first after last; load balanced takes the fewest open tickets, ties in round robin
// order.
func chooseCandidate(cands []candidate, last *uuid.UUID, mode string) uuid.UUID {
	start := 0
	if last != nil {
		for i, c := range cands {
			if c.ID.String() > last.String() {
				start = i
				break
			}
			if i == len(cands)-1 {
				start = 0
			}
		}
	}
	order := append(append([]candidate{}, cands[start:]...), cands[:start]...)
	if mode != AssignLoadBalanced {
		return order[0].ID
	}
	best := order[0]
	for _, c := range order[1:] {
		if c.Open < best.Open {
			best = c
		}
	}
	return best.ID
}

func notifyCustomerReplied(ctx context.Context, tx pgx.Tx, wid, tid uuid.UUID, messageID *uuid.UUID) error {
	var assignee *uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT assignee_id FROM tickets WHERE workspace_id = $1 AND id = $2`, wid, tid).Scan(&assignee); err != nil {
		return err
	}
	if assignee == nil {
		return nil
	}
	data := map[string]any{}
	if messageID != nil {
		var preview string
		if err := tx.QueryRow(ctx, `SELECT body_text FROM messages WHERE workspace_id = $1 AND id = $2`, wid, *messageID).Scan(&preview); err == nil {
			data["message_id"] = messageID.String()
			data["preview"] = hd.Excerpt(preview, 140)
		}
	}
	var cid uuid.UUID
	var cname string
	if err := tx.QueryRow(ctx, `SELECT c.id, c.name FROM tickets t JOIN contacts c ON c.id = t.contact_id AND c.workspace_id = t.workspace_id
		WHERE t.workspace_id = $1 AND t.id = $2`, wid, tid).Scan(&cid, &cname); err == nil {
		data["contact"] = map[string]any{"id": cid.String(), "name": cname}
	}
	return hd.Notify(ctx, tx, wid, *assignee, hd.NotifyCustomerReplied, &tid, data)
}
