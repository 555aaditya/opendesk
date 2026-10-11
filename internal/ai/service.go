package ai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/opendesk/opendesk/internal/ai/decide"
	"github.com/opendesk/opendesk/internal/db"
	"github.com/opendesk/opendesk/internal/deps"
	"github.com/opendesk/opendesk/internal/domain"
	"github.com/opendesk/opendesk/internal/helpdesk/hd"
	"github.com/opendesk/opendesk/internal/httpx"
	"github.com/opendesk/opendesk/internal/plan"
)

// Service runs the AI features for every area.
type Service struct {
	d        *deps.Deps
	provider Provider // nil when AI is off
	embedder Embedder // nil without embeddings
	models   struct{ Default, Fast string }
	// vectors reports whether ai_embeddings exists (pgvector available).
	vectors bool
	// decider answers typed decisions (Jev, or the LLM adapter); nil without one.
	decider decide.Decider
}

// New builds the service from configuration. It never fails: a missing provider turns
// AI off, a missing vector table turns semantic search into FTS.
func New(ctx context.Context, d *deps.Deps) *Service {
	cfg := d.Cfg
	s := &Service{d: d}
	s.models.Default, s.models.Fast = cfg.AIModel, cfg.AIFastModel
	if s.models.Fast == "" {
		s.models.Fast = s.models.Default
	}
	switch cfg.AIProvider {
	case "anthropic":
		if cfg.AnthropicAPIKey != "" {
			s.provider = NewAnthropic(cfg.AnthropicAPIKey, os.Getenv("ANTHROPIC_BASE_URL"))
		}
	case "openai":
		if s.models.Default != "" {
			s.provider = NewOpenAI(cfg.OpenAIBaseURL, cfg.OpenAIAPIKey)
		} else {
			d.Log.Warn("ai: AI_MODEL is required for an OpenAI-compatible provider; AI is off")
		}
	}
	if s.provider != nil {
		switch cfg.EmbeddingsDriver {
		case "voyage":
			if cfg.VoyageAPIKey != "" {
				s.embedder = NewVoyage(cfg.VoyageAPIKey, cfg.EmbeddingsModel)
			}
		case "openai":
			s.embedder = NewOpenAIEmbedder(cfg.OpenAIBaseURL, cfg.OpenAIAPIKey, cfg.EmbeddingsModel)
		}
	}
	s.vectors = vectorTable(ctx, d.DB.Pool)
	switch cfg.DecisionsProvider {
	case "typesafe":
		if cfg.TypesafeAPIKey != "" {
			s.decider = decide.NewTypeSafe(cfg.TypesafeAPIURL, cfg.TypesafeAPIKey, cfg.TypesafeModel)
		}
	case "llm":
		if s.provider != nil {
			s.decider = &llmDecider{s: s}
		}
	}
	if s.decider != nil {
		d.Log.Info("decisions ready", "engine", s.decider.Name(), "model", s.decider.Model())
	}
	if s.provider != nil {
		d.Log.Info("ai ready", "provider", s.provider.Name(), "model", s.models.Default, "fast_model", s.models.Fast,
			"embeddings", s.embedder != nil, "vector_store", s.vectors)
	}
	return s
}

// WithDecider replaces the decision engine (tests, alternative backends); nil turns it off.
func (s *Service) WithDecider(dc decide.Decider) *Service {
	s.decider = dc
	return s
}

// WithProvider replaces the provider and embedder (tests, alternative backends).
func (s *Service) WithProvider(p Provider, e Embedder, defaultModel, fastModel string) *Service {
	s.provider, s.embedder = p, e
	s.models.Default, s.models.Fast = defaultModel, fastModel
	return s
}

func vectorTable(ctx context.Context, q db.Querier) bool {
	var ok bool
	if err := q.QueryRow(ctx, `SELECT to_regclass('public.ai_embeddings') IS NOT NULL`).Scan(&ok); err != nil {
		return false
	}
	return ok
}

// Enabled reports whether an AI provider is configured.
func (s *Service) Enabled() bool { return s != nil && s.provider != nil }

// canTriage reports whether triage can run: an AI provider or a calibrated decision
// engine (Jev) is configured.
func (s *Service) canTriage() bool { return s != nil && (s.provider != nil || s.jev()) }

// jev reports whether decisions run on a calibrated engine.
func (s *Service) jev() bool { return s.decider != nil && s.decider.Calibrated() }

// semantic reports whether embeddings can be used for retrieval.
func (s *Service) semantic() bool { return s.embedder != nil && s.vectors }

var errDisabled = httpx.E(http.StatusNotFound, "ai_disabled", "AI is not enabled on this instance.")
var errOff = httpx.E(http.StatusForbidden, "ai_off", "AI features are turned off for this workspace.")

// workspaceAI loads the workspace's AI settings and refuses when AI is off.
func (s *Service) workspaceAI(ctx context.Context, wid uuid.UUID) (hd.AISettings, error) {
	if !s.Enabled() {
		return hd.AISettings{}, errDisabled
	}
	return s.workspaceOn(ctx, wid)
}

// workspaceOn loads the workspace's AI settings and refuses when the workspace turned
// AI off, whatever engine is configured.
func (s *Service) workspaceOn(ctx context.Context, wid uuid.UUID) (hd.AISettings, error) {
	st, err := hd.LoadSettings(ctx, s.d.DB.Pool, wid)
	if err != nil {
		return hd.AISettings{}, err
	}
	a := st.AI()
	if !a.Enabled {
		return a, errOff
	}
	return a, nil
}

// call is one model call billed to a feature. Credits are checked before the call and
// charged by charge after the feature succeeded, so a failed call costs nothing.
type call struct {
	s        *Service
	wid      uuid.UUID
	userID   *uuid.UUID
	ticketID *uuid.UUID
	feature  string
	resp     Response
}

func (s *Service) newCall(wid uuid.UUID, userID, ticketID *uuid.UUID, feature string) *call {
	return &call{s: s, wid: wid, userID: userID, ticketID: ticketID, feature: feature}
}

func (c *call) reserve(ctx context.Context) error {
	if c.s.d.Plan == nil {
		return nil // no plan service: unlimited
	}
	return c.s.d.Plan.Reserve(ctx, c.s.d.DB.Pool, c.wid, c.feature)
}

// run reserves and calls the model; onDelta non-nil streams.
func (c *call) run(ctx context.Context, req Request, onDelta func(string)) (Response, error) {
	if err := c.reserve(ctx); err != nil {
		return Response{}, err
	}
	var err error
	start := time.Now()
	if onDelta != nil {
		c.resp, err = c.s.provider.Stream(ctx, req, onDelta)
	} else {
		c.resp, err = c.s.provider.Complete(ctx, req)
	}
	if c.resp.Model == "" {
		c.resp.Model = req.Model
	}
	// Counts and timings only: prompts and completions are never logged.
	c.s.d.Log.Debug("ai call", "feature", c.feature, "model", c.resp.Model, "input_tokens", c.resp.InputTokens,
		"output_tokens", c.resp.OutputTokens, "ms", time.Since(start).Milliseconds(), "ok", err == nil)
	return c.resp, err
}

// decide reserves credits and asks the decision engine. Usage is recorded by charge
// with the engine's name as the model ("jev", counts only).
func (c *call) decide(ctx context.Context, dc decide.Decider, req decide.Request) (decide.Result, error) {
	if err := c.reserve(ctx); err != nil {
		return decide.Result{}, err
	}
	start := time.Now()
	res, err := dc.Decide(ctx, req)
	c.resp = Response{Model: dc.Name(), InputTokens: res.InputTokens, OutputTokens: res.OutputTokens}
	if dc.Name() != "jev" {
		c.resp.Model = res.Model
	}
	c.s.d.Log.Debug("ai decision", "feature", c.feature, "engine", dc.Name(), "questions", len(req.Questions),
		"input_tokens", res.InputTokens, "ms", time.Since(start).Milliseconds(), "ok", err == nil)
	return res, decisionErr(err)
}

// decisionErr maps decision engine errors to the AI errors features handle.
func decisionErr(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, decide.ErrBusy), errors.Is(err, ErrBusy):
		return ErrBusy
	case errors.Is(err, decide.ErrBadOutput), errors.Is(err, ErrBadOutput):
		return ErrBadOutput
	case errors.Is(err, ErrRefused):
		return ErrRefused
	case isNoCredits(err), errors.Is(err, context.Canceled):
		return err
	}
	return ErrUnavailable
}

// charge records usage and spends the feature's credits after it succeeded.
func (c *call) charge(ctx context.Context) {
	ctx = context.WithoutCancel(ctx)
	var err error
	if c.s.d.Plan != nil {
		err = c.s.d.Plan.Spend(ctx, c.s.d.DB.Pool, c.wid, plan.Usage{UserID: c.userID, TicketID: c.ticketID, Feature: c.feature,
			Model: c.resp.Model, InputTokens: c.resp.InputTokens, OutputTokens: c.resp.OutputTokens})
	}
	if err != nil {
		c.s.d.Log.Warn("ai spend failed", "feature", c.feature, "err", err)
	}
	distinct := "workspace:" + c.wid.String()
	if c.userID != nil {
		distinct = c.userID.String()
	}
	c.s.d.Analytics.Capture(distinct, c.wid.String(), "ai_feature_used", map[string]any{"feature": c.feature, "model": c.resp.Model})
}

// apiErr maps AI errors to problem responses.
func apiErr(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, ErrBusy):
		return httpx.E(http.StatusServiceUnavailable, "ai_busy", "The AI provider is busy. Try again in a moment.")
	case errors.Is(err, ErrRefused):
		return httpx.E(http.StatusUnprocessableEntity, "ai_refused", "The AI model declined this request.")
	case errors.Is(err, ErrBadOutput):
		return httpx.E(http.StatusBadGateway, "ai_bad_output", "The AI model returned an unusable answer. Try again.")
	case errors.Is(err, ErrUnavailable), errors.Is(err, context.DeadlineExceeded):
		return httpx.E(http.StatusBadGateway, "ai_unavailable", "The AI provider is unavailable. Try again.")
	}
	return httpx.Wrap(err)
}

// resolveTicket accepts a uuid, "#123" or "123".
func resolveTicket(ctx context.Context, q db.Querier, wid uuid.UUID, raw string) (uuid.UUID, error) {
	raw = strings.TrimSpace(raw)
	if id, err := uuid.Parse(raw); err == nil {
		return id, nil
	}
	n, err := strconv.ParseInt(strings.TrimPrefix(raw, "#"), 10, 64)
	if err != nil || n <= 0 {
		return uuid.Nil, httpx.NotFound("Ticket")
	}
	var id uuid.UUID
	err = q.QueryRow(ctx, `SELECT id FROM tickets WHERE workspace_id = $1 AND number = $2 AND deleted_at IS NULL`, wid, n).Scan(&id)
	if db.IsNotFound(err) {
		return uuid.Nil, httpx.NotFound("Ticket")
	}
	return id, err
}

// ticketCtx is what features read about a ticket.
type ticketCtx struct {
	T         domain.Ticket
	Msgs      []domain.Message
	Contact   *domain.Contact
	Workspace struct{ Name, Slug string }
	Signature bool // the mailbox appends a signature on send
	Summary   string
}

func (s *Service) loadTicketCtx(ctx context.Context, q db.Querier, wid, tid uuid.UUID, publicOnly bool) (*ticketCtx, error) {
	t, err := domain.LoadTicket(ctx, q, wid, tid)
	if db.IsNotFound(err) {
		return nil, httpx.NotFound("Ticket")
	}
	if err != nil {
		return nil, err
	}
	tc := &ticketCtx{T: t}
	if tc.Msgs, err = domain.ListMessages(ctx, q, wid, tid, publicOnly); err != nil {
		return nil, err
	}
	if t.Contact != nil {
		c, err := domain.LoadContact(ctx, q, wid, t.Contact.ID)
		if err != nil && !db.IsNotFound(err) {
			return nil, err
		}
		if err == nil {
			tc.Contact = &c
		}
	}
	if err := q.QueryRow(ctx, `SELECT name, slug FROM workspaces WHERE id = $1`, wid).Scan(&tc.Workspace.Name, &tc.Workspace.Slug); err != nil {
		return nil, err
	}
	if t.MailboxID != nil {
		_ = q.QueryRow(ctx, `SELECT signature_html <> '' FROM mailboxes WHERE workspace_id = $1 AND id = $2`, wid, *t.MailboxID).Scan(&tc.Signature)
	}
	tc.Summary = storedSummary(t.Custom).Text
	return tc, nil
}

func (tc *ticketCtx) language() string {
	l, _ := tc.T.Custom["language"].(string)
	return l
}

// StoredSummary is custom.ai_summary.
type StoredSummary struct {
	Text         string    `json:"text"`
	KeyPoints    []string  `json:"key_points"`
	Sentiment    string    `json:"sentiment"`
	UpdatedAt    time.Time `json:"updated_at"`
	MessageCount int       `json:"message_count"`
}

func storedSummary(custom map[string]any) StoredSummary {
	var s StoredSummary
	if v, ok := custom["ai_summary"]; ok {
		raw, _ := json.Marshal(v)
		_ = json.Unmarshal(raw, &s)
	}
	return s
}

// articleURL is the public help center link of an article.
func (s *Service) articleURL(wsSlug, articleSlug string) string {
	return s.d.Cfg.AppURL + "/help/" + wsSlug + "/articles/" + articleSlug
}
