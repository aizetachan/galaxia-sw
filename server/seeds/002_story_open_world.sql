-- 002_story_open_world.sql
-- Sample seeds for narrative model

-- Affordances for key locations
INSERT INTO affordances (location_id, action, params, weight)
SELECT id, 'talk', '{"npc":"barman"}', 80 FROM locations WHERE name='Cantina de Mos Espa'
ON CONFLICT DO NOTHING;

INSERT INTO affordances (location_id, action, params, weight)
SELECT id, 'gamble', '{"game":"dice"}', 60 FROM locations WHERE name='Cantina de Mos Espa'
ON CONFLICT DO NOTHING;

INSERT INTO affordances (location_id, action, params, weight)
SELECT id, 'search', '{"area":"market"}', 40 FROM locations WHERE name='Mos Espa'
ON CONFLICT DO NOTHING;

INSERT INTO affordances (location_id, action, params, weight)
SELECT id, 'trade', '{"goods":"scrap"}', 50 FROM locations WHERE name='Mos Espa'
ON CONFLICT DO NOTHING;

INSERT INTO affordances (location_id, action, params, weight)
SELECT id, 'rest', '{}', 30 FROM locations WHERE name='Cantina de Mos Espa'
ON CONFLICT DO NOTHING;

-- Hooks
INSERT INTO story_hooks(scope, scope_id, label, offer, weight)
VALUES
 ('world', NULL, 'Rumor sobre carrera de vainas', '{"info":"Se rumorea una carrera cercana"}', 40),
 ('location', (SELECT id FROM locations WHERE name='Mos Espa'), 'Guardia sospechosa', '{"action":"investigar guardia"}', 60),
 ('location', (SELECT id FROM locations WHERE name='Cantina de Mos Espa'), 'Mercader necesita escolta', '{"action":"escoltar mercader"}', 70)
ON CONFLICT DO NOTHING;

-- Main story thread with beats
INSERT INTO story_threads(scope, scope_id, title, kind, priority)
VALUES ('world', NULL, 'El origen del héroe', 'main', 100)
ON CONFLICT DO NOTHING;

WITH t AS (SELECT id FROM story_threads WHERE title='El origen del héroe')
INSERT INTO story_beats(thread_id, idx, title, soft_mandatory, state)
SELECT t.id, 1, 'Enterarte de un misterio en la cantina', true, 'available' FROM t
UNION ALL
SELECT t.id, 2, 'Seguir la pista hasta el puerto espacial', true, 'pending' FROM t
UNION ALL
SELECT t.id, 3, 'Tomar una decisión difícil', true, 'pending' FROM t
ON CONFLICT DO NOTHING;

