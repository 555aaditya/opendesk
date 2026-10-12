package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/jsonrpc"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/modelcontextprotocol/go-sdk/oauthex"

	"github.com/useopendesk/opendesk/internal/version"
)

// conn is one pooled session with a server, valid while the server's settings and
// credentials are unchanged (serverKey).
type conn struct {
	session  *sdk.ClientSession
	tr       *transport
	key      string // serverKey of the server it was built for
	legacy   bool   // HTTP+SSE instead of Streamable HTTP
	stop     context.CancelFunc
	lastUsed atomic.Int64
	dead     atomic.Bool
}

func (c *conn) touch(now time.Time) { c.lastUsed.Store(now.UnixNano()) }

func (c *conn) close() {
	c.dead.Store(true)
	_ = c.session.Close()
	c.stop()
}

// connectError is a failed connection, with a fixed message for the server's status.
type connectError struct {
	status  string // StatusNeedsAuth or StatusError
	message string
	// wwwAuth is the WWW-Authenticate of a 401, for OAuth discovery.
	wwwAuth []string
	// transient failures (unreachable, timeouts) may be retried.
	transient bool
	cause     error
}

func (e *connectError) Error() string { return e.message }
func (e *connectError) Unwrap() error { return e.cause }

// Fixed, safe status messages: never the server's own text.
const (
	msgUnreachable = "Could not reach the server."
	msgBlocked     = "The server's address is not allowed. Use a public https URL."
	msgCredentials = "The server did not accept the credentials."
	msgSignIn      = "Sign in to connect this server."
	msgSignInAgain = "The sign-in expired. Sign in again to reconnect this server."
	msgProtocol    = "The server did not answer as an MCP server."
	msgTooLarge    = "The server's answer was too large."
	msgTimeout     = "The server took too long to answer."
	msgNoTools     = "The server does not offer tools."
)

// classify turns a connection failure into a connectError.
func classify(ctx context.Context, err error, st transportState, kind string) *connectError {
	var ce *connectError
	if errors.As(err, &ce) {
		return ce
	}
	switch {
	case st.blocked:
		return &connectError{status: StatusError, message: msgBlocked, cause: err}
	case st.tooLarge:
		return &connectError{status: StatusError, message: msgTooLarge, cause: err}
	case st.unauth && kind == AuthNone && !bearerChallenge(st.wwwAuth):
		// Another scheme (Basic, an API key): the admin adds a token or header.
		return &connectError{status: StatusError, message: msgCredentials, cause: err}
	case st.unauth && (kind == AuthNone || kind == AuthOAuth), st.authFail && kind == AuthOAuth:
		return &connectError{status: StatusNeedsAuth, message: msgSignIn, wwwAuth: st.wwwAuth, cause: err}
	case st.authFail:
		return &connectError{status: StatusError, message: msgCredentials, cause: err}
	case errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded):
		return &connectError{status: StatusError, message: msgTimeout, transient: true, cause: err}
	case st.status == 0:
		return &connectError{status: StatusError, message: msgUnreachable, transient: true, cause: err}
	case st.status >= 500:
		return &connectError{status: StatusError, message: msgUnreachable, transient: true, cause: err}
	}
	return &connectError{status: StatusError, message: msgProtocol, cause: err}
}

// bearerChallenge reports a 401 that asks for a bearer token (or names no scheme, as
// servers of the first MCP authorization spec do): the server signs in with OAuth.
func bearerChallenge(wwwAuth []string) bool {
	if len(wwwAuth) == 0 {
		return true
	}
	cs, err := oauthex.ParseWWWAuthenticate(wwwAuth)
	if err != nil {
		return false
	}
	for _, c := range cs {
		if c.Scheme == "bearer" {
			return true
		}
	}
	return false
}

// credential returns the header a connection sends, refreshing an OAuth token first
// when it is about to expire.
func (r *Registry) credential(ctx context.Context, s *server) (string, string, error) {
	switch s.AuthKind {
	case AuthBearer:
		sec, err := s.open(r.d.Box)
		if err != nil {
			return "", "", err
		}
		if sec.Token == "" {
			return "", "", nil
		}
		return "Authorization", "Bearer " + sec.Token, nil
	case AuthHeader:
		sec, err := s.open(r.d.Box)
		if err != nil {
			return "", "", err
		}
		if s.HeaderName == nil || sec.HeaderValue == "" {
			return "", "", nil
		}
		return *s.HeaderName, sec.HeaderValue, nil
	case AuthOAuth:
		tok, err := r.accessToken(ctx, s, false)
		if err != nil {
			return "", "", err
		}
		if tok == "" {
			return "", "", nil
		}
		return "Authorization", "Bearer " + tok, nil
	}
	return "", "", nil
}

// dial connects to url with one credential header: Streamable HTTP first, then the
// legacy HTTP+SSE transport when the server refuses Streamable HTTP's POST.
func (r *Registry) dial(ctx context.Context, rawURL, header, value, kind string) (*conn, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	tr, err := r.newTransport(rawURL, header, value)
	if err != nil {
		return nil, &connectError{status: StatusError, message: msgProtocol, cause: err}
	}
	hc := r.httpClient(tr)
	client := sdk.NewClient(&sdk.Implementation{Name: "opendesk", Title: "opendesk", Version: version.Version},
		&sdk.ClientOptions{Capabilities: &sdk.ClientCapabilities{}})

	cctx, cancel := context.WithTimeout(ctx, listTimeout)
	defer cancel()
	st := &sdk.StreamableClientTransport{Endpoint: rawURL, HTTPClient: hc, MaxRetries: 2, DisableStandaloneSSE: true, MaxEventSize: maxResponse}
	cs, err := client.Connect(cctx, st, nil)
	if err == nil {
		c := &conn{session: cs, tr: tr, stop: func() {}}
		return c, nil
	}
	state := tr.state()
	if state.authFail || state.blocked || state.tooLarge || cctx.Err() != nil {
		return nil, classify(cctx, err, state, kind)
	}
	if s := state.status; s != http.StatusBadRequest && s != http.StatusNotFound && s != http.StatusMethodNotAllowed {
		return nil, classify(cctx, err, state, kind)
	}

	// Legacy HTTP+SSE: the GET stream lives as long as the session, so it is bound to a
	// context the connection owns; the connect deadline cancels it only until connected.
	tr2, _ := r.newTransport(rawURL, header, value)
	life, stop := context.WithCancel(context.WithoutCancel(ctx))
	connected := make(chan struct{})
	go func() {
		select {
		case <-connected:
		case <-cctx.Done():
			stop()
		}
	}()
	cs, err = client.Connect(life, &sdk.SSEClientTransport{Endpoint: rawURL, HTTPClient: r.httpClient(tr2), MaxEventSize: maxResponse}, nil)
	close(connected)
	if err != nil {
		stop()
		st2 := tr2.state()
		if st2.status == 0 && !st2.blocked && cctx.Err() == nil {
			st2 = state // the GET never answered: report the Streamable HTTP failure
		}
		return nil, classify(cctx, err, st2, kind)
	}
	if cctx.Err() != nil {
		_ = cs.Close()
		stop()
		return nil, classify(cctx, cctx.Err(), tr2.state(), kind)
	}
	return &conn{session: cs, tr: tr2, legacy: true, stop: stop}, nil
}

// session returns the pooled connection for s, connecting when there is none for the
// server's current version. Concurrent callers share one dial.
func (r *Registry) session(ctx context.Context, s *server) (*conn, error) {
	if c := r.pooled(s); c != nil {
		return c, nil
	}
	r.mu.Lock()
	m := r.dials[s.ID]
	if m == nil {
		m = &sync.Mutex{}
		r.dials[s.ID] = m
	}
	r.mu.Unlock()
	m.Lock()
	defer m.Unlock()
	if c := r.pooled(s); c != nil {
		return c, nil
	}
	header, value, err := r.credential(ctx, s)
	if err != nil {
		return nil, err
	}
	c, err := r.dial(ctx, s.URL, header, value, s.AuthKind)
	if err != nil {
		return nil, err
	}
	c.key = serverKey(s)
	c.touch(r.now())
	go func() {
		_ = c.session.Wait()
		c.dead.Store(true)
		r.drop(s.ID, c)
	}()
	r.mu.Lock()
	old := r.conns[s.ID]
	r.conns[s.ID] = c
	r.mu.Unlock()
	if old != nil {
		old.close()
	}
	return c, nil
}

// serverKey changes with the server's settings (version) and its OAuth token expiry, so
// a refreshed token, even one refreshed by another process, rebuilds the connection.
func serverKey(s *server) string {
	k := strconv.Itoa(s.Version)
	if s.OAuth.ExpiresAt != nil {
		k += ":" + strconv.FormatInt(s.OAuth.ExpiresAt.UnixNano(), 10)
	}
	return k
}

func (r *Registry) pooled(s *server) *conn {
	r.mu.Lock()
	defer r.mu.Unlock()
	c := r.conns[s.ID]
	if c == nil || c.dead.Load() || c.key != serverKey(s) {
		return nil
	}
	c.touch(r.now())
	return c
}

// drop removes c from the pool (if it is still the server's connection) and closes it.
func (r *Registry) drop(id uuid.UUID, c *conn) {
	r.mu.Lock()
	if r.conns[id] == c {
		delete(r.conns, id)
	}
	r.mu.Unlock()
	c.close()
}

// Forget closes the pooled connection of a server (deleted or changed).
func (r *Registry) forget(id uuid.UUID) {
	r.mu.Lock()
	c := r.conns[id]
	delete(r.conns, id)
	r.mu.Unlock()
	if c != nil {
		c.close()
	}
}

// janitor closes connections idle for idleTimeout.
func (r *Registry) janitor(ctx context.Context) {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			r.closeIdle()
		}
	}
}

func (r *Registry) closeIdle() {
	cutoff := r.now().Add(-idleTimeout).UnixNano()
	var idle []*conn
	r.mu.Lock()
	for id, c := range r.conns {
		if c.lastUsed.Load() < cutoff || c.dead.Load() {
			idle = append(idle, c)
			delete(r.conns, id)
		}
	}
	r.mu.Unlock()
	for _, c := range idle {
		c.close()
	}
}

// listTools lists the server's tools (at most maxToolsListed).
func listTools(ctx context.Context, cs *sdk.ClientSession) ([]cachedTool, error) {
	ctx, cancel := context.WithTimeout(ctx, listTimeout)
	defer cancel()
	if init := cs.InitializeResult(); init != nil && init.Capabilities != nil && init.Capabilities.Tools == nil {
		return []cachedTool{}, nil
	}
	out := []cachedTool{}
	seen := map[string]bool{}
	for t, err := range cs.Tools(ctx, nil) {
		if err != nil {
			return nil, err
		}
		if t == nil || t.Name == "" || seen[t.Name] || len(t.Name) > 128 {
			continue
		}
		seen[t.Name] = true
		out = append(out, toCached(t))
		if len(out) >= maxToolsListed {
			break
		}
	}
	return out, nil
}

func toCached(t *sdk.Tool) cachedTool {
	ct := cachedTool{Name: t.Name, Title: cleanText(t.Title, 200), Description: cleanText(t.Description, 1000)}
	readOnly, destructive := false, true
	if a := t.Annotations; a != nil {
		readOnly = a.ReadOnlyHint
		if a.DestructiveHint != nil {
			destructive = *a.DestructiveHint
		}
		if ct.Title == "" {
			ct.Title = cleanText(a.Title, 200)
		}
	}
	// destructiveHint is meaningful only for tools that are not read-only (default true).
	ct.ReadOnly, ct.Destructive = readOnly, !readOnly && destructive
	ct.InputSchema = schemaMap(t.InputSchema)
	return ct
}

// schemaMap normalizes an input schema to a JSON object of at most 32 KB.
func schemaMap(v any) map[string]any {
	fallback := map[string]any{"type": "object"}
	raw, err := json.Marshal(v)
	if err != nil || len(raw) > 32<<10 {
		return fallback
	}
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil || m == nil {
		return fallback
	}
	if _, ok := m["type"]; !ok {
		m["type"] = "object"
	}
	return m
}

// call runs a tool on s. It retries once, on a new connection, only when the call
// cannot have run: the server refused the credential (an OAuth token is refreshed
// first), the session was gone or closed, or the tool is read-only.
func (r *Registry) call(ctx context.Context, s *server, tool string, args json.RawMessage, v Visitor) (Result, error) {
	ctx, cancel := context.WithTimeout(ctx, callTimeout)
	defer cancel()
	var arguments any = map[string]any{}
	if len(strings.TrimSpace(string(args))) > 0 && strings.TrimSpace(string(args)) != "null" {
		if !json.Valid(args) {
			return Result{Text: "The tool arguments are not valid JSON.", IsError: true}, nil
		}
		arguments = json.RawMessage(args)
	}
	params := &sdk.CallToolParams{Meta: callMeta(s, v), Name: tool, Arguments: arguments}

	for attempt := 0; ; attempt++ {
		c, err := r.session(ctx, s)
		if err != nil {
			return Result{}, r.unavailable(ctx, s, err)
		}
		res, err := c.session.CallTool(ctx, params)
		if err == nil {
			return toResult(res), nil
		}
		var rpcErr *jsonrpc.Error
		if errors.As(err, &rpcErr) && !c.tr.state().authFail {
			// The server answered with a protocol error (unknown tool, bad arguments).
			return Result{Text: "The tool could not run: " + cleanText(rpcErr.Message, 300), IsError: true}, nil
		}
		st := c.tr.state()
		r.drop(s.ID, c)
		if ctx.Err() != nil {
			return Result{}, fmt.Errorf("%w (%s)", ErrUnavailable, msgTimeout)
		}
		if st.tooLarge {
			return Result{Text: "The tool's answer was too large.", IsError: true}, nil
		}
		t, _ := s.tool(tool)
		safe := st.authFail || t.ReadOnly || errors.Is(err, sdk.ErrSessionMissing) || errors.Is(err, sdk.ErrConnectionClosed)
		if attempt > 0 || !safe {
			return Result{}, r.unavailable(ctx, s, classify(ctx, err, st, s.AuthKind))
		}
		if st.authFail && s.AuthKind == AuthOAuth {
			if _, err := r.accessToken(ctx, s, true); err != nil {
				return Result{}, r.unavailable(ctx, s, err)
			}
			if s, err = loadServer(ctx, r.d.DB.Pool, s.WorkspaceID, s.ID); err != nil {
				return Result{}, ErrUnavailable
			}
		}
	}
}

// unavailable maps a connection failure to the error Call returns, recording a
// refused credential on the server.
func (r *Registry) unavailable(ctx context.Context, s *server, err error) error {
	if errors.Is(err, ErrNeedsAuth) {
		return ErrNeedsAuth
	}
	var ce *connectError
	if errors.As(err, &ce) {
		if ce.status == StatusNeedsAuth || ce.message == msgCredentials {
			r.setStatus(context.WithoutCancel(ctx), s, ce)
		}
		if ce.status == StatusNeedsAuth {
			return ErrNeedsAuth
		}
		return fmt.Errorf("%w (%s)", ErrUnavailable, ce.message)
	}
	return fmt.Errorf("%w: %w", ErrUnavailable, err)
}

func callMeta(s *server, v Visitor) sdk.Meta {
	visitor := map[string]any{"verified": v.Verified}
	if v.ContactID != uuid.Nil {
		visitor["contact_id"] = v.ContactID.String()
	}
	if v.ConversationID != uuid.Nil {
		visitor["conversation_id"] = v.ConversationID.String()
	}
	if v.Verified {
		if v.UserID != "" {
			visitor["user_id"] = v.UserID
		}
		if v.Email != "" {
			visitor["email"] = v.Email
		}
	}
	if v.Name != "" {
		visitor["name"] = v.Name
	}
	return sdk.Meta{
		"opendesk/visitor":   visitor,
		"opendesk/workspace": map[string]any{"id": s.WorkspaceID.String(), "name": s.WorkspaceName},
	}
}

// toResult is the text the model sees: text content, then short markers for other
// content, then structured content when there is no text.
func toResult(res *sdk.CallToolResult) Result {
	var parts []string
	for _, c := range res.Content {
		switch c := c.(type) {
		case *sdk.TextContent:
			parts = append(parts, c.Text)
		case *sdk.ImageContent:
			parts = append(parts, "[image]")
		case *sdk.AudioContent:
			parts = append(parts, "[audio]")
		case *sdk.ResourceLink:
			parts = append(parts, "[resource: "+c.Name+" "+c.URI+"]")
		case *sdk.EmbeddedResource:
			if c.Resource != nil && c.Resource.Text != "" {
				parts = append(parts, c.Resource.Text)
			} else if c.Resource != nil {
				parts = append(parts, "[resource: "+c.Resource.URI+"]")
			}
		}
	}
	text := strings.Join(parts, "\n")
	if strings.TrimSpace(text) == "" && res.StructuredContent != nil {
		if b, err := json.Marshal(res.StructuredContent); err == nil {
			text = string(b)
		}
	}
	return Result{Text: truncateRunes(text, MaxOutput), IsError: res.IsError}
}
