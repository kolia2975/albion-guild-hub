-- New family totals are separate from legacy 0–100 mastery records.
-- Do not reinterpret, multiply or delete historical values.
CREATE TABLE IF NOT EXISTS player_family_progress (
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 code TEXT NOT NULL,
 total_level SMALLINT NOT NULL CHECK (total_level BETWEEN 0 AND 960),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,code)
);
