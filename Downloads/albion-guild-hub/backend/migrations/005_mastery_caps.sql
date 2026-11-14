-- Expand the storage ceiling without changing any recorded progress.
-- Individual family limits are validated by the API.
ALTER TABLE player_family_progress
 DROP CONSTRAINT IF EXISTS player_family_progress_total_level_check,
 ADD CONSTRAINT player_family_progress_total_level_check CHECK (total_level BETWEEN 0 AND 1200);
