package hd_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/opendesk/opendesk/internal/helpdesk/hd"
)

func TestAddBusinessMinutes(t *testing.T) {
	berlin, _ := time.LoadLocation("Europe/Berlin")
	bh := hd.DefaultBusinessHours()
	bh.Enabled = true
	bh.Holidays = []hd.Holiday{{Date: "2026-12-25", Name: "Christmas"}}
	at := func(s string) time.Time {
		v, err := time.ParseInLocation("2006-01-02 15:04", s, berlin)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	cases := []struct {
		start string
		mins  int
		want  string
	}{
		{"2026-10-12 10:00", 60, "2026-10-12 11:00"},  // Monday, inside hours
		{"2026-10-12 16:30", 60, "2026-10-13 09:30"},  // runs over the close
		{"2026-10-12 07:00", 30, "2026-10-12 09:30"},  // before opening
		{"2026-10-16 16:00", 120, "2026-10-19 10:00"}, // Friday into Monday
		{"2026-10-17 12:00", 15, "2026-10-19 09:15"},  // Saturday
		{"2026-12-24 16:00", 120, "2026-12-28 10:00"}, // Thursday, Christmas Friday is closed
		{"2026-10-12 10:00", 8 * 60, "2026-10-13 10:00"},
		{"2026-10-23 16:00", 120, "2026-10-26 10:00"}, // across the DST change
	}
	for _, c := range cases {
		got := bh.AddBusinessMinutes(at(c.start), c.mins, berlin)
		if !got.Equal(at(c.want)) {
			t.Errorf("%s + %dm = %s, want %s", c.start, c.mins, got.In(berlin).Format("2006-01-02 15:04"), c.want)
		}
	}
	// Off, or no open time: wall clock.
	off := hd.DefaultBusinessHours()
	if got := off.AddBusinessMinutes(at("2026-10-17 12:00"), 30, berlin); !got.Equal(at("2026-10-17 12:30")) {
		t.Fatalf("off: %s", got)
	}
	closed := hd.BusinessHours{Enabled: true, Schedule: map[string][]hd.TimeRange{}}
	if got := closed.AddBusinessMinutes(at("2026-10-17 12:00"), 30, berlin); !got.Equal(at("2026-10-17 12:30")) {
		t.Fatalf("closed week: %s", got)
	}
}

func TestValidateBusinessHours(t *testing.T) {
	ok := hd.BusinessHours{Enabled: true, Schedule: map[string][]hd.TimeRange{
		"mon": {{Start: "13:00", End: "17:00"}, {Start: "09:00", End: "12:00"}}, "sat": {{Start: "10:00", End: "24:00"}}},
		Holidays: []hd.Holiday{{Date: "2026-12-26", Name: " Boxing  day "}, {Date: "2026-12-25", Name: "Christmas"}, {Date: "2026-12-25", Name: "dup"}}}
	got, err := hd.ValidateBusinessHours(ok)
	if err != nil {
		t.Fatal(err)
	}
	if got.Schedule["mon"][0].Start != "09:00" || len(got.Schedule["tue"]) != 0 || len(got.Holidays) != 2 || got.Holidays[0].Date != "2026-12-25" ||
		got.Holidays[1].Name != "Boxing day" {
		t.Fatalf("normalised %+v", got)
	}
	bad := []map[string][]hd.TimeRange{
		{"mon": {{Start: "09:00", End: "09:00"}}},
		{"mon": {{Start: "09:00", End: "12:00"}, {Start: "11:00", End: "13:00"}}},
		{"mon": {{Start: "09:07", End: "12:00"}}},
		{"mon": {{Start: "25:00", End: "26:00"}}},
		{"funday": {{Start: "09:00", End: "12:00"}}},
		{"mon": {{"01:00", "02:00"}, {"03:00", "04:00"}, {"05:00", "06:00"}, {"07:00", "08:00"}}},
	}
	for _, s := range bad {
		if _, err := hd.ValidateBusinessHours(hd.BusinessHours{Schedule: s}); err == nil {
			t.Errorf("accepted %v", s)
		}
	}
	if _, err := hd.ValidateBusinessHours(hd.BusinessHours{Holidays: []hd.Holiday{{Date: "2026-13-01"}}}); err == nil {
		t.Error("accepted a bad date")
	}
	// Stored settings round-trip through Settings.Hours.
	raw, _ := json.Marshal(map[string]any{"business_hours": got})
	if h := hd.ParseSettings(raw).Hours(); !h.Enabled || len(h.Schedule["sat"]) != 1 {
		t.Fatalf("parsed %+v", h)
	}
}

func TestTriageConfig(t *testing.T) {
	if c := hd.ParseSettings(nil).Triage(); len(c.Fields) != 3 || !c.Sets("severity") || c.Sets("team") || c.AssignAfterTriage ||
		c.AutoTriage || c.Threshold != hd.DefaultTriageThreshold {
		t.Fatalf("defaults %+v", c)
	}
	raw := []byte(`{"ai":{"auto_triage":true,"triage_fields":["labels","bogus"],"assign_after_triage":true}}`)
	c := hd.ParseSettings(raw).Triage()
	if !c.AutoTriage || !c.AssignAfterTriage || c.Sets("priority") || !c.Sets("labels") {
		t.Fatalf("parsed %+v", c)
	}
	if c := hd.ParseSettings([]byte(`{"ai":{"triage_fields":[]}}`)).Triage(); len(c.Fields) != 0 {
		t.Fatalf("empty fields %+v", c)
	}
	if c := hd.ParseSettings([]byte(`{"ai":{"triage_threshold":0.85}}`)).Triage(); c.Threshold != 0.85 {
		t.Fatalf("threshold %+v", c)
	}
	// Out of range values fall back to the default.
	if c := hd.ParseSettings([]byte(`{"ai":{"triage_threshold":0.2}}`)).Triage(); c.Threshold != hd.DefaultTriageThreshold {
		t.Fatalf("threshold %+v", c)
	}
}
