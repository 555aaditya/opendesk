package hd

import (
	"context"
	"slices"
	"strings"

	"github.com/google/uuid"

	"github.com/opendesk/opendesk/internal/db"
	"github.com/opendesk/opendesk/internal/domain"
	"github.com/opendesk/opendesk/internal/httpx"
	"github.com/opendesk/opendesk/internal/jobs"
)

// Automation enums (contracts/api.md).
var (
	AutomationTriggers = []string{jobs.TriggerTicketCreated, jobs.TriggerCustomerReplied, jobs.TriggerAgentReplied, jobs.TriggerTicketUpdated}
	ConditionFields    = []string{"subject", "body", "from_email", "channel", "mailbox_id", "priority", "status", "tag", "sentiment"}
	ConditionOps       = []string{"contains", "not_contains", "equals", "not_equals"}
	ActionTypes        = []string{"set_status", "set_priority", "assign_user", "assign_team", "add_tag", "remove_tag", "send_reply", "add_note", "mark_spam", "ai_triage"}
	// Sentiments are the values triage writes to custom.ai_sentiment (contracts/ai.md).
	Sentiments = []string{"positive", "neutral", "negative", "frustrated"}
)

const (
	MaxConditions = 20
	MaxActions    = 20
)

type Condition struct {
	Field string `json:"field" enum:"subject,body,from_email,channel,mailbox_id,priority,status,tag,sentiment"`
	Op    string `json:"op" enum:"contains,not_contains,equals,not_equals,eq" doc:"eq is an alias of equals"`
	Value string `json:"value" maxLength:"500"`
}

type Action struct {
	Type  string `json:"type" enum:"set_status,set_priority,assign_user,assign_team,add_tag,remove_tag,send_reply,add_note,mark_spam,ai_triage"`
	Value string `json:"value" maxLength:"20000"`
}

// ValidateConditions checks conditions against the enums and the workspace.
func ValidateConditions(ctx context.Context, q db.Querier, wid uuid.UUID, cs []Condition) ([]Condition, error) {
	if len(cs) > MaxConditions {
		return nil, httpx.Validation("an automation can have at most 20 conditions")
	}
	out := make([]Condition, 0, len(cs))
	for _, c := range cs {
		c.Field, c.Op = strings.TrimSpace(c.Field), strings.TrimSpace(c.Op)
		if c.Op == "eq" {
			c.Op = "equals"
		}
		if !slices.Contains(ConditionFields, c.Field) {
			return nil, httpx.Validation("condition field must be one of " + strings.Join(ConditionFields, ", "))
		}
		if !slices.Contains(ConditionOps, c.Op) {
			return nil, httpx.Validation("condition op must be one of " + strings.Join(ConditionOps, ", "))
		}
		if len([]rune(c.Value)) > 500 {
			return nil, httpx.Validation("condition values must be 500 characters or less")
		}
		exact := c.Op == "equals" || c.Op == "not_equals"
		switch c.Field {
		case "channel":
			if exact && !slices.Contains(domain.Channels, c.Value) {
				return nil, httpx.Validation("channel must be one of " + strings.Join(domain.Channels, ", "))
			}
		case "priority":
			if exact && !slices.Contains(domain.Priorities, c.Value) {
				return nil, httpx.Validation("priority must be one of " + strings.Join(domain.Priorities, ", "))
			}
		case "status":
			if exact && !slices.Contains(domain.Statuses, c.Value) {
				return nil, httpx.Validation("status must be one of " + strings.Join(domain.Statuses, ", "))
			}
		case "sentiment":
			if !exact || !slices.Contains(Sentiments, c.Value) {
				return nil, httpx.Validation("sentiment conditions use equals or not_equals with one of " + strings.Join(Sentiments, ", "))
			}
		case "mailbox_id":
			if exact {
				id, err := ParseRef(c.Value, "mailbox_id")
				if err != nil {
					return nil, err
				}
				if err := CheckRef(ctx, q, wid, "mailbox", id); err != nil {
					return nil, err
				}
				c.Value = id.String()
			}
		}
		out = append(out, c)
	}
	return out, nil
}

// ValidateActions checks actions and sanitizes reply and note bodies.
func ValidateActions(ctx context.Context, q db.Querier, wid uuid.UUID, as []Action) ([]Action, error) {
	if len(as) == 0 {
		return nil, httpx.Validation("an automation needs at least one action")
	}
	if len(as) > MaxActions {
		return nil, httpx.Validation("an automation can have at most 20 actions")
	}
	out := make([]Action, 0, len(as))
	for _, a := range as {
		a.Type = strings.TrimSpace(a.Type)
		switch a.Type {
		case "set_status":
			if !slices.Contains(domain.Statuses, a.Value) {
				return nil, httpx.Validation("set_status value must be one of " + strings.Join(domain.Statuses, ", "))
			}
		case "set_priority":
			if !slices.Contains(domain.Priorities, a.Value) {
				return nil, httpx.Validation("set_priority value must be one of " + strings.Join(domain.Priorities, ", "))
			}
		case "assign_user":
			id, err := ParseRef(a.Value, "assign_user value")
			if err != nil {
				return nil, err
			}
			if err := CheckMember(ctx, q, wid, id); err != nil {
				return nil, err
			}
			a.Value = id.String()
		case "assign_team":
			id, err := ParseRef(a.Value, "assign_team value")
			if err != nil {
				return nil, err
			}
			if err := CheckRef(ctx, q, wid, "team", id); err != nil {
				return nil, err
			}
			a.Value = id.String()
		case "add_tag", "remove_tag":
			name, err := CleanTagName(a.Value)
			if err != nil {
				return nil, err
			}
			a.Value = name
		case "send_reply", "add_note":
			a.Value = SanitizeRich(a.Value)
			if HTMLToText(a.Value) == "" {
				return nil, httpx.Validation(a.Type + " needs a message")
			}
		case "ai_triage":
			a.Value = ""
		case "mark_spam":
			switch a.Value {
			case "", "true":
				a.Value = "true"
			case "false":
			default:
				return nil, httpx.Validation(`mark_spam value must be "true" or "false"`)
			}
		default:
			return nil, httpx.Validation("action type must be one of " + strings.Join(ActionTypes, ", "))
		}
		out = append(out, a)
	}
	return out, nil
}
