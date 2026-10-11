-- Labels: colours, descriptions, groups (optionally exclusive), order, archive and scope.
CREATE TABLE tag_groups (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name         text NOT NULL,
    color        text,
    exclusive    boolean NOT NULL DEFAULT false,
    position     integer NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tag_groups_ws_idx ON tag_groups(workspace_id, position);

ALTER TABLE tags
    ADD COLUMN color       text NOT NULL DEFAULT 'gray',
    ADD COLUMN description text NOT NULL DEFAULT '',
    ADD COLUMN group_id    uuid REFERENCES tag_groups(id) ON DELETE SET NULL,
    ADD COLUMN position    integer NOT NULL DEFAULT 0,
    ADD COLUMN archived    boolean NOT NULL DEFAULT false,
    ADD COLUMN applies_to  text[] NOT NULL DEFAULT '{tickets,contacts,companies}',
    ADD COLUMN updated_at  timestamptz NOT NULL DEFAULT now();
CREATE INDEX tags_group_idx ON tags(group_id) WHERE group_id IS NOT NULL;

CREATE TABLE contact_tags (
    contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    tag_id     uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (contact_id, tag_id)
);
CREATE INDEX contact_tags_tag_idx ON contact_tags(tag_id);

CREATE TABLE company_tags (
    company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    tag_id     uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (company_id, tag_id)
);
CREATE INDEX company_tags_tag_idx ON company_tags(tag_id);

-- Colour the existing labels: the default ones by name, the rest from a hash of the name.
UPDATE tags SET color = CASE lower(name)
    WHEN 'question' THEN 'blue' WHEN 'problem' THEN 'orange' WHEN 'bug' THEN 'red'
    WHEN 'feature request' THEN 'violet' WHEN 'billing' THEN 'green' WHEN 'vip' THEN 'amber' WHEN 'feedback' THEN 'teal'
    ELSE (ARRAY['gray','red','orange','amber','yellow','lime','green','teal','cyan','blue','indigo','violet','purple','pink','rose'])
        [1 + (abs(hashtext(lower(name))) % 15)]
    END;

-- The default "Type" group for workspaces that have the default labels.
INSERT INTO tag_groups (workspace_id, name, exclusive, position)
SELECT w.id, 'Type', true, 0 FROM workspaces w
WHERE EXISTS (SELECT 1 FROM tags t WHERE t.workspace_id = w.id
    AND lower(t.name) IN ('question', 'problem', 'bug', 'feature request', 'billing'));
UPDATE tags t SET group_id = g.id,
    position = CASE lower(t.name) WHEN 'question' THEN 0 WHEN 'problem' THEN 1 WHEN 'bug' THEN 2 WHEN 'feature request' THEN 3 ELSE 4 END
FROM tag_groups g
WHERE g.workspace_id = t.workspace_id AND g.name = 'Type'
    AND lower(t.name) IN ('question', 'problem', 'bug', 'feature request', 'billing');
UPDATE tags t SET position = s.n + 10 FROM (
    SELECT id, row_number() OVER (PARTITION BY workspace_id ORDER BY lower(name)) AS n FROM tags WHERE group_id IS NULL
) s WHERE s.id = t.id;

-- Custom fields: definitions per entity; values live in a validated `fields` object on each record.
CREATE TABLE custom_fields (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    entity            text NOT NULL CHECK (entity IN ('ticket', 'contact', 'company')),
    key               text NOT NULL,
    name              text NOT NULL,
    type              text NOT NULL CHECK (type IN ('text', 'long_text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url', 'email', 'user')),
    options           jsonb NOT NULL DEFAULT '[]',
    required_on_solve boolean NOT NULL DEFAULT false,
    description       text NOT NULL DEFAULT '',
    position          integer NOT NULL DEFAULT 0,
    archived          boolean NOT NULL DEFAULT false,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, entity, key)
);

ALTER TABLE tickets ADD COLUMN fields jsonb NOT NULL DEFAULT '{}';
ALTER TABLE contacts ADD COLUMN fields jsonb NOT NULL DEFAULT '{}';
ALTER TABLE companies ADD COLUMN fields jsonb NOT NULL DEFAULT '{}';
ALTER TABLE tickets ADD COLUMN fields_search tsvector GENERATED ALWAYS AS (jsonb_to_tsvector('simple'::regconfig, fields, '["string", "numeric"]')) STORED;
ALTER TABLE contacts ADD COLUMN fields_search tsvector GENERATED ALWAYS AS (jsonb_to_tsvector('simple'::regconfig, fields, '["string", "numeric"]')) STORED;
ALTER TABLE companies ADD COLUMN fields_search tsvector GENERATED ALWAYS AS (jsonb_to_tsvector('simple'::regconfig, fields, '["string", "numeric"]')) STORED;
CREATE INDEX tickets_fields_idx ON tickets USING gin(fields jsonb_path_ops);
CREATE INDEX tickets_fields_search_idx ON tickets USING gin(fields_search);
CREATE INDEX contacts_fields_search_idx ON contacts USING gin(fields_search);
CREATE INDEX companies_fields_search_idx ON companies USING gin(fields_search);
