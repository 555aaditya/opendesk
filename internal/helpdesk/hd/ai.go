package hd

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"sync/atomic"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"

	"github.com/opendesk/opendesk/internal/config"
	"github.com/opendesk/opendesk/internal/domain"
	"github.com/opendesk/opendesk/internal/httpx"
	"github.com/opendesk/opendesk/internal/jobs"
)

// AISettings lives in workspaces.settings.ai (contracts/ai.md).
type AISettings struct {
	Enabled       bool `json:"enabled"`
	AutoTriage    bool `json:"auto_triage"`
	AutoSummarize bool `json:"auto_summarize"`
	WidgetAnswers bool `json:"widget_answers"`
	// Assistant offers the assistant panel (Ollie) to the workspace's members.
	Assistant     bool   `json:"assistant"`
	Tone          string `json:"tone"`
	ReplyLanguage string `json:"reply_language" enum:"customer,workspace"`
	Instructions  string `json:"instructions"`
}

// DefaultAISettings apply to keys a workspace has not set.
func DefaultAISettings() AISettings {
	return AISettings{Enabled: true, Assistant: true, Tone: "friendly", ReplyLanguage: "customer"}
}

// AI returns the workspace's AI settings with defaults for unset keys.
func (s Settings) AI() AISettings {
	a := DefaultAISettings()
	if len(s.AIRaw) > 0 {
		var m map[string]json.RawMessage
		if json.Unmarshal(s.AIRaw, &m) == nil {
			field := func(k string, v any) {
				if r, ok := m[k]; ok {
					_ = json.Unmarshal(r, v)
				}
			}
			field("enabled", &a.Enabled)
			field("auto_triage", &a.AutoTriage)
			field("auto_summarize", &a.AutoSummarize)
			field("widget_answers", &a.WidgetAnswers)
			field("assistant", &a.Assistant)
			field("tone", &a.Tone)
			field("reply_language", &a.ReplyLanguage)
			field("instructions", &a.Instructions)
		}
	}
	if a.ReplyLanguage != "workspace" {
		a.ReplyLanguage = "customer"
	}
	if strings.TrimSpace(a.Tone) == "" {
		a.Tone = "friendly"
	}
	return a
}

// AISettingsPatch is the body of PATCH /v1/ai/settings.
type AISettingsPatch struct {
	Enabled       *bool   `json:"enabled,omitempty"`
	AutoTriage    *bool   `json:"auto_triage,omitempty"`
	AutoSummarize *bool   `json:"auto_summarize,omitempty"`
	WidgetAnswers *bool   `json:"widget_answers,omitempty"`
	Assistant     *bool   `json:"assistant,omitempty"`
	Tone          *string `json:"tone,omitempty" maxLength:"200" doc:"friendly, professional, concise, or free text up to 200 characters"`
	ReplyLanguage *string `json:"reply_language,omitempty" enum:"customer,workspace"`
	Instructions  *string `json:"instructions,omitempty" maxLength:"2000"`
}

// AITones are the named tones; any other value is free text.
var AITones = []string{"friendly", "professional", "concise"}

// ValidateAIPatch checks a settings.ai patch and returns the keys to merge.
func ValidateAIPatch(p AISettingsPatch) (map[string]any, error) {
	out := map[string]any{}
	if p.Enabled != nil {
		out["enabled"] = *p.Enabled
	}
	if p.AutoTriage != nil {
		out["auto_triage"] = *p.AutoTriage
	}
	if p.AutoSummarize != nil {
		out["auto_summarize"] = *p.AutoSummarize
	}
	if p.WidgetAnswers != nil {
		out["widget_answers"] = *p.WidgetAnswers
	}
	if p.Assistant != nil {
		out["assistant"] = *p.Assistant
	}
	if p.Tone != nil {
		t := strings.Join(strings.Fields(*p.Tone), " ")
		if t == "" {
			t = "friendly"
		}
		if utf8.RuneCountInString(t) > 200 || strings.ContainsAny(t, "<>`") || strings.IndexFunc(t, unicode.IsControl) >= 0 {
			return nil, httpx.Validation("tone must be friendly, professional, concise, or up to 200 characters of plain text")
		}
		if slices.Contains(AITones, strings.ToLower(t)) {
			t = strings.ToLower(t)
		}
		out["tone"] = t
	}
	if p.ReplyLanguage != nil {
		if *p.ReplyLanguage != "customer" && *p.ReplyLanguage != "workspace" {
			return nil, httpx.Validation("reply_language must be customer or workspace")
		}
		out["reply_language"] = *p.ReplyLanguage
	}
	if p.Instructions != nil {
		s := strings.TrimSpace(strings.ReplaceAll(strings.ToValidUTF8(*p.Instructions, ""), "\r\n", "\n"))
		s = strings.Map(func(r rune) rune {
			if r != '\n' && r != '\t' && unicode.IsControl(r) {
				return -1
			}
			return r
		}, s)
		if utf8.RuneCountInString(s) > 2000 {
			return nil, httpx.Validation("instructions must be 2000 characters or less")
		}
		out["instructions"] = s
	}
	return out, nil
}

// AIHooks are AI features the helpdesk calls without importing internal/ai, which
// installs them at registration. Every hook is optional.
type AIHooks struct {
	// AutoTriage triages a new ticket when settings.ai.auto_triage is on. It runs before
	// the ticket_created automations, outside their transaction, and applies its result
	// in its own transaction. It is a no-op when the ticket was triaged already.
	AutoTriage func(ctx context.Context, wid, tid uuid.UUID) error
	// Triage runs the ai_triage automation action inside the trigger transaction and
	// returns the ticket fields it changed. It returns (nil, nil) when it skips (AI off,
	// no credits, provider unavailable); an error means tx failed.
	Triage func(ctx context.Context, tx pgx.Tx, wid, tid uuid.UUID) ([]string, error)
	// Decide answers ai_decide conditions: the probability of yes for each question, in
	// one decision call inside the trigger transaction. A question it could not answer
	// (no decision engine, AI off, no credits, provider failure) is absent from the map;
	// an error means tx failed.
	Decide func(ctx context.Context, tx pgx.Tx, wid, tid uuid.UUID, questions []string) (map[string]float64, error)
}

var aiHooks atomic.Pointer[AIHooks]

// SetAIHooks installs the AI hooks (internal/ai does this at registration).
func SetAIHooks(h *AIHooks) { aiHooks.Store(h) }

// GetAIHooks returns the installed hooks, or nil.
func GetAIHooks() *AIHooks { return aiHooks.Load() }

// AIEmbeddingsOn reports whether semantic indexing runs on this instance.
func AIEmbeddingsOn(cfg *config.Config) bool {
	return cfg != nil && cfg.AIEnabled() && cfg.EmbeddingsDriver != "" && cfg.EmbeddingsDriver != "none"
}

// EnqueueAIEmbed queues (re)indexing of an article or ticket in tx. The worker skips
// unchanged content and removes embeddings of content that is gone.
func EnqueueAIEmbed(ctx context.Context, tx pgx.Tx, jc domain.Jobs, cfg *config.Config, wid uuid.UUID, kind string, id uuid.UUID) error {
	if jc == nil || !AIEmbeddingsOn(cfg) {
		return nil
	}
	_, err := jc.InsertTx(ctx, tx, jobs.AIEmbedArgs{WorkspaceID: wid, Type: kind, RefID: id},
		&river.InsertOpts{MaxAttempts: 5, ScheduledAt: time.Now().Add(5 * time.Second)})
	return err
}

// EnqueueAIWidgetAnswer queues the widget answer bot for a visitor message when the
// workspace turned it on. It only inserts a job; the request never waits for the model.
func EnqueueAIWidgetAnswer(ctx context.Context, tx pgx.Tx, jc domain.Jobs, cfg *config.Config, wid, tid, mid uuid.UUID) error {
	if jc == nil || cfg == nil || !cfg.AIEnabled() {
		return nil
	}
	s, err := LoadSettings(ctx, tx, wid)
	if err != nil {
		return err
	}
	if a := s.AI(); !a.Enabled || !a.WidgetAnswers {
		return nil
	}
	_, err = jc.InsertTx(ctx, tx, jobs.AIWidgetAnswerArgs{WorkspaceID: wid, TicketID: tid, MessageID: mid},
		&river.InsertOpts{MaxAttempts: 2, UniqueOpts: river.UniqueOpts{ByArgs: true}})
	return err
}

// NotifyAIHandoff is the notification type sent when a visitor asks for a person.
const NotifyAIHandoff = "ai_handoff"

// MarkAIHandoff hands a chat over from the answer bot to the team: it sets
// custom.ai_handoff, logs an ai_handoff activity, notifies the assignee (or the team's
// members) and publishes ticket.updated. It reports false when the ticket was already
// handed off.
func MarkAIHandoff(ctx context.Context, tx pgx.Tx, wid, tid uuid.UUID, actorType string) (bool, error) {
	var custom map[string]any
	var assignee, team *uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT custom, assignee_id, team_id FROM tickets WHERE workspace_id = $1 AND id = $2
		AND deleted_at IS NULL FOR UPDATE`, wid, tid).Scan(&custom, &assignee, &team); err != nil {
		return false, err
	}
	if v, _ := custom["ai_handoff"].(bool); v {
		return false, nil
	}
	patch := map[string]any{"ai_handoff": true, "ai_handoff_at": time.Now().UTC().Format(time.RFC3339)}
	if _, err := tx.Exec(ctx, `UPDATE tickets SET custom = custom || $3, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
		wid, tid, patch); err != nil {
		return false, err
	}
	if _, err := domain.LogActivity(ctx, tx, wid, tid, actorType, nil, "ai_handoff", map[string]any{}); err != nil {
		return false, err
	}
	// The assignee, else the ticket's team, else every member who can reply.
	var recipients []uuid.UUID
	var rows pgx.Rows
	var err error
	switch {
	case assignee != nil:
		recipients = []uuid.UUID{*assignee}
	case team != nil:
		rows, err = tx.Query(ctx, `SELECT tm.user_id FROM team_members tm JOIN teams t ON t.id = tm.team_id
			JOIN members m ON m.user_id = tm.user_id AND m.workspace_id = t.workspace_id
			WHERE t.workspace_id = $1 AND t.id = $2 AND m.role <> 'viewer' ORDER BY tm.user_id LIMIT 50`, wid, *team)
	default:
		rows, err = tx.Query(ctx, `SELECT user_id FROM members WHERE workspace_id = $1 AND role <> 'viewer'
			ORDER BY user_id LIMIT 50`, wid)
	}
	if err != nil {
		return false, err
	}
	if rows != nil {
		if recipients, err = pgx.CollectRows(rows, pgx.RowTo[uuid.UUID]); err != nil {
			return false, err
		}
	}
	var contact map[string]any
	var cid uuid.UUID
	var cname string
	if err := tx.QueryRow(ctx, `SELECT c.id, c.name FROM tickets t JOIN contacts c ON c.id = t.contact_id AND c.workspace_id = t.workspace_id
		WHERE t.workspace_id = $1 AND t.id = $2`, wid, tid).Scan(&cid, &cname); err == nil {
		contact = map[string]any{"id": cid.String(), "name": cname}
	}
	for _, uid := range recipients {
		data := map[string]any{"via": actorType}
		if contact != nil {
			data["contact"] = contact
		}
		if err := Notify(ctx, tx, wid, uid, NotifyAIHandoff, &tid, data); err != nil {
			return false, err
		}
	}
	return true, domain.PublishTicketUpdated(ctx, tx, wid, tid, []string{"custom"})
}
