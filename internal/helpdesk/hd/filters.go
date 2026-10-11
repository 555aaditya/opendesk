package hd

import (
	"context"
	"slices"
	"strings"

	"github.com/google/uuid"

	"github.com/opendesk/opendesk/internal/db"
	"github.com/opendesk/opendesk/internal/domain"
	"github.com/opendesk/opendesk/internal/httpx"
)

// SeverityFilterValues are the severities a filter may name; "none" is no severity.
var SeverityFilterValues = append(append([]string{}, domain.Severities...), "none")

// TicketFilters is a saved view's filter set (contracts/api.md TicketFilters).
// Assignee is "me", "none" or a user id.
type TicketFilters struct {
	Status    []string `json:"status,omitempty" enum:"open,pending,on_hold,solved,closed"`
	Priority  []string `json:"priority,omitempty" enum:"low,normal,high,urgent"`
	Severity  []string `json:"severity,omitempty" enum:"sev1,sev2,sev3,sev4,none" doc:"none: tickets without a severity"`
	Assignee  string   `json:"assignee,omitempty"`
	TeamID    string   `json:"team_id,omitempty"`
	MailboxID string   `json:"mailbox_id,omitempty"`
	Tag       string   `json:"tag,omitempty"`
	Channel   string   `json:"channel,omitempty" enum:"email,chat,api,portal"`
	Q         string   `json:"q,omitempty" maxLength:"200"`
	// Fields are custom field filters, ANDed.
	Fields []FieldFilter `json:"fields,omitempty" maxItems:"20"`
}

// Normalize trims values and validates every field against the contract enums and the
// workspace's own rows.
func (f *TicketFilters) Normalize(ctx context.Context, q db.Querier, wid uuid.UUID) error {
	var err error
	if f.Status, err = enumList(f.Status, domain.Statuses, "status"); err != nil {
		return err
	}
	if f.Priority, err = enumList(f.Priority, domain.Priorities, "priority"); err != nil {
		return err
	}
	if f.Severity, err = enumList(f.Severity, SeverityFilterValues, "severity"); err != nil {
		return err
	}
	f.Assignee = strings.TrimSpace(f.Assignee)
	switch f.Assignee {
	case "", "me", "none":
	default:
		id, err := ParseRef(f.Assignee, "assignee")
		if err != nil {
			return err
		}
		var exists bool
		if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM members WHERE workspace_id = $1 AND user_id = $2)`, wid, id).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return httpx.Validation("assignee is not a member of this workspace")
		}
		f.Assignee = id.String()
	}
	for _, ref := range []struct {
		v    *string
		kind string
	}{{&f.TeamID, "team"}, {&f.MailboxID, "mailbox"}} {
		*ref.v = strings.TrimSpace(*ref.v)
		if *ref.v == "" {
			continue
		}
		id, err := ParseRef(*ref.v, ref.kind+"_id")
		if err != nil {
			return err
		}
		if err := CheckRef(ctx, q, wid, ref.kind, id); err != nil {
			return err
		}
		*ref.v = id.String()
	}
	f.Tag = strings.TrimSpace(f.Tag)
	if len([]rune(f.Tag)) > 50 {
		return httpx.Validation("tag must be 50 characters or less")
	}
	f.Channel = strings.TrimSpace(f.Channel)
	if f.Channel != "" && !slices.Contains(domain.Channels, f.Channel) {
		return httpx.Validation("channel must be one of " + strings.Join(domain.Channels, ", "))
	}
	f.Q = strings.TrimSpace(f.Q)
	if len([]rune(f.Q)) > 200 {
		return httpx.Validation("q must be 200 characters or less")
	}
	if len(f.Fields) > 0 {
		defs, err := domain.LoadFieldDefs(ctx, q, wid, domain.FieldEntityTicket)
		if err != nil {
			return err
		}
		if f.Fields, err = NormalizeFieldFilters(defs, f.Fields); err != nil {
			return err
		}
	} else {
		f.Fields = nil
	}
	return nil
}

func enumList(in, allowed []string, field string) ([]string, error) {
	var out []string
	for _, v := range in {
		v = strings.TrimSpace(v)
		if v == "" || slices.Contains(out, v) {
			continue
		}
		if !slices.Contains(allowed, v) {
			return nil, httpx.Validation(field + " must be one of " + strings.Join(allowed, ", "))
		}
		out = append(out, v)
	}
	return out, nil
}

// SplitCSV splits a comma separated query value.
func SplitCSV(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
