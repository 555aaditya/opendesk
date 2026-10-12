package knowledge

import (
	"strings"
	"testing"

	"github.com/useopendesk/opendesk/internal/ai"
	"github.com/useopendesk/opendesk/internal/auth"
)

// The agent's "Improve answer" creates snippets through ai.SnippetWriter.
func TestCreateSnippetForImprovedAnswer(t *testing.T) {
	e := newEnv(t, false)
	var sw ai.SnippetWriter = e.S
	p := &auth.Principal{Kind: auth.KindUser, UserID: e.WS.Admin.ID, WorkspaceID: e.WS.ID, Role: auth.RoleAdmin}
	_, seq := e.Events(e.WS.ID, 0)
	id, name, err := sw.CreateSnippet(e.Ctx, p, "", "Do you ship notebooks to Australia?", "Yes, we ship to **Australia** in 7 to 10 days.")
	if err != nil {
		t.Fatal(err)
	}
	if src := e.get(id); src.Kind != KindSnippet || src.Status != StatusReady || name != "Do you ship notebooks to Australia?" || src.Name != name {
		t.Fatalf("source %+v %q", src, name)
	}
	if types, _ := e.Events(e.WS.ID, seq); len(types) != 1 || types[0] != "ai_knowledge.created" {
		t.Fatalf("events %v", types)
	}
	var n int
	e.Scalar(`SELECT count(*) FROM audit_logs WHERE workspace_id = $1 AND action = 'ai.knowledge_created' AND actor_user_id = $2`, &n, e.WS.ID, e.WS.Admin.ID)
	if n != 1 {
		t.Fatalf("audit %d", n)
	}
	// Used for answers at once.
	ps := e.retrieve(e.WS.ID, "ship notebooks Australia")
	if len(ps) != 1 || ps[0].Kind != "snippet" || !strings.Contains(ps[0].Text, "7 to 10 days") {
		t.Fatalf("passages %+v", ps)
	}
	// The same validation as the API.
	if _, _, err := sw.CreateSnippet(e.Ctx, p, "", "Hi", "x"); err == nil {
		t.Fatal("short question accepted")
	}
}
