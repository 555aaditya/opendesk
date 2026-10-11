package billing_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/opendesk/opendesk/internal/crypto"
)

// fakeStripe is the slice of the Stripe API billing uses, held in memory.
type fakeStripe struct {
	srv *httptest.Server

	mu        sync.Mutex
	n         int
	customers map[string]url.Values
	sessions  []url.Values // checkout session create forms, in order
	subs      map[string]*fakeSub
	itemForms []url.Values // subscription item update forms
	canceled  []string
	calls     []string
	prices    map[string]map[string]any
}

type fakeSub struct {
	ID, Customer, Status, ItemID, PriceID, Interval string
	Quantity                                        int64
	Metadata                                        map[string]string
	PeriodEnd                                       int64
	CancelAtPeriodEnd                               bool
}

func newFakeStripe() *fakeStripe {
	f := &fakeStripe{customers: map[string]url.Values{}, subs: map[string]*fakeSub{}, prices: map[string]map[string]any{
		"price_pro":     {"id": "price_pro", "object": "price", "unit_amount": 1900, "currency": "usd", "recurring": map[string]any{"interval": "month"}},
		"price_pro_y":   {"id": "price_pro_y", "object": "price", "unit_amount": 19000, "currency": "usd", "recurring": map[string]any{"interval": "year"}},
		"price_credits": {"id": "price_credits", "object": "price", "unit_amount": 1000, "currency": "usd", "recurring": nil},
	}}
	f.srv = httptest.NewServer(http.HandlerFunc(f.serve))
	return f
}

func (f *fakeStripe) id(prefix string) string {
	f.n++
	return prefix + "_" + strconv.Itoa(f.n) + crypto.RandomString(10)
}

// addSub creates a subscription as Stripe would after a completed Checkout.
func (f *fakeStripe) addSub(customer, wid string, qty int64) *fakeSub {
	f.mu.Lock()
	defer f.mu.Unlock()
	s := &fakeSub{ID: f.id("sub"), Customer: customer, Status: "active", ItemID: f.id("si"), PriceID: "price_pro", Interval: "month",
		Quantity: qty, Metadata: map[string]string{"workspace_id": wid}, PeriodEnd: time.Now().Add(30 * 24 * time.Hour).Unix()}
	f.subs[s.ID] = s
	return s
}

func (f *fakeStripe) sub(id string) fakeSub {
	f.mu.Lock()
	defer f.mu.Unlock()
	return *f.subs[id]
}

func (f *fakeStripe) setStatus(id, status string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.subs[id].Status = status
}

func (f *fakeStripe) lastSession() url.Values {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.sessions) == 0 {
		return nil
	}
	return f.sessions[len(f.sessions)-1]
}

func (s *fakeSub) json() map[string]any {
	return map[string]any{"id": s.ID, "object": "subscription", "status": s.Status, "customer": s.Customer, "metadata": s.Metadata,
		"cancel_at_period_end": s.CancelAtPeriodEnd,
		"items": map[string]any{"object": "list", "data": []any{map[string]any{"id": s.ItemID, "object": "subscription_item",
			"quantity": s.Quantity, "current_period_end": s.PeriodEnd, "subscription": s.ID,
			"price": map[string]any{"id": s.PriceID, "object": "price", "recurring": map[string]any{"interval": s.Interval}}}}}}
}

func (f *fakeStripe) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	_ = r.ParseForm()
	f.calls = append(f.calls, r.Method+" "+r.URL.Path)
	if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer sk_test_") {
		writeStripe(w, 401, map[string]any{"error": map[string]any{"type": "invalid_request_error", "message": "bad key"}})
		return
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	missing := func() {
		writeStripe(w, 404, map[string]any{"error": map[string]any{"type": "invalid_request_error", "code": "resource_missing", "message": "No such object"}})
	}
	switch {
	case r.Method == "POST" && r.URL.Path == "/v1/customers":
		id := f.id("cus")
		f.customers[id] = r.PostForm
		writeStripe(w, 200, map[string]any{"id": id, "object": "customer"})
	case r.Method == "POST" && r.URL.Path == "/v1/checkout/sessions":
		f.sessions = append(f.sessions, r.PostForm)
		id := f.id("cs")
		writeStripe(w, 200, map[string]any{"id": id, "object": "checkout.session", "url": "https://checkout.stripe.test/" + id})
	case r.Method == "POST" && r.URL.Path == "/v1/billing_portal/sessions":
		writeStripe(w, 200, map[string]any{"id": f.id("bps"), "object": "billing_portal.session", "url": "https://billing.stripe.test/session"})
	case r.Method == "GET" && len(parts) == 3 && parts[1] == "prices":
		p, ok := f.prices[parts[2]]
		if !ok {
			missing()
			return
		}
		writeStripe(w, 200, p)
	case r.Method == "GET" && r.URL.Path == "/v1/subscriptions":
		data := []any{}
		for _, s := range f.subs {
			if s.Customer == r.Form.Get("customer") && s.Status != "canceled" {
				data = append(data, s.json())
			}
		}
		writeStripe(w, 200, map[string]any{"object": "list", "data": data, "has_more": false, "url": "/v1/subscriptions"})
	case len(parts) == 3 && parts[1] == "subscriptions":
		s, ok := f.subs[parts[2]]
		if !ok {
			missing()
			return
		}
		if r.Method == "DELETE" {
			s.Status = "canceled"
			f.canceled = append(f.canceled, s.ID)
		}
		writeStripe(w, 200, s.json())
	case r.Method == "POST" && len(parts) == 3 && parts[1] == "subscription_items":
		for _, s := range f.subs {
			if s.ItemID == parts[2] {
				f.itemForms = append(f.itemForms, r.PostForm)
				q, _ := strconv.ParseInt(r.PostForm.Get("quantity"), 10, 64)
				s.Quantity = q
				writeStripe(w, 200, map[string]any{"id": s.ItemID, "object": "subscription_item", "quantity": q})
				return
			}
		}
		missing()
	default:
		missing()
	}
}

func writeStripe(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		panic(fmt.Sprint(err))
	}
}
