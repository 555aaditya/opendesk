-- When the customer started waiting for a reply: their first public message after the
-- last outbound public reply. NULL once someone (or the AI agent) replied.
ALTER TABLE tickets ADD COLUMN waiting_since timestamptz;

UPDATE tickets t SET waiting_since = w.since
FROM (
    SELECT m.ticket_id, min(m.created_at) AS since
    FROM messages m
    WHERE m.kind = 'reply' AND m.direction = 'inbound'
      AND m.created_at > COALESCE((SELECT max(o.created_at) FROM messages o
          WHERE o.ticket_id = m.ticket_id AND o.kind = 'reply' AND o.direction = 'outbound'), '-infinity')
    GROUP BY m.ticket_id
) w
WHERE t.id = w.ticket_id AND t.status IN ('open', 'pending') AND t.deleted_at IS NULL;
