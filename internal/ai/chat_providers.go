package ai

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

// --- Anthropic ---------------------------------------------------------------------

func (a *Anthropic) chatParams(req ChatRequest) (anthropic.MessageNewParams, []option.RequestOption) {
	base, opts := a.params(Request{System: req.System, MaxTokens: req.MaxTokens, Model: req.Model})
	base.Messages = nil
	for i, t := range req.Turns {
		var blocks []anthropic.ContentBlockParamUnion
		if t.Role == "assistant" {
			if strings.TrimSpace(t.Text) != "" {
				blocks = append(blocks, anthropic.NewTextBlock(t.Text))
			}
			for _, c := range t.Calls {
				var input any = map[string]any{}
				if len(c.Input) > 0 {
					input = c.Input
				}
				blocks = append(blocks, anthropic.NewToolUseBlock(c.ID, input, c.Name))
			}
			if len(blocks) > 0 {
				base.Messages = append(base.Messages, anthropic.NewAssistantMessage(blocks...))
			}
			continue
		}
		for _, r := range t.Results {
			blocks = append(blocks, anthropic.NewToolResultBlock(r.CallID, r.Content, r.IsError))
		}
		if strings.TrimSpace(t.Text) != "" {
			tb := anthropic.TextBlockParam{Text: t.Text}
			// The newest user turn ends the cacheable prefix of the conversation.
			if i == len(req.Turns)-1 {
				tb.CacheControl = anthropic.NewCacheControlEphemeralParam()
			}
			blocks = append(blocks, anthropic.ContentBlockParamUnion{OfText: &tb})
		}
		if len(blocks) > 0 {
			base.Messages = append(base.Messages, anthropic.NewUserMessage(blocks...))
		}
	}
	for i, tool := range req.Tools {
		props, _ := tool.Schema["properties"].(map[string]any)
		var required []string
		switch r := tool.Schema["required"].(type) {
		case []string:
			required = r
		case []any:
			for _, v := range r {
				if s, ok := v.(string); ok {
					required = append(required, s)
				}
			}
		}
		u := anthropic.ToolUnionParamOfTool(anthropic.ToolInputSchemaParam{Properties: props, Required: required}, tool.Name)
		u.OfTool.Description = anthropic.String(tool.Description)
		// Tools are stable: cache them with the system prompt.
		if i == len(req.Tools)-1 {
			u.OfTool.CacheControl = anthropic.NewCacheControlEphemeralParam()
		}
		base.Tools = append(base.Tools, u)
	}
	return base, opts
}

func (a *Anthropic) Chat(ctx context.Context, req ChatRequest, onDelta func(string)) (ChatResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, streamTimeout)
	defer cancel()
	p, opts := a.chatParams(req)
	opts = append(opts, option.WithRequestTimeout(streamTimeout))
	stream := a.client.Messages.NewStreaming(ctx, p, opts...)
	defer stream.Close()
	msg := anthropic.Message{}
	for stream.Next() {
		ev := stream.Current()
		if err := msg.Accumulate(ev); err != nil {
			return ChatResponse{}, ErrUnavailable
		}
		if e, ok := ev.AsAny().(anthropic.ContentBlockDeltaEvent); ok && onDelta != nil {
			if d, ok := e.Delta.AsAny().(anthropic.TextDelta); ok && d.Text != "" {
				onDelta(d.Text)
			}
		}
	}
	if err := stream.Err(); err != nil {
		return ChatResponse{}, anthropicErr(ctx, err)
	}
	if msg.StopReason == anthropic.StopReasonRefusal {
		return ChatResponse{}, ErrRefused
	}
	out := ChatResponse{Model: string(msg.Model), StopReason: string(msg.StopReason)}
	var text strings.Builder
	for _, b := range msg.Content {
		switch v := b.AsAny().(type) {
		case anthropic.TextBlock:
			text.WriteString(v.Text)
		case anthropic.ToolUseBlock:
			in := v.Input
			if len(in) == 0 {
				in = json.RawMessage(`{}`)
			}
			out.Calls = append(out.Calls, ToolCall{ID: v.ID, Name: v.Name, Input: in})
		}
	}
	out.Text = text.String()
	u := msg.Usage
	out.InputTokens = int(u.InputTokens + u.CacheReadInputTokens + u.CacheCreationInputTokens)
	out.OutputTokens = int(u.OutputTokens)
	return out, nil
}

// --- OpenAI-compatible ---------------------------------------------------------------

type oaToolCall struct {
	Index    *int   `json:"index,omitempty"`
	ID       string `json:"id,omitempty"`
	Type     string `json:"type,omitempty"`
	Function struct {
		Name      string `json:"name,omitempty"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type oaChatMessage struct {
	Role       string       `json:"role"`
	Content    *string      `json:"content"`
	ToolCalls  []oaToolCall `json:"tool_calls,omitempty"`
	ToolCallID string       `json:"tool_call_id,omitempty"`
}

func strPtr(s string) *string { return &s }

func (o *OpenAI) chatBody(req ChatRequest) map[string]any {
	var msgs []oaChatMessage
	if len(req.System) > 0 {
		var parts []string
		for _, b := range req.System {
			parts = append(parts, b.Text)
		}
		msgs = append(msgs, oaChatMessage{Role: "system", Content: strPtr(strings.Join(parts, "\n\n"))})
	}
	for _, t := range req.Turns {
		if t.Role == "assistant" {
			m := oaChatMessage{Role: "assistant"}
			if t.Text != "" || len(t.Calls) == 0 {
				m.Content = strPtr(t.Text)
			}
			for _, c := range t.Calls {
				tc := oaToolCall{ID: c.ID, Type: "function"}
				tc.Function.Name = c.Name
				tc.Function.Arguments = string(c.Input)
				if tc.Function.Arguments == "" {
					tc.Function.Arguments = "{}"
				}
				m.ToolCalls = append(m.ToolCalls, tc)
			}
			msgs = append(msgs, m)
			continue
		}
		for _, r := range t.Results {
			content := r.Content
			if r.IsError {
				content = "Error: " + content
			}
			msgs = append(msgs, oaChatMessage{Role: "tool", ToolCallID: r.CallID, Content: strPtr(content)})
		}
		if strings.TrimSpace(t.Text) != "" {
			msgs = append(msgs, oaChatMessage{Role: "user", Content: strPtr(t.Text)})
		}
	}
	body := map[string]any{"model": req.Model, "messages": msgs, "max_tokens": max(req.MaxTokens, 256),
		"stream": true, "stream_options": map[string]any{"include_usage": true}}
	if len(req.Tools) > 0 {
		var tools []map[string]any
		for _, t := range req.Tools {
			tools = append(tools, map[string]any{"type": "function", "function": map[string]any{
				"name": t.Name, "description": t.Description, "parameters": t.Schema}})
		}
		body["tools"] = tools
	}
	return body
}

type oaChatChunk struct {
	Model   string `json:"model"`
	Choices []struct {
		Delta struct {
			Content   string       `json:"content"`
			ToolCalls []oaToolCall `json:"tool_calls"`
		} `json:"delta"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage *struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
}

func (o *OpenAI) Chat(ctx context.Context, req ChatRequest, onDelta func(string)) (ChatResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, streamTimeout)
	defer cancel()
	body := o.chatBody(req)
	res, err := o.send(ctx, func(int32) map[string]any { return body }, false, true)
	if err != nil {
		return ChatResponse{}, err
	}
	defer res.Body.Close()
	out := ChatResponse{Model: req.Model}
	var text strings.Builder
	type partial struct {
		id, name string
		args     strings.Builder
	}
	calls := map[int]*partial{}
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
		var chunk oaChatChunk
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
				if onDelta != nil {
					onDelta(c.Delta.Content)
				}
			}
			for n, tc := range c.Delta.ToolCalls {
				idx := n
				if tc.Index != nil {
					idx = *tc.Index
				}
				pc := calls[idx]
				if pc == nil {
					pc = &partial{}
					calls[idx] = pc
				}
				if tc.ID != "" {
					pc.id = tc.ID
				}
				if tc.Function.Name != "" {
					pc.name = tc.Function.Name
				}
				pc.args.WriteString(tc.Function.Arguments)
			}
			if c.FinishReason != "" {
				out.StopReason = c.FinishReason
			}
		}
	}
	if err := sc.Err(); err != nil {
		if errors.Is(ctx.Err(), context.Canceled) {
			return ChatResponse{}, context.Canceled
		}
		return ChatResponse{}, ErrUnavailable
	}
	if out.StopReason == "content_filter" {
		return ChatResponse{}, ErrRefused
	}
	idxs := make([]int, 0, len(calls))
	for i := range calls {
		idxs = append(idxs, i)
	}
	sort.Ints(idxs)
	for _, i := range idxs {
		pc := calls[i]
		if pc.name == "" {
			continue
		}
		args := strings.TrimSpace(pc.args.String())
		if args == "" || !json.Valid([]byte(args)) {
			args = "{}"
		}
		id := pc.id
		if id == "" {
			id = "call_" + pc.name
		}
		out.Calls = append(out.Calls, ToolCall{ID: id, Name: pc.name, Input: json.RawMessage(args)})
	}
	out.Text = text.String()
	return out, nil
}
