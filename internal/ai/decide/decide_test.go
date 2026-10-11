package decide

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeTS mimics POST /v1/systemone (docs.typesafe.ai/api).
type fakeTS struct {
	mu       sync.Mutex
	srv      *httptest.Server
	bodies   [][]byte
	headers  []http.Header
	statuses []int // returned before answering
	reply    func(questions map[string]map[string]any) map[string]any
}

func newFakeTS(t *testing.T) *fakeTS {
	f := &fakeTS{}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		f.bodies = append(f.bodies, raw)
		f.headers = append(f.headers, r.Header.Clone())
		var st int
		if len(f.statuses) > 0 {
			st, f.statuses = f.statuses[0], f.statuses[1:]
		}
		f.mu.Unlock()
		if r.URL.Path != "/v1/systemone" || r.Method != http.MethodPost {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if st != 0 {
			w.Header().Set("retry-after-ms", "1")
			w.WriteHeader(st)
			_, _ = w.Write([]byte(`{"detail":"customer text echoed here"}`))
			return
		}
		var req struct {
			Model     string                    `json:"model"`
			Questions map[string]map[string]any `json:"questions"`
		}
		_ = json.Unmarshal(raw, &req)
		answers := map[string]any{}
		if f.reply != nil {
			answers = f.reply(req.Questions)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"model": "jev-1.13.0", "answers": answers,
			"usage": map[string]int{"input_tokens": 300, "output_tokens": 20}})
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func sample() Request {
	return Request{State: map[string]any{"ticket": map[string]any{"subject": "Payouts failing"}}, Questions: map[string]Question{
		"department": Choice("Which team?", Options{{"technical", "Bugs"}, {"billing", "Payments"}, {"sales", nil}}),
		"severity":   Score("How severe?", "Minor", "Major", "Critical"),
		"urgent":     Noul("Is it urgent?", "Time-sensitive", "No urgency"),
	}}
}

func goodReply(map[string]map[string]any) map[string]any {
	return map[string]any{
		"department": map[string]any{"type": "choice", "choice": "billing", "probabilities": map[string]float64{"billing": 0.88, "technical": 0.12, "sales": 0}, "confidence": 0.81},
		"severity": map[string]any{"type": "score", "score": 1.05, "legend": map[string]string{"0": "Minor", "1": "Major", "2": "Critical"},
			"probabilities": map[string]float64{"0": 0, "1": 0.95, "2": 0.05}, "confidence": 0.92},
		"urgent": map[string]any{"type": "noul", "noul": 0.95},
	}
}

func TestRequestShapeAndBatching(t *testing.T) {
	f := newFakeTS(t)
	f.reply = goodReply
	c := NewTypeSafe(f.srv.URL+"/", "ts-secret", "")
	res, err := c.Decide(context.Background(), sample())
	if err != nil {
		t.Fatal(err)
	}
	if len(f.bodies) != 1 {
		t.Fatalf("questions must go in one call, got %d", len(f.bodies))
	}
	if h := f.headers[0]; h.Get("Authorization") != "Bearer ts-secret" || h.Get("Content-Type") != "application/json" {
		t.Fatalf("headers %v", h)
	}
	var body map[string]any
	if err := json.Unmarshal(f.bodies[0], &body); err != nil {
		t.Fatal(err)
	}
	if body["model"] != "jev-latest" || body["state"] == nil {
		t.Fatalf("body %s", f.bodies[0])
	}
	qs := body["questions"].(map[string]any)
	dep := qs["department"].(map[string]any)
	if dep["type"] != "choice" || dep["instructions"] != "Which team?" {
		t.Fatalf("choice %v", dep)
	}
	// Options keep the caller's order on the wire.
	if s := string(f.bodies[0]); !(strings.Index(s, `"technical"`) < strings.Index(s, `"billing"`) && strings.Index(s, `"billing"`) < strings.Index(s, `"sales":null`)) {
		t.Fatalf("option order lost: %s", s)
	}
	if sc := qs["severity"].(map[string]any); sc["type"] != "score" || len(sc["criteria"].([]any)) != 3 {
		t.Fatalf("score %v", sc)
	}
	if n := qs["urgent"].(map[string]any); n["type"] != "noul" || n["criteria"].(map[string]any)["true"] != "Time-sensitive" {
		t.Fatalf("noul %v", n)
	}
	if res.Model != "jev-1.13.0" || res.InputTokens != 300 {
		t.Fatalf("result %+v", res)
	}
	d := res.Answers["department"]
	if d.Choice != "billing" || d.Probability() != 0.88 || *d.Conf() != 0.81 {
		t.Fatalf("choice %+v", d)
	}
	s := res.Answers["severity"]
	if s.Level() != 1 || s.Probability() != 0.95 || *s.Conf() != 0.92 {
		t.Fatalf("score %+v", s)
	}
	u := res.Answers["urgent"]
	if u.Noul != 0.95 || u.Probability() != 0.95 || *u.Conf() < 0.899 || *u.Conf() > 0.901 {
		t.Fatalf("noul %+v conf %v", u, *u.Conf())
	}
}

func TestRetriesRateLimitsAndOverload(t *testing.T) {
	f := newFakeTS(t)
	f.reply = goodReply
	f.statuses = []int{429, 529}
	c := NewTypeSafe(f.srv.URL, "k", "jev-1.13.0")
	start := time.Now()
	if _, err := c.Decide(context.Background(), sample()); err != nil {
		t.Fatal(err)
	}
	if len(f.bodies) != 3 || time.Since(start) > 5*time.Second {
		t.Fatalf("attempts %d", len(f.bodies))
	}
	// Still rate limited after every attempt: busy.
	f.statuses = []int{429, 429, 429}
	f.bodies = nil
	if _, err := c.Decide(context.Background(), sample()); !errors.Is(err, ErrBusy) {
		t.Fatalf("err %v", err)
	}
}

func TestNoRetryOnAuthAndValidation(t *testing.T) {
	for _, st := range []int{401, 422} {
		f := newFakeTS(t)
		f.reply = goodReply
		f.statuses = []int{st}
		c := NewTypeSafe(f.srv.URL, "ts-secret", "")
		_, err := c.Decide(context.Background(), sample())
		if !errors.Is(err, ErrRejected) || len(f.bodies) != 1 {
			t.Fatalf("%d: err %v attempts %d", st, err, len(f.bodies))
		}
		// Errors are fixed values: no key, request or response body.
		if msg := err.Error(); strings.Contains(msg, "ts-secret") || strings.Contains(msg, "customer") || strings.Contains(msg, "Payouts") {
			t.Fatalf("error leaks content: %q", msg)
		}
	}
}

func TestServerErrorsAndTimeouts(t *testing.T) {
	f := newFakeTS(t)
	f.statuses = []int{500, 502, 503}
	c := NewTypeSafe(f.srv.URL, "k", "")
	if _, err := c.Decide(context.Background(), sample()); !errors.Is(err, ErrUnavailable) || len(f.bodies) != 3 {
		t.Fatalf("err %v attempts %d", err, len(f.bodies))
	}
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(2 * time.Second):
		}
	}))
	t.Cleanup(slow.Close)
	c = NewTypeSafe(slow.URL, "k", "")
	c.Timeout, c.Attempts = 50*time.Millisecond, 2
	if _, err := c.Decide(context.Background(), sample()); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("timeout err %v", err)
	}
}

func TestBadAnswersAreRefused(t *testing.T) {
	f := newFakeTS(t)
	c := NewTypeSafe(f.srv.URL, "k", "")
	// Missing answers.
	f.reply = func(map[string]map[string]any) map[string]any { return map[string]any{} }
	if _, err := c.Decide(context.Background(), sample()); !errors.Is(err, ErrBadOutput) || len(f.bodies) != 1 {
		t.Fatalf("missing: %v (%d attempts)", err, len(f.bodies))
	}
	// A choice that is not an option.
	f.reply = func(q map[string]map[string]any) map[string]any {
		r := goodReply(q)
		r["department"] = map[string]any{"type": "choice", "choice": "legal", "probabilities": map[string]float64{"legal": 1}, "confidence": 1}
		return r
	}
	if _, err := c.Decide(context.Background(), sample()); !errors.Is(err, ErrBadOutput) {
		t.Fatalf("unknown option: %v", err)
	}
}

func TestValidateLimits(t *testing.T) {
	opts := Options{}
	for i := 0; i < MaxChoiceOptions+1; i++ {
		opts = append(opts, Option{Key: strings.Repeat("x", i+1)})
	}
	if err := Choice("q", opts).Validate(); err == nil {
		t.Fatal("256 options accepted")
	}
	if err := Choice("q", opts[:MaxChoiceOptions]).Validate(); err != nil {
		t.Fatal(err)
	}
	if err := Score("q", "only one").Validate(); err == nil {
		t.Fatal("one level accepted")
	}
	f := newFakeTS(t)
	c := NewTypeSafe(f.srv.URL, "k", "")
	if _, err := c.Decide(context.Background(), Request{Questions: map[string]Question{"x": Score("q", "one")}}); err == nil || len(f.bodies) != 0 {
		t.Fatal("invalid question was sent")
	}
}
