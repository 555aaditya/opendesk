DROP INDEX IF EXISTS widget_sessions_contact_idx;
DROP INDEX IF EXISTS kb_articles_ws_status_idx;
DROP INDEX IF EXISTS contacts_ws_company_idx;
DROP INDEX IF EXISTS contacts_ws_created_idx;
DROP INDEX IF EXISTS activities_ws_type_idx;
DROP INDEX IF EXISTS attachments_unattached_idx;
DROP INDEX IF EXISTS messages_ws_ticket_idx;
DROP INDEX IF EXISTS tickets_ws_team_idx;
DROP INDEX IF EXISTS tickets_autoclose_idx;
DROP INDEX IF EXISTS tickets_snoozed_idx;
DROP INDEX IF EXISTS tickets_ws_solved_idx;
DROP INDEX IF EXISTS tickets_ws_created_idx;
DROP TABLE IF EXISTS round_robin_cursors;
ALTER TABLE attachments DROP COLUMN IF EXISTS uploaded_by_contact_id;
ALTER TABLE tickets
    DROP COLUMN IF EXISTS csat_requested_at,
    DROP COLUMN IF EXISTS sla_resolution_breached_at,
    DROP COLUMN IF EXISTS sla_first_response_breached_at,
    DROP COLUMN IF EXISTS merged_into_id;
