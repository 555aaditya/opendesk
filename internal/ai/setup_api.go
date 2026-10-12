package ai

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/useopendesk/opendesk/internal/ai/agentsetup"
	"github.com/useopendesk/opendesk/internal/auth"
	"github.com/useopendesk/opendesk/internal/httpx"
)

// registerSetup serves the AI agent's setup checklist (contracts/agent.md "Setup").
func (s *Service) registerSetup(api huma.API) {
	huma.Register(api, huma.Operation{OperationID: "ai-agent-setup", Method: http.MethodGet, Path: "/v1/ai/agent/setup",
		Summary: "Get the AI agent's setup checklist",
		Description: "What is left before the agent answers visitors well, computed from the workspace's data: " +
			"AI on, identity, knowledge, tools (optional), a playground test, the widget installed, answers on, " +
			"and email answers for a mailbox (optional).",
		Tags: []string{"AI"}},
		func(ctx context.Context, _ *struct{}) (*struct{ Body agentsetup.Setup }, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAdmin, auth.ScopeSettingsRead)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			out, err := agentsetup.Load(ctx, s.d.DB.Pool, p.WorkspaceID, s.Enabled())
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body agentsetup.Setup }{out}, nil
		})
}
