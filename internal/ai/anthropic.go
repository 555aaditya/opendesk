package ai

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

// Anthropic calls the Claude Messages API through the official SDK.
type Anthropic struct {
	client anthropic.Client
	// fallbacks enables server-side refusal fallbacks on models that support them
	// (first-party API only).
	fallbacks bool
}

// NewAnthropic returns a Claude provider. baseURL is empty for the public API.
func NewAnthropic(apiKey, baseURL string) *Anthropic {
	opts := []option.RequestOption{
		option.WithAPIKey(apiKey),
		option.WithHTTPClient(newHTTPClient()),
		option.WithMaxRetries(maxAttempts - 1), // the SDK retries 408/409/429/5xx with backoff
		option.WithRequestTimeout(completeTimeout),
	}
	if baseURL != "" {
		opts = append(opts, option.WithBaseURL(baseURL))
	}
	return &Anthropic{client: anthropic.NewClient(opts...), fallbacks: baseURL == ""}
}

func (a *Anthropic) Name() string { return "anthropic" }

func (a *Anthropic) params(req Request) (anthropic.MessageNewParams, []option.RequestOption) {
	p := anthropic.MessageNewParams{Model: anthropic.Model(req.Model), MaxTokens: int64(max(req.MaxTokens, 256))}
	for _, b := range req.System {
		tb := anthropic.TextBlockParam{Text: b.Text}
		if b.Cache {
			tb.CacheControl = anthropic.NewCacheControlEphemeralParam()
		}
		p.System = append(p.System, tb)
	}
	for _, m := range req.Messages {
		var blocks []anthropic.ContentBlockParamUnion
		for _, b := range m.Blocks {
			tb := &anthropic.TextBlockParam{Text: b.Text}
			if b.Cache {
				tb.CacheControl = anthropic.NewCacheControlEphemeralParam()
			}
			blocks = append(blocks, anthropic.ContentBlockParamUnion{OfText: tb})
		}
		if m.Role == "assistant" {
			p.Messages = append(p.Messages, anthropic.NewAssistantMessage(blocks...))
		} else {
			p.Messages = append(p.Messages, anthropic.NewUserMessage(blocks...))
		}
	}
	if req.JSONSchema != nil {
		p.OutputConfig.Format = anthropic.JSONOutputFormatParam{Schema: req.JSONSchema}
	}
	// Haiku 4.5 takes no effort parameter; newer models use it to bound thinking.
	if req.Effort != "" && !strings.Contains(req.Model, "haiku") {
		p.OutputConfig.Effort = anthropic.OutputConfigEffort(req.Effort)
	}
	var opts []option.RequestOption
	if a.fallbacks && (strings.HasPrefix(req.Model, "claude-sonnet-5-5") || strings.HasPrefix(req.Model, "claude-opus-5")) {
		// A request a safety classifier declines is re-served by a fallback model.
		opts = append(opts, option.WithHeaderAdd("anthropic-beta", "server-side-fallback-2026-07-01"),
			option.WithJSONSet("fallbacks", "default"))
	}
	return p, opts
}

func (a *Anthropic) Complete(ctx context.Context, req Request) (Response, error) {
	ctx, cancel := context.WithTimeout(ctx, completeTimeout*maxAttempts)
	defer cancel()
	p, opts := a.params(req)
	msg, err := a.client.Messages.New(ctx, p, opts...)
	if err != nil {
		return Response{}, anthropicErr(ctx, err)
	}
	return anthropicResponse(msg)
}

func (a *Anthropic) Stream(ctx context.Context, req Request, onDelta func(string)) (Response, error) {
	ctx, cancel := context.WithTimeout(ctx, streamTimeout)
	defer cancel()
	p, opts := a.params(req)
	opts = append(opts, option.WithRequestTimeout(streamTimeout))
	stream := a.client.Messages.NewStreaming(ctx, p, opts...)
	defer stream.Close()
	msg := anthropic.Message{}
	for stream.Next() {
		ev := stream.Current()
		if err := msg.Accumulate(ev); err != nil {
			return Response{}, ErrUnavailable
		}
		if e, ok := ev.AsAny().(anthropic.ContentBlockDeltaEvent); ok {
			if d, ok := e.Delta.AsAny().(anthropic.TextDelta); ok && d.Text != "" {
				onDelta(d.Text)
			}
		}
	}
	if err := stream.Err(); err != nil {
		return Response{}, anthropicErr(ctx, err)
	}
	return anthropicResponse(&msg)
}

func anthropicResponse(msg *anthropic.Message) (Response, error) {
	if msg.StopReason == anthropic.StopReasonRefusal {
		return Response{}, ErrRefused
	}
	var b strings.Builder
	for _, block := range msg.Content {
		if t, ok := block.AsAny().(anthropic.TextBlock); ok {
			b.WriteString(t.Text)
		}
	}
	u := msg.Usage
	return Response{Text: b.String(), Model: string(msg.Model), StopReason: string(msg.StopReason),
		InputTokens:  int(u.InputTokens + u.CacheReadInputTokens + u.CacheCreationInputTokens),
		OutputTokens: int(u.OutputTokens)}, nil
}

// anthropicErr maps SDK errors without carrying provider text (which may echo input).
func anthropicErr(ctx context.Context, err error) error {
	var apierr *anthropic.Error
	if errors.As(err, &apierr) {
		if apierr.StatusCode == http.StatusBadRequest || apierr.StatusCode == http.StatusNotFound {
			return errors.Join(ErrUnavailable, errors.New("anthropic: request rejected (status "+http.StatusText(apierr.StatusCode)+")"))
		}
		return statusError(apierr.StatusCode)
	}
	if errors.Is(err, context.Canceled) && ctx.Err() != nil && !errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return context.Canceled
	}
	return ErrUnavailable
}

// newHTTPClient bounds connection setup; overall time is bounded by request contexts.
func newHTTPClient() *http.Client {
	tr := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 120 * time.Second,
		IdleConnTimeout:       90 * time.Second,
		MaxIdleConnsPerHost:   16,
		ForceAttemptHTTP2:     true,
	}
	return &http.Client{Transport: tr}
}
