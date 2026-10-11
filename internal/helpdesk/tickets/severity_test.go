package tickets_test

import (
	"testing"

	"github.com/google/uuid"

	"github.com/useopendesk/opendesk/internal/domain"
	"github.com/useopendesk/opendesk/internal/helpdesk/hdtest"
	"github.com/useopendesk/opendesk/internal/helpdesk/resources"
	"github.com/useopendesk/opendesk/internal/helpdesk/tickets"
)

// newFullEnv adds the resources routes (views, automations) to the tickets routes.
func newFullEnv(t *testing.T) (*hdtest.Env, hdtest.WS) {
	t.Helper()
	e := hdtest.New(t, tickets.Register, resources.Register)
	return e, e.NewWorkspace()
}

func sev(t domain.Ticket) string {
	if t.Severity == nil {
		return "none"
	}
	return *t.Severity
}

func TestSeverityEndToEnd(t *testing.T) {
	e, ws := newFullEnv(t)
	agent := ws.Agent.As(ws)

	// Create with and without a severity; unknown values are refused.
	s1 := createTicket(t, e, ws, map[string]any{"subject": "Down", "severity": "sev1", "kind": "note"})
	s3 := createTicket(t, e, ws, map[string]any{"subject": "Typo", "severity": "sev3", "kind": "note"})
	none := createTicket(t, e, ws, map[string]any{"subject": "Question", "kind": "note"})
	e.Do("POST", "/v1/tickets", agent, map[string]any{"subject": "x", "severity": "sev9", "body_html": "<p>x</p>"}).Want(t, 422)
	if sev(s1) != "sev1" || sev(s3) != "sev3" || sev(none) != "none" {
		t.Fatalf("created %s %s %s", sev(s1), sev(s3), sev(none))
	}

	// PATCH sets, clears with null, refuses unknown values, and logs severity_changed.
	e.Do("PATCH", "/v1/tickets/"+s3.ID.String(), agent, map[string]any{"severity": "sev2"}).Want(t, 200)
	e.Do("PATCH", "/v1/tickets/"+s3.ID.String(), agent, map[string]any{"severity": "high"}).Want(t, 422)
	if got := getTicket(t, e, ws, s3.ID); sev(got) != "sev2" {
		t.Fatal(sev(got))
	}
	var n int
	e.Scalar(`SELECT count(*) FROM activities WHERE ticket_id = $1 AND type = 'severity_changed' AND actor_type = 'user'
		AND data->>'from' = 'sev3' AND data->>'to' = 'sev2'`, &n, s3.ID)
	if n != 1 {
		t.Fatalf("activity %d", n)
	}
	e.Do("PATCH", "/v1/tickets/"+s3.ID.String(), agent, map[string]any{"severity": nil}).Want(t, 200)
	if got := getTicket(t, e, ws, s3.ID); got.Severity != nil {
		t.Fatal("not cleared")
	}
	e.Do("PATCH", "/v1/tickets/"+s3.ID.String(), agent, map[string]any{"severity": "sev3"}).Want(t, 200)

	// Filters: a list, and none for tickets without one.
	if p := list(t, e, agent, "severity=sev1"); !sameSet(idsOf(p), []uuid.UUID{s1.ID}) {
		t.Fatalf("sev1 %v", idsOf(p))
	}
	if p := list(t, e, agent, "severity=sev1,sev3"); !sameSet(idsOf(p), []uuid.UUID{s1.ID, s3.ID}) {
		t.Fatalf("sev1,sev3 %v", idsOf(p))
	}
	if p := list(t, e, agent, "severity=none"); !sameSet(idsOf(p), []uuid.UUID{none.ID}) {
		t.Fatalf("none %v", idsOf(p))
	}
	e.Do("GET", "/v1/tickets?severity=sev5", agent, nil).Want(t, 422)

	// Sort: most severe first, none last; pages keep the order.
	p := list(t, e, agent, "sort=severity&limit=2")
	if len(p.Data) != 2 || p.Data[0].ID != s1.ID || p.Data[1].ID != s3.ID || p.NextCursor == nil {
		t.Fatalf("sorted %v", idsOf(p))
	}
	if p2 := list(t, e, agent, "sort=severity&limit=2&cursor="+*p.NextCursor); len(p2.Data) != 1 || p2.Data[0].ID != none.ID {
		t.Fatalf("page 2 %v", idsOf(p2))
	}

	// Views store the severity filter.
	var view struct {
		ID string `json:"id"`
	}
	e.Do("POST", "/v1/views", agent, map[string]any{"name": "Critical", "filters": map[string]any{"severity": []string{"sev1", "sev2"}}}).
		Want(t, 201).JSON(t, &view)
	if p := list(t, e, agent, "view_id="+view.ID); !sameSet(idsOf(p), []uuid.UUID{s1.ID}) {
		t.Fatalf("view %v", idsOf(p))
	}
	e.Do("POST", "/v1/views", agent, map[string]any{"name": "Bad", "filters": map[string]any{"severity": []string{"sev0"}}}).Want(t, 422)

	// Reports count tickets created in the range by severity.
	var o tickets.ReportOverview
	e.Do("GET", "/v1/reports/overview", ws.Viewer.As(ws), nil).Want(t, 200).JSON(t, &o)
	if o.BySeverity["sev1"] != 1 || o.BySeverity["sev3"] != 1 || o.BySeverity["none"] != 1 || o.BySeverity["sev2"] != 0 {
		t.Fatalf("by severity %v", o.BySeverity)
	}
}

func TestSeverityAutomations(t *testing.T) {
	e, ws := newFullEnv(t)
	admin := ws.Admin.As(ws)
	// Validation through the API.
	bad := []map[string]any{
		{"conditions": []any{map[string]any{"field": "severity", "op": "contains", "value": "sev1"}}, "actions": []any{map[string]any{"type": "set_priority", "value": "urgent"}}},
		{"conditions": []any{map[string]any{"field": "severity", "op": "equals", "value": "major"}}, "actions": []any{map[string]any{"type": "set_priority", "value": "urgent"}}},
		{"conditions": []any{}, "actions": []any{map[string]any{"type": "set_severity", "value": "sev7"}}},
	}
	for _, b := range bad {
		b["name"], b["trigger"] = "bad", "ticket_created"
		e.Do("POST", "/v1/automations", admin, b).Want(t, 422)
	}
	// Outages get sev1; sev1 tickets become urgent; tickets without a severity get a note tag.
	e.Do("POST", "/v1/automations", admin, map[string]any{"name": "Outage", "trigger": "ticket_created",
		"conditions": []any{map[string]any{"field": "subject", "op": "contains", "value": "outage"}},
		"actions":    []any{map[string]any{"type": "set_severity", "value": "sev1"}}}).Want(t, 201)
	e.Do("POST", "/v1/automations", admin, map[string]any{"name": "Sev1 is urgent", "trigger": "ticket_updated",
		"conditions": []any{map[string]any{"field": "severity", "op": "eq", "value": "sev1"}},
		"actions":    []any{map[string]any{"type": "set_priority", "value": "urgent"}}}).Want(t, 201)
	e.Do("POST", "/v1/automations", admin, map[string]any{"name": "Unassessed", "trigger": "ticket_created",
		"conditions": []any{map[string]any{"field": "severity", "op": "equals", "value": "none"}, map[string]any{"field": "subject", "op": "contains", "value": "question"}},
		"actions":    []any{map[string]any{"type": "add_tag", "value": "needs-severity"}}}).Want(t, 201)

	out := createTicket(t, e, ws, map[string]any{"subject": "Full outage in EU", "kind": "note"})
	q := createTicket(t, e, ws, map[string]any{"subject": "A question", "kind": "note"})
	runTriggers(t, e, ws.ID)
	got := getTicket(t, e, ws, out.ID)
	if sev(got) != "sev1" || got.Priority != "urgent" {
		t.Fatalf("outage %s %s", sev(got), got.Priority)
	}
	var n int
	e.Scalar(`SELECT count(*) FROM activities WHERE ticket_id = $1 AND type = 'severity_changed' AND actor_type = 'automation'`, &n, out.ID)
	if n != 1 {
		t.Fatalf("automation activity %d", n)
	}
	got = getTicket(t, e, ws, q.ID)
	if sev(got) != "none" || len(got.Tags) != 1 || got.Tags[0].Name != "needs-severity" {
		t.Fatalf("question %+v", got)
	}
	// An empty set_severity clears it.
	e.Do("POST", "/v1/automations", admin, map[string]any{"name": "Clear", "trigger": "ticket_updated",
		"conditions": []any{map[string]any{"field": "status", "op": "equals", "value": "solved"}},
		"actions":    []any{map[string]any{"type": "set_severity", "value": ""}}}).Want(t, 201)
	e.Do("PATCH", "/v1/tickets/"+out.ID.String(), ws.Agent.As(ws), map[string]any{"status": "solved"}).Want(t, 200)
	runTriggers(t, e, ws.ID)
	if got := getTicket(t, e, ws, out.ID); got.Severity != nil {
		t.Fatalf("not cleared: %s", sev(got))
	}
}

func TestSettingAFieldDropsItsSuggestion(t *testing.T) {
	e, ws := newEnv(t)
	tk := createTicket(t, e, ws, map[string]any{"subject": "Help", "kind": "note"})
	e.Exec(`UPDATE tickets SET custom = custom || '{"ai_suggestions":{"severity":{"value":"sev2"},"priority":{"value":"high"}}}' WHERE id = $1`, tk.ID)
	e.Do("PATCH", "/v1/tickets/"+tk.ID.String(), ws.Agent.As(ws), map[string]any{"severity": "sev3"}).Want(t, 200)
	got := getTicket(t, e, ws, tk.ID)
	s, _ := got.Custom["ai_suggestions"].(map[string]any)
	if _, ok := s["severity"]; ok || s["priority"] == nil {
		t.Fatalf("suggestions %v", got.Custom)
	}
	e.Do("PATCH", "/v1/tickets/"+tk.ID.String(), ws.Agent.As(ws), map[string]any{"priority": "high"}).Want(t, 200)
	if got := getTicket(t, e, ws, tk.ID); got.Custom["ai_suggestions"] != nil {
		t.Fatalf("suggestions %v", got.Custom)
	}
}
