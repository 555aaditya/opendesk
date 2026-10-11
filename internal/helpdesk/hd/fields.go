package hd

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"github.com/google/uuid"

	"github.com/useopendesk/opendesk/internal/db"
	"github.com/useopendesk/opendesk/internal/domain"
	"github.com/useopendesk/opendesk/internal/httpx"
)

// FieldFilter is one custom field filter (contracts/api.md FieldFilter).
type FieldFilter struct {
	Key   string `json:"key" maxLength:"40"`
	Op    string `json:"op" enum:"eq,ne,contains,not_contains,gt,gte,lt,lte,any,all,none,set,not_set"`
	Value string `json:"value" maxLength:"500"`
}

// MaxFieldFilters bounds the field filters of one query or view.
const MaxFieldFilters = 20

var fieldParamRe = regexp.MustCompile(`^field\.([a-z][a-z0-9_]{0,39})(?:\[([a-z_]+)\])?$`)

// FieldFiltersFromQuery reads field.<key>=v and field.<key>[op]=v query parameters.
// An empty op is filled in by NormalizeFieldFilters from the field's type.
func FieldFiltersFromQuery(q url.Values) ([]FieldFilter, error) {
	var out []FieldFilter
	for name, vals := range q {
		if !strings.HasPrefix(name, "field.") {
			continue
		}
		m := fieldParamRe.FindStringSubmatch(name)
		if m == nil {
			return nil, httpx.Validation(fmt.Sprintf("%q is not a field filter; use field.<key> or field.<key>[op]", Truncate(name, 60)))
		}
		for _, v := range vals {
			out = append(out, FieldFilter{Key: m[1], Op: m[2], Value: v})
		}
	}
	if len(out) > MaxFieldFilters {
		return nil, httpx.Validation(fmt.Sprintf("use at most %d field filters", MaxFieldFilters))
	}
	return out, nil
}

// NormalizeFieldFilters validates filters against defs and fills in default ops.
func NormalizeFieldFilters(defs domain.FieldDefs, in []FieldFilter) ([]FieldFilter, error) {
	if len(in) > MaxFieldFilters {
		return nil, httpx.Validation(fmt.Sprintf("use at most %d field filters", MaxFieldFilters))
	}
	out := make([]FieldFilter, 0, len(in))
	for _, ff := range in {
		ff.Key, ff.Op = strings.TrimSpace(ff.Key), strings.TrimSpace(ff.Op)
		f, ok := defs[ff.Key]
		if !ok {
			return nil, httpx.Validation(fmt.Sprintf("there is no custom field %q", Truncate(ff.Key, 40)))
		}
		if ff.Op == "" {
			ff.Op = domain.DefaultOp(f.Type)
		}
		v, err := domain.CheckFieldOperand(f, domain.NormalizeOp(ff.Op), ff.Value, true)
		if err != nil {
			return nil, err
		}
		ff.Op, ff.Value = domain.NormalizeOp(ff.Op), v
		out = append(out, ff)
	}
	return out, nil
}

// FieldClause is the SQL predicate for one normalized filter on the jsonb column col
// (e.g. "t.fields"). arg binds a parameter and returns its placeholder; me resolves "me".
func FieldClause(f domain.CustomField, ff FieldFilter, col string, arg func(any) string, me *uuid.UUID) string {
	k := arg(f.Key) + "::text"
	val := col + "->" + k
	txt := "(" + col + "->>" + k + ")"
	switch ff.Op {
	case "set":
		return "(" + val + " IS NOT NULL AND " + val + " NOT IN ('\"\"'::jsonb, '[]'::jsonb, 'null'::jsonb))"
	case "not_set":
		return "(" + val + " IS NULL OR " + val + " IN ('\"\"'::jsonb, '[]'::jsonb, 'null'::jsonb))"
	}
	switch f.Type {
	case domain.FieldText, domain.FieldLongText, domain.FieldURL, domain.FieldEmail:
		v := "lower(" + arg(ff.Value) + "::text)"
		switch ff.Op {
		case "eq":
			return "lower(" + txt + ") = " + v
		case "ne":
			return "lower(" + txt + ") IS DISTINCT FROM " + v
		case "contains":
			return "strpos(lower(" + txt + "), " + v + ") > 0"
		case "not_contains":
			return "COALESCE(strpos(lower(" + txt + "), " + v + "), 0) = 0"
		}
	case domain.FieldNumber, domain.FieldDate:
		var lhs, rhs string
		if f.Type == domain.FieldDate {
			lhs = "(CASE WHEN jsonb_typeof(" + val + ") = 'string' THEN " + txt + " END)"
			rhs = arg(ff.Value) + "::text"
		} else {
			lhs = "(CASE WHEN jsonb_typeof(" + val + ") = 'number' THEN " + txt + "::float8 END)"
			rhs = arg(ff.Value) + "::float8"
		}
		ops := map[string]string{"eq": "=", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}
		if ff.Op == "ne" {
			return lhs + " IS DISTINCT FROM " + rhs
		}
		if o, ok := ops[ff.Op]; ok {
			return lhs + " " + o + " " + rhs
		}
	case domain.FieldCheckbox:
		truthy := "(" + val + " = 'true'::jsonb)"
		want := ff.Value == "true"
		if (ff.Op == "eq") == want {
			return truthy
		}
		return "NOT COALESCE(" + truthy + ", false)"
	case domain.FieldSelect, domain.FieldUser:
		list := domain.SplitList(ff.Value)
		if f.Type == domain.FieldUser {
			resolved := list[:0:0]
			for _, u := range list {
				if u == "me" {
					if me == nil {
						continue
					}
					u = me.String()
				}
				resolved = append(resolved, u)
			}
			list = resolved
		}
		in := txt + " = ANY(" + arg(list) + "::text[])"
		if ff.Op == "ne" || ff.Op == "none" {
			return "NOT COALESCE(" + in + ", false)"
		}
		return "COALESCE(" + in + ", false)"
	case domain.FieldMultiSelect:
		list := arg(domain.SplitList(ff.Value)) + "::text[]"
		arr := "(CASE WHEN jsonb_typeof(" + val + ") = 'array' THEN " + val + " END)"
		switch ff.Op {
		case "any", "eq":
			return "COALESCE(" + arr + " ?| " + list + ", false)"
		case "none", "ne":
			return "NOT COALESCE(" + arr + " ?| " + list + ", false)"
		case "all":
			return "COALESCE(" + arr + " ?& " + list + ", false)"
		}
	}
	return "false"
}

// FieldSortable reports whether a field type can sort lists.
func FieldSortable(typ string) bool {
	switch typ {
	case domain.FieldText, domain.FieldNumber, domain.FieldDate, domain.FieldCheckbox, domain.FieldSelect:
		return true
	}
	return false
}

// FieldSortExpr is a never-null sort expression for f on col and its SQL cast
// ("text", "float8" or "int"); records without a value sort lowest.
func FieldSortExpr(f domain.CustomField, col string, arg func(any) string) (string, string) {
	k := arg(f.Key) + "::text"
	val := col + "->" + k
	txt := "(" + col + "->>" + k + ")"
	switch f.Type {
	case domain.FieldNumber:
		return "COALESCE(CASE WHEN jsonb_typeof(" + val + ") = 'number' THEN " + txt + "::float8 END, '-Infinity'::float8)", "float8"
	case domain.FieldCheckbox:
		return "(CASE WHEN " + val + " = 'true'::jsonb THEN 1 ELSE 0 END)", "int"
	case domain.FieldSelect:
		ids := make([]string, 0, len(f.Options))
		for _, o := range f.Options {
			ids = append(ids, o.ID)
		}
		return "COALESCE(array_position(" + arg(ids) + "::text[], " + txt + "), 0)", "int"
	case domain.FieldDate:
		return "COALESCE(" + txt + ", '')", "text"
	}
	return "lower(COALESCE(" + txt + ", ''))", "text"
}

// LoadDefs loads an entity's field definitions (see domain.LoadFieldDefs).
func LoadDefs(ctx context.Context, q db.Querier, wid uuid.UUID, entity string) (domain.FieldDefs, error) {
	return domain.LoadFieldDefs(ctx, q, wid, entity)
}
