package ai

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// AgentChannels is the agent report split by channel (contracts/agent.md "Report").
type AgentChannels struct {
	Chat  AgentChannelReport `json:"chat"`
	Email AgentChannelReport `json:"email"`
}

// AgentChannelReport counts one channel of the agent report.
type AgentChannelReport struct {
	Conversations int `json:"conversations"`
	Replies       int `json:"replies"`
	Resolved      int `json:"resolved"`
	Handoffs      int `json:"handoffs"`
	// Suggested counts suggested replies on email tickets (draft mode); zero for chat.
	Suggested int `json:"suggested"`
	// SuggestedSent counts the suggestions a teammate sent as written.
	SuggestedSent int `json:"suggested_sent"`
}

func (s *Service) agentReportChannels(ctx context.Context, wid uuid.UUID, from, to time.Time) (AgentChannels, error) {
	var out AgentChannels
	pick := func(channel string) *AgentChannelReport {
		switch channel {
		case "chat":
			return &out.Chat
		case "email":
			return &out.Email
		}
		return nil
	}
	rows, err := s.d.DB.Pool.Query(ctx, `WITH r AS (
			SELECT m.ticket_id, t.channel, t.status FROM messages m JOIN tickets t ON t.workspace_id = m.workspace_id AND t.id = m.ticket_id
			WHERE m.workspace_id = $1 AND m.ai AND m.kind = 'reply' AND m.created_at >= $2 AND m.created_at < $3),
		conv AS (
			SELECT ticket_id, channel, bool_or(status IN ('solved', 'closed') AND NOT EXISTS (SELECT 1 FROM messages u
				WHERE u.workspace_id = $1 AND u.ticket_id = r.ticket_id AND u.kind = 'reply' AND u.author_type = 'user')) AS resolved
			FROM r GROUP BY ticket_id, channel),
		hand AS (
			SELECT t.channel, count(*) AS n FROM activities a JOIN tickets t ON t.workspace_id = a.workspace_id AND t.id = a.ticket_id
			WHERE a.workspace_id = $1 AND a.type = 'ai_handoff' AND a.created_at >= $2 AND a.created_at < $3 GROUP BY t.channel),
		sug AS (
			SELECT 'email'::text AS channel, count(*) AS n, count(*) FILTER (WHERE status = 'sent') AS sent FROM ai_suggested_replies
			WHERE workspace_id = $1 AND created_at >= $2 AND created_at < $3),
		ch AS (SELECT channel FROM r UNION SELECT channel FROM hand UNION SELECT channel FROM sug)
		SELECT ch.channel,
			(SELECT count(*) FROM conv WHERE conv.channel = ch.channel)::int,
			(SELECT count(*) FROM r WHERE r.channel = ch.channel)::int,
			(SELECT count(*) FROM conv WHERE conv.channel = ch.channel AND resolved)::int,
			COALESCE((SELECT n FROM hand WHERE hand.channel = ch.channel), 0)::int,
			COALESCE((SELECT n FROM sug WHERE sug.channel = ch.channel), 0)::int,
			COALESCE((SELECT sent FROM sug WHERE sug.channel = ch.channel), 0)::int
		FROM ch`, wid, from, to)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var channel string
		var c AgentChannelReport
		if err := rows.Scan(&channel, &c.Conversations, &c.Replies, &c.Resolved, &c.Handoffs, &c.Suggested, &c.SuggestedSent); err != nil {
			return out, err
		}
		if dst := pick(channel); dst != nil {
			*dst = c
		}
	}
	return out, rows.Err()
}
