-- 001_game_base seeds

-- Locations
INSERT INTO locations (id, name, type) VALUES
  (gen_random_uuid(),'Tatooine','planet'),
  (gen_random_uuid(),'Mos Espa','city'),
  (gen_random_uuid(),'Cantina de Mos Espa','interior')
ON CONFLICT DO NOTHING;

-- Story vars base
INSERT INTO story_variables (scope_type, scope_id, key, value)
VALUES ('world', NULL, 'tutorial_enabled', '{"value": true}'),
       ('world', NULL, 'drop_rate_common', '{"value": 0.65}')
ON CONFLICT DO NOTHING;

-- Items
INSERT INTO item_defs (code, name, type, rarity, allowed_slots, base_stats, use_effect, stackable) VALUES
  ('stimpack','Stimpack','consumable','common','{}','{}','{"heal": 30}', true),
  ('blaster_mk1','Bláster MK1','weapon','common','{"hands"}','{"atk": 5}','{}', false)
ON CONFLICT DO NOTHING;

-- Quest de bienvenida
INSERT INTO quests (code, title, description, rewards)
VALUES ('intro_cantina','Bienvenido a la Cantina','Llega a la cantina y habla con el barman.','{"xp":50,"credits":25}')
ON CONFLICT DO NOTHING;

WITH q AS (SELECT id FROM quests WHERE code='intro_cantina')
INSERT INTO quest_objectives (quest_id, idx, type, params)
SELECT q.id, 1, 'go_to', '{"location_name":"Cantina de Mos Espa"}' FROM q
ON CONFLICT DO NOTHING;

-- GameClock
INSERT INTO world_time (id, real_to_game_ratio, note)
VALUES (TRUE, 2.0, '12h de juego por cada 24h reales')
ON CONFLICT (id) DO NOTHING;
