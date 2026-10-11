package tickets_test

import (
	"encoding/json"
	"net/url"
	"slices"
	"testing"

	"github.com/google/uuid"

	"github.com/opendesk/opendesk/internal/domain"
	"github.com/opendesk/opendesk/internal/helpdesk/hdtest"
	"github.com/opendesk/opendesk/internal/ids"
)

func addField(t *testing.T, e *hdtest.Env, ws hdtest.WS, entity, key, typ string, opts []domain.FieldOption, required bool) {
	t.Helper()
	if opts == nil {
		opts = []domain.FieldOption{}
	}
	raw, _ := json.Marshal(opts)
	e.Exec(`INSERT INTO custom_fields (workspace_id, entity, key, name, type, options, required_on_solve) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		ws.ID, entity, key, "Field "+key, typ, raw, required)
}

func addGroup(t *testing.T, e *hdtest.Env, ws hdtest.WS, name string, exclusive bool, labels ...string) {
	t.Helper()
	gid := ids.New()
	e.Exec(`INSERT INTO tag_groups (id, workspace_id, name, exclusive) VALUES ($1, $2, $3, $4)`, gid, ws.ID, name, exclusive)
	for _, l := range labels {
		e.Exec(`INSERT INTO tags (workspace_id, name, group_id) VALUES ($1, $2, $3)`, ws.ID, l, gid)
	}
}

func tagNames(tk domain.Ticket) []string {
	out := []string{}
	for _, g := range tk.Tags {
		out = append(out, g.Name)
	}
	slices.Sort(out)
	return out
}

func activityTypes(t *testing.T, e *hdtest.Env, ws hdtest.WS, id uuid.UUID) []domain.Activity {
	t.Helper()
	var acts struct {
		Data []domain.Activity `json:"data"`
	}
	e.Do("GET", "/v1/tickets/"+id.String()+"/activities", ws.Agent.As(ws), nil).Want(t, 200).JSON(t, &acts)
	return acts.Data
}

func TestExclusiveLabels(t *testing.T) {
	e, ws := newEnv(t)
	addGroup(t, e, ws, "Type", true, "Question", "Bug", "Billing")
	addGroup(t, e, ws, "Area", false, "Mobile", "Web")
	a := ws.Agent.As(ws)

	tk := createTicket(t, e, ws, map[string]any{"tags": []string{"question", "bug", "mobile"}})
	if got := tagNames(tk); !slices.Equal(got, []string{"Bug", "Mobile"}) {
		t.Fatalf("create kept %v", got)
	}
	if tk.Tags[0].Color == "" {
		t.Fatal("no colour on the embedded label")
	}
	var out domain.Ticket
	e.Do("PATCH", "/v1/tickets/"+tk.ID.String(), a, map[string]any{"add_tags": []string{"Billing", "web"}}).Want(t, 200).JSON(t, &out)
	if got := tagNames(out); !slices.Equal(got, []string{"Billing", "Mobile", "Web"}) {
		t.Fatalf("add_tags gave %v", got)
	}
	e.Do("PATCH", "/v1/tickets/"+tk.ID.String(), a, map[string]any{"tags": []string{"Bug", "Question"}}).Want(t, 200).JSON(t, &out)
	if got := tagNames(out); !slices.Equal(got, []string{"Question"}) {
		t.Fatalf("replace gave %v", got)
	}

	// Automations go through the same rule.
	addAutomation(t, e, ws, "ticket_created", 0, []map[string]any{}, []map[string]any{{"type": "add_tag", "value": "bug"}})
	tk2 := createTicket(t, e, ws, map[string]any{"tags": []string{"question"}})
	runTriggers(t, e, ws.ID)
	if got := tagNames(getTicket(t, e, ws, tk2.ID)); !slices.Equal(got, []string{"Bug"}) {
		t.Fatalf("automation gave %v", got)
	}

	// label_creation admins: agents cannot create labels by name, admins can.
	e.SetSettings(ws, map[string]any{"label_creation": "admins"})
	e.Do("PATCH", "/v1/tickets/"+tk.ID.String(), a, map[string]any{"add_tags": []string{"brand new"}}).Want(t, 422)
	e.Do("PATCH", "/v1/tickets/"+tk.ID.String(), ws.Admin.As(ws), map[string]any{"add_tags": []string{"brand new"}}).Want(t, 200)

	// A label that does not apply to tickets is refused.
	e.Exec(`INSERT INTO tags (workspace_id, name, applies_to) VALUES ($1, 'Enterprise', '{contacts}')`, ws.ID)
	e.Do("PATCH", "/v1/tickets/"+tk.ID.String(), a, map[string]any{"add_tags": []string{"Enterprise"}}).Want(t, 422)
}

func TestTicketFields(t *testing.T) {
	e, ws := newEnv(t)
	other := e.NewWorkspace()
	addField(t, e, ws, "ticket", "order_id", "text", nil, true)
	addField(t, e, ws, "ticket", "seats", "number", nil, false)
	addField(t, e, ws, "ticket", "plan", "select", []domain.FieldOption{{ID: "free", Label: "Free", Color: "gray"}, {ID: "pro", Label: "Pro", Color: "violet"}}, false)
	addField(t, e, ws, "ticket", "areas", "multi_select", []domain.FieldOption{{ID: "api", Label: "API"}, {ID: "web", Label: "Web"}, {ID: "ios", Label: "iOS"}}, false)
	addField(t, e, ws, "ticket", "due", "date", nil, false)
	addField(t, e, ws, "ticket", "vip", "checkbox", nil, false)
	addField(t, e, ws, "ticket", "owner", "user", nil, false)
	addField(t, e, ws, "ticket", "old", "text", nil, false)
	e.Exec(`UPDATE custom_fields SET archived = true WHERE workspace_id = $1 AND key = 'old'`, ws.ID)
	addField(t, e, other, "ticket", "secret", "text", nil, false)
	a := ws.Agent.As(ws)

	tk := createTicket(t, e, ws, map[string]any{"fields": map[string]any{"seats": 12, "plan": "pro", "areas": []string{"web", "api"}}})
	if tk.Fields["seats"] != float64(12) || tk.Fields["plan"] != "pro" {
		t.Fatalf("create fields %+v", tk.Fields)
	}
	if areas, _ := tk.Fields["areas"].([]any); len(areas) != 2 || areas[0] != "api" {
		t.Fatalf("multi_select stored %+v", tk.Fields["areas"])
	}
	path := "/v1/tickets/" + tk.ID.String()
	for _, bad := range []map[string]any{
		{"seats": "many"}, {"plan": "gold"}, {"areas": []string{"api", "nope"}}, {"due": "11/10/2026"}, {"vip": "yes"},
		{"owner": ids.New().String()}, {"owner": other.Agent.ID.String()}, {"unknown": "x"}, {"secret": "x"}, {"old": "x"},
		{"order_id": "line\nbreak"},
	} {
		e.Do("PATCH", path, a, map[string]any{"fields": bad}).Want(t, 422)
	}
	// Solving needs order_id.
	r := e.Do("PATCH", path, a, map[string]any{"status": "solved"}).Want(t, 422).Map(t)
	if r["code"] != "field_required" {
		t.Fatalf("solve without order_id: %v", r)
	}
	e.Do("POST", "/v1/tickets/bulk", a, map[string]any{"ids": []string{tk.ID.String()}, "patch": map[string]any{"status": "closed"}}).Want(t, 422)
	e.Do("POST", path+"/messages", a, map[string]any{"kind": "note", "body_html": "<p>x</p>", "status": "solved"}).Want(t, 422)
	var out domain.Ticket
	e.Do("PATCH", path, a, map[string]any{"status": "solved", "fields": map[string]any{"order_id": " A-100 ", "vip": true,
		"owner": ws.Agent.ID.String(), "due": "2026-10-20", "seats": nil}}).Want(t, 200).JSON(t, &out)
	if out.Status != "solved" || out.Fields["order_id"] != "A-100" || out.Fields["vip"] != true {
		t.Fatalf("patched %+v %+v", out.Status, out.Fields)
	}
	if _, ok := out.Fields["seats"]; ok {
		t.Fatal("null did not clear seats")
	}
	var changes []string
	for _, act := range activityTypes(t, e, ws, tk.ID) {
		if act.Type == "field_changed" {
			changes = append(changes, act.Data["key"].(string))
		}
	}
	if !slices.Equal(changes, []string{"due", "order_id", "owner", "seats", "vip"}) {
		t.Fatalf("field_changed %v", changes)
	}
	types, _ := e.Events(ws.ID, 0)
	if !slices.Contains(types, "ticket.updated") {
		t.Fatal("no ticket.updated")
	}

	// Filters.
	tk2 := createTicket(t, e, ws, map[string]any{"fields": map[string]any{"seats": 3, "plan": "free", "areas": []string{"ios"}, "order_id": "Zephyr-7"}})
	createTicket(t, e, ws, map[string]any{})
	list := func(q string) []uuid.UUID {
		t.Helper()
		var p struct {
			Data []domain.Ticket `json:"data"`
		}
		e.Do("GET", "/v1/tickets?status=open,pending,on_hold,solved&"+q, a, nil).Want(t, 200).JSON(t, &p)
		out := []uuid.UUID{}
		for _, x := range p.Data {
			out = append(out, x.ID)
		}
		return out
	}
	enc := url.QueryEscape
	cases := []struct {
		q    string
		want []uuid.UUID
	}{
		{"field.plan=pro", []uuid.UUID{tk.ID}},
		{"field.plan=pro,free", []uuid.UUID{tk2.ID, tk.ID}},
		{enc("field.plan[ne]") + "=pro", nil}, // filled in below: everything but tk
		{enc("field.seats[gte]") + "=3", []uuid.UUID{tk2.ID}},
		{enc("field.areas[all]") + "=api,web", []uuid.UUID{tk.ID}},
		{enc("field.areas[none]") + "=api", nil},
		{"field.order_id=zephyr-7", []uuid.UUID{tk2.ID}},
		{enc("field.order_id[contains]") + "=-1", []uuid.UUID{tk.ID}},
		{"field.vip=true", []uuid.UUID{tk.ID}},
		{"field.owner=me", []uuid.UUID{tk.ID}},
		{enc("field.due[lt]") + "=2026-12-01", []uuid.UUID{tk.ID}},
		{enc("field.seats[set]") + "=", []uuid.UUID{tk2.ID}},
	}
	for _, c := range cases {
		got := list(c.q)
		if c.want == nil {
			if slices.Contains(got, tk.ID) || len(got) != 2 {
				t.Errorf("%s: %v", c.q, got)
			}
			continue
		}
		if !slices.Equal(got, c.want) {
			t.Errorf("%s: got %v want %v", c.q, got, c.want)
		}
	}
	for _, bad := range []string{"field.nope=1", enc("field.seats[contains]") + "=1", "field.seats=abc", "field.plan=gold", "field.Bad=1"} {
		e.Do("GET", "/v1/tickets?"+bad, a, nil).Want(t, 422)
	}
	// Sort by a number field: tk (no seats) sorts lowest.
	var p struct {
		Data       []domain.Ticket `json:"data"`
		NextCursor *string         `json:"next_cursor"`
	}
	e.Do("GET", "/v1/tickets?status=open,solved&sort=field.seats&order=desc&limit=1", a, nil).Want(t, 200).JSON(t, &p)
	if len(p.Data) != 1 || p.Data[0].ID != tk2.ID || p.NextCursor == nil {
		t.Fatalf("sort %+v", p)
	}
	e.Do("GET", "/v1/tickets?status=open,solved&sort=field.seats&order=desc&limit=1&cursor="+*p.NextCursor, a, nil).Want(t, 200).JSON(t, &p)
	if len(p.Data) != 1 || p.Data[0].ID == tk2.ID {
		t.Fatalf("sort page 2 %+v", p)
	}
	e.Do("GET", "/v1/tickets?sort=field.areas", a, nil).Want(t, 422)
	// Search matches field values.
	if got := list("q=zephyr"); !slices.Equal(got, []uuid.UUID{tk2.ID}) {
		t.Fatalf("search %v", got)
	}

	// Views store field filters.
	vid := ids.New()
	e.Exec(`INSERT INTO views (id, workspace_id, name, filters) VALUES ($1, $2, 'Pro', '{"status":["open","solved"],"fields":[{"key":"plan","op":"eq","value":"pro"}]}')`, vid, ws.ID)
	if got := list("view_id=" + vid.String()); !slices.Equal(got, []uuid.UUID{tk.ID}) {
		t.Fatalf("view %v", got)
	}
	var counts struct {
		Views map[string]int `json:"views"`
	}
	e.Do("GET", "/v1/tickets/counts", a, nil).Want(t, 200).JSON(t, &counts)
	if counts.Views[vid.String()] != 1 {
		t.Fatalf("view count %v", counts.Views)
	}
}

func TestFieldAutomations(t *testing.T) {
	e, ws := newEnv(t)
	addField(t, e, ws, "ticket", "plan", "select", []domain.FieldOption{{ID: "free", Label: "Free"}, {ID: "pro", Label: "Pro"}}, false)
	addField(t, e, ws, "ticket", "tier", "number", nil, false)
	addField(t, e, ws, "contact", "segment", "text", nil, false)
	addAutomation(t, e, ws, "ticket_created", 0,
		[]map[string]any{{"field": "field.plan", "op": "eq", "value": "pro"}},
		[]map[string]any{{"type": "set_field", "field": "tier", "value": "2"}, {"type": "set_priority", "value": "high"}})
	addAutomation(t, e, ws, "ticket_created", 1,
		[]map[string]any{{"field": "contact.field.segment", "op": "contains", "value": "enter"}},
		[]map[string]any{{"type": "add_tag", "value": "enterprise"}})

	var cid uuid.UUID
	e.Scalar(`INSERT INTO contacts (workspace_id, email, name, fields) VALUES ($1, 'c@example.com', 'C', '{"segment":"Enterprise"}') RETURNING id`, &cid, ws.ID)
	tk := createTicket(t, e, ws, map[string]any{"contact_id": cid.String(), "kind": "note", "fields": map[string]any{"plan": "pro"}})
	runTriggers(t, e, ws.ID)
	got := getTicket(t, e, ws, tk.ID)
	if got.Fields["tier"] != float64(2) || got.Priority != "high" || !slices.Equal(tagNames(got), []string{"enterprise"}) {
		t.Fatalf("automation result %+v %s %v", got.Fields, got.Priority, tagNames(got))
	}
	tk2 := createTicket(t, e, ws, map[string]any{"kind": "note", "fields": map[string]any{"plan": "free"}})
	runTriggers(t, e, ws.ID)
	if got := getTicket(t, e, ws, tk2.ID); got.Fields["tier"] != nil {
		t.Fatal("condition matched a free ticket")
	}
}
