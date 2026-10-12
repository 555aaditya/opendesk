package ai

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"

	"github.com/google/uuid"
)

// AgentTool is one tool a workspace connected for the widget agent (an MCP tool,
// contracts/agent.md "MCP connections").
type AgentTool struct {
	ServerID    uuid.UUID
	ServerSlug  string
	Name        string // the tool's name on its server
	Title       string // display name; the name when empty
	Description string
	Schema      map[string]any
	ReadOnly    bool
	// Confirm means the visitor confirms each call before it runs.
	Confirm bool
}

// AgentVisitor is who the agent is talking to, sent to tools as _meta. UserID and Email
// come only from a verified widget session.
type AgentVisitor struct {
	Verified       bool
	UserID         string
	Email          string
	Name           string
	ContactID      uuid.UUID
	ConversationID uuid.UUID
}

// AgentToolbox lists and runs a workspace's tools. internal/ai/mcp provides it and
// installs it with SetToolbox, so this package never imports it.
type AgentToolbox interface {
	// Tools returns the enabled tools; verified=false leaves out tools offered only in
	// verified sessions.
	Tools(ctx context.Context, wid uuid.UUID, verified bool) ([]AgentTool, error)
	// Call runs one tool. isError is a tool-level error the model may read.
	Call(ctx context.Context, wid, serverID uuid.UUID, tool string, args json.RawMessage, v AgentVisitor) (text string, isError bool, err error)
}

// SetToolbox installs the workspace tool provider; nil removes it.
func (s *Service) SetToolbox(t AgentToolbox) {
	s.knowledgeMu.Lock()
	defer s.knowledgeMu.Unlock()
	s.toolbox = t
}

func (s *Service) agentToolbox() AgentToolbox {
	s.knowledgeMu.RLock()
	defer s.knowledgeMu.RUnlock()
	return s.toolbox
}

var toolKeyChars = regexp.MustCompile(`[^a-zA-Z0-9_-]+`)

// toolKey is the model-facing name of a workspace tool: <server_slug>__<tool>, at most
// 64 characters of [a-zA-Z0-9_-].
func toolKey(t AgentTool) string {
	k := toolKeyChars.ReplaceAllString(t.ServerSlug, "_") + "__" + toolKeyChars.ReplaceAllString(t.Name, "_")
	if len(k) > 64 {
		k = k[:64]
	}
	return strings.Trim(k, "_-")
}

// displayName is how a tool is named to visitors and in reports.
func (t AgentTool) displayName() string {
	if t.Title != "" {
		return t.Title
	}
	return strings.ReplaceAll(t.Name, "_", " ")
}
