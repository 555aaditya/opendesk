package hd

import (
	"encoding/json"
	"slices"
)

// TriageFields are the ticket fields triage may change.
var TriageFields = []string{"priority", "labels"}

// TriageConfig is the triage part of settings.ai (contracts/api.md "Triage").
type TriageConfig struct {
	AutoTriage bool
	// Fields are what triage may change ("priority", "labels"; default both).
	Fields []string
	// AssignAfterTriage assigns a ticket after auto-triage, attributed to ai.
	AssignAfterTriage bool
}

// Sets reports whether triage may change field.
func (t TriageConfig) Sets(field string) bool { return slices.Contains(t.Fields, field) }

// Triage reads the triage keys of settings.ai.
func (s Settings) Triage() TriageConfig {
	t := TriageConfig{AutoTriage: s.AI().AutoTriage}
	var m struct {
		Fields *[]string `json:"triage_fields"`
		Assign *bool     `json:"assign_after_triage"`
	}
	if len(s.AIRaw) > 0 && json.Unmarshal(s.AIRaw, &m) == nil {
		if m.Fields != nil {
			for _, f := range *m.Fields {
				if slices.Contains(TriageFields, f) && !slices.Contains(t.Fields, f) {
					t.Fields = append(t.Fields, f)
				}
			}
			if t.Fields == nil {
				t.Fields = []string{}
			}
		}
		if m.Assign != nil {
			t.AssignAfterTriage = *m.Assign
		}
	}
	if t.Fields == nil {
		t.Fields = slices.Clone(TriageFields)
	}
	return t
}
