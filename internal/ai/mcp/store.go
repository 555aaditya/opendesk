package mcp

import (
	"context"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/useopendesk/opendesk/internal/crypto"
	"github.com/useopendesk/opendesk/internal/db"
)

// Statuses.
const (
	StatusConnected  = "connected"
	StatusNeedsAuth  = "needs_auth"
	StatusError      = "error"
	StatusConnecting = "connecting"
)

// Auth kinds.
const (
	AuthNone   = "none"
	AuthBearer = "bearer"
	AuthHeader = "header"
	AuthOAuth  = "oauth"
)

// Tool policies.
const (
	PolicyAuto    = "auto"
	PolicyConfirm = "confirm"
)

// McpServer is a connected MCP server (contracts/agent.md).
type McpServer struct {
	ID           uuid.UUID      `json:"id"`
	Name         string         `json:"name"`
	Slug         string         `json:"slug" doc:"Names the server in agent tool names (<slug>__<tool>)"`
	URL          string         `json:"url"`
	Enabled      bool           `json:"enabled"`
	Auth         McpAuth        `json:"auth"`
	Status       string         `json:"status" enum:"connected,needs_auth,error,connecting"`
	Error        *string        `json:"error" doc:"A fixed, safe message"`
	ServerInfo   *McpServerInfo `json:"server_info"`
	Tools        []McpTool      `json:"tools"`
	LastSyncedAt *time.Time     `json:"last_synced_at"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
}

type McpAuth struct {
	Kind       string    `json:"kind" enum:"none,bearer,header,oauth"`
	HeaderName string    `json:"header_name,omitempty"`
	HasSecret  bool      `json:"has_secret"`
	OAuth      *McpOAuth `json:"oauth,omitempty"`
}

type McpOAuth struct {
	Connected bool       `json:"connected"`
	Scopes    []string   `json:"scopes"`
	ExpiresAt *time.Time `json:"expires_at"`
}

type McpServerInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type McpTool struct {
	Name         string         `json:"name"`
	Title        *string        `json:"title"`
	Description  string         `json:"description"`
	InputSchema  map[string]any `json:"input_schema"`
	ReadOnly     bool           `json:"read_only"`
	Destructive  bool           `json:"destructive"`
	Enabled      bool           `json:"enabled"`
	Policy       string         `json:"policy" enum:"auto,confirm"`
	VerifiedOnly bool           `json:"verified_only"`
}

// cachedTool is a tool as the server last listed it.
type cachedTool struct {
	Name        string         `json:"name"`
	Title       string         `json:"title,omitempty"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"input_schema"`
	ReadOnly    bool           `json:"read_only"`
	Destructive bool           `json:"destructive"`
}

// toolSetting is the admin's choice for one tool, kept by tool name across syncs.
type toolSetting struct {
	Enabled      bool   `json:"enabled"`
	Policy       string `json:"policy"`
	VerifiedOnly bool   `json:"verified_only"`
}

// defaultSetting: read-only tools run on their own, others are off and need confirmation.
func defaultSetting(t cachedTool) toolSetting {
	if t.ReadOnly {
		return toolSetting{Enabled: true, Policy: PolicyAuto}
	}
	return toolSetting{Enabled: false, Policy: PolicyConfirm}
}

// oauthMeta is the OAuth state without secrets.
type oauthMeta struct {
	Issuer             string     `json:"issuer,omitempty"`
	TokenEndpoint      string     `json:"token_endpoint,omitempty"`
	RevocationEndpoint string     `json:"revocation_endpoint,omitempty"`
	RegistrationIssuer string     `json:"registration_issuer,omitempty"` // the issuer client_id was registered with
	ClientID           string     `json:"client_id,omitempty"`
	AuthMethod         string     `json:"auth_method,omitempty"` // client_secret_basic | client_secret_post | none
	RedirectURI        string     `json:"redirect_uri,omitempty"`
	Resource           string     `json:"resource,omitempty"`
	Scopes             []string   `json:"scopes,omitempty"`
	ExpiresAt          *time.Time `json:"expires_at,omitempty"`
	Connected          bool       `json:"connected,omitempty"`
}

// secrets is sealed with d.Box and never returned.
type secrets struct {
	Token        string `json:"token,omitempty"`
	HeaderValue  string `json:"header_value,omitempty"`
	ClientSecret string `json:"client_secret,omitempty"`
	AccessToken  string `json:"access_token,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
}

// server is one ai_mcp_servers row.
type server struct {
	ID           uuid.UUID
	WorkspaceID  uuid.UUID
	Name         string
	Slug         string
	URL          string
	Enabled      bool
	AuthKind     string
	HeaderName   *string
	SecretsEnc   []byte
	OAuth        oauthMeta
	Status       string
	Error        *string
	ServerInfo   *McpServerInfo
	Tools        []cachedTool
	Settings     map[string]toolSetting
	Version      int
	LastSyncedAt *time.Time
	CreatedAt    time.Time
	UpdatedAt    time.Time
	// WorkspaceName is joined in for _meta.
	WorkspaceName string
}

const serverCols = `s.id, s.workspace_id, s.name, s.slug, s.url, s.enabled, s.auth_kind, s.header_name, s.secrets_enc, s.oauth,
	s.status, s.error, s.server_info, s.tools, s.tool_settings, s.version, s.last_synced_at, s.created_at, s.updated_at, w.name`

const serverFrom = ` FROM ai_mcp_servers s JOIN workspaces w ON w.id = s.workspace_id`

func scanServer(row pgx.Row) (*server, error) {
	s := &server{}
	err := row.Scan(&s.ID, &s.WorkspaceID, &s.Name, &s.Slug, &s.URL, &s.Enabled, &s.AuthKind, &s.HeaderName, &s.SecretsEnc, &s.OAuth,
		&s.Status, &s.Error, &s.ServerInfo, &s.Tools, &s.Settings, &s.Version, &s.LastSyncedAt, &s.CreatedAt, &s.UpdatedAt, &s.WorkspaceName)
	if err != nil {
		return nil, err
	}
	if s.Settings == nil {
		s.Settings = map[string]toolSetting{}
	}
	return s, nil
}

func loadServer(ctx context.Context, q db.Querier, wid, id uuid.UUID) (*server, error) {
	return scanServer(q.QueryRow(ctx, `SELECT `+serverCols+serverFrom+` WHERE s.workspace_id = $1 AND s.id = $2`, wid, id))
}

// lockServer loads the row FOR UPDATE inside tx.
func lockServer(ctx context.Context, tx pgx.Tx, wid, id uuid.UUID) (*server, error) {
	return scanServer(tx.QueryRow(ctx, `SELECT `+serverCols+serverFrom+` WHERE s.workspace_id = $1 AND s.id = $2 FOR UPDATE OF s`, wid, id))
}

func listServers(ctx context.Context, q db.Querier, wid uuid.UUID, enabledOnly bool) ([]*server, error) {
	rows, err := q.Query(ctx, `SELECT `+serverCols+serverFrom+` WHERE s.workspace_id = $1 AND ($2 = false OR s.enabled)
		ORDER BY s.created_at, s.id`, wid, enabledOnly)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (*server, error) { return scanServer(r) })
}

func isNotFound(err error) bool { return db.IsNotFound(err) }

func (s *server) tool(name string) (cachedTool, bool) {
	for _, t := range s.Tools {
		if t.Name == name {
			return t, true
		}
	}
	return cachedTool{}, false
}

func (s *server) setting(t cachedTool) toolSetting {
	if st, ok := s.Settings[t.Name]; ok {
		if st.Policy != PolicyAuto && st.Policy != PolicyConfirm {
			st.Policy = PolicyConfirm
		}
		return st
	}
	return defaultSetting(t)
}

// enabledTools counts the server's enabled tools.
func (s *server) enabledTools() int {
	n := 0
	for _, t := range s.Tools {
		if s.setting(t).Enabled {
			n++
		}
	}
	return n
}

func (s *server) open(box *crypto.Box) (secrets, error) {
	var sec secrets
	if len(s.SecretsEnc) == 0 {
		return sec, nil
	}
	err := box.OpenJSON(s.SecretsEnc, &sec)
	return sec, err
}

// view is the API shape. Secrets are reported only as has_secret.
func (s *server) view(box *crypto.Box) McpServer {
	out := McpServer{ID: s.ID, Name: s.Name, Slug: s.Slug, URL: s.URL, Enabled: s.Enabled, Status: s.Status, Error: s.Error,
		ServerInfo: s.ServerInfo, Tools: make([]McpTool, 0, len(s.Tools)), LastSyncedAt: s.LastSyncedAt, CreatedAt: s.CreatedAt, UpdatedAt: s.UpdatedAt}
	out.Auth.Kind = s.AuthKind
	if s.HeaderName != nil && s.AuthKind == AuthHeader {
		out.Auth.HeaderName = *s.HeaderName
	}
	sec, _ := s.open(box)
	switch s.AuthKind {
	case AuthBearer:
		out.Auth.HasSecret = sec.Token != ""
	case AuthHeader:
		out.Auth.HasSecret = sec.HeaderValue != ""
	case AuthOAuth:
		out.Auth.HasSecret = sec.AccessToken != "" || sec.RefreshToken != ""
		scopes := s.OAuth.Scopes
		if scopes == nil {
			scopes = []string{}
		}
		out.Auth.OAuth = &McpOAuth{Connected: s.OAuth.Connected && out.Auth.HasSecret, Scopes: scopes, ExpiresAt: s.OAuth.ExpiresAt}
	}
	for _, t := range s.Tools {
		st := s.setting(t)
		mt := McpTool{Name: t.Name, Description: t.Description, InputSchema: t.InputSchema, ReadOnly: t.ReadOnly,
			Destructive: t.Destructive, Enabled: st.Enabled, Policy: st.Policy, VerifiedOnly: st.VerifiedOnly}
		if t.Title != "" {
			title := t.Title
			mt.Title = &title
		}
		if mt.InputSchema == nil {
			mt.InputSchema = map[string]any{"type": "object"}
		}
		out.Tools = append(out.Tools, mt)
	}
	return out
}

var toolNameRe = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

// ToolName is the agent's name for a server's tool, <server_slug>__<tool>, and whether
// it is usable (at most MaxToolName characters of [a-zA-Z0-9_-]).
func ToolName(slug, tool string) (string, bool) {
	name := slug + "__" + tool
	return name, len(name) <= MaxToolName && toolNameRe.MatchString(tool)
}

const maxSlug = 24

// slugify makes a slug of lowercase letters, digits and single underscores.
func slugify(name string) string {
	var b strings.Builder
	under := false
	for _, r := range strings.ToLower(name) {
		switch {
		case r < utf8.RuneSelf && (unicode.IsLetter(r) || unicode.IsDigit(r)):
			b.WriteRune(r)
			under = false
		default:
			if b.Len() > 0 && !under {
				b.WriteByte('_')
				under = true
			}
		}
		if b.Len() >= maxSlug {
			break
		}
	}
	s := strings.Trim(b.String(), "_")
	if len(s) > maxSlug {
		s = strings.Trim(s[:maxSlug], "_")
	}
	if s == "" {
		s = "mcp"
	}
	return s
}

// uniqueSlug returns slugify(name), suffixed with _2, _3 ... when taken in the workspace.
func uniqueSlug(ctx context.Context, tx pgx.Tx, wid uuid.UUID, name string) (string, error) {
	base := slugify(name)
	rows, err := tx.Query(ctx, `SELECT slug FROM ai_mcp_servers WHERE workspace_id = $1`, wid)
	if err != nil {
		return "", err
	}
	taken, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return "", err
	}
	used := map[string]bool{}
	for _, t := range taken {
		used[t] = true
	}
	if !used[base] {
		return base, nil
	}
	for i := 2; i < 1000; i++ {
		suffix := "_" + strconv.Itoa(i)
		cand := base
		if len(cand)+len(suffix) > maxSlug {
			cand = strings.TrimRight(cand[:maxSlug-len(suffix)], "_")
		}
		cand += suffix
		if !used[cand] {
			return cand, nil
		}
	}
	return "", errors.New("no free slug")
}

// workspaceEnabledTools counts enabled tools over the workspace's servers, except one.
func workspaceEnabledTools(ctx context.Context, tx pgx.Tx, wid uuid.UUID, except uuid.UUID) (int, error) {
	list, err := listServers(ctx, tx, wid, false)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, s := range list {
		if s.ID != except {
			n += s.enabledTools()
		}
	}
	return n, nil
}

// lockWorkspace serializes the limit checks of one workspace.
func lockWorkspace(ctx context.Context, tx pgx.Tx, wid uuid.UUID) error {
	_, err := tx.Exec(ctx, `SELECT 1 FROM workspaces WHERE id = $1 FOR UPDATE`, wid)
	return err
}

// cleanText keeps a server-provided string displayable: no control characters, at most n runes.
func cleanText(s string, n int) string {
	s = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' {
			return r
		}
		if unicode.IsControl(r) || unicode.In(r, unicode.Cf, unicode.Co, unicode.Cs) || r == utf8.RuneError {
			return -1
		}
		return r
	}, s)
	return truncateRunes(strings.TrimSpace(s), n)
}

func truncateRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return string(r[:n])
}
