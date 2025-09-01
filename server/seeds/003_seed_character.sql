-- 003_seed_character.sql
-- Seed functions for initializing a character with basic stats, items and story

-- Requiere pgcrypto para gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============
-- Seed por personaje
-- ==============
CREATE OR REPLACE FUNCTION seed_character_basics(p_character_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_city UUID;
  v_cantina UUID;
  v_port UUID;
  v_market UUID;
  v_def_blaster UUID;
  v_def_stim UUID;
  v_inst UUID;
  v_thread UUID;
BEGIN
  -- Asegurar localizaciones base (creadas en seeds previos)
  SELECT id INTO v_city FROM locations WHERE name='Mos Espa' LIMIT 1;
  SELECT id INTO v_cantina FROM locations WHERE name='Cantina de Mos Espa' LIMIT 1;
  SELECT id INTO v_port FROM locations WHERE name='Puerto Espacial' LIMIT 1;
  SELECT id INTO v_market FROM locations WHERE name='Mercado de Chatarra' LIMIT 1;

  IF v_cantina IS NULL THEN
    RAISE EXCEPTION 'No existe la localización "Cantina de Mos Espa". Ejecuta los seeds del mundo antes.';
  END IF;

  -- Posición por defecto (Cantina)
  INSERT INTO character_location(character_id, location_id)
  VALUES (p_character_id, v_cantina)
  ON CONFLICT (character_id) DO UPDATE
  SET location_id = EXCLUDED.location_id,
      last_seen_at = now();

  -- Recursos base
  INSERT INTO character_resources(character_id)
  VALUES (p_character_id)
  ON CONFLICT (character_id) DO NOTHING;

  -- Atributos base
  INSERT INTO character_attributes(character_id, attr, value) VALUES
    (p_character_id,'str',5),
    (p_character_id,'agi',5),
    (p_character_id,'int',5),
    (p_character_id,'cha',5),
    (p_character_id,'luck',5)
  ON CONFLICT (character_id, attr) DO NOTHING;

  -- Definiciones de items necesarias
  SELECT id INTO v_def_blaster FROM item_defs WHERE code='blaster_mk1' LIMIT 1;
  SELECT id INTO v_def_stim   FROM item_defs WHERE code='stimpack'   LIMIT 1;

  IF v_def_blaster IS NULL OR v_def_stim IS NULL THEN
    RAISE EXCEPTION 'Faltan item_defs (blaster_mk1 o stimpack). Ejecuta los seeds del mundo antes.';
  END IF;

  -- Bláster (no stackable) + equipar en 'hands'
  INSERT INTO item_instances(item_def_id, durability, bound_to_character_id)
  VALUES (v_def_blaster, 100, p_character_id)
  RETURNING id INTO v_inst;

  INSERT INTO character_inventory(character_id, item_instance_id, qty, equipped_slot)
  VALUES (p_character_id, v_inst, 1, 'hands')
  ON CONFLICT DO NOTHING;

  -- Stimpacks (stackable=TRUE) → qty=2
  INSERT INTO item_instances(item_def_id, bound_to_character_id)
  VALUES (v_def_stim, p_character_id)
  RETURNING id INTO v_inst;

  INSERT INTO character_inventory(character_id, item_instance_id, qty)
  VALUES (p_character_id, v_inst, 2)
  ON CONFLICT DO NOTHING;

  -- Hilo principal (si ya existe, no duplicar)
  SELECT st.id INTO v_thread
  FROM story_threads st
  WHERE st.scope='character' AND st.scope_id=p_character_id AND st.kind='main'
  LIMIT 1;

  IF v_thread IS NULL THEN
    INSERT INTO story_threads(scope, scope_id, title, kind, priority)
    VALUES ('character', p_character_id, 'Ecos en Mos Espa', 'main', 80)
    RETURNING id INTO v_thread;

    INSERT INTO story_beats(thread_id, idx, title, soft_mandatory, condition, actions)
    VALUES
      (v_thread, 1, 'Rumor en la Cantina', TRUE,
        jsonb_build_object('location_name','Cantina de Mos Espa'),
        jsonb_build_object('hint','Habla con el barman para enterarte de un rastro')),
      (v_thread, 2, 'Sombra en el Puerto', TRUE,
        jsonb_build_object('location_name','Puerto Espacial'),
        jsonb_build_object('hint','Observa el muelle 3, alguien se mueve en las sombras')),
      (v_thread, 3, 'Trato en el Mercado', TRUE,
        jsonb_build_object('location_name','Mercado de Chatarra'),
        jsonb_build_object('hint','Negocia con el chatarrero o rebusca entre la chatarra'));
  END IF;

  -- Descubrimientos iniciales
  IF v_port IS NOT NULL THEN
    INSERT INTO discoveries(character_id, entity_type, entity_id, key)
    VALUES (p_character_id,'location',v_port,'known')
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_market IS NOT NULL THEN
    INSERT INTO discoveries(character_id, entity_type, entity_id, key)
    VALUES (p_character_id,'location',v_market,'known')
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO discoveries(character_id, entity_type, entity_id, key)
  VALUES (p_character_id,'location',v_cantina,'known')
  ON CONFLICT DO NOTHING;

  -- Memoria del personaje
  INSERT INTO story_variables(scope_type, scope_id, key, value)
  VALUES ('character', p_character_id, 'tutorial_seen', '{"value": false}')
  ON CONFLICT (scope_type, scope_id, key) DO NOTHING;
END $$;


-- ==============
-- Helper por username
-- ==============
CREATE OR REPLACE FUNCTION seed_character_for_user(p_username TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_char UUID;
BEGIN
  SELECT c.id INTO v_char
  FROM characters c
  JOIN users u ON u.id = c.user_id
  WHERE u.username = p_username
  ORDER BY c.created_at DESC
  LIMIT 1;

  IF v_char IS NULL THEN
    RAISE NOTICE 'No se encontró personaje para el usuario %', p_username;
  ELSE
    PERFORM seed_character_basics(v_char);
    RAISE NOTICE 'Seed aplicado a character_id=%', v_char;
  END IF;
END $$;
