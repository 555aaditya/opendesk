package hd

import (
	"context"
	"fmt"
	"slices"
	"strconv"
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
	ActionTypes        = []string{"set_status", "set_priority", "assign_user", "assign_team", "add_tag", "remove_tag", "send_reply", "add_note", "mark_spam", "ai_triage", "set_field"}
	// Sentiments are the values triage writes to custom.ai_sentiment (contracts/ai.md).
	Sentiments = []string{"positive", "neutral", "negative", "frustrated"}
)

const (
	MaxConditions = 20
	MaxActions    = 20
)

type Condition struct {
	Field string `json:"field" maxLength:"60" doc:"subject, body, from_email, channel, mailbox_id, priority, status, tag, sentiment, field.<key> (ticket custom field) or contact.field.<key>"`
	Op    string `json:"op" enum:"contains,not_contains,equals,not_equals,eq,ne,gt,gte,lt,lte,any,all,none,set,not_set" doc:"eq is an alias of equals, ne of not_equals; custom fields take the ops of their type"`
	Value string `json:"value" maxLength:"500"`
}

type Action struct {
	Type  string `json:"type" enum:"set_status,set_priority,assign_user,assign_team,add_tag,remove_tag,send_reply,add_note,mark_spam,ai_triage,set_field"`
	Value string `json:"value" maxLength:"20000"`
	// Field is the ticket custom field key of set_field.
	Field string `json:"field,omitempty" maxLength:"40"`
}

// ConditionFieldKey splits "field.<key>" (ticket) and "contact.field.<key>" (contact) conditions.
func ConditionFieldKey(field string) (entity, key string, ok bool) {
	if k, found := strings.CutPrefix(field, "contact.field."); found {
		return domain.FieldEntityContact, k, true
	}
	if k, found := strings.CutPrefix(field, "field."); found {
		return domain.FieldEntityTicket, k, true
	}
	return "", "", false
}

// ValidateConditions checks conditions against the enums and the workspace.
func ValidateConditions(ctx context.Context, q db.Querier, wid uuid.UUID, cs []Condition) ([]Condition, error) {
	if len(cs) > MaxConditions {
		return nil, httpx.Validation("an automation can have at most 20 conditions")
	}
	out := make([]Condition, 0, len(cs))
	defs := map[string]domain.FieldDefs{}
	for _, c := range cs {
		c.Field, c.Op = strings.TrimSpace(c.Field), strings.TrimSpace(c.Op)
		if entity, key, ok := ConditionFieldKey(c.Field); ok {
			if defs[entity] == nil {
				d, err := domain.LoadFieldDefs(ctx, q, wid, entity)
				if err != nil {
					return nil, err
				}
				defs[entity] = d
			}
			f, ok := defs[entity][key]
			if !ok {
				return nil, httpx.Validation(fmt.Sprintf("condition field %q is not a custom field of %ss", Truncate(c.Field, 60), entity))
			}
			v, err := domain.CheckFieldOperand(f, domain.NormalizeOp(c.Op), c.Value, false)
			if err != nil {
				return nil, err
			}
			c.Op, c.Value = domain.NormalizeOp(c.Op), v
			out = append(out, c)
			continue
		}
		switch c.Op {
		case "eq":
			c.Op = "equals"
		case "ne":
			c.Op = "not_equals"
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
		case "set_field":
			a.Field = strings.TrimSpace(a.Field)
			defs, err := domain.LoadFieldDefs(ctx, q, wid, domain.FieldEntityTicket)
			if err != nil {
				return nil, err
			}
			f, ok := defs[a.Field]
			if !ok || f.Archived {
				return nil, httpx.Validation("set_field needs field, the key of an active ticket custom field")
			}
			v, err := domain.ParseFieldString(f, a.Value, domain.MemberChecker(ctx, q, wid))
			if err != nil {
				return nil, err
			}
			a.Value = FieldString(v)
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
		if a.Type != "set_field" {
			a.Field = ""
		}
		out = append(out, a)
	}
	return out, nil
}

// FieldString is the string form of a stored field value (set_field action values).
func FieldString(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case bool:
		return strconv.FormatBool(x)
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case []string:
		return strings.Join(x, ",")
	case []any:
		parts := make([]string, 0, len(x))
		for _, e := range x {
			parts = append(parts, fmt.Sprint(e))
		}
		return strings.Join(parts, ",")
	}
	return fmt.Sprint(v)
}
