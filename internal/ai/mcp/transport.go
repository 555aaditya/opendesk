package mcp

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"github.com/useopendesk/opendesk/internal/netsafe"
	"github.com/useopendesk/opendesk/internal/version"
)

var errTooLarge = errors.New("response too large")

// userAgent identifies opendesk to MCP and authorization servers.
var userAgent = "opendesk/" + version.Version + " (+https://opendesk.sh)"

// transport adds the server's credentials to requests for the server's own origin,
// caps response sizes and remembers what went wrong, so a failure can be reported with
// a fixed message. Every connection goes through the registry's guarded dialer.
type transport struct {
	base   http.RoundTripper
	origin string // scheme://host[:port] of the server URL
	header string // credential header name ("" = none)
	value  string

	mu       sync.Mutex
	status   int      // last response status
	wwwAuth  []string // WWW-Authenticate of the last 401
	authFail bool     // a 401 or 403 was seen
	unauth   bool     // a 401 was seen
	blocked  bool     // a destination was refused by the SSRF guard
	tooLarge bool
}

func originOf(u *url.URL) string { return strings.ToLower(u.Scheme + "://" + u.Host) }

func (t *transport) RoundTrip(req *http.Request) (*http.Response, error) {
	req = req.Clone(req.Context())
	req.Header.Set("User-Agent", userAgent)
	if t.header != "" && originOf(req.URL) == t.origin {
		req.Header.Set(t.header, t.value)
	}
	res, err := t.base.RoundTrip(req)
	if err != nil {
		if errors.Is(err, netsafe.ErrBlocked) {
			t.mu.Lock()
			t.blocked = true
			t.mu.Unlock()
		}
		return nil, err
	}
	t.mu.Lock()
	t.status = res.StatusCode
	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		t.authFail = true
		if res.StatusCode == http.StatusUnauthorized {
			t.unauth = true
			t.wwwAuth = res.Header.Values("WWW-Authenticate")
		}
	}
	t.mu.Unlock()
	limit := int64(maxResponse)
	if req.Method == http.MethodGet && strings.Contains(req.Header.Get("Accept"), "text/event-stream") {
		limit = maxStream
	}
	res.Body = &limitedBody{rc: res.Body, left: limit, onExceed: func() {
		t.mu.Lock()
		t.tooLarge = true
		t.mu.Unlock()
	}}
	return res, nil
}

type transportState struct {
	status   int
	wwwAuth  []string
	authFail bool
	unauth   bool
	blocked  bool
	tooLarge bool
}

func (t *transport) state() transportState {
	t.mu.Lock()
	defer t.mu.Unlock()
	return transportState{status: t.status, wwwAuth: t.wwwAuth, authFail: t.authFail, unauth: t.unauth, blocked: t.blocked, tooLarge: t.tooLarge}
}

// limitedBody fails a read past its limit instead of truncating silently.
type limitedBody struct {
	rc       io.ReadCloser
	left     int64
	onExceed func()
}

func (b *limitedBody) Read(p []byte) (int, error) {
	if b.left <= 0 {
		// Probe for one more byte: a body of exactly the limit is fine.
		var one [1]byte
		n, err := b.rc.Read(one[:])
		if n > 0 {
			b.onExceed()
			return 0, errTooLarge
		}
		return 0, err
	}
	if int64(len(p)) > b.left {
		p = p[:b.left]
	}
	n, err := b.rc.Read(p)
	b.left -= int64(n)
	return n, err
}

func (b *limitedBody) Close() error { return b.rc.Close() }

// httpClient is a client for one server: guarded, credentials for its origin only,
// at most maxRedirects redirects, each to https (or loopback http on a development
// instance) and re-checked by the dialer. Contexts bound every request.
func (r *Registry) httpClient(t *transport) *http.Client {
	return &http.Client{
		Transport: t,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxRedirects {
				return fmt.Errorf("stopped after %d redirects", maxRedirects)
			}
			return r.checkScheme(req.URL)
		},
	}
}

func (r *Registry) checkScheme(u *url.URL) error {
	switch {
	case u.User != nil:
		return errors.New("URL with credentials")
	case u.Scheme == "https":
		return nil
	case u.Scheme == "http" && r.dev && netsafe.IsLoopbackHost(u.Hostname()):
		return nil
	}
	return errors.New("URL must use https")
}

// newTransport builds the transport for a server URL and credential header.
func (r *Registry) newTransport(serverURL, header, value string) (*transport, error) {
	u, err := url.Parse(serverURL)
	if err != nil {
		return nil, err
	}
	return &transport{base: r.base, origin: originOf(u), header: header, value: value}, nil
}

// plainClient is a guarded client without credentials, for OAuth metadata and token
// endpoints.
func (r *Registry) plainClient() (*http.Client, *transport) {
	t := &transport{base: r.base}
	return r.httpClient(t), t
}

// postClient is plainClient without redirects, for requests that carry client
// credentials or tokens (registration, token, revocation endpoints).
func (r *Registry) postClient() *http.Client {
	hc, _ := r.plainClient()
	hc.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return hc
}

// readBody reads at most maxResponse bytes of a body.
func readBody(res *http.Response) ([]byte, error) {
	b, err := io.ReadAll(io.LimitReader(res.Body, maxResponse+1))
	if err != nil {
		return nil, err
	}
	if len(b) > maxResponse {
		return nil, errTooLarge
	}
	return b, nil
}
