package jobs

import "github.com/google/uuid"

// MCPSyncArgs reconnects one MCP server and lists its tools again. Without a server it
// is the hourly sweep that enqueues one sync per enabled server. Owner: ai/mcp.
type MCPSyncArgs struct {
	WorkspaceID uuid.UUID `json:"workspace_id,omitzero"`
	ServerID    uuid.UUID `json:"server_id,omitzero"`
}

func (MCPSyncArgs) Kind() string { return "ai.mcp_sync" }
