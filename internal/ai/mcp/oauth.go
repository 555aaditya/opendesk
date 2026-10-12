package mcp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/modelcontextprotocol/go-sdk/oauthex"

	"github.com/useopendesk/opendesk/internal/audit"
	"github.com/useopendesk/opendesk/internal/crypto"
	"github.com/useopendesk/opendesk/internal/events"
)

// OAuth for MCP servers follows the MCP authorization spec: protected resource metadata
// (RFC 9728), authorization server metadata (RFC 8414, OpenID discovery), dynamic client
// registration (RFC 7591), the authorization code grant with PKCE S256 and the resource
// indicator (RFC 8707), refresh, and revocation (RFC 7009).

const (
	oauthStateTTL   = 10 * time.Minute
	oauthCookie     = "od_mcp_oauth"
	oauthCookiePath = "/v1/ai/mcp-servers/oauth"
	oauthTimeout    = 15 * time.Second
	refreshEarly    = time.Minute
)

// oauthError is an OAuth failure with a stable code for the callback redirect.
type oauthError struct {
	code   string
	detail string
	cause  error
}

func (e *oauthError) Error() string { return e.detail }
func (e *oauthError) Unwrap() error { return e.cause }

func oerr(code, detail string, cause error) *oauthError {
	return &oauthError{code: code, detail: detail, cause: cause}
}

// authConfig is what discovery finds for a server.
type authConfig struct {
	Issuer                string
	AuthorizationEndpoint string
	TokenEndpoint         string
	RevocationEndpoint    string
	RegistrationEndpoint  string
	TokenAuthMethods      []string
	Resource              string
	Scopes                []string
}

// flowState is sealed in ai_mcp_oauth_states for the callback.
type flowState struct {
	Verifier           string   `json:"verifier"`
	URL                string   `json:"url"`
	Version            int      `json:"version"`
	Issuer             string   `json:"issuer"`
	TokenEndpoint      string   `json:"token_endpoint"`
	RevocationEndpoint string   `json:"revocation_endpoint,omitempty"`
	ClientID           string   `json:"client_id"`
	ClientSecret       string   `json:"client_secret,omitempty"`
	AuthMethod         string   `json:"auth_method"`
	RedirectURI        string   `json:"redirect_uri"`
	Resource           string   `json:"resource"`
	Scopes             []string `json:"scopes,omitempty"`
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    any    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
}

func (t tokenResponse) expiresAt(now time.Time) *time.Time {
	var secs int64
	switch v := t.ExpiresIn.(type) {
	case float64:
		secs = int64(v)
	case string:
		secs, _ = strconv.ParseInt(v, 10, 64)
	}
	if secs <= 0 {
		return nil
	}
	at := now.Add(time.Duration(secs) * time.Second).UTC()
	return &at
}

func (r *Registry) redirectURI() string {
	return strings.TrimRight(r.d.Cfg.APIURL, "/") + "/v1/ai/mcp-servers/oauth/callback"
}

// checkURL refuses a metadata or endpoint URL that is not https (loopback http on a
// development instance), carries credentials, or resolves to a private address.
func (r *Registry) checkURL(ctx context.Context, raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "", oerr("discovery_failed", "The authorization server sent an invalid URL.", err)
	}
	if err := r.checkScheme(u); err != nil {
		return "", oerr("discovery_failed", "The authorization server must use https.", err)
	}
	if _, err := r.guard().ValidateURL(ctx, raw); err != nil {
		return "", oerr("discovery_failed", "The authorization server's address is not allowed.", err)
	}
	return u.String(), nil
}

// getJSON fetches a JSON document of at most maxResponse bytes. ok=false for a 4xx.
func (r *Registry) getJSON(ctx context.Context, raw string, v any) (bool, error) {
	if _, err := r.checkURL(ctx, raw); err != nil {
		return false, err
	}
	ctx, cancel := context.WithTimeout(ctx, oauthTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("Accept", "application/json")
	hc, _ := r.plainClient()
	res, err := hc.Do(req)
	if err != nil {
		return false, err
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 && res.StatusCode < 500 {
		return false, nil
	}
	if res.StatusCode != http.StatusOK {
		return false, fmt.Errorf("metadata status %d", res.StatusCode)
	}
	if mt, _, _ := mime.ParseMediaType(res.Header.Get("Content-Type")); mt != "application/json" && !strings.HasSuffix(mt, "+json") {
		return false, nil
	}
	b, err := readBody(res)
	if err != nil {
		return false, err
	}
	if err := json.Unmarshal(b, v); err != nil {
		return false, nil
	}
	return true, nil
}

// probe sends an unauthenticated initialize to the server and returns the
// WWW-Authenticate challenges of a 401.
func (r *Registry) probe(ctx context.Context, serverURL string) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, oauthTimeout)
	defer cancel()
	body := `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"opendesk","version":"1"}}}`
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, serverURL, strings.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("MCP-Protocol-Version", "2025-06-18")
	hc, _ := r.plainClient()
	res, err := hc.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusUnauthorized {
		return res.Header.Values("WWW-Authenticate"), nil
	}
	return nil, nil
}

// discover finds the authorization server of a server and its endpoints.
func (r *Registry) discover(ctx context.Context, serverURL string, wwwAuth []string) (*authConfig, error) {
	if len(wwwAuth) == 0 {
		var err error
		if wwwAuth, err = r.probe(ctx, serverURL); err != nil {
			return nil, oerr("discovery_failed", msgUnreachable, err)
		}
	}
	var metadataURL, scope string
	if cs, err := oauthex.ParseWWWAuthenticate(wwwAuth); err == nil {
		for _, c := range cs {
			if c.Scheme == "bearer" {
				metadataURL, scope = c.Params["resource_metadata"], c.Params["scope"]
				break
			}
		}
	}
	su, err := url.Parse(serverURL)
	if err != nil {
		return nil, oerr("discovery_failed", msgProtocol, err)
	}
	cfg := &authConfig{Resource: canonicalResource(su)}
	if scope != "" {
		cfg.Scopes = strings.Fields(scope)
	}

	// Protected resource metadata: the challenge's URL, else the well-known URLs.
	var candidates []string
	if metadataURL != "" {
		candidates = append(candidates, metadataURL)
	} else {
		root := su.Scheme + "://" + su.Host + "/.well-known/oauth-protected-resource"
		if p := strings.TrimRight(su.EscapedPath(), "/"); p != "" {
			candidates = append(candidates, root+p)
		}
		candidates = append(candidates, root)
	}
	var prm *oauthex.ProtectedResourceMetadata
	for _, c := range candidates {
		var m oauthex.ProtectedResourceMetadata
		ok, err := r.getJSON(ctx, c, &m)
		if err != nil {
			var oe *oauthError
			if errors.As(err, &oe) {
				return nil, oe
			}
			return nil, oerr("discovery_failed", msgUnreachable, err)
		}
		if ok {
			prm = &m
			break
		}
	}
	issuer := su.Scheme + "://" + su.Host // servers without resource metadata (2025-03-26)
	if prm != nil {
		if !resourceMatches(prm.Resource, su) {
			return nil, oerr("discovery_failed", "The server's metadata names a different resource.", nil)
		}
		cfg.Resource = prm.Resource
		if len(prm.AuthorizationServers) == 0 {
			return nil, oerr("discovery_failed", "The server does not name an authorization server.", nil)
		}
		issuer = prm.AuthorizationServers[0]
		if len(cfg.Scopes) == 0 {
			cfg.Scopes = prm.ScopesSupported
		}
	}
	if _, err := r.checkURL(ctx, issuer); err != nil {
		return nil, err
	}

	asm, err := r.authServerMeta(ctx, issuer)
	if err != nil {
		return nil, err
	}
	for _, e := range []string{asm.AuthorizationEndpoint, asm.TokenEndpoint} {
		if e == "" {
			return nil, oerr("discovery_failed", "The authorization server's metadata is incomplete.", nil)
		}
		if _, err := r.checkURL(ctx, e); err != nil {
			return nil, err
		}
	}
	if !slices.Contains(asm.CodeChallengeMethodsSupported, "S256") {
		return nil, oerr("pkce_unsupported", "The authorization server does not support PKCE (S256).", nil)
	}
	for _, e := range []*string{&asm.RegistrationEndpoint, &asm.RevocationEndpoint} {
		if *e != "" {
			if _, err := r.checkURL(ctx, *e); err != nil {
				*e = ""
			}
		}
	}
	cfg.Issuer = asm.Issuer
	cfg.AuthorizationEndpoint, cfg.TokenEndpoint = asm.AuthorizationEndpoint, asm.TokenEndpoint
	cfg.RevocationEndpoint, cfg.RegistrationEndpoint = asm.RevocationEndpoint, asm.RegistrationEndpoint
	cfg.TokenAuthMethods = asm.TokenEndpointAuthMethodsSupported
	return cfg, nil
}

// authServerMeta reads RFC 8414 metadata, falling back to OpenID discovery.
func (r *Registry) authServerMeta(ctx context.Context, issuer string) (*oauthex.AuthServerMeta, error) {
	iu, err := url.Parse(issuer)
	if err != nil {
		return nil, oerr("discovery_failed", "The authorization server's address is invalid.", err)
	}
	base := iu.Scheme + "://" + iu.Host
	p := strings.TrimRight(iu.EscapedPath(), "/")
	var urls []string
	if p == "" {
		urls = []string{base + "/.well-known/oauth-authorization-server", base + "/.well-known/openid-configuration"}
	} else {
		urls = []string{base + "/.well-known/oauth-authorization-server" + p, base + "/.well-known/openid-configuration" + p,
			base + p + "/.well-known/openid-configuration"}
	}
	for _, u := range urls {
		var m oauthex.AuthServerMeta
		ok, err := r.getJSON(ctx, u, &m)
		if err != nil {
			var oe *oauthError
			if errors.As(err, &oe) {
				return nil, oe
			}
			return nil, oerr("discovery_failed", "Could not reach the authorization server.", err)
		}
		if !ok {
			continue
		}
		if strings.TrimRight(m.Issuer, "/") != strings.TrimRight(issuer, "/") {
			return nil, oerr("discovery_failed", "The authorization server's metadata names a different issuer.", nil)
		}
		return &m, nil
	}
	return nil, oerr("discovery_failed", "The authorization server publishes no metadata.", nil)
}

// canonicalResource is the server URL without fragment, the RFC 8707 resource.
func canonicalResource(u *url.URL) string {
	c := *u
	c.Fragment, c.RawFragment = "", ""
	c.Scheme, c.Host = strings.ToLower(c.Scheme), strings.ToLower(c.Host)
	return c.String()
}

// resourceMatches accepts metadata whose resource is the server URL or a same-origin
// prefix of its path.
func resourceMatches(resource string, server *url.URL) bool {
	ru, err := url.Parse(resource)
	if err != nil || ru.Host == "" {
		return false
	}
	if originOf(ru) != originOf(server) {
		return false
	}
	rp, sp := strings.TrimRight(ru.Path, "/"), strings.TrimRight(server.Path, "/")
	return rp == sp || strings.HasPrefix(sp+"/", rp+"/")
}

// registerClient registers opendesk with the authorization server (RFC 7591).
func (r *Registry) registerClient(ctx context.Context, cfg *authConfig) (id, secret, method string, err error) {
	method = "none"
	for _, m := range []string{"client_secret_basic", "client_secret_post"} {
		if slices.Contains(cfg.TokenAuthMethods, m) {
			method = m
			break
		}
	}
	meta := map[string]any{
		"client_name":                "opendesk",
		"client_uri":                 "https://opendesk.sh",
		"redirect_uris":              []string{r.redirectURI()},
		"grant_types":                []string{"authorization_code", "refresh_token"},
		"response_types":             []string{"code"},
		"token_endpoint_auth_method": method,
		"application_type":           "web",
	}
	if len(cfg.Scopes) > 0 {
		meta["scope"] = strings.Join(cfg.Scopes, " ")
	}
	raw, _ := json.Marshal(meta)
	ctx, cancel := context.WithTimeout(ctx, oauthTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.RegistrationEndpoint, bytes.NewReader(raw))
	if err != nil {
		return "", "", "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	hc := r.postClient()
	res, err := hc.Do(req)
	if err != nil {
		return "", "", "", oerr("registration_failed", "Could not reach the authorization server.", err)
	}
	defer res.Body.Close()
	b, err := readBody(res)
	if err != nil {
		return "", "", "", oerr("registration_failed", "The authorization server's answer was too large.", err)
	}
	if res.StatusCode != http.StatusCreated && res.StatusCode != http.StatusOK {
		return "", "", "", oerr("registration_failed", "The authorization server refused to register opendesk.", fmt.Errorf("status %d", res.StatusCode))
	}
	var out struct {
		ClientID                string `json:"client_id"`
		ClientSecret            string `json:"client_secret"`
		TokenEndpointAuthMethod string `json:"token_endpoint_auth_method"`
	}
	if err := json.Unmarshal(b, &out); err != nil || out.ClientID == "" {
		return "", "", "", oerr("registration_failed", "The authorization server's registration answer is invalid.", err)
	}
	if out.TokenEndpointAuthMethod != "" {
		method = out.TokenEndpointAuthMethod
	}
	if out.ClientSecret == "" {
		method = "none"
	}
	return out.ClientID, out.ClientSecret, method, nil
}

// tokenRequest posts a token endpoint request with the client's authentication.
// status is the HTTP status (0 when the server was not reached).
func (r *Registry) tokenRequest(ctx context.Context, endpoint string, form url.Values, clientID, clientSecret, method string) (*tokenResponse, int, error) {
	if _, err := r.checkURL(ctx, endpoint); err != nil {
		return nil, 0, err
	}
	switch method {
	case "client_secret_basic":
	case "client_secret_post":
		form.Set("client_id", clientID)
		form.Set("client_secret", clientSecret)
	default:
		form.Set("client_id", clientID)
	}
	ctx, cancel := context.WithTimeout(ctx, oauthTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	if method == "client_secret_basic" {
		req.SetBasicAuth(url.QueryEscape(clientID), url.QueryEscape(clientSecret))
	}
	hc := r.postClient()
	res, err := hc.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer res.Body.Close()
	b, err := readBody(res)
	if err != nil {
		return nil, res.StatusCode, err
	}
	if res.StatusCode != http.StatusOK {
		return nil, res.StatusCode, fmt.Errorf("token endpoint status %d", res.StatusCode)
	}
	var tr tokenResponse
	if err := json.Unmarshal(b, &tr); err != nil {
		// Some servers answer form-encoded.
		if q, perr := url.ParseQuery(string(b)); perr == nil && q.Get("access_token") != "" {
			tr = tokenResponse{AccessToken: q.Get("access_token"), TokenType: q.Get("token_type"), ExpiresIn: q.Get("expires_in"),
				RefreshToken: q.Get("refresh_token"), Scope: q.Get("scope")}
		} else {
			return nil, res.StatusCode, errors.New("invalid token response")
		}
	}
	if tr.AccessToken == "" {
		return nil, res.StatusCode, errors.New("token response without access_token")
	}
	if tr.TokenType != "" && !strings.EqualFold(tr.TokenType, "bearer") {
		return nil, res.StatusCode, errors.New("unsupported token type")
	}
	return &tr, res.StatusCode, nil
}

func pkceChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// startAuthorization discovers the server's authorization server, registers a client
// when the server has none for it, stores a single-use state and returns the
// authorization URL and the browser binding nonce.
func (r *Registry) startAuthorization(ctx context.Context, userID uuid.UUID, s *server) (string, string, error) {
	cfg, err := r.discover(ctx, s.URL, nil)
	if err != nil {
		return "", "", err
	}
	sec, err := s.open(r.d.Box)
	if err != nil {
		return "", "", err
	}
	clientID, clientSecret, method := s.OAuth.ClientID, sec.ClientSecret, s.OAuth.AuthMethod
	if clientID == "" || s.OAuth.RegistrationIssuer != cfg.Issuer || s.OAuth.RedirectURI != r.redirectURI() {
		if cfg.RegistrationEndpoint == "" {
			return "", "", oerr("registration_unsupported", "The authorization server does not let opendesk register as a client.", nil)
		}
		if clientID, clientSecret, method, err = r.registerClient(ctx, cfg); err != nil {
			return "", "", err
		}
		// Keep the registration so later sign-ins reuse the client.
		err = r.d.DB.Tx(ctx, func(tx pgx.Tx) error {
			row, err := lockServer(ctx, tx, s.WorkspaceID, s.ID)
			if err != nil {
				return err
			}
			rsec, err := row.open(r.d.Box)
			if err != nil {
				return err
			}
			rsec.ClientSecret = clientSecret
			sealed, err := r.d.Box.SealJSON(rsec)
			if err != nil {
				return err
			}
			meta := row.OAuth
			meta.RegistrationIssuer, meta.ClientID, meta.AuthMethod, meta.RedirectURI = cfg.Issuer, clientID, method, r.redirectURI()
			_, err = tx.Exec(ctx, `UPDATE ai_mcp_servers SET oauth = $3, secrets_enc = $4 WHERE workspace_id = $1 AND id = $2`,
				s.WorkspaceID, s.ID, meta, sealed)
			return err
		})
		if err != nil {
			return "", "", err
		}
	}

	verifier := crypto.RandomToken(48)
	state := crypto.RandomToken(32)
	nonce := crypto.RandomToken(32)
	flow := flowState{Verifier: verifier, URL: s.URL, Version: s.Version, Issuer: cfg.Issuer, TokenEndpoint: cfg.TokenEndpoint,
		RevocationEndpoint: cfg.RevocationEndpoint, ClientID: clientID, ClientSecret: clientSecret, AuthMethod: method,
		RedirectURI: r.redirectURI(), Resource: cfg.Resource, Scopes: cfg.Scopes}
	sealed, err := r.d.Box.SealJSON(flow)
	if err != nil {
		return "", "", err
	}
	if _, err := r.d.DB.Pool.Exec(ctx, `INSERT INTO ai_mcp_oauth_states (state_hash, workspace_id, server_id, user_id, nonce_hash, flow_enc, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`, crypto.HashToken(state), s.WorkspaceID, s.ID, userID, crypto.HashToken(nonce), sealed,
		r.now().Add(oauthStateTTL)); err != nil {
		return "", "", err
	}

	au, err := url.Parse(cfg.AuthorizationEndpoint)
	if err != nil {
		return "", "", oerr("discovery_failed", "The authorization server's address is invalid.", err)
	}
	q := au.Query()
	q.Set("response_type", "code")
	q.Set("client_id", clientID)
	q.Set("redirect_uri", r.redirectURI())
	q.Set("state", state)
	q.Set("code_challenge", pkceChallenge(verifier))
	q.Set("code_challenge_method", "S256")
	q.Set("resource", cfg.Resource)
	if len(cfg.Scopes) > 0 {
		q.Set("scope", strings.Join(cfg.Scopes, " "))
	}
	au.RawQuery = q.Encode()
	return au.String(), nonce, nil
}

// pendingFlow is a redeemed state row.
type pendingFlow struct {
	WorkspaceID, ServerID, UserID uuid.UUID
	NonceHash                     []byte
	Flow                          flowState
}

// redeemState deletes the state row (single use) and returns it when unexpired.
func (r *Registry) redeemState(ctx context.Context, state string) (*pendingFlow, error) {
	if state == "" || len(state) > 200 {
		return nil, errors.New("no state")
	}
	var pf pendingFlow
	var sealed []byte
	var expires time.Time
	err := r.d.DB.Pool.QueryRow(ctx, `DELETE FROM ai_mcp_oauth_states WHERE state_hash = $1
		RETURNING workspace_id, server_id, user_id, nonce_hash, flow_enc, expires_at`, crypto.HashToken(state)).
		Scan(&pf.WorkspaceID, &pf.ServerID, &pf.UserID, &pf.NonceHash, &sealed, &expires)
	if err != nil {
		return nil, err
	}
	if !r.now().Before(expires) {
		return nil, errors.New("state expired")
	}
	if err := r.d.Box.OpenJSON(sealed, &pf.Flow); err != nil {
		return nil, err
	}
	return &pf, nil
}

// exchangeCode redeems an authorization code.
func (r *Registry) exchangeCode(ctx context.Context, f flowState, code string) (*tokenResponse, error) {
	form := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {f.RedirectURI},
		"code_verifier": {f.Verifier}, "resource": {f.Resource}}
	tr, _, err := r.tokenRequest(ctx, f.TokenEndpoint, form, f.ClientID, f.ClientSecret, f.AuthMethod)
	return tr, err
}

// accessToken returns a usable access token for an OAuth server, refreshing it when it
// expires within a minute (or when force is set because the server refused it). The
// refresh runs under the row lock so concurrent callers refresh once. A refused refresh
// sets needs_auth and returns ErrNeedsAuth. s is updated with the new credentials.
func (r *Registry) accessToken(ctx context.Context, s *server, force bool) (string, error) {
	sec, err := s.open(r.d.Box)
	if err != nil {
		return "", err
	}
	fresh := func(sec secrets, meta oauthMeta) bool {
		return sec.AccessToken != "" && (meta.ExpiresAt == nil || meta.ExpiresAt.After(r.now().Add(refreshEarly)))
	}
	if !force && fresh(sec, s.OAuth) {
		return sec.AccessToken, nil
	}
	if sec.RefreshToken == "" {
		if sec.AccessToken == "" {
			return "", nil // never signed in: the server answers needs_auth
		}
		if !force && s.OAuth.ExpiresAt == nil {
			return sec.AccessToken, nil
		}
		r.markNeedsAuth(context.WithoutCancel(ctx), s)
		return "", ErrNeedsAuth
	}
	var token string
	needsAuth := false
	err = r.d.DB.Tx(ctx, func(tx pgx.Tx) error {
		row, err := lockServer(ctx, tx, s.WorkspaceID, s.ID)
		if err != nil {
			return err
		}
		rsec, err := row.open(r.d.Box)
		if err != nil {
			return err
		}
		if rsec.AccessToken != sec.AccessToken && fresh(rsec, row.OAuth) {
			// Another caller refreshed while we waited for the lock.
			token = rsec.AccessToken
			*s = *row
			return nil
		}
		if rsec.RefreshToken == "" {
			needsAuth = true
			return nil
		}
		form := url.Values{"grant_type": {"refresh_token"}, "refresh_token": {rsec.RefreshToken}}
		if row.OAuth.Resource != "" {
			form.Set("resource", row.OAuth.Resource)
		}
		tr, status, err := r.tokenRequest(ctx, row.OAuth.TokenEndpoint, form, row.OAuth.ClientID, rsec.ClientSecret, row.OAuth.AuthMethod)
		if err != nil {
			if status == http.StatusBadRequest || status == http.StatusUnauthorized {
				needsAuth = true
				return nil
			}
			return fmt.Errorf("refresh: %w", err)
		}
		rsec.AccessToken = tr.AccessToken
		if tr.RefreshToken != "" {
			rsec.RefreshToken = tr.RefreshToken
		}
		meta := row.OAuth
		meta.ExpiresAt = tr.expiresAt(r.now())
		if tr.Scope != "" {
			meta.Scopes = strings.Fields(tr.Scope)
		}
		sealed, err := r.d.Box.SealJSON(rsec)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE ai_mcp_servers SET secrets_enc = $3, oauth = $4 WHERE workspace_id = $1 AND id = $2`,
			s.WorkspaceID, s.ID, sealed, meta); err != nil {
			return err
		}
		row.SecretsEnc, row.OAuth = sealed, meta
		*s = *row
		token = tr.AccessToken
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	if needsAuth {
		r.markNeedsAuth(context.WithoutCancel(ctx), s)
		return "", ErrNeedsAuth
	}
	return token, nil
}

// markNeedsAuth records that the server's sign-in no longer works: tokens are dropped
// (the client registration is kept) and the admins see needs_auth.
func (r *Registry) markNeedsAuth(ctx context.Context, s *server) {
	err := r.d.DB.Tx(ctx, func(tx pgx.Tx) error {
		row, err := lockServer(ctx, tx, s.WorkspaceID, s.ID)
		if err != nil {
			return err
		}
		if row.AuthKind != AuthOAuth || (row.Status == StatusNeedsAuth && !row.OAuth.Connected) {
			return nil
		}
		rsec, err := row.open(r.d.Box)
		if err != nil {
			return err
		}
		rsec.AccessToken, rsec.RefreshToken = "", ""
		sealed, err := r.d.Box.SealJSON(rsec)
		if err != nil {
			return err
		}
		meta := row.OAuth
		meta.Connected, meta.ExpiresAt = false, nil
		msg := msgSignInAgain
		if err := tx.QueryRow(ctx, `UPDATE ai_mcp_servers SET status = 'needs_auth', error = $3, oauth = $4, secrets_enc = $5,
			version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2 RETURNING version, updated_at`,
			s.WorkspaceID, s.ID, msg, meta, sealed).Scan(&row.Version, &row.UpdatedAt); err != nil {
			return err
		}
		row.Status, row.Error, row.OAuth, row.SecretsEnc = StatusNeedsAuth, &msg, meta, sealed
		if _, err := events.Publish(ctx, tx, events.Event{WorkspaceID: s.WorkspaceID, Type: "ai_mcp_server.updated",
			Data: map[string]any{"mcp_server": row.view(r.d.Box)}}); err != nil {
			return err
		}
		return audit.Log(ctx, tx, nil, s.WorkspaceID, "ai.mcp_server_disconnected", "ai_mcp_server", &s.ID,
			map[string]any{"name": row.Name, "reason": "sign_in_expired"})
	})
	if err != nil {
		r.d.Log.Warn("mcp: record needs_auth", "workspace_id", s.WorkspaceID, "server_id", s.ID, "err", err)
	}
	r.forget(s.ID)
}

// revoke revokes a server's OAuth tokens when its authorization server supports it.
// Best effort: deletion goes ahead either way.
func (r *Registry) revoke(ctx context.Context, s *server) {
	if s.AuthKind != AuthOAuth || s.OAuth.RevocationEndpoint == "" {
		return
	}
	sec, err := s.open(r.d.Box)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	for _, t := range []struct{ token, hint string }{{sec.RefreshToken, "refresh_token"}, {sec.AccessToken, "access_token"}} {
		if t.token == "" {
			continue
		}
		form := url.Values{"token": {t.token}, "token_type_hint": {t.hint}}
		if _, err := r.checkURL(ctx, s.OAuth.RevocationEndpoint); err != nil {
			return
		}
		switch s.OAuth.AuthMethod {
		case "client_secret_post":
			form.Set("client_id", s.OAuth.ClientID)
			form.Set("client_secret", sec.ClientSecret)
		case "client_secret_basic":
		default:
			form.Set("client_id", s.OAuth.ClientID)
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.OAuth.RevocationEndpoint, strings.NewReader(form.Encode()))
		if err != nil {
			return
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		if s.OAuth.AuthMethod == "client_secret_basic" {
			req.SetBasicAuth(url.QueryEscape(s.OAuth.ClientID), url.QueryEscape(sec.ClientSecret))
		}
		hc := r.postClient()
		res, err := hc.Do(req)
		if err != nil {
			r.d.Log.Info("mcp: token revocation failed", "workspace_id", s.WorkspaceID, "server_id", s.ID)
			return
		}
		_ = res.Body.Close()
	}
}
