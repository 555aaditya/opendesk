package kb

import (
	"context"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/opendesk/opendesk/internal/auth"
	"github.com/opendesk/opendesk/internal/db"
	"github.com/opendesk/opendesk/internal/deps"
	"github.com/opendesk/opendesk/internal/events"
	"github.com/opendesk/opendesk/internal/helpdesk/hd"
	"github.com/opendesk/opendesk/internal/httpx"
	"github.com/opendesk/opendesk/internal/ids"
)

type kbCollectionCreate struct {
	Name        string `json:"name" minLength:"1" maxLength:"100"`
	Slug        string `json:"slug,omitempty" maxLength:"100"`
	Description string `json:"description,omitempty" maxLength:"1000"`
	Position    int    `json:"position,omitempty"`
}

type kbCollectionPatch struct {
	Name        *string `json:"name,omitempty" minLength:"1" maxLength:"100"`
	Slug        *string `json:"slug,omitempty" maxLength:"100"`
	Description *string `json:"description,omitempty" maxLength:"1000"`
	Position    *int    `json:"position,omitempty"`
}

type collectionOut struct{ Body KbCollection }

func cleanName(s string) (string, error) {
	s = strings.Join(strings.Fields(s), " ")
	if s == "" {
		return "", httpx.Validation("name is required")
	}
	return hd.Truncate(s, 100), nil
}

// pickSlug returns a unique slug: the requested one (slugified, 409 when taken), or one
// generated from fallback.
func pickSlug(ctx context.Context, q db.Querier, table string, wid uuid.UUID, requested *string, fallback string, exclude *uuid.UUID) (string, error) {
	if requested != nil && strings.TrimSpace(*requested) != "" {
		slug := hd.Slugify(*requested)
		if slug == "" {
			return "", httpx.Validation("slug must contain letters or digits")
		}
		var taken bool
		if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM `+table+` WHERE workspace_id = $1 AND slug = $2 AND ($3::uuid IS NULL OR id <> $3))`,
			wid, slug, exclude).Scan(&taken); err != nil {
			return "", err
		}
		if taken {
			return "", httpx.Conflict("that slug is already in use")
		}
		return slug, nil
	}
	return hd.UniqueSlug(ctx, q, table, wid, hd.Slugify(fallback), exclude)
}

func slugConflict(err error) error {
	if db.IsUniqueViolation(err, "") {
		return httpx.Conflict("that slug is already in use")
	}
	return err
}

func registerCollections(d *deps.Deps, api huma.API) {
	huma.Register(api, huma.Operation{OperationID: "list-kb-collections", Method: http.MethodGet, Path: "/v1/kb/collections",
		Summary: "List knowledge base collections", Tags: []string{"Knowledge base"}},
		func(ctx context.Context, _ *struct{}) (*struct{ Body httpx.Page[KbCollection] }, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleViewer, auth.ScopeKBRead)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			rows, err := d.DB.Pool.Query(ctx, collectionSelect+` WHERE k.workspace_id = $2 ORDER BY k.position, k.name, k.id`, false, p.WorkspaceID)
			out, err := collectRows(rows, err, scanCollection)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &struct{ Body httpx.Page[KbCollection] }{httpx.Page[KbCollection]{Data: out}}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "get-kb-collection", Method: http.MethodGet, Path: "/v1/kb/collections/{id}",
		Summary: "Get a knowledge base collection", Tags: []string{"Knowledge base"}},
		func(ctx context.Context, in *struct {
			ID string `path:"id"`
		}) (*collectionOut, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleViewer, auth.ScopeKBRead)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := hd.ParseID(in.ID, "Collection")
			if err != nil {
				return nil, err
			}
			c, err := loadCollection(ctx, d.DB.Pool, p.WorkspaceID, id)
			if db.IsNotFound(err) {
				return nil, httpx.NotFound("Collection")
			}
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &collectionOut{c}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "create-kb-collection", Method: http.MethodPost, Path: "/v1/kb/collections",
		Summary: "Create a knowledge base collection", Tags: []string{"Knowledge base"}, DefaultStatus: http.StatusCreated},
		func(ctx context.Context, in *struct{ Body kbCollectionCreate }) (*collectionOut, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAgent, auth.ScopeKBWrite)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			name, err := cleanName(in.Body.Name)
			if err != nil {
				return nil, err
			}
			var c KbCollection
			err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
				slug, err := pickSlug(ctx, tx, "kb_collections", p.WorkspaceID, &in.Body.Slug, name, nil)
				if err != nil {
					return err
				}
				id := ids.New()
				if _, err := tx.Exec(ctx, `INSERT INTO kb_collections (id, workspace_id, name, slug, description, position)
					VALUES ($1,$2,$3,$4,$5,$6)`, id, p.WorkspaceID, name, slug, strings.TrimSpace(in.Body.Description), in.Body.Position); err != nil {
					return slugConflict(err)
				}
				if c, err = loadCollection(ctx, tx, p.WorkspaceID, id); err != nil {
					return err
				}
				_, err = events.Publish(ctx, tx, events.Event{WorkspaceID: p.WorkspaceID, Type: "kb_collection.created", Data: map[string]any{"kb_collection": c}})
				return err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &collectionOut{c}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "update-kb-collection", Method: http.MethodPatch, Path: "/v1/kb/collections/{id}",
		Summary: "Update a knowledge base collection", Tags: []string{"Knowledge base"}},
		func(ctx context.Context, in *struct {
			ID   string `path:"id"`
			Body kbCollectionPatch
		}) (*collectionOut, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAgent, auth.ScopeKBWrite)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := hd.ParseID(in.ID, "Collection")
			if err != nil {
				return nil, err
			}
			var c KbCollection
			err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
				cur, err := scanCollection(tx.QueryRow(ctx, collectionSelect+` WHERE k.workspace_id = $2 AND k.id = $3 FOR UPDATE OF k`, false, p.WorkspaceID, id))
				if db.IsNotFound(err) {
					return httpx.NotFound("Collection")
				}
				if err != nil {
					return err
				}
				b := in.Body
				if b.Name != nil {
					if cur.Name, err = cleanName(*b.Name); err != nil {
						return err
					}
				}
				if b.Slug != nil {
					if cur.Slug, err = pickSlug(ctx, tx, "kb_collections", p.WorkspaceID, b.Slug, cur.Name, &id); err != nil {
						return err
					}
				}
				if b.Description != nil {
					cur.Description = strings.TrimSpace(*b.Description)
				}
				if b.Position != nil {
					cur.Position = *b.Position
				}
				if _, err := tx.Exec(ctx, `UPDATE kb_collections SET name = $3, slug = $4, description = $5, position = $6, updated_at = now()
					WHERE workspace_id = $1 AND id = $2`, p.WorkspaceID, id, cur.Name, cur.Slug, cur.Description, cur.Position); err != nil {
					return slugConflict(err)
				}
				if c, err = loadCollection(ctx, tx, p.WorkspaceID, id); err != nil {
					return err
				}
				_, err = events.Publish(ctx, tx, events.Event{WorkspaceID: p.WorkspaceID, Type: "kb_collection.updated", Data: map[string]any{"kb_collection": c}})
				return err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return &collectionOut{c}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "delete-kb-collection", Method: http.MethodDelete, Path: "/v1/kb/collections/{id}",
		Summary: "Delete a knowledge base collection", Description: "Its articles stay, without a collection.",
		Tags: []string{"Knowledge base"}, DefaultStatus: http.StatusNoContent},
		func(ctx context.Context, in *struct {
			ID string `path:"id"`
		}) (*hd.Empty, error) {
			p, err := auth.RequireWorkspace(ctx, auth.RoleAgent, auth.ScopeKBWrite)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			id, err := hd.ParseID(in.ID, "Collection")
			if err != nil {
				return nil, err
			}
			err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
				tag, err := tx.Exec(ctx, `DELETE FROM kb_collections WHERE workspace_id = $1 AND id = $2`, p.WorkspaceID, id)
				if err != nil {
					return err
				}
				if tag.RowsAffected() == 0 {
					return httpx.NotFound("Collection")
				}
				_, err = events.Publish(ctx, tx, events.Event{WorkspaceID: p.WorkspaceID, Type: "kb_collection.deleted", Data: map[string]any{"kb_collection_id": id}})
				return err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return nil, nil
		})
}
