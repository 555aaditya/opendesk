package domain

import (
	"testing"
)

func TestCleanFieldValue(t *testing.T) {
	sel := CustomField{Key: "plan", Name: "Plan", Type: FieldMultiSelect, Options: []FieldOption{{ID: "a"}, {ID: "b"}, {ID: "c"}}}
	v, err := CleanFieldValue(sel, []any{"c", "a", "c"}, nil)
	if err != nil || len(v.([]string)) != 2 || v.([]string)[0] != "a" {
		t.Fatalf("%v %v", v, err)
	}
	for _, c := range []struct {
		f  CustomField
		in any
		ok bool
	}{
		{CustomField{Type: FieldNumber}, 1.5, true},
		{CustomField{Type: FieldNumber}, "1", false},
		{CustomField{Type: FieldDate}, "2026-02-30", false},
		{CustomField{Type: FieldDate}, "2026-02-28", true},
		{CustomField{Type: FieldURL}, "javascript:alert(1)", false},
		{CustomField{Type: FieldURL}, "https://example.com/x", true},
		{CustomField{Type: FieldEmail}, "A@Example.com", true},
		{CustomField{Type: FieldEmail}, "nope", false},
		{CustomField{Type: FieldText}, "tab\tin text", false},
		{CustomField{Type: FieldLongText}, "two\nlines", true},
		{CustomField{Type: FieldCheckbox}, "true", false},
		{CustomField{Type: FieldUser}, "not-a-uuid", false},
	} {
		_, err := CleanFieldValue(c.f, c.in, nil)
		if (err == nil) != c.ok {
			t.Errorf("%s %v: err %v", c.f.Type, c.in, err)
		}
	}
}

func TestMatchField(t *testing.T) {
	num := CustomField{Type: FieldNumber}
	if !MatchField(num, "gte", "3", 3.0) || MatchField(num, "lt", "3", 3.0) || !MatchField(num, "not_set", "", nil) {
		t.Fatal("number")
	}
	multi := CustomField{Type: FieldMultiSelect}
	have := []any{"a", "b"}
	if !MatchField(multi, "all", "a,b", have) || MatchField(multi, "all", "a,c", have) || !MatchField(multi, "none", "c", have) {
		t.Fatal("multi")
	}
	cb := CustomField{Type: FieldCheckbox}
	if !MatchField(cb, "eq", "false", nil) || MatchField(cb, "eq", "true", nil) {
		t.Fatal("checkbox")
	}
	txt := CustomField{Type: FieldText}
	if !MatchField(txt, "contains", "ACME", "acme corp") || !MatchField(txt, "ne", "x", nil) {
		t.Fatal("text")
	}
}

func TestRequiredOnSolve(t *testing.T) {
	defs := FieldDefs{
		"order": {Key: "order", Name: "Order", Type: FieldText, RequiredOnSolve: true},
		"ok":    {Key: "ok", Name: "OK", Type: FieldCheckbox, RequiredOnSolve: true},
		"old":   {Key: "old", Name: "Old", Type: FieldText, RequiredOnSolve: true, Archived: true},
	}
	err := CheckRequiredOnSolve(defs, map[string]any{"ok": false})
	if err == nil || err.Error() != "Fill in OK, Order before solving this ticket." {
		t.Fatalf("%v", err)
	}
	if err := CheckRequiredOnSolve(defs, map[string]any{"ok": true, "order": "1"}); err != nil {
		t.Fatal(err)
	}
}
