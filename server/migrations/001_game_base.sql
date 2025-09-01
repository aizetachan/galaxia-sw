-- 001_game_base.sql
-- Game base schema for world, attributes, inventory, quests, story vars and game clock

-- Enable pgcrypto extension for gen_random_uuid
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1.1 Mundo y posición
CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'place',
  parent_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  props JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS location_links (
  from_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  to_id   UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  rule JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (from_id, to_id)
);

CREATE TABLE IF NOT EXISTS character_location (
  character_id UUID PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  location_id  UUID NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_character_location_loc ON character_location(location_id);

-- 1.2 Atributos y recursos
CREATE TABLE IF NOT EXISTS character_attributes (
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  attr TEXT NOT NULL,
  value NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id, attr)
);

CREATE TABLE IF NOT EXISTS character_resources (
  character_id UUID PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  hp INT NOT NULL DEFAULT 100,
  energy INT NOT NULL DEFAULT 100,
  morale INT NOT NULL DEFAULT 50,
  hunger INT NOT NULL DEFAULT 0,
  credits INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.3 Items e inventario
DO $$ BEGIN
  CREATE TYPE item_type AS ENUM ('consumable','weapon','armor','quest','misc');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS item_defs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  type item_type NOT NULL,
  rarity TEXT,
  allowed_slots TEXT[] NOT NULL DEFAULT '{}',
  base_stats JSONB NOT NULL DEFAULT '{}',
  use_effect JSONB NOT NULL DEFAULT '{}',
  stackable BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS item_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_def_id UUID NOT NULL REFERENCES item_defs(id) ON DELETE CASCADE,
  durability INT,
  seed INT,
  bound_to_character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS character_inventory (
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_instance_id UUID NOT NULL REFERENCES item_instances(id) ON DELETE CASCADE,
  qty INT NOT NULL DEFAULT 1,
  equipped_slot TEXT,
  PRIMARY KEY (character_id, item_instance_id)
);
CREATE INDEX IF NOT EXISTS idx_inv_character ON character_inventory(character_id);

-- 1.4 Misiones y progreso
CREATE TABLE IF NOT EXISTS quests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  scope TEXT NOT NULL DEFAULT 'world',
  rewards JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quest_objectives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quest_id UUID NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  idx INT NOT NULL,
  type TEXT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}',
  UNIQUE (quest_id, idx)
);

CREATE TABLE IF NOT EXISTS quest_progress (
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  quest_id UUID NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  objective_id UUID REFERENCES quest_objectives(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'active',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, quest_id, objective_id)
);
CREATE INDEX IF NOT EXISTS idx_qp_char ON quest_progress(character_id);

-- 1.5 Story variables y GameClock
CREATE TABLE IF NOT EXISTS story_variables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('world','faction','character')),
  scope_id UUID,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope_type, scope_id, key)
);
CREATE INDEX IF NOT EXISTS idx_storyvars_scope ON story_variables(scope_type, scope_id);

CREATE TABLE IF NOT EXISTS world_time (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE,
  real_to_game_ratio NUMERIC NOT NULL DEFAULT 2.0,
  current_epoch_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT
);

-- Indices adicionales
CREATE INDEX IF NOT EXISTS idx_item_instances_def ON item_instances(item_def_id);
CREATE INDEX IF NOT EXISTS idx_attr_char ON character_attributes(character_id);
