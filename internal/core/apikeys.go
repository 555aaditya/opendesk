package core

import (
	"context"
	"net/http"
	"slices"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/opendesk/opendesk/internal/audit"
	"github.com/opendesk/opendesk/internal/auth"
	"github.com/opendesk/opendesk/internal/crypto"
	"github.com/opendesk/opendesk/internal/db"
	"github.com/opendesk/opendesk/internal/displayname"
	"github.com/opendesk/opendesk/internal/domain"
	"github.com/opendesk/opendesk/internal/httpx"
	"github.com/opendesk/opendesk/internal/ids"
)

// APIKeyPrefix starts every API key; the resolver recognizes keys by it.
const APIKeyPrefix = "od_live_"

type CoreAPIKey struct {
	ID         uuid.UUID       `json:"id"`
	Name       string          `json:"name"`
	Prefix     string          `json:"prefix" doc:"First characters of the key, for recognizing it"`
	Scopes     []string        `json:"scopes"`
	LastUsedAt *time.Time      `json:"last_used_at"`
	ExpiresAt  *time.Time      `json:"expires_at"`
	CreatedAt  time.Time       `json:"created_at"`
	CreatedBy  *domain.UserRef `json:"created_by"`
}

type CoreAPIKeyWithSecret struct {
	CoreAPIKey
	Secret string `json:"secret" doc:"The full key. Shown once."`
}

const apiKeySelect = `SELECT k.id, k.name, k.prefix, k.scopes, k.last_used_at, k.expires_at, k.created_at,
	u.id, u.name, u.email, u.avatar_url FROM api_keys k LEFT JOIN users u ON u.id = k.created_by`

func scanAPIKey(r pgx.Row) (CoreAPIKey, error) {
	var k CoreAPIKey
	var uid *uuid.UUID
	var name, email, avatar *string
	if err := r.Scan(&k.ID, &k.Name, &k.Prefix, &k.Scopes, &k.LastUsedAt, &k.ExpiresAt, &k.CreatedAt, &uid, &name, &email, &avatar); err != nil {
		return k, err
	}
	if uid != nil {
		k.CreatedBy = &domain.UserRef{ID: *uid, Name: *name, Email: *email, AvatarURL: domain.Avatar(*avatar)}
	}
	if k.Scopes == nil {
		k.Scopes = []string{}
	}
	return k, nil
}

func loadAPIKey(ctx context.Context, q db.Querier, wid, id uuid.UUID) (CoreAPIKey, error) {
	return scanAPIKey(q.QueryRow(ctx, apiKeySelect+` WHERE k.workspace_id = $1 AND k.id = $2 AND k.revoked_at IS NULL`, wid, id))
}

// newAPIKey returns a key, its stored hash and its displayed prefix.
func newAPIKey() (secret string, hash []byte, prefix string) {
	secret = APIKeyPrefix + crypto.RandomToken(32)
	return secret, crypto.HashToken(secret), secret[:len(APIKeyPrefix)+8]
}

// validScopes normalizes a scope list; every entry must be a known scope.
func validScopes(in []string) ([]string, error) {
	if len(in) == 0 {
		return nil, httpx.Validation("Choose at least one scope.")
	}
	out := make([]string, 0, len(in))
	for _, s := range in {
		if !slices.Contains(auth.AllScopes, s) {
			return nil, httpx.Validation("Unknown scope: " + truncate(s, 40))
		}
		if !slices.Contains(out, s) {
			out = append(out, s)
		}
	}
	slices.Sort(out)
	return out, nil
}

func (s *svc) registerAPIKeys(api huma.API) {
	tags := []string{"API keys"}

	register(s, api, huma.Operation{OperationID: "list-api-keys", Method: http.MethodGet, Path: "/v1/api-keys",
		Summary: "List API keys", Tags: tags},
		func(ctx context.Context, in *struct{ httpx.ListParams }) (*struct{ Body httpx.Page[CoreAPIKey] }, error) {
			p, err := requireUserWorkspace(ctx, auth.RoleAdmin)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			var cur struct {
				T  time.Time `json:"t"`
				ID uuid.UUID `json:"id"`
			}
			if err := httpx.DecodeCursor(in.Cursor, &cur); err != nil {
				return nil, err
			}
			if cur.T.IsZero() {
				cur.T = time.Now().Add(time.Hour)
			}
			rows, err := s.d.DB.Pool.Query(ctx, apiKeySelect+` WHERE k.workspace_id = $1 AND k.revoked_at IS NULL
				AND (k.created_at, k.id) < ($2, $3) ORDER BY k.created_at DESC, k.id DESC LIMIT $4`, p.WorkspaceID, cur.T, cur.ID, in.Limit+1)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (CoreAPIKey, error) { return scanAPIKey(r) })
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body httpx.Page[CoreAPIKey] }{httpx.NewPage(list, in.Limit, func(k CoreAPIKey) any {
				return map[string]any{"t": k.CreatedAt, "id": k.ID}
			})}, nil
		})

	register(s, api, huma.Operation{OperationID: "get-api-key", Method: http.MethodGet, Path: "/v1/api-keys/{id}",
		Summary: "Get an API key", Tags: tags},
		func(ctx context.Context, in *struct {
			ID string `path:"id"`
		}) (*struct{ Body CoreAPIKey }, error) {
			p, err := requireUserWorkspace(ctx, auth.RoleAdmin)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := parseID(in.ID, "API key")
			if err != nil {
				return nil, err
			}
			k, err := loadAPIKey(ctx, s.d.DB.Pool, p.WorkspaceID, id)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body CoreAPIKey }{k}, nil
		})

	register(s, api, huma.Operation{OperationID: "create-api-key", Method: http.MethodPost, Path: "/v1/api-keys",
		Summary: "Create an API key", Tags: tags, DefaultStatus: http.StatusCreated},
		func(ctx context.Context, in *struct {
			Body struct {
				Name      string     `json:"name" maxLength:"200"`
				Scopes    []string   `json:"scopes" maxItems:"20"`
				ExpiresAt *time.Time `json:"expires_at,omitempty"`
			}
		}) (*struct {
			CacheControl string `header:"Cache-Control"`
			Body         CoreAPIKeyWithSecret
		}, error) {
			p, err := requireUserWorkspace(ctx, auth.RoleAdmin)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			name, err := displayname.Validate("Key name", in.Body.Name, displayname.Workspace, false)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			scopes, err := validScopes(in.Body.Scopes)
			if err != nil {
				return nil, err
			}
			if e := in.Body.ExpiresAt; e != nil && !e.After(time.Now().Add(time.Minute)) {
				return nil, httpx.Validation("expires_at must be in the future.")
			}
			if err := s.limit("apikey:create:"+p.WorkspaceID.String(), 30, time.Hour); err != nil {
				return nil, err
			}
			secret, hash, prefix := newAPIKey()
			var k CoreAPIKey
			err = s.tx(ctx, func(tx pgx.Tx) error {
				id := ids.New()
				if _, err := tx.Exec(ctx, `INSERT INTO api_keys (id, workspace_id, name, prefix, key_hash, scopes, created_by, expires_at)
					VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, id, p.WorkspaceID, name, prefix, hash, scopes, p.UserID, in.Body.ExpiresAt); err != nil {
					return err
				}
				if err := audit.Log(ctx, tx, p, p.WorkspaceID, "api_key.created", "api_key", &id,
					map[string]any{"name": name, "scopes": scopes, "prefix": prefix}); err != nil {
					return err
				}
				k, err = loadAPIKey(ctx, tx, p.WorkspaceID, id)
				return err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			s.d.Analytics.Capture(p.UserID.String(), p.WorkspaceID.String(), "api_key_created",
				map[string]any{"scope_count": len(scopes), "expires": in.Body.ExpiresAt != nil})
			return &struct {
				CacheControl string `header:"Cache-Control"`
				Body         CoreAPIKeyWithSecret
			}{"no-store", CoreAPIKeyWithSecret{CoreAPIKey: k, Secret: secret}}, nil
		})

	register(s, api, huma.Operation{OperationID: "update-api-key", Method: http.MethodPatch, Path: "/v1/api-keys/{id}",
		Summary: "Rename an API key", Tags: tags},
		func(ctx context.Context, in *struct {
			ID   string `path:"id"`
			Body struct {
				Name string `json:"name" maxLength:"200"`
			}
		}) (*struct{ Body CoreAPIKey }, error) {
			p, err := requireUserWorkspace(ctx, auth.RoleAdmin)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := parseID(in.ID, "API key")
			if err != nil {
				return nil, err
			}
			name, err := displayname.Validate("Key name", in.Body.Name, displayname.Workspace, false)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			var k CoreAPIKey
			err = s.tx(ctx, func(tx pgx.Tx) error {
				tag, err := tx.Exec(ctx, `UPDATE api_keys SET name = $3 WHERE id = $1 AND workspace_id = $2 AND revoked_at IS NULL`, id, p.WorkspaceID, name)
				if err != nil {
					return err
				}
				if tag.RowsAffected() == 0 {
					return httpx.NotFound("API key")
				}
				if err := audit.Log(ctx, tx, p, p.WorkspaceID, "api_key.updated", "api_key", &id, map[string]any{"name": name}); err != nil {
					return err
				}
				k, err = loadAPIKey(ctx, tx, p.WorkspaceID, id)
				return err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body CoreAPIKey }{k}, nil
		})

	register(s, api, huma.Operation{OperationID: "revoke-api-key", Method: http.MethodDelete, Path: "/v1/api-keys/{id}",
		Summary: "Revoke an API key", Tags: tags, DefaultStatus: http.StatusNoContent},
		func(ctx context.Context, in *struct {
			ID string `path:"id"`
		}) (*struct{}, error) {
			p, err := requireUserWorkspace(ctx, auth.RoleAdmin)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := parseID(in.ID, "API key")
			if err != nil {
				return nil, err
			}
			err = s.tx(ctx, func(tx pgx.Tx) error {
				tag, err := tx.Exec(ctx, `UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND workspace_id = $2 AND revoked_at IS NULL`, id, p.WorkspaceID)
				if err != nil {
					return err
				}
				if tag.RowsAffected() == 0 {
					return httpx.NotFound("API key")
				}
				return audit.Log(ctx, tx, p, p.WorkspaceID, "api_key.revoked", "api_key", &id, nil)
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			// Sockets opened with this key carry it as their subject.
			s.disconnect(id, uuid.Nil)
			return nil, nil
		})
}
