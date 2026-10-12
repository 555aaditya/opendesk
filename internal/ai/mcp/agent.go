package mcp

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"

	"github.com/useopendesk/opendesk/internal/ai"
)

// toolbox serves the registry's tools to the widget agent (ai.AgentToolbox).
type toolbox struct{ r *Registry }

func (t toolbox) Tools(ctx context.Context, wid uuid.UUID, verified bool) ([]ai.AgentTool, error) {
	tools, err := t.r.Tools(ctx, wid, verified)
	if err != nil {
		return nil, err
	}
	out := make([]ai.AgentTool, 0, len(tools))
	for _, tl := range tools {
		out = append(out, ai.AgentTool{ServerID: tl.ServerID, ServerSlug: tl.ServerSlug, Name: tl.Name, Title: tl.Title,
			Description: tl.Description, Schema: tl.InputSchema, ReadOnly: tl.ReadOnly, Confirm: tl.Policy == "confirm"})
	}
	return out, nil
}

func (t toolbox) Call(ctx context.Context, wid, serverID uuid.UUID, tool string, args json.RawMessage, v ai.AgentVisitor) (string, bool, error) {
	res, err := t.r.Call(ctx, wid, serverID, tool, args, Visitor{Verified: v.Verified, UserID: v.UserID, Email: v.Email,
		Name: v.Name, ContactID: v.ContactID, ConversationID: v.ConversationID})
	if err != nil {
		return "", false, err
	}
	return res.Text, res.IsError, nil
}
