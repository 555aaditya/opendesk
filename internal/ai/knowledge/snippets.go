package knowledge

import (
	"context"

	"github.com/google/uuid"

	"github.com/useopendesk/opendesk/internal/auth"
)

// CreateSnippet adds a Q&A snippet source for the agent's "Improve answer"
// (contracts/agent.md). It is the same write as POST /v1/ai/knowledge: limits, audit
// entry, ai_knowledge.created and indexing, so the agent answers from it at once. It
// implements ai.SnippetWriter.
func (s *Service) CreateSnippet(ctx context.Context, p *auth.Principal, name, question, answer string) (uuid.UUID, string, error) {
	src, err := s.create(ctx, p, CreateInput{Kind: KindSnippet, Name: name, Snippet: &SnippetInput{Question: question, Answer: answer}})
	if err != nil {
		return uuid.Nil, "", err
	}
	return src.ID, src.Name, nil
}
