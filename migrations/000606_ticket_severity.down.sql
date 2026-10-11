DROP INDEX IF EXISTS tickets_ws_severity_idx;
ALTER TABLE tickets DROP COLUMN IF EXISTS severity;
