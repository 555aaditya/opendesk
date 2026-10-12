package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"

	"github.com/useopendesk/opendesk/internal/auth"
	"github.com/useopendesk/opendesk/internal/events"
	"github.com/useopendesk/opendesk/internal/jobs"
)

// outcome is the result of connecting to a server and listing its tools.
type outcome struct {
	info  *McpServerInfo
	tools []cachedTool
	err   *connectError
}

// connectAndList dials with explicit credentials (a server not saved yet, or new
// settings) and lists the tools. The connection is not pooled.
func (r *Registry) connectAndList(ctx context.Context, rawURL, header, value, kind string) outcome {
	if kind == AuthOAuth && value == "" {
		// Not signed in: say so without asking the server.
		return outcome{err: &connectError{status: StatusNeedsAuth, message: msgSignIn}}
	}
	c, err := r.dial(ctx, rawURL, header, value, kind)
	if err != nil {
		return outcome{err: classify(ctx, err, transportState{}, kind)}
	}
	defer c.close()
	return listOutcome(ctx, c, kind)
}

func listOutcome(ctx context.Context, c *conn, kind string) outcome {
	var info *McpServerInfo
	if ir := c.session.InitializeResult(); ir != nil && ir.ServerInfo != nil {
		info = &McpServerInfo{Name: cleanText(ir.ServerInfo.Name, 100), Version: cleanText(ir.ServerInfo.Version, 50)}
	}
	tools, err := listTools(ctx, c.session)
	if err != nil {
		return outcome{err: classify(ctx, err, c.tr.state(), kind)}
	}
	return outcome{info: info, tools: tools}
}

// refreshServer reconnects a saved server (a fresh pooled connection, refreshing an
// OAuth token when needed) and lists its tools.
func (r *Registry) refreshServer(ctx context.Context, s *server) outcome {
	r.forget(s.ID)
	if s.AuthKind == AuthOAuth {
		if sec, err := s.open(r.d.Box); err != nil || (sec.AccessToken == "" && sec.RefreshToken == "") {
			return outcome{err: &connectError{status: StatusNeedsAuth, message: msgSignIn}}
		}
	}
	c, err := r.session(ctx, s)
	if err != nil {
		if errors.Is(err, ErrNeedsAuth) {
			return outcome{err: &connectError{status: StatusNeedsAuth, message: msgSignInAgain}}
		}
		var ce *connectError
		if errors.As(err, &ce) {
			return outcome{err: ce}
		}
		return outcome{err: &connectError{status: StatusError, message: msgUnreachable, transient: true, cause: err}}
	}
	o := listOutcome(ctx, c, s.AuthKind)
	if o.err != nil {
		r.drop(s.ID, c)
	}
	return o
}

// mergeSettings keeps the admin's settings by tool name and gives new tools their
// defaults, enabling default-on tools only while the workspace stays within
// MaxEnabledTools (budget = what the other servers leave).
func mergeSettings(old map[string]toolSetting, tools []cachedTool, budget int) map[string]toolSetting {
	out := make(map[string]toolSetting, len(tools))
	var fresh []cachedTool
	for _, t := range tools {
		if st, ok := old[t.Name]; ok {
			out[t.Name] = st
			if st.Enabled {
				budget--
			}
		} else {
			fresh = append(fresh, t)
		}
	}
	for _, t := range fresh {
		st := defaultSetting(t)
		if st.Enabled {
			if budget <= 0 {
				st.Enabled = false
			} else {
				budget--
			}
		}
		out[t.Name] = st
	}
	return out
}

// mergeOutcome applies an outcome to s in memory (status, error, info, tools and their
// settings) and reports whether anything visible changed. The auth columns are untouched.
func (r *Registry) mergeOutcome(ctx context.Context, tx pgx.Tx, s *server, o outcome) (bool, error) {
	before := struct {
		Status string
		Error  *string
		Info   *McpServerInfo
		Tools  []cachedTool
		Set    map[string]toolSetting
	}{s.Status, s.Error, s.ServerInfo, s.Tools, s.Settings}
	now := r.now().UTC()
	if o.err == nil {
		used, err := workspaceEnabledTools(ctx, tx, s.WorkspaceID, s.ID)
		if err != nil {
			return false, err
		}
		s.Tools, s.Settings = o.tools, mergeSettings(s.Settings, o.tools, MaxEnabledTools-used)
		s.ServerInfo, s.Status, s.Error, s.LastSyncedAt = o.info, StatusConnected, nil, &now
		if len(o.tools) == 0 {
			msg := msgNoTools
			s.Error = &msg
		}
	} else {
		msg := o.err.message
		s.Status, s.Error = o.err.status, &msg
	}
	changed := before.Status != s.Status || !reflect.DeepEqual(before.Error, s.Error) || !reflect.DeepEqual(before.Info, s.ServerInfo) ||
		!jsonEqual(before.Tools, s.Tools) || !jsonEqual(before.Set, s.Settings)
	return changed, nil
}

// saveServer writes every mutable column of s. bump moves updated_at.
func saveServer(ctx context.Context, tx pgx.Tx, s *server, bump bool) error {
	return tx.QueryRow(ctx, `UPDATE ai_mcp_servers SET name = $3, url = $4, enabled = $5, auth_kind = $6, header_name = $7,
		secrets_enc = $8, oauth = $9, status = $10, error = $11, server_info = $12, tools = $13, tool_settings = $14, version = $15,
		last_synced_at = $16, updated_at = CASE WHEN $17 THEN now() ELSE updated_at END
		WHERE workspace_id = $1 AND id = $2 RETURNING updated_at`, s.WorkspaceID, s.ID, s.Name, s.URL, s.Enabled, s.AuthKind, s.HeaderName,
		s.SecretsEnc, s.OAuth, s.Status, s.Error, s.ServerInfo, s.Tools, s.Settings, s.Version, s.LastSyncedAt, bump).Scan(&s.UpdatedAt)
}

// setStatus records a failure a tool call ran into (a refused credential).
func (r *Registry) setStatus(ctx context.Context, s *server, ce *connectError) {
	if ce.status == StatusNeedsAuth && s.AuthKind == AuthOAuth {
		r.markNeedsAuth(ctx, s)
		return
	}
	err := r.d.DB.Tx(ctx, func(tx pgx.Tx) error {
		row, err := lockServer(ctx, tx, s.WorkspaceID, s.ID)
		if err != nil || row.Version != s.Version {
			return err
		}
		changed, err := r.mergeOutcome(ctx, tx, row, outcome{err: ce})
		if err != nil || !changed {
			return err
		}
		if err := saveServer(ctx, tx, row, true); err != nil {
			return err
		}
		_, err = events.Publish(ctx, tx, events.Event{WorkspaceID: s.WorkspaceID, Type: "ai_mcp_server.updated",
			Data: map[string]any{"mcp_server": row.view(r.d.Box)}})
		return err
	})
	if err != nil {
		r.d.Log.Warn("mcp: record status", "workspace_id", s.WorkspaceID, "server_id", s.ID, "err", err)
	}
}

func jsonEqual(a, b any) bool {
	x, err1 := json.Marshal(a)
	y, err2 := json.Marshal(b)
	return err1 == nil && err2 == nil && string(x) == string(y)
}

// syncServer reconnects a server, lists its tools and saves the result. p is the admin
// asking (nil for the hourly sync, which publishes only when something changed).
// final=false lets a transient failure return an error for a retry instead of being saved.
func (r *Registry) syncServer(ctx context.Context, p *auth.Principal, wid, id uuid.UUID, final bool) (*server, error) {
	s, err := loadServer(ctx, r.d.DB.Pool, wid, id)
	if err != nil {
		return nil, err
	}
	o := r.refreshServer(ctx, s)
	if o.err != nil && o.err.transient && !final {
		return nil, o.err
	}
	var out *server
	err = r.d.DB.Tx(ctx, func(tx pgx.Tx) error {
		row, err := lockServer(ctx, tx, wid, id)
		if err != nil {
			return err
		}
		if row.Version != s.Version || row.URL != s.URL {
			// Changed while we were connecting; that change brought its own sync.
			out = row
			return nil
		}
		changed, err := r.mergeOutcome(ctx, tx, row, o)
		if err != nil {
			return err
		}
		if err := saveServer(ctx, tx, row, changed); err != nil {
			return err
		}
		out = row
		if !changed && p == nil {
			return nil
		}
		_, err = events.Publish(ctx, tx, events.Event{WorkspaceID: wid, Type: "ai_mcp_server.updated",
			Data: map[string]any{"mcp_server": row.view(r.d.Box)}})
		return err
	})
	return out, err
}

// SyncWorker runs ai.mcp_sync: one server, or (without a server) the hourly sweep that
// enqueues a sync per enabled server and prunes expired OAuth states.
type SyncWorker struct {
	river.WorkerDefaults[jobs.MCPSyncArgs]
	R *Registry
}

func (w *SyncWorker) Timeout(*river.Job[jobs.MCPSyncArgs]) time.Duration { return 2 * time.Minute }

func (w *SyncWorker) Work(ctx context.Context, job *river.Job[jobs.MCPSyncArgs]) error {
	r := w.R
	if job.Args.ServerID == uuid.Nil {
		return r.sweep(ctx)
	}
	_, err := r.syncServer(ctx, nil, job.Args.WorkspaceID, job.Args.ServerID, job.Attempt >= job.MaxAttempts)
	if isNotFound(err) {
		return nil
	}
	return err
}

// sweep enqueues a sync for every enabled server that can connect.
func (r *Registry) sweep(ctx context.Context) error {
	if _, err := r.d.DB.Pool.Exec(ctx, `DELETE FROM ai_mcp_oauth_states WHERE expires_at < now()`); err != nil {
		return err
	}
	rows, err := r.d.DB.Pool.Query(ctx, `SELECT workspace_id, id FROM ai_mcp_servers WHERE enabled AND status <> 'needs_auth'`)
	if err != nil {
		return err
	}
	type ref struct{ wid, id uuid.UUID }
	refs, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (ref, error) {
		var x ref
		return x, row.Scan(&x.wid, &x.id)
	})
	if err != nil || len(refs) == 0 {
		return err
	}
	params := make([]river.InsertManyParams, 0, len(refs))
	for _, x := range refs {
		params = append(params, river.InsertManyParams{Args: jobs.MCPSyncArgs{WorkspaceID: x.wid, ServerID: x.id},
			InsertOpts: syncOpts()})
	}
	_, err = r.d.Jobs.InsertMany(ctx, params)
	return err
}

func syncOpts() *river.InsertOpts {
	return &river.InsertOpts{MaxAttempts: 3, UniqueOpts: river.UniqueOpts{ByArgs: true, ByPeriod: 30 * time.Minute}}
}

func syncPeriodic() *river.PeriodicJob {
	return river.NewPeriodicJob(river.PeriodicInterval(time.Hour),
		func() (river.JobArgs, *river.InsertOpts) {
			return jobs.MCPSyncArgs{}, &river.InsertOpts{UniqueOpts: river.UniqueOpts{ByPeriod: time.Hour}}
		}, nil)
}
