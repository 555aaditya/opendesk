DROP INDEX IF EXISTS ai_widget_answers_ws_created_idx;
ALTER TABLE ai_widget_answers DROP COLUMN handoff;
DROP TABLE ai_tool_calls;
DROP TABLE ai_widget_actions;
ALTER TABLE messages DROP COLUMN ai_rating;
ALTER TABLE messages DROP COLUMN ai_action;
