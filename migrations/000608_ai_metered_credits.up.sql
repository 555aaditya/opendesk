-- AI credits follow real usage (contracts/billing.md "Metered credits"): balances and
-- usage rows are kept in thousandths of a credit, and each usage row records the
-- provider's cost of the call.
ALTER TABLE ai_credits RENAME COLUMN included_used TO included_used_milli;
ALTER TABLE ai_credits ALTER COLUMN included_used_milli TYPE bigint USING included_used_milli::bigint * 1000;
ALTER TABLE ai_credits RENAME COLUMN purchased_balance TO purchased_milli;
ALTER TABLE ai_credits ALTER COLUMN purchased_milli TYPE bigint USING purchased_milli::bigint * 1000;

ALTER TABLE ai_usage RENAME COLUMN credits TO millicredits;
ALTER TABLE ai_usage ALTER COLUMN millicredits TYPE bigint USING millicredits::bigint * 1000;
ALTER TABLE ai_usage ADD COLUMN cost_usd numeric(14, 8) NOT NULL DEFAULT 0;
