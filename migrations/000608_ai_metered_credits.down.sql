ALTER TABLE ai_usage DROP COLUMN cost_usd;
ALTER TABLE ai_usage ALTER COLUMN millicredits TYPE integer USING ceil(millicredits / 1000.0)::integer;
ALTER TABLE ai_usage RENAME COLUMN millicredits TO credits;

ALTER TABLE ai_credits ALTER COLUMN purchased_milli TYPE integer USING floor(purchased_milli / 1000.0)::integer;
ALTER TABLE ai_credits RENAME COLUMN purchased_milli TO purchased_balance;
ALTER TABLE ai_credits ALTER COLUMN included_used_milli TYPE integer USING ceil(included_used_milli / 1000.0)::integer;
ALTER TABLE ai_credits RENAME COLUMN included_used_milli TO included_used;
