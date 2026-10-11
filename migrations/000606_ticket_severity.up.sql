-- Ticket severity: business impact, sev1 the most severe. NULL means not assessed.
ALTER TABLE tickets
    ADD COLUMN severity text CHECK (severity IN ('sev1', 'sev2', 'sev3', 'sev4'));

CREATE INDEX tickets_ws_severity_idx ON tickets(workspace_id, severity) WHERE severity IS NOT NULL AND deleted_at IS NULL;
