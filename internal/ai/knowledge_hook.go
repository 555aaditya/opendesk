package ai

import (
	"context"

	"github.com/google/uuid"
)

// Passage is one retrieved piece of knowledge the AI answers from: a KB article or a
// knowledge source document (contracts/agent.md "Knowledge sources").
type Passage struct {
	Kind  string // "article" | "page" | "file" | "snippet"
	ID    string // article id, or knowledge document id
	Title string
	URL   string // "" when the passage has no public link
	Text  string
	Score float64 // higher is more relevant; comparable within one Retrieve call
}

// KnowledgeRetriever finds passages in a workspace's enabled, ready knowledge sources.
// internal/ai/knowledge implements it and installs itself with SetKnowledge, so this
// package never imports it.
type KnowledgeRetriever interface {
	Retrieve(ctx context.Context, wid uuid.UUID, query string, k int) ([]Passage, error)
}

// SetKnowledge installs the knowledge source retriever; nil removes it.
func (s *Service) SetKnowledge(k KnowledgeRetriever) {
	s.knowledgeMu.Lock()
	defer s.knowledgeMu.Unlock()
	s.knowledge = k
}

func (s *Service) knowledgeRetriever() KnowledgeRetriever {
	s.knowledgeMu.RLock()
	defer s.knowledgeMu.RUnlock()
	return s.knowledge
}

// Embedder returns the configured embedder, or nil without embeddings.
func (s *Service) Embedder() Embedder { return s.embedder }

// SemanticSearch reports whether embeddings can be used for retrieval (an embedder and
// the ai_embeddings table).
func (s *Service) SemanticSearch() bool { return s.semantic() }
