package resources_test

import (
	"slices"
	"strings"
	"testing"

	"github.com/opendesk/opendesk/internal/helpdesk/hdtest"
	"github.com/opendesk/opendesk/internal/helpdesk/resources"
	"github.com/opendesk/opendesk/internal/ids"
)

type page[T any] struct {
	Data       []T     `json:"data"`
	NextCursor *string `json:"next_cursor"`
}

type tag struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func TestTags(t *testing.T) {
	e := hdtest.New(t, resources.Register)
	ws := e.NewWorkspace()
	other := e.NewWorkspace()
	a := ws.Agent.As(ws)

	var bug tag
	e.Do("POST", "/v1/tags", a, map[string]any{"name": "  bug  "}).Want(t, 201).JSON(t, &bug)
	if bug.Name != "bug" {
		t.Fatal(bug)
	}
	e.Do("POST", "/v1/tags", a, map[string]any{"name": "BUG"}).Want(t, 409)
	e.Do("POST", "/v1/tags", a, map[string]any{"name": "<b>x</b>"}).Want(t, 422)
	e.Do("POST", "/v1/tags", a, map[string]any{"name": ""}).Want(t, 422)
	e.Do("POST", "/v1/tags", ws.Viewer.As(ws), map[string]any{"name": "nope"}).Want(t, 403)
	var vip tag
	e.Do("POST", "/v1/tags", a, map[string]any{"name": "VIP"}).Want(t, 201).JSON(t, &vip)

	var p page[tag]
	e.Do("GET", "/v1/tags", ws.Viewer.As(ws), nil).Want(t, 200).JSON(t, &p)
	if len(p.Data) != 2 || p.Data[0].Name != "bug" || p.NextCursor != nil {
		t.Fatalf("list %+v", p)
	}
	e.Do("PATCH", "/v1/tags/"+vip.ID, a, map[string]any{"name": "Bug"}).Want(t, 409)
	e.Do("PATCH", "/v1/tags/"+vip.ID, a, map[string]any{"name": "vip"}).Want(t, 200)
	e.Do("PATCH", "/v1/tags/"+vip.ID, other.Owner.As(other), map[string]any{"name": "x"}).Want(t, 404)
	e.Do("DELETE", "/v1/tags/"+vip.ID, other.Owner.As(other), nil).Want(t, 404)

	// Delete cascades to tickets.
	tid := ids.New()
	e.Exec(`INSERT INTO tickets (id, workspace_id, number, channel) VALUES ($1, $2, 1, 'api')`, tid, ws.ID)
	e.Exec(`INSERT INTO ticket_tags (ticket_id, tag_id) VALUES ($1, $2)`, tid, bug.ID)
	e.Do("DELETE", "/v1/tags/"+bug.ID, a, nil).Want(t, 204)
	var n int
	e.Scalar(`SELECT count(*) FROM ticket_tags WHERE ticket_id = $1`, &n, tid)
	if n != 0 {
		t.Fatal("ticket_tags kept")
	}

	key := e.APIKey(ws, "tickets:read")
	e.Do("GET", "/v1/tags", hdtest.Auth{Bearer: key}, nil).Want(t, 200)
	e.Do("POST", "/v1/tags", hdtest.Auth{Bearer: key}, map[string]any{"name": "k"}).Want(t, 403)
	e.Do("POST", "/v1/tags", hdtest.Auth{Bearer: e.APIKey(ws, "tickets:write")}, map[string]any{"name": "k"}).Want(t, 201)

	types, _ := e.Events(ws.ID, 0)
	for _, w := range []string{"tag.created", "tag.updated", "tag.deleted"} {
		if !slices.Contains(types, w) {
			t.Errorf("missing %s", w)
		}
	}
}

type savedReply struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Shortcut string `json:"shortcut"`
	BodyHTML string `json:"body_html"`
}

func TestSavedReplies(t *testing.T) {
	e := hdtest.New(t, resources.Register)
	ws := e.NewWorkspace()
	other := e.NewWorkspace()
	a := ws.Agent.As(ws)

	var r savedReply
	e.Do("POST", "/v1/saved-replies", a, map[string]any{"title": "Refund", "shortcut": "/Refund",
		"body_html": `<p onclick="x">Hi <script>bad()</script>{{name}}</p>`}).Want(t, 201).JSON(t, &r)
	if r.Shortcut != "refund" || strings.Contains(r.BodyHTML, "script") || strings.Contains(r.BodyHTML, "onclick") {
		t.Fatalf("created %+v", r)
	}
	e.Do("POST", "/v1/saved-replies", a, map[string]any{"title": "Other", "shortcut": "refund", "body_html": "<p>x</p>"}).Want(t, 409)
	e.Do("POST", "/v1/saved-replies", a, map[string]any{"title": "Bad", "shortcut": "has space", "body_html": "<p>x</p>"}).Want(t, 422)
	e.Do("POST", "/v1/saved-replies", a, map[string]any{"title": "Empty", "body_html": "<script>x</script>"}).Want(t, 422)
	// Empty shortcuts do not clash.
	e.Do("POST", "/v1/saved-replies", a, map[string]any{"title": "A", "body_html": "<p>a</p>"}).Want(t, 201)
	var b savedReply
	e.Do("POST", "/v1/saved-replies", a, map[string]any{"title": "B", "body_html": "<p>b</p>"}).Want(t, 201).JSON(t, &b)
	e.Do("PATCH", "/v1/saved-replies/"+b.ID, a, map[string]any{"shortcut": "refund"}).Want(t, 409)
	e.Do("PATCH", "/v1/saved-replies/"+b.ID, a, map[string]any{"shortcut": "bee", "title": "Bee"}).Want(t, 200).JSON(t, &b)
	if b.Shortcut != "bee" || b.Title != "Bee" || b.BodyHTML != "<p>b</p>" {
		t.Fatalf("patched %+v", b)
	}
	// The same shortcut is fine in another workspace.
	e.Do("POST", "/v1/saved-replies", other.Agent.As(other), map[string]any{"title": "R", "shortcut": "refund", "body_html": "<p>x</p>"}).Want(t, 201)
	e.Do("GET", "/v1/saved-replies/"+r.ID, other.Agent.As(other), nil).Want(t, 404)

	var p page[savedReply]
	e.Do("GET", "/v1/saved-replies?limit=2", ws.Viewer.As(ws), nil).Want(t, 200).JSON(t, &p)
	if len(p.Data) != 2 || p.NextCursor == nil {
		t.Fatalf("page %+v", p)
	}
	var p2 page[savedReply]
	e.Do("GET", "/v1/saved-replies?limit=2&cursor="+*p.NextCursor, a, nil).Want(t, 200).JSON(t, &p2)
	if len(p2.Data) != 1 || p2.NextCursor != nil {
		t.Fatalf("page2 %+v", p2)
	}
	e.Do("GET", "/v1/saved-replies?q=ref", a, nil).Want(t, 200).JSON(t, &p)
	if len(p.Data) != 1 {
		t.Fatalf("q %+v", p.Data)
	}
	e.Do("DELETE", "/v1/saved-replies/"+r.ID, ws.Viewer.As(ws), nil).Want(t, 403)
	e.Do("DELETE", "/v1/saved-replies/"+r.ID, a, nil).Want(t, 204)
	e.Do("GET", "/v1/saved-replies/"+r.ID, a, nil).Want(t, 404)
}

type view struct {
	ID       string         `json:"id"`
	Name     string         `json:"name"`
	Shared   bool           `json:"shared"`
	Filters  map[string]any `json:"filters"`
	Position int            `json:"position"`
}

func TestViews(t *testing.T) {
	e := hdtest.New(t, resources.Register)
	ws := e.NewWorkspace()
	other := e.NewWorkspace()

	var shared view
	e.Do("POST", "/v1/views", ws.Admin.As(ws), map[string]any{"name": "Urgent", "shared": true,
		"filters": map[string]any{"status": []string{"open", "pending", "open"}, "priority": []string{"urgent"}, "assignee": "none"}}).
		Want(t, 201).JSON(t, &shared)
	if !shared.Shared || len(shared.Filters["status"].([]any)) != 2 || shared.Filters["assignee"] != "none" {
		t.Fatalf("shared %+v", shared)
	}
	e.Do("POST", "/v1/views", ws.Agent.As(ws), map[string]any{"name": "Team", "shared": true}).Want(t, 403)

	var mine view
	e.Do("POST", "/v1/views", ws.Agent.As(ws), map[string]any{"name": "Mine", "filters": map[string]any{"assignee": "me"}}).Want(t, 201).JSON(t, &mine)
	if mine.Shared || mine.Position != 1 {
		t.Fatalf("mine %+v", mine)
	}
	// Validation.
	e.Do("POST", "/v1/views", ws.Agent.As(ws), map[string]any{"name": "Bad", "filters": map[string]any{"status": []string{"nope"}}}).Want(t, 422)
	e.Do("POST", "/v1/views", ws.Agent.As(ws), map[string]any{"name": "Bad", "filters": map[string]any{"assignee": other.Agent.ID.String()}}).Want(t, 422)
	e.Do("POST", "/v1/views", ws.Agent.As(ws), map[string]any{"name": "Bad", "filters": map[string]any{"team_id": ids.New().String()}}).Want(t, 422)
	e.Do("POST", "/v1/views", ws.Agent.As(ws), map[string]any{"name": "Bad", "filters": map[string]any{"channel": "fax"}}).Want(t, 422)
	e.Do("POST", "/v1/views", ws.Agent.As(ws), map[string]any{"filters": map[string]any{}}).Want(t, 422)
	e.Do("POST", "/v1/views", ws.Viewer.As(ws), map[string]any{"name": "V"}).Want(t, 403)
	e.Do("POST", "/v1/views", ws.Agent.As(ws), map[string]any{"name": "Assigned", "filters": map[string]any{"assignee": ws.Admin.ID.String()}}).Want(t, 201)

	// The agent sees shared + own; the admin sees only shared.
	var p page[view]
	e.Do("GET", "/v1/views", ws.Agent.As(ws), nil).Want(t, 200).JSON(t, &p)
	if len(p.Data) != 3 || p.Data[0].ID != shared.ID {
		t.Fatalf("agent list %+v", p.Data)
	}
	e.Do("GET", "/v1/views", ws.Admin.As(ws), nil).Want(t, 200).JSON(t, &p)
	if len(p.Data) != 1 {
		t.Fatalf("admin list %+v", p.Data)
	}
	e.Do("GET", "/v1/views/"+mine.ID, ws.Admin.As(ws), nil).Want(t, 404)
	e.Do("PATCH", "/v1/views/"+mine.ID, ws.Admin.As(ws), map[string]any{"name": "x"}).Want(t, 404)
	e.Do("DELETE", "/v1/views/"+mine.ID, ws.Owner.As(ws), nil).Want(t, 404)
	e.Do("GET", "/v1/views/"+shared.ID, other.Owner.As(other), nil).Want(t, 404)

	var mine2 view
	// Agents cannot edit shared views or share their own.
	e.Do("PATCH", "/v1/views/"+shared.ID, ws.Agent.As(ws), map[string]any{"name": "x"}).Want(t, 403)
	e.Do("DELETE", "/v1/views/"+shared.ID, ws.Agent.As(ws), nil).Want(t, 403)
	e.Do("PATCH", "/v1/views/"+mine.ID, ws.Agent.As(ws), map[string]any{"shared": true}).Want(t, 403)
	e.Do("PATCH", "/v1/views/"+mine.ID, ws.Agent.As(ws), map[string]any{"name": "My open", "filters": map[string]any{"status": []string{"open"}}}).Want(t, 200).JSON(t, &mine2)
	if mine2.Name != "My open" || mine2.Filters["assignee"] != nil {
		t.Fatalf("patched %+v", mine2)
	}

	// An admin can share their personal view.
	var adm view
	e.Do("POST", "/v1/views", ws.Admin.As(ws), map[string]any{"name": "Admin own"}).Want(t, 201).JSON(t, &adm)
	e.Do("PATCH", "/v1/views/"+adm.ID, ws.Admin.As(ws), map[string]any{"shared": true}).Want(t, 200).JSON(t, &adm)
	if !adm.Shared {
		t.Fatal("not shared")
	}
	e.Do("GET", "/v1/views/"+adm.ID, ws.Agent.As(ws), nil).Want(t, 200)

	// API keys see and manage shared views only.
	readKey := e.APIKey(ws, "tickets:read")
	e.Do("GET", "/v1/views", hdtest.Auth{Bearer: readKey}, nil).Want(t, 200).JSON(t, &p)
	if len(p.Data) != 2 {
		t.Fatalf("key list %+v", p.Data)
	}
	e.Do("POST", "/v1/views", hdtest.Auth{Bearer: readKey}, map[string]any{"name": "K", "shared": true}).Want(t, 403)
	setKey := e.APIKey(ws, "settings:write")
	e.Do("POST", "/v1/views", hdtest.Auth{Bearer: setKey}, map[string]any{"name": "K"}).Want(t, 403)
	e.Do("POST", "/v1/views", hdtest.Auth{Bearer: setKey}, map[string]any{"name": "K", "shared": true}).Want(t, 201)
	e.Do("DELETE", "/v1/views/"+shared.ID, hdtest.Auth{Bearer: setKey}, nil).Want(t, 204)

	e.Do("DELETE", "/v1/views/"+mine.ID, ws.Agent.As(ws), nil).Want(t, 204)
	var topics []string
	e.Scalar(`SELECT topics FROM events WHERE workspace_id = $1 AND type = 'view.deleted' AND data->>'view_id' = $2`, &topics, ws.ID, mine.ID)
	if !slices.Contains(topics, "user:"+ws.Agent.ID.String()) {
		t.Fatalf("topics %v", topics)
	}
}

type sla struct {
	ID                   string  `json:"id"`
	Name                 string  `json:"name"`
	Priority             *string `json:"priority"`
	FirstResponseMinutes int     `json:"first_response_minutes"`
	ResolutionMinutes    int     `json:"resolution_minutes"`
	Enabled              bool    `json:"enabled"`
	Position             int     `json:"position"`
}

func TestSLAPolicies(t *testing.T) {
	e := hdtest.New(t, resources.Register)
	ws := e.NewWorkspace()
	other := e.NewWorkspace()
	ad := ws.Admin.As(ws)

	var s sla
	e.Do("POST", "/v1/sla-policies", ad, map[string]any{"name": "Urgent", "priority": "urgent", "first_response_minutes": 30, "resolution_minutes": 240}).Want(t, 201).JSON(t, &s)
	if s.Priority == nil || *s.Priority != "urgent" || !s.Enabled || s.Position != 0 {
		t.Fatalf("created %+v", s)
	}
	var def sla
	e.Do("POST", "/v1/sla-policies", ad, map[string]any{"name": "Default", "first_response_minutes": 60, "resolution_minutes": 1440}).Want(t, 201).JSON(t, &def)
	if def.Priority != nil || def.Position != 1 {
		t.Fatalf("default %+v", def)
	}
	e.Do("POST", "/v1/sla-policies", ad, map[string]any{"name": "Bad", "priority": "meh", "first_response_minutes": 1, "resolution_minutes": 1}).Want(t, 422)
	e.Do("POST", "/v1/sla-policies", ad, map[string]any{"name": "Bad", "first_response_minutes": 0, "resolution_minutes": 1}).Want(t, 422)
	e.Do("POST", "/v1/sla-policies", ad, map[string]any{"name": "Bad"}).Want(t, 422)
	e.Do("POST", "/v1/sla-policies", ws.Agent.As(ws), map[string]any{"name": "A", "first_response_minutes": 1, "resolution_minutes": 1}).Want(t, 403)

	e.Do("PATCH", "/v1/sla-policies/"+s.ID, ad, map[string]any{"priority": nil, "enabled": false}).Want(t, 200).JSON(t, &s)
	if s.Priority != nil || s.Enabled || s.FirstResponseMinutes != 30 {
		t.Fatalf("patched %+v", s)
	}
	e.Do("PATCH", "/v1/sla-policies/"+s.ID, other.Owner.As(other), map[string]any{"enabled": true}).Want(t, 404)
	var p page[sla]
	e.Do("GET", "/v1/sla-policies", ws.Viewer.As(ws), nil).Want(t, 200).JSON(t, &p)
	if len(p.Data) != 2 {
		t.Fatal(p)
	}
	e.Do("GET", "/v1/sla-policies", hdtest.Auth{Bearer: e.APIKey(ws, "tickets:read")}, nil).Want(t, 403)
	e.Do("DELETE", "/v1/sla-policies/"+s.ID, other.Owner.As(other), nil).Want(t, 404)
	e.Do("DELETE", "/v1/sla-policies/"+s.ID, ad, nil).Want(t, 204)

	var actions []string
	rows, _ := e.D.DB.Pool.Query(e.Ctx, `SELECT action FROM audit_logs WHERE workspace_id = $1 AND entity_type = 'sla_policy' ORDER BY created_at`, ws.ID)
	for rows.Next() {
		var a string
		_ = rows.Scan(&a)
		actions = append(actions, a)
	}
	rows.Close()
	if strings.Join(actions, ",") != "sla_policy.created,sla_policy.created,sla_policy.updated,sla_policy.deleted" {
		t.Fatalf("audit %v", actions)
	}
	types, _ := e.Events(ws.ID, 0)
	if !slices.Contains(types, "sla_policy.deleted") {
		t.Fatal(types)
	}
}

type automation struct {
	ID         string           `json:"id"`
	Name       string           `json:"name"`
	Trigger    string           `json:"trigger"`
	Conditions []map[string]any `json:"conditions"`
	Actions    []map[string]any `json:"actions"`
	Enabled    bool             `json:"enabled"`
	Position   int              `json:"position"`
	RunCount   int              `json:"run_count"`
}

func TestAutomations(t *testing.T) {
	e := hdtest.New(t, resources.Register)
	ws := e.NewWorkspace()
	other := e.NewWorkspace()
	ad := ws.Admin.As(ws)
	team := ids.New()
	e.Exec(`INSERT INTO teams (id, workspace_id, name) VALUES ($1, $2, 'Billing')`, team, ws.ID)

	var a automation
	e.Do("POST", "/v1/automations", ad, map[string]any{"name": "Refunds", "trigger": "ticket_created",
		"conditions": []map[string]any{{"field": "subject", "op": "contains", "value": "refund"}, {"field": "priority", "op": "equals", "value": "high"}},
		"actions": []map[string]any{{"type": "assign_team", "value": team.String()}, {"type": "add_tag", "value": "billing"},
			{"type": "send_reply", "value": `<p>Thanks<script>x</script></p>`}, {"type": "assign_user", "value": ws.Agent.ID.String()}, {"type": "mark_spam", "value": ""}}}).
		Want(t, 201).JSON(t, &a)
	if !a.Enabled || len(a.Conditions) != 2 || a.Actions[2]["value"] != "<p>Thanks</p>" || a.Actions[4]["value"] != "true" || a.RunCount != 0 {
		t.Fatalf("created %+v", a)
	}
	bad := []map[string]any{
		{"name": "x", "trigger": "nope", "actions": []map[string]any{{"type": "add_tag", "value": "a"}}},
		{"name": "x", "trigger": "ticket_created", "actions": []map[string]any{}},
		{"name": "x", "trigger": "ticket_created", "actions": []map[string]any{{"type": "explode", "value": ""}}},
		{"name": "x", "trigger": "ticket_created", "actions": []map[string]any{{"type": "set_status", "value": "gone"}}},
		{"name": "x", "trigger": "ticket_created", "actions": []map[string]any{{"type": "assign_user", "value": other.Agent.ID.String()}}},
		{"name": "x", "trigger": "ticket_created", "actions": []map[string]any{{"type": "assign_user", "value": ws.Viewer.ID.String()}}},
		{"name": "x", "trigger": "ticket_created", "actions": []map[string]any{{"type": "assign_team", "value": ids.New().String()}}},
		{"name": "x", "trigger": "ticket_created", "actions": []map[string]any{{"type": "add_note", "value": "<script>x</script>"}}},
		{"name": "x", "trigger": "ticket_created", "conditions": []map[string]any{{"field": "colour", "op": "equals", "value": "x"}}, "actions": []map[string]any{{"type": "add_tag", "value": "a"}}},
		{"name": "x", "trigger": "ticket_created", "conditions": []map[string]any{{"field": "status", "op": "equals", "value": "lost"}}, "actions": []map[string]any{{"type": "add_tag", "value": "a"}}},
		{"name": "x", "trigger": "ticket_created", "conditions": []map[string]any{{"field": "mailbox_id", "op": "equals", "value": ids.New().String()}}, "actions": []map[string]any{{"type": "add_tag", "value": "a"}}},
		{"trigger": "ticket_created", "actions": []map[string]any{{"type": "add_tag", "value": "a"}}},
	}
	for i, b := range bad {
		if r := e.Do("POST", "/v1/automations", ad, b); r.Status != 422 {
			t.Errorf("bad[%d]: status %d %s", i, r.Status, r.Body)
		}
	}
	e.Do("POST", "/v1/automations", ws.Agent.As(ws), map[string]any{"name": "x", "trigger": "ticket_created", "actions": []map[string]any{{"type": "add_tag", "value": "a"}}}).Want(t, 403)

	e.Do("PATCH", "/v1/automations/"+a.ID, ad, map[string]any{"enabled": false, "conditions": []map[string]any{}}).Want(t, 200).JSON(t, &a)
	if a.Enabled || len(a.Conditions) != 0 || len(a.Actions) != 5 {
		t.Fatalf("patched %+v", a)
	}
	e.Do("PATCH", "/v1/automations/"+a.ID, ad, map[string]any{"actions": []map[string]any{}}).Want(t, 422)
	e.Do("GET", "/v1/automations/"+a.ID, other.Owner.As(other), nil).Want(t, 404)
	var p page[automation]
	e.Do("GET", "/v1/automations?trigger=ticket_created", ws.Viewer.As(ws), nil).Want(t, 200).JSON(t, &p)
	if len(p.Data) != 1 {
		t.Fatal(p)
	}
	key := e.APIKey(ws, "settings:read")
	e.Do("GET", "/v1/automations", hdtest.Auth{Bearer: key}, nil).Want(t, 200)
	e.Do("DELETE", "/v1/automations/"+a.ID, hdtest.Auth{Bearer: key}, nil).Want(t, 403)
	e.Do("DELETE", "/v1/automations/"+a.ID, ad, nil).Want(t, 204)

	var n int
	e.Scalar(`SELECT count(*) FROM audit_logs WHERE workspace_id = $1 AND entity_type = 'automation' AND actor_user_id = $2`, &n, ws.ID, ws.Admin.ID)
	if n != 3 {
		t.Fatalf("audit rows %d", n)
	}
	types, _ := e.Events(ws.ID, 0)
	for _, w := range []string{"automation.created", "automation.updated", "automation.deleted"} {
		if !slices.Contains(types, w) {
			t.Errorf("missing %s", w)
		}
	}
}
