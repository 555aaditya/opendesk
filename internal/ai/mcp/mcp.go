// Package mcp is MCP connections (contracts/agent.md, "MCP connections"): a workspace
// connects its own remote MCP servers and the widget agent uses their tools. It owns
// the servers' admin API, the OAuth flow of the MCP authorization spec, the hourly tool
// sync, and a pooled client the agent loop calls through Registry.
package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/riverqueue/river"

	"github.com/useopendesk/opendesk/internal/ai"
	"github.com/useopendesk/opendesk/internal/deps"
	"github.com/useopendesk/opendesk/internal/netsafe"
)

// Visitor is who the agent is talking to. Only a verified session's UserID and Email
// are sent to MCP servers.
type Visitor struct {
	Verified                  bool
	UserID, Email, Name       string
	ContactID, ConversationID uuid.UUID
}

// Tool is one enabled tool of an enabled, connected server, as offered to the agent.
type Tool struct {
	ServerID                 uuid.UUID
	ServerSlug, ServerName   string
	Name, Title, Description string
	InputSchema              map[string]any
	ReadOnly, Destructive    bool
	Policy                   string // "auto" | "confirm"
	VerifiedOnly             bool
}

// Result is a tool's output: its text content, truncated to MaxOutput characters.
type Result struct {
	Text    string
	IsError bool
}

// Limits (contracts/agent.md).
const (
	MaxServers      = 10
	MaxEnabledTools = 64
	// MaxOutput is the most characters of tool output handed to the model.
	MaxOutput = 8000
	// MaxToolName is the longest agent tool name, <server_slug>__<tool>.
	MaxToolName = 64

	callTimeout    = 20 * time.Second
	listTimeout    = 15 * time.Second
	idleTimeout    = 5 * time.Minute
	maxResponse    = 1 << 20  // one response (or one event of a stream)
	maxStream      = 32 << 20 // a long-lived event stream, in total
	maxRedirects   = 3
	maxToolsListed = 200
)

// Errors Call returns. Messages are safe to show.
var (
	ErrNotFound    = errors.New("MCP server not found")
	ErrUnavailable = errors.New("The MCP server is not connected.")
	ErrToolDenied  = errors.New("This tool is not enabled for this conversation.")
	ErrNeedsAuth   = errors.New("The MCP server needs to be signed in again.")
)

// Registry is the process's MCP client: pooled connections per server, safe for
// concurrent use.
type Registry struct {
	d     *deps.Deps
	dev   bool // development instance: loopback and http targets are allowed
	base  *http.Transport
	now   func() time.Time
	mu    sync.Mutex
	conns map[uuid.UUID]*conn
	dials map[uuid.UUID]*sync.Mutex
}

var (
	regMu      sync.Mutex
	registries = map[*deps.Deps]*Registry{}
)

// For returns the process's registry for d, building it once.
func For(d *deps.Deps) *Registry {
	regMu.Lock()
	defer regMu.Unlock()
	if r, ok := registries[d]; ok {
		return r
	}
	r := newRegistry(d, !d.Cfg.IsProduction())
	registries[d] = r
	go r.janitor(context.Background())
	ai.For(d).SetToolbox(toolbox{r})
	return r
}

func newRegistry(d *deps.Deps, dev bool) *Registry {
	r := &Registry{d: d, now: time.Now, conns: map[uuid.UUID]*conn{}, dials: map[uuid.UUID]*sync.Mutex{}}
	r.setDev(dev)
	return r
}

// setDev rebuilds the guarded transport (tests switch the guard).
func (r *Registry) setDev(dev bool) {
	r.dev = dev
	g := netsafe.Guard{Dev: dev}
	dialer := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
	r.base = &http.Transport{
		Proxy:                 nil,
		DialContext:           g.DialContext(dialer),
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   4,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: callTimeout + 5*time.Second,
	}
}

func (r *Registry) guard() netsafe.Guard { return netsafe.Guard{Dev: r.dev} }

// Tools returns the enabled tools of enabled, connected servers; verified=false omits
// verified_only tools.
func (r *Registry) Tools(ctx context.Context, wid uuid.UUID, verified bool) ([]Tool, error) {
	list, err := listServers(ctx, r.d.DB.Pool, wid, true)
	if err != nil {
		return nil, err
	}
	var out []Tool
	for _, s := range list {
		if !s.Enabled || s.Status != StatusConnected {
			continue
		}
		for _, t := range s.Tools {
			st := s.setting(t)
			if !st.Enabled || (st.VerifiedOnly && !verified) {
				continue
			}
			if _, ok := ToolName(s.Slug, t.Name); !ok {
				continue
			}
			out = append(out, Tool{ServerID: s.ID, ServerSlug: s.Slug, ServerName: s.Name, Name: t.Name, Title: t.Title,
				Description: t.Description, InputSchema: t.InputSchema, ReadOnly: t.ReadOnly, Destructive: t.Destructive,
				Policy: st.Policy, VerifiedOnly: st.VerifiedOnly})
		}
	}
	return out, nil
}

// Call runs one enabled tool with _meta {"opendesk/visitor": ..., "opendesk/workspace":
// {id, name}}. Output text is truncated to MaxOutput characters. A tool that reports a
// failure is a Result with IsError; err is for a server that cannot be used.
func (r *Registry) Call(ctx context.Context, wid, serverID uuid.UUID, tool string, args json.RawMessage, v Visitor) (Result, error) {
	s, err := loadServer(ctx, r.d.DB.Pool, wid, serverID)
	if err != nil {
		if isNotFound(err) {
			return Result{}, ErrNotFound
		}
		return Result{}, err
	}
	if !s.Enabled || s.Status != StatusConnected {
		return Result{}, ErrUnavailable
	}
	t, ok := s.tool(tool)
	if !ok {
		return Result{}, ErrToolDenied
	}
	st := s.setting(t)
	if !st.Enabled || (st.VerifiedOnly && !v.Verified) {
		return Result{}, ErrToolDenied
	}
	return r.call(ctx, s, tool, args, v)
}

// Register adds the MCP connection routes.
func Register(d *deps.Deps, api huma.API, r chi.Router) { registerRoutes(For(d), api, r) }

// RegisterWorkers adds the sync worker.
func RegisterWorkers(d *deps.Deps, w *river.Workers) { river.AddWorker(w, &SyncWorker{R: For(d)}) }

// Periodic re-syncs every server's tools hourly.
func Periodic(d *deps.Deps) []*river.PeriodicJob { return []*river.PeriodicJob{syncPeriodic()} }

// Background has no loops: idle connections are closed by the registry itself.
func Background(ctx context.Context, d *deps.Deps) {}
