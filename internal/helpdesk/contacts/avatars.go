package contacts

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/opendesk/opendesk/internal/audit"
	"github.com/opendesk/opendesk/internal/auth"
	"github.com/opendesk/opendesk/internal/db"
	"github.com/opendesk/opendesk/internal/deps"
	"github.com/opendesk/opendesk/internal/domain"
	"github.com/opendesk/opendesk/internal/events"
	"github.com/opendesk/opendesk/internal/helpdesk/hd"
	"github.com/opendesk/opendesk/internal/httpx"
	"github.com/opendesk/opendesk/internal/images"
	"github.com/opendesk/opendesk/internal/jobs"
)

func sameEmail(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return strings.EqualFold(*a, *b)
}

// pictureFromURL applies a contact body's avatar_url: an https URL is copied by the
// fetch job as a manual picture; "" removes the manual picture and looks the automatic
// sources up again. It returns the key prefix of a removed image (discard after commit).
func pictureFromURL(ctx context.Context, d *deps.Deps, tx pgx.Tx, wid, id uuid.UUID, u *string) (string, error) {
	if u == nil {
		return "", nil
	}
	if *u == "" {
		var src *string
		if err := tx.QueryRow(ctx, `SELECT avatar_source FROM contacts WHERE workspace_id = $1 AND id = $2`, wid, id).Scan(&src); err != nil {
			return "", err
		}
		if src == nil || *src != "upload" {
			return "", nil
		}
		return images.ClearTx(ctx, tx, images.Owner{Type: images.OwnerContact, ID: id, WorkspaceID: &wid}, true, images.SetOptions{Quiet: true})
	}
	if _, err := tx.Exec(ctx, `UPDATE contacts SET avatar_remote_url = $3, avatar_source = 'upload', avatar_checked_at = NULL,
		avatar_retry_at = NULL WHERE workspace_id = $1 AND id = $2`, wid, id, *u); err != nil {
		return "", err
	}
	return "", images.Enqueue(ctx, tx, d.Jobs, jobs.AvatarFetchArgs{Owner: images.OwnerContact, ID: id, WorkspaceID: wid})
}

func publishContact(ctx context.Context, tx pgx.Tx, wid, id uuid.UUID) error {
	c, err := domain.LoadContact(ctx, tx, wid, id)
	if db.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	_, err = events.Publish(ctx, tx, events.Event{WorkspaceID: wid, Type: "contact.updated", Data: map[string]any{"contact": c}})
	return err
}

func publishCompany(ctx context.Context, tx pgx.Tx, wid, id uuid.UUID) error {
	c, err := loadCompany(ctx, tx, wid, id)
	if db.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	_, err = events.Publish(ctx, tx, events.Event{WorkspaceID: wid, Type: "company.updated", Data: map[string]any{"company": c}})
	return err
}

// InstallImageHooks publishes contact.updated and company.updated when a picture changes.
func InstallImageHooks() {
	images.SetHooks(images.Hooks{Contact: publishContact, Company: publishCompany})
}

type avatarKind struct {
	owner, table, what, tag, path string
	fit                           images.Fit
}

func registerAvatars(d *deps.Deps, api huma.API) {
	avatarRoutes(d, api, avatarKind{images.OwnerContact, "contacts", "Contact", "Contacts", "/v1/contacts/{id}/avatar", images.Cover},
		func(ctx context.Context, wid, id uuid.UUID) (domain.Contact, error) {
			return domain.LoadContact(ctx, d.DB.Pool, wid, id)
		})
	avatarRoutes(d, api, avatarKind{images.OwnerCompany, "companies", "Company", "Companies", "/v1/companies/{id}/avatar", images.Contain},
		func(ctx context.Context, wid, id uuid.UUID) (Company, error) {
			return loadCompany(ctx, d.DB.Pool, wid, id)
		})
}

func avatarRoutes[T any](d *deps.Deps, api huma.API, k avatarKind, load func(ctx context.Context, wid, id uuid.UUID) (T, error)) {
	target := func(ctx context.Context, raw string) (*auth.Principal, images.Owner, error) {
		p, err := auth.RequireWorkspace(ctx, auth.RoleAgent, auth.ScopeContactsWrite)
		if err != nil {
			return nil, images.Owner{}, httpx.Wrap(err)
		}
		id, err := hd.ParseID(raw, k.what)
		if err != nil {
			return nil, images.Owner{}, err
		}
		if err := hd.CheckRef(ctx, d.DB.Pool, p.WorkspaceID, k.owner, id); err != nil {
			return nil, images.Owner{}, httpx.NotFound(k.what)
		}
		return p, images.Owner{Type: k.owner, ID: id, WorkspaceID: &p.WorkspaceID}, nil
	}
	auditFn := func(p *auth.Principal, o images.Owner, action string) func(context.Context, pgx.Tx) error {
		return func(ctx context.Context, tx pgx.Tx) error {
			return audit.Log(ctx, tx, p, p.WorkspaceID, k.owner+"."+action, k.owner, &o.ID, nil)
		}
	}
	fail := func(err error) error {
		if errors.Is(err, images.ErrOwnerGone) || db.IsNotFound(err) {
			return httpx.NotFound(k.what)
		}
		return httpx.Wrap(err)
	}
	what := strings.ToLower(k.what)

	huma.Register(api, images.UploadOperation(api, huma.Operation{OperationID: "upload-" + k.owner + "-avatar", Method: http.MethodPut,
		Path: k.path, Summary: "Upload a " + what + " picture", Tags: []string{k.tag},
		Description: "A manual picture that automatic sources never replace. PNG, JPEG, GIF or WebP, at most 5 MB."}),
		func(ctx context.Context, in *struct {
			ID string `path:"id"`
			images.UploadInput
		}) (*struct{ Body T }, error) {
			p, o, err := target(ctx, in.ID)
			if err != nil {
				return nil, err
			}
			img, err := images.ReadUpload(&in.UploadInput, k.fit)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			err = images.Set(ctx, d, o, img, "upload", images.SetOptions{After: func(ctx context.Context, tx pgx.Tx) error {
				if k.owner == images.OwnerContact {
					if _, err := tx.Exec(ctx, `UPDATE contacts SET avatar_remote_url = '' WHERE workspace_id = $1 AND id = $2`, p.WorkspaceID, o.ID); err != nil {
						return err
					}
				}
				return auditFn(p, o, "avatar_updated")(ctx, tx)
			}})
			if err != nil {
				return nil, fail(err)
			}
			out, err := load(ctx, p.WorkspaceID, o.ID)
			if err != nil {
				return nil, fail(err)
			}
			return &struct{ Body T }{out}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "delete-" + k.owner + "-avatar", Method: http.MethodDelete,
		Path: k.path, Summary: "Remove a " + what + "'s uploaded picture", Tags: []string{k.tag},
		Description: "Removes the picture and looks the automatic sources up again."},
		func(ctx context.Context, in *struct {
			ID string `path:"id"`
		}) (*struct{ Body T }, error) {
			p, o, err := target(ctx, in.ID)
			if err != nil {
				return nil, err
			}
			if err := images.Clear(ctx, d, o, true, images.SetOptions{After: auditFn(p, o, "avatar_removed")}); err != nil {
				return nil, fail(err)
			}
			out, err := load(ctx, p.WorkspaceID, o.ID)
			if err != nil {
				return nil, fail(err)
			}
			return &struct{ Body T }{out}, nil
		})

	huma.Register(api, huma.Operation{OperationID: "refresh-" + k.owner + "-avatar", Method: http.MethodPost,
		Path: k.path + "/refresh", Summary: "Look a " + what + "'s picture up again", Tags: []string{k.tag},
		DefaultStatus: http.StatusAccepted},
		func(ctx context.Context, in *struct {
			ID string `path:"id"`
		}) (*struct{}, error) {
			p, o, err := target(ctx, in.ID)
			if err != nil {
				return nil, err
			}
			err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
				if _, err := tx.Exec(ctx, `UPDATE `+k.table+` SET avatar_failures = 0, avatar_retry_at = NULL
					WHERE workspace_id = $1 AND id = $2`, p.WorkspaceID, o.ID); err != nil {
					return err
				}
				return images.Enqueue(ctx, tx, d.Jobs, jobs.AvatarFetchArgs{Owner: k.owner, ID: o.ID, WorkspaceID: p.WorkspaceID})
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return nil, nil
		})
}
