BEGIN;

DROP TABLE IF EXISTS dice_rolls;

CREATE TABLE dice_rolls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  context_type TEXT NOT NULL DEFAULT 'generic', -- combat|skill_check|dialogue|generic
  formula TEXT NOT NULL,                        -- "1d20+3"
  result JSONB NOT NULL,                        -- {"total":17,"detail":[14, +3]}
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dice_rolls_char ON dice_rolls(character_id);

COMMIT;
