package hd

import (
	"encoding/json"
	"slices"

	"github.com/opendesk/opendesk/internal/config"
)

// DecisionEngine reports the instance's decision engine (contracts/api.md).
type DecisionEngine struct {
	Provider  string `json:"provider" enum:"typesafe,llm,none"`
	Model     string `json:"model"`
	Connected bool   `json:"connected" doc:"The engine is configured (a TypeSafe key, or an AI provider for llm)"`
}

// Engine describes the configured decision engine; never the key.
func Engine(cfg *config.Config) DecisionEngine {
	switch cfg.DecisionsProvider {
	case "typesafe":
		return DecisionEngine{Provider: "typesafe", Model: cfg.TypesafeModel, Connected: cfg.TypesafeAPIKey != ""}
	case "llm":
		return DecisionEngine{Provider: "llm", Model: cfg.AIFastModel, Connected: cfg.AIEnabled()}
	}
	return DecisionEngine{Provider: "none"}
}

// TriageFields are the ticket fields triage may change.
var TriageFields = []string{"priority", "severity", "labels", "team"}

// DefaultTriageFields apply when a workspace has not chosen (team routing is opt-in).
var DefaultTriageFields = []string{"priority", "severity", "labels"}

// Triage confidence threshold bounds and default (contracts/api.md "Triage").
const (
	MinTriageThreshold     = 0.5
	MaxTriageThreshold     = 0.99
	DefaultTriageThreshold = 0.7
)

// TriageConfig is the triage part of settings.ai (contracts/api.md "Triage").
type TriageConfig struct {
	AutoTriage bool
	// Fields are what triage may change (DefaultTriageFields when unset).
	Fields []string
	// AssignAfterTriage assigns a ticket after auto-triage, attributed to ai.
	AssignAfterTriage bool
	// Threshold is the confidence at or above which a decision is applied; below it
	// the decision is kept as a suggestion.
	Threshold float64
}

// Sets reports whether triage may change field.
func (t TriageConfig) Sets(field string) bool { return slices.Contains(t.Fields, field) }

// Triage reads the triage keys of settings.ai.
func (s Settings) Triage() TriageConfig {
	t := TriageConfig{AutoTriage: s.AI().AutoTriage, Threshold: DefaultTriageThreshold}
	var m struct {
		Fields    *[]string `json:"triage_fields"`
		Assign    *bool     `json:"assign_after_triage"`
		Threshold *float64  `json:"triage_threshold"`
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
		if m.Threshold != nil && *m.Threshold >= MinTriageThreshold && *m.Threshold <= MaxTriageThreshold {
			t.Threshold = *m.Threshold
		}
	}
	if t.Fields == nil {
		t.Fields = slices.Clone(DefaultTriageFields)
	}
	return t
}
