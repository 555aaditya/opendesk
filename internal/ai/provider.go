package ai

import (
	"context"
	"errors"
	"math/rand/v2"
	"net/http"
	"strconv"
	"time"
)

// Block is one piece of prompt text. Cache marks the end of a stable prefix the
// provider may cache (Anthropic prompt caching); other providers ignore it.
type Block struct {
	Text  string
	Cache bool
}

// Message is one conversation turn: "user" or "assistant".
type Message struct {
	Role   string
	Blocks []Block
}

// UserText is a user message of plain text blocks.
func UserText(texts ...string) Message {
	m := Message{Role: "user"}
	for _, t := range texts {
		m.Blocks = append(m.Blocks, Block{Text: t})
	}
	return m
}

// Request is one model call.
type Request struct {
	System    []Block
	Messages  []Message
	MaxTokens int
	Model     string
	// JSONSchema asks for structured JSON output matching the schema.
	JSONSchema map[string]any
	// SchemaName names the schema for providers that need one.
	SchemaName string
	// Effort is a hint ("low" | "medium" | "high") for models that support it.
	Effort string
}

// Response is a completed call. Token counts are for usage records only.
type Response struct {
	Text         string
	Model        string
	InputTokens  int
	OutputTokens int
	StopReason   string
}

// Provider is a chat model backend.
type Provider interface {
	Name() string
	Complete(ctx context.Context, req Request) (Response, error)
	// Stream calls onDelta with text as it is generated and returns the full response.
	Stream(ctx context.Context, req Request, onDelta func(string)) (Response, error)
}

var (
	// ErrUnavailable means the provider failed or timed out after retries.
	ErrUnavailable = errors.New("ai provider unavailable")
	// ErrBusy means the provider kept rate limiting after retries.
	ErrBusy = errors.New("ai provider rate limited")
	// ErrRefused means the model declined the request.
	ErrRefused = errors.New("ai model declined the request")
	// ErrBadOutput means the model output could not be used (invalid JSON, empty).
	ErrBadOutput = errors.New("ai output unusable")
)

// Timeouts for model calls. Streams get longer because output arrives incrementally.
const (
	completeTimeout = 90 * time.Second
	streamTimeout   = 4 * time.Minute
	maxAttempts     = 3
)

// retryable reports whether an HTTP status is worth retrying.
func retryable(status int) bool {
	return status == http.StatusTooManyRequests || status == http.StatusRequestTimeout || status == 529 || status >= 500
}

// backoff returns the wait before attempt n (1-based), honoring Retry-After.
func backoff(n int, h http.Header) time.Duration {
	if h != nil {
		if s, err := strconv.Atoi(h.Get("Retry-After")); err == nil && s >= 0 && s <= 30 {
			return time.Duration(s) * time.Second
		}
	}
	base := time.Duration(1<<(n-1)) * 500 * time.Millisecond
	return base + time.Duration(rand.Int64N(int64(base/2)+1))
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// statusError maps a final HTTP failure to our errors.
func statusError(status int) error {
	if status == http.StatusTooManyRequests || status == 529 {
		return ErrBusy
	}
	return ErrUnavailable
}
