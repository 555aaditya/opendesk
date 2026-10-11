// Package audit records security-relevant and settings changes per workspace.
package audit

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/opendesk/opendesk/internal/auth"
	"github.com/opendesk/opendesk/internal/ids"
)

// Log writes an audit entry in tx. data must not contain secrets or message content.
func Log(ctx context.Context, tx pgx.Tx, p *auth.Principal, wid uuid.UUID, action, entityType string, entityID *uuid.UUID, data map[string]any) error {
	if data == nil {
		data = map[string]any{}
	}
	var userID, keyID *uuid.UUID
	ip := ""
	if p != nil {
		userID, keyID, ip = p.ActorUserID(), p.ActorAPIKeyID(), p.IP
	}
	_, err := tx.Exec(ctx, `INSERT INTO audit_logs (id, workspace_id, actor_user_id, actor_api_key_id, action, entity_type, entity_id, data, ip)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, ids.New(), wid, userID, keyID, action, entityType, entityID, data, ip)
	if err != nil {
		return fmt.Errorf("audit: %w", err)
	}
	return nil
}
