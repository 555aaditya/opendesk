DROP INDEX IF EXISTS companies_fields_search_idx;
DROP INDEX IF EXISTS contacts_fields_search_idx;
DROP INDEX IF EXISTS tickets_fields_search_idx;
DROP INDEX IF EXISTS tickets_fields_idx;
ALTER TABLE companies DROP COLUMN IF EXISTS fields_search, DROP COLUMN IF EXISTS fields;
ALTER TABLE contacts DROP COLUMN IF EXISTS fields_search, DROP COLUMN IF EXISTS fields;
ALTER TABLE tickets DROP COLUMN IF EXISTS fields_search, DROP COLUMN IF EXISTS fields;
DROP TABLE IF EXISTS custom_fields;
DROP TABLE IF EXISTS company_tags;
DROP TABLE IF EXISTS contact_tags;
ALTER TABLE tags DROP COLUMN IF EXISTS updated_at, DROP COLUMN IF EXISTS applies_to, DROP COLUMN IF EXISTS archived,
    DROP COLUMN IF EXISTS position, DROP COLUMN IF EXISTS group_id, DROP COLUMN IF EXISTS description, DROP COLUMN IF EXISTS color;
DROP TABLE IF EXISTS tag_groups;
