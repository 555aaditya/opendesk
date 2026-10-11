package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
)

// OpenAI calls any OpenAI-compatible /chat/completions endpoint (OpenAI, Azure OpenAI,
// Ollama, vLLM, LM Studio) over plain HTTP.
type OpenAI struct {
	baseURL string
	apiKey  string
	http    *http.Client
	// jsonMode is the strongest response_format the endpoint accepted: 2 json_schema,
	// 1 json_object, 0 none. It steps down when a server rejects a mode.
	jsonMode atomic.Int32
}

// NewOpenAI returns an OpenAI-compatible provider for baseURL (e.g. https://api.openai.com/v1).
func NewOpenAI(baseURL, apiKey string) *OpenAI {
	o := &OpenAI{baseURL: strings.TrimRight(baseURL, "/"), apiKey: apiKey, http: newHTTPClient()}
	o.jsonMode.Store(2)
	return o
}

func (o *OpenAI) Name() string { return "openai" }

type oaMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func (o *OpenAI) body(req Request, stream bool, mode int32) map[string]any {
	var msgs []oaMessage
	if len(req.System) > 0 {
		var parts []string
		for _, b := range req.System {
			parts = append(parts, b.Text)
		}
		msgs = append(msgs, oaMessage{Role: "system", Content: strings.Join(parts, "\n\n")})
	}
	for _, m := range req.Messages {
		var parts []string
		for _, b := range m.Blocks {
			parts = append(parts, b.Text)
		}
		role := "user"
		if m.Role == "assistant" {
			role = "assistant"
		}
		msgs = append(msgs, oaMessage{Role: role, Content: strings.Join(parts, "\n\n")})
	}
	body := map[string]any{"model": req.Model, "messages": msgs, "max_tokens": max(req.MaxTokens, 256)}
	if stream {
		body["stream"] = true
		body["stream_options"] = map[string]any{"include_usage": true}
	}
	if req.JSONSchema != nil {
		name := req.SchemaName
		if name == "" {
			name = "result"
		}
		switch mode {
		case 2:
			body["response_format"] = map[string]any{"type": "json_schema",
				"json_schema": map[string]any{"name": name, "schema": req.JSONSchema, "strict": true}}
		case 1:
			body["response_format"] = map[string]any{"type": "json_object"}
		}
	}
	return body
}

// do posts with retries on 429 and 5xx. A 400 on a JSON request steps the JSON mode
// down (some servers support only json_object, or no response_format) and retries.
func (o *OpenAI) do(ctx context.Context, req Request, stream bool) (*http.Response, error) {
	return o.send(ctx, func(mode int32) map[string]any { return o.body(req, stream, mode) }, req.JSONSchema != nil, stream)
}

// send posts the body build returns for the current JSON mode, with retries.
func (o *OpenAI) send(ctx context.Context, build func(mode int32) map[string]any, jsonReq, stream bool) (*http.Response, error) {
	attempt := 0
	for {
		attempt++
		mode := o.jsonMode.Load()
		raw, _ := json.Marshal(build(mode))
		hr, err := http.NewRequestWithContext(ctx, http.MethodPost, o.baseURL+"/chat/completions", bytes.NewReader(raw))
		if err != nil {
			return nil, ErrUnavailable
		}
		hr.Header.Set("Content-Type", "application/json")
		if stream {
			hr.Header.Set("Accept", "text/event-stream")
		}
		if o.apiKey != "" {
			hr.Header.Set("Authorization", "Bearer "+o.apiKey)
			hr.Header.Set("api-key", o.apiKey) // Azure OpenAI
		}
		res, err := o.http.Do(hr)
		if err != nil {
			if ctx.Err() != nil {
				return nil, ErrUnavailable
			}
			if attempt < maxAttempts {
				if sleepCtx(ctx, backoff(attempt, nil)) != nil {
					return nil, ErrUnavailable
				}
				continue
			}
			return nil, ErrUnavailable
		}
		if res.StatusCode == http.StatusOK {
			return res, nil
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 64<<10))
		res.Body.Close()
		if res.StatusCode == http.StatusBadRequest && jsonReq && mode > 0 {
			o.jsonMode.CompareAndSwap(mode, mode-1)
			continue
		}
		if retryable(res.StatusCode) && attempt < maxAttempts {
			if sleepCtx(ctx, backoff(attempt, res.Header)) != nil {
				return nil, ErrUnavailable
			}
			continue
		}
		return nil, statusError(res.StatusCode)
	}
}

type oaChoice struct {
	Message struct {
		Content string `json:"content"`
		Refusal string `json:"refusal"`
	} `json:"message"`
	Delta struct {
		Content string `json:"content"`
	} `json:"delta"`
	FinishReason string `json:"finish_reason"`
}

type oaResponse struct {
	Model   string     `json:"model"`
	Choices []oaChoice `json:"choices"`
	Usage   *struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
}

func (o *OpenAI) Complete(ctx context.Context, req Request) (Response, error) {
	ctx, cancel := context.WithTimeout(ctx, completeTimeout*maxAttempts)
	defer cancel()
	res, err := o.do(ctx, req, false)
	if err != nil {
		return Response{}, err
	}
	defer res.Body.Close()
	var r oaResponse
	if err := json.NewDecoder(io.LimitReader(res.Body, 8<<20)).Decode(&r); err != nil || len(r.Choices) == 0 {
		return Response{}, ErrUnavailable
	}
	c := r.Choices[0]
	if c.Message.Refusal != "" || c.FinishReason == "content_filter" {
		return Response{}, ErrRefused
	}
	out := Response{Text: c.Message.Content, Model: firstNonEmpty(r.Model, req.Model), StopReason: c.FinishReason}
	if r.Usage != nil {
		out.InputTokens, out.OutputTokens = r.Usage.PromptTokens, r.Usage.CompletionTokens
	}
	return out, nil
}

func (o *OpenAI) Stream(ctx context.Context, req Request, onDelta func(string)) (Response, error) {
	ctx, cancel := context.WithTimeout(ctx, streamTimeout)
	defer cancel()
	res, err := o.do(ctx, req, true)
	if err != nil {
		return Response{}, err
	}
	defer res.Body.Close()
	out := Response{Model: req.Model}
	var text strings.Builder
	sc := bufio.NewScanner(res.Body)
	sc.Buffer(make([]byte, 64<<10), 4<<20)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			break
		}
		var chunk oaResponse
		if json.Unmarshal([]byte(data), &chunk) != nil {
			continue
		}
		if chunk.Model != "" {
			out.Model = chunk.Model
		}
		if chunk.Usage != nil {
			out.InputTokens, out.OutputTokens = chunk.Usage.PromptTokens, chunk.Usage.CompletionTokens
		}
		for _, c := range chunk.Choices {
			if c.Delta.Content != "" {
				text.WriteString(c.Delta.Content)
				onDelta(c.Delta.Content)
			}
			if c.FinishReason != "" {
				out.StopReason = c.FinishReason
			}
		}
	}
	if err := sc.Err(); err != nil {
		if errors.Is(ctx.Err(), context.Canceled) {
			return Response{}, context.Canceled
		}
		return Response{}, ErrUnavailable
	}
	if out.StopReason == "content_filter" {
		return Response{}, ErrRefused
	}
	out.Text = text.String()
	return out, nil
}

func firstNonEmpty(s ...string) string {
	for _, v := range s {
		if v != "" {
			return v
		}
	}
	return ""
}
