-- Existing sets keep their items; pre-quality records default to Normal.
ALTER TABLE gear_set_items ADD COLUMN IF NOT EXISTS quality SMALLINT NOT NULL DEFAULT 1 CHECK (quality BETWEEN 1 AND 5);
INSERT INTO crafting_lines(code,label,category) VALUES
 ('WAR_GLOVES','Бойові рукавиці','weapon'),
 ('SHAPESHIFTER_STAFF','Посохи перевертнів','weapon')
ON CONFLICT(code) DO UPDATE SET label=EXCLUDED.label,category=EXCLUDED.category;
