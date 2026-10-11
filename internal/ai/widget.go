package ai

import (
	"context"
	"errors"
	"html"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"

	"github.com/opendesk/opendesk/internal/db"
	"github.com/opendesk/opendesk/internal/domain"
	"github.com/opendesk/opendesk/internal/helpdesk/hd"
	"github.com/opendesk/opendesk/internal/jobs"
	"github.com/opendesk/opendesk/internal/plan"
)

// maxBotAnswers bounds automatic answers per conversation: after that the visitor is
// clearly not being helped by articles and the team takes over.
const maxBotAnswers = 3

func isNoCredits(err error) bool { return errors.Is(err, plan.ErrNoCredits) }

var widgetSchema = obj(map[string]any{"answerable": boolT, "answer": strT, "source_ids": map[string]any{"type": "array",
	"items": map[string]any{"type": "integer"}}, "wants_human": boolT}, "answerable", "answer", "source_ids", "wants_human")

// wantsPerson spots a request for a human in common languages without a model call.
var wantsPerson = regexp.MustCompile(`(?i)\b(human|real person|a person|live agent|an agent|representative|operator|someone real|talk to (?:someone|support|a person)|speak (?:to|with) (?:someone|a person|an agent)|mensch|mitarbeiter|humain|une personne|conseiller|humano|una persona|persona real|agente|operatore|atendente|uma pessoa|medewerker|człowiek|konsultant)\b`)

// WidgetAnswerWorker runs ai.widget_answer jobs.
type WidgetAnswerWorker struct {
	river.WorkerDefaults[jobs.AIWidgetAnswerArgs]
	S *Service
}

func (w *WidgetAnswerWorker) Work(ctx context.Context, job *river.Job[jobs.AIWidgetAnswerArgs]) error {
	err := w.S.WidgetAnswer(ctx, job.Args)
	if err != nil && skippable(err) {
		w.S.d.Log.Info("widget answer skipped", "ticket_id", job.Args.TicketID, "reason", errReason(err))
		return nil
	}
	return err
}

// WidgetAnswer answers one visitor message from published KB articles, or does nothing.
// It answers at most once per message, never on assigned tickets or after a handoff,
// and only when the latest message is the visitor's.
func (s *Service) WidgetAnswer(ctx context.Context, a jobs.AIWidgetAnswerArgs) error {
	if !s.Enabled() {
		return nil
	}
	st, err := hd.LoadSettings(ctx, s.d.DB.Pool, a.WorkspaceID)
	if err != nil {
		return err
	}
	if set := st.AI(); !set.Enabled || !set.WidgetAnswers {
		return nil
	}
	var handled bool
	if err := s.d.DB.Pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM ai_widget_answers WHERE message_id = $1)`, a.MessageID).Scan(&handled); err != nil || handled {
		return err
	}
	tc, err := s.loadTicketCtx(ctx, s.d.DB.Pool, a.WorkspaceID, a.TicketID, true)
	if err != nil {
		if isNotFound(err) {
			return nil
		}
		return err
	}
	t := tc.T
	if t.Channel != domain.ChannelChat || t.Spam || t.Assignee != nil || t.Status == domain.StatusSolved || t.Status == domain.StatusClosed {
		return nil
	}
	if v, _ := t.Custom["ai_handoff"].(bool); v {
		return nil
	}
	if len(tc.Msgs) == 0 {
		return nil
	}
	last := tc.Msgs[len(tc.Msgs)-1]
	if last.ID != a.MessageID || last.Direction != "inbound" {
		return nil // the visitor wrote again (that job answers) or someone replied
	}
	answered := 0
	for _, m := range tc.Msgs {
		if m.Author.Type == "user" {
			return nil // a person on the team is in the conversation
		}
		if m.AI {
			answered++
		}
	}
	if answered >= maxBotAnswers {
		return nil
	}
	question := messageText(last)
	if wantsPerson.MatchString(question) {
		return s.handoff(ctx, a, "visitor_asked")
	}
	// A short follow-up ("and on mobile?") is retrieved together with the previous question.
	query := question
	if len([]rune(query)) < 60 {
		for i := len(tc.Msgs) - 2; i >= 0; i-- {
			if tc.Msgs[i].Direction == "inbound" {
				query = messageText(tc.Msgs[i]) + "\n" + query
				break
			}
		}
	}
	sources, err := s.retrieveKB(ctx, a.WorkspaceID, tc.Workspace.Slug, clip(query, 2000), 3, true)
	if err != nil {
		return err
	}
	if len(sources) == 0 {
		return s.decline(ctx, a)
	}
	c := s.newCall(a.WorkspaceID, nil, &a.TicketID, "answer")
	set := st.AI()
	req := Request{Model: s.models.Default, MaxTokens: 3000, Effort: "low", JSONSchema: widgetSchema, SchemaName: "widget_answer",
		System: []Block{{Text: widgetSystem, Cache: true}, {Text: guidance(tc.Workspace.Name, set, "", ""), Cache: true}},
		Messages: []Message{{Role: "user", Blocks: []Block{
			{Text: renderKB(sources)},
			{Text: renderThread(tc.Msgs, "", 12000)},
			{Text: "Answer the visitor's latest message (message " + strconv.Itoa(len(tc.Msgs)) + ") as JSON."},
		}}}}
	resp, err := c.run(ctx, req, nil)
	if err != nil {
		return err
	}
	var out struct {
		Answerable bool   `json:"answerable"`
		Answer     string `json:"answer"`
		SourceIDs  []int  `json:"source_ids"`
		WantsHuman bool   `json:"wants_human"`
	}
	if err := parseJSON(resp.Text, &out); err != nil {
		return s.decline(ctx, a)
	}
	if out.WantsHuman {
		return s.handoff(ctx, a, "model")
	}
	var cited []kbSource
	for _, id := range out.SourceIDs {
		if id >= 1 && id <= len(sources) && !slices.ContainsFunc(cited, func(k kbSource) bool { return k.ArticleID == sources[id-1].ArticleID }) {
			cited = append(cited, sources[id-1])
		}
	}
	answerHTML := markdownToHTML(out.Answer)
	if !out.Answerable || len(cited) == 0 || hd.HTMLToText(answerHTML) == "" {
		return s.decline(ctx, a)
	}
	body := answerHTML + sourcesHTML(cited)
	err = s.d.DB.Tx(ctx, func(tx pgx.Tx) error {
		// Re-check under the ticket lock that nothing changed while the model ran.
		var assignee *uuid.UUID
		var custom map[string]any
		if err := tx.QueryRow(ctx, `SELECT assignee_id, custom FROM tickets WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
			a.WorkspaceID, a.TicketID).Scan(&assignee, &custom); err != nil {
			return err
		}
		var latest uuid.UUID
		if err := tx.QueryRow(ctx, `SELECT id FROM messages WHERE workspace_id = $1 AND ticket_id = $2 AND kind = 'reply'
			ORDER BY created_at DESC, id DESC LIMIT 1`, a.WorkspaceID, a.TicketID).Scan(&latest); err != nil {
			return err
		}
		if v, _ := custom["ai_handoff"].(bool); v || assignee != nil || latest != a.MessageID {
			return errStale
		}
		tag, err := tx.Exec(ctx, `INSERT INTO ai_widget_answers (message_id, workspace_id, ticket_id, answered) VALUES ($1, $2, $3, true)
			ON CONFLICT DO NOTHING`, a.MessageID, a.WorkspaceID, a.TicketID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return errStale
		}
		m, err := domain.AddMessage(ctx, tx, s.d.Jobs, domain.NewMessage{WorkspaceID: a.WorkspaceID, TicketID: a.TicketID,
			Kind: "reply", Direction: "outbound", AuthorType: "system", BodyHTML: body, BodyText: hd.HTMLToText(body),
			Subject: t.Subject, Trigger: "none", AI: true, FromName: AssistantName})
		if err != nil {
			return err
		}
		ids := make([]uuid.UUID, 0, len(cited))
		for _, c := range cited {
			if id, err := uuid.Parse(c.ArticleID); err == nil {
				ids = append(ids, id)
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE ai_widget_answers SET reply_id = $2, article_ids = $3 WHERE message_id = $1`, a.MessageID, m.ID, ids); err != nil {
			return err
		}
		_, err = domain.LogActivity(ctx, tx, a.WorkspaceID, a.TicketID, "ai", nil, "ai_answered",
			map[string]any{"message_id": m.ID.String(), "article_ids": ids})
		return err
	})
	if errors.Is(err, errStale) {
		return nil
	}
	if err != nil {
		return err
	}
	c.charge(ctx)
	return nil
}

var errStale = errors.New("conversation changed")

// decline records that the bot did not answer this message; the team handles it.
func (s *Service) decline(ctx context.Context, a jobs.AIWidgetAnswerArgs) error {
	_, err := s.d.DB.Pool.Exec(ctx, `INSERT INTO ai_widget_answers (message_id, workspace_id, ticket_id, answered) VALUES ($1, $2, $3, false)
		ON CONFLICT DO NOTHING`, a.MessageID, a.WorkspaceID, a.TicketID)
	return err
}

// handoff stops the bot for this conversation and alerts the team.
func (s *Service) handoff(ctx context.Context, a jobs.AIWidgetAnswerArgs, _ string) error {
	return s.d.DB.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO ai_widget_answers (message_id, workspace_id, ticket_id, answered) VALUES ($1, $2, $3, false)
			ON CONFLICT DO NOTHING`, a.MessageID, a.WorkspaceID, a.TicketID); err != nil {
			return err
		}
		_, err := hd.MarkAIHandoff(ctx, tx, a.WorkspaceID, a.TicketID, "ai")
		if db.IsNotFound(err) {
			return nil
		}
		return err
	})
}

// sourcesHTML lists the cited articles under an answer (links only, so it reads in
// any language; the widget labels AI answers).
func sourcesHTML(src []kbSource) string {
	var b strings.Builder
	b.WriteString("<ul>")
	for _, s := range src {
		b.WriteString(`<li><a href="` + html.EscapeString(s.URL) + `">` + html.EscapeString(s.Title) + `</a></li>`)
	}
	b.WriteString("</ul>")
	return hd.SanitizeRich(b.String())
}
