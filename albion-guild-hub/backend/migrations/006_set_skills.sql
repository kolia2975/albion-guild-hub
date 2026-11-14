-- Existing sets remain valid: no skills are chosen automatically.
ALTER TABLE gear_set_items ADD COLUMN IF NOT EXISTS skills JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(skills)='object');
