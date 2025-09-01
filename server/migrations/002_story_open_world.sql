-- 002_story_open_world.sql
-- New narrative tables: threads, beats, hooks, affordances, discoveries

-- Hilos de historia
CREATE TABLE IF NOT EXISTS story_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('character','world')),
  scope_id UUID,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'main',
  priority INT NOT NULL DEFAULT 50,
  state TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pasos dentro del hilo
CREATE TABLE IF NOT EXISTS story_beats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES story_threads(id) ON DELETE CASCADE,
  idx INT NOT NULL,
  title TEXT NOT NULL,
  condition JSONB NOT NULL DEFAULT '{}',
  actions JSONB NOT NULL DEFAULT '{}',
  soft_mandatory BOOLEAN NOT NULL DEFAULT false,
  cooldown_s INT NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'pending',
  UNIQUE(thread_id, idx)
);

-- Hooks narrativos
CREATE TABLE IF NOT EXISTS story_hooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('character','world','location')),
  scope_id UUID,
  label TEXT NOT NULL,
  offer JSONB NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  weight INT NOT NULL DEFAULT 50,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Acciones disponibles en un lugar
CREATE TABLE IF NOT EXISTS affordances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}',
  requires JSONB NOT NULL DEFAULT '{}',
  weight INT NOT NULL DEFAULT 50,
  cooldown_s INT NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true
);

-- Descubrimientos del jugador
CREATE TABLE IF NOT EXISTS discoveries (
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  key TEXT,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, entity_type, entity_id, key)
);

