package jobs

import "github.com/google/uuid"

// AIKnowledgeSyncArgs crawls a website source, extracts a file source or indexes a
// snippet, then embeds its documents. Owner: ai (internal/ai/knowledge).
type AIKnowledgeSyncArgs struct {
	WorkspaceID uuid.UUID `json:"workspace_id"`
	SourceID    uuid.UUID `json:"source_id"`
}

func (AIKnowledgeSyncArgs) Kind() string { return "ai.knowledge_sync" }

// AIKnowledgeMaintainArgs is the periodic knowledge upkeep: weekly recrawls, recovery of
// stalled syncs, embedding backfill and cleanup. Owner: ai (internal/ai/knowledge).
type AIKnowledgeMaintainArgs struct{}

func (AIKnowledgeMaintainArgs) Kind() string { return "ai.knowledge_maintain" }
