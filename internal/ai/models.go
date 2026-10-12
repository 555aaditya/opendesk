package ai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/useopendesk/opendesk/internal/helpdesk/hd"
	"github.com/useopendesk/opendesk/internal/plan"
)

// Model tiers: which workspace setting picks the model of a feature
// (contracts/ai.md "Workspace settings").
const (
	tierDefault = "default"
	tierFast    = "fast"
	tierWidget  = "widget"
)

// featureTier maps an AI feature to its model tier.
func featureTier(feature string) string {
	switch feature {
	case "rewrite", "translate", "triage", "decide":
		return tierFast
	case "answer", "playground":
		return tierWidget
	}
	return tierDefault
}

// curatedModels is the default list a workspace chooses from on OpenRouter when
// AI_MODELS is unset (contracts/ai.md "Models").
var curatedModels = []string{
	"anthropic/claude-sonnet-5.5",
	"anthropic/claude-haiku-5.5",
	"anthropic/claude-opus-5.5",
	"openai/gpt-5.6-sol",
	"openai/gpt-5.6-luna",
	"google/gemini-3.8-flash",
	"deepseek/deepseek-v4.1-flash",
}

// ModelInfo describes one model a workspace may choose.
type ModelInfo struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	Vendor         string     `json:"vendor"`
	ContextLength  *int       `json:"context_length"`
	CreditsPerMTok *MTokPrice `json:"credits_per_mtok"`
	// USD per token, for the cost of calls whose provider reports none.
	inUSD, outUSD float64
	priced        bool
}

// MTokPrice is credits per million tokens, markup included.
type MTokPrice struct {
	Input  float64 `json:"input"`
	Output float64 `json:"output"`
}

// catalog caches the provider's model metadata (OpenRouter's /v1/models).
type catalog struct {
	mu      sync.Mutex
	fetched time.Time
	info    map[string]ModelInfo
}

const catalogTTL = time.Hour

// modelIDs is the instance's list of models a workspace may choose, defaults first.
func (s *Service) modelIDs() []string {
	ids := []string{}
	add := func(id string) {
		if id = strings.TrimSpace(id); id != "" && !slices.Contains(ids, id) {
			ids = append(ids, id)
		}
	}
	add(s.models.Default)
	add(s.models.Fast)
	switch {
	case len(s.d.Cfg.AIModels) > 0:
		for _, id := range s.d.Cfg.AIModels {
			add(id)
		}
	case s.provider != nil && s.provider.Name() == "openrouter":
		for _, id := range curatedModels {
			add(id)
		}
	}
	return ids
}

// Catalog returns the models a workspace may choose, with names and prices when the
// provider publishes them. On OpenRouter, an id it does not list is dropped, except the
// instance defaults.
func (s *Service) Catalog(ctx context.Context) []ModelInfo {
	ids := s.modelIDs()
	info := s.catalogInfo(ctx)
	markup := 1.0
	if s.d.Plan != nil && s.d.Plan.Billing {
		markup = max(s.d.Plan.Markup, 1)
	}
	out := make([]ModelInfo, 0, len(ids))
	for _, id := range ids {
		m, ok := info[id]
		if !ok {
			if info != nil && id != s.models.Default && id != s.models.Fast {
				continue
			}
			m = ModelInfo{ID: id, Name: id}
		}
		if m.priced {
			perM := func(usd float64) float64 {
				return float64(plan.FromCost(usd*1e6, markup)) / 1000
			}
			m.CreditsPerMTok = &MTokPrice{Input: perM(m.inUSD), Output: perM(m.outUSD)}
		}
		out = append(out, m)
	}
	return out
}

// allowedModel reports whether id is one of the instance's models.
func (s *Service) allowedModel(id string) bool { return slices.Contains(s.modelIDs(), id) }

// priceOf returns a model's USD price per input and output token when known.
func (s *Service) priceOf(ctx context.Context, model string) (in, out float64, ok bool) {
	m, found := s.catalogInfo(ctx)[model]
	if !found || !m.priced {
		return 0, 0, false
	}
	return m.inUSD, m.outUSD, true
}

// catalogInfo returns the cached model metadata, refreshing it hourly. It is nil when
// the provider publishes none (or could not be reached and nothing is cached).
func (s *Service) catalogInfo(ctx context.Context) map[string]ModelInfo {
	if s.provider == nil || s.provider.Name() != "openrouter" {
		return nil
	}
	c := &s.catalog
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.info != nil && time.Since(c.fetched) < catalogTTL {
		return c.info
	}
	info, err := fetchOpenRouterModels(ctx, s.d.Cfg.OpenRouterBaseURL, s.d.Cfg.OpenRouterAPIKey)
	if err != nil {
		s.d.Log.Warn("ai: model list unavailable", "err", err)
		if c.info != nil {
			c.fetched = time.Now().Add(-catalogTTL + time.Minute) // retry in a minute
		}
		return c.info
	}
	c.info, c.fetched = info, time.Now()
	return c.info
}

// fetchOpenRouterModels reads GET {base}/v1/models.
func fetchOpenRouterModels(ctx context.Context, base, key string) (map[string]ModelInfo, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(base, "/")+"/v1/models", nil)
	if err != nil {
		return nil, err
	}
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	res, err := newHTTPClient().Do(req)
	if err != nil {
		return nil, ErrUnavailable
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, statusError(res.StatusCode)
	}
	var body struct {
		Data []struct {
			ID            string `json:"id"`
			Name          string `json:"name"`
			ContextLength int    `json:"context_length"`
			Pricing       struct {
				Prompt     string `json:"prompt"`
				Completion string `json:"completion"`
			} `json:"pricing"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 32<<20)).Decode(&body); err != nil {
		return nil, ErrBadOutput
	}
	out := make(map[string]ModelInfo, len(body.Data))
	for _, m := range body.Data {
		vendor, name := "", m.Name
		if v, n, ok := strings.Cut(m.Name, ": "); ok {
			vendor, name = v, n
		}
		mi := ModelInfo{ID: m.ID, Name: name, Vendor: vendor}
		if m.ContextLength > 0 {
			cl := m.ContextLength
			mi.ContextLength = &cl
		}
		in, errIn := strconv.ParseFloat(m.Pricing.Prompt, 64)
		outP, errOut := strconv.ParseFloat(m.Pricing.Completion, 64)
		if errIn == nil && errOut == nil && in >= 0 && outP >= 0 {
			mi.inUSD, mi.outUSD, mi.priced = in, outP, true
		}
		out[m.ID] = mi
	}
	return out, nil
}

// tierModel picks a workspace's model for a tier: its choice when the instance still
// offers it, else the instance default.
func (s *Service) tierModel(set hd.AISettings, tier string) string {
	pick := func(choice, fallback string) string {
		if choice != "" && s.allowedModel(choice) {
			return choice
		}
		return fallback
	}
	def := pick(set.Model, s.models.Default)
	switch tier {
	case tierFast:
		return pick(set.FastModel, s.models.Fast)
	case tierWidget:
		return pick(set.WidgetModel, def)
	}
	return def
}

// costOf is a call's cost in USD: what the provider reported, else its tokens at the
// model's published price, else 0 (the feature's typical credits are charged).
func (s *Service) costOf(ctx context.Context, r Response) float64 {
	if r.CostUSD > 0 {
		return r.CostUSD
	}
	if r.InputTokens == 0 && r.OutputTokens == 0 {
		return 0
	}
	in, out, ok := s.priceOf(ctx, r.Model)
	if !ok {
		return 0
	}
	return float64(r.InputTokens)*in + float64(r.OutputTokens)*out
}
