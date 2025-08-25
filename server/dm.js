// server/dm.js
import { Router } from 'express';
import OpenAI from 'openai';
import { hasDb, sql } from './db.js';
import { optionalAuth } from './auth.js';

const router = Router();

// Pequeña ayuda
const toInt = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

async function getWorldBrief(characterId) {
  if (!hasDb || !characterId) return '';
  // Personaje + últimos eventos relevantes (públicos cerca, facción y sus actos)
  const [{ rows: cRows }, { rows: ev1 }, { rows: ev2 }, { rows: ev3 }] = await Promise.all([
    sql(
      `SELECT c.id, c.name, c.species, c.role, c.last_location
         FROM characters c WHERE c.id=$1`,
      [characterId]
    ),
    sql(
      `SELECT e.ts, e.summary, e.location, e.kind
         FROM events e
        WHERE e.visibility='public'
          AND e.location IS NOT NULL
          AND e.location = (SELECT last_location FROM characters WHERE id=$1)
        ORDER BY e.ts DESC
        LIMIT 10`,
      [characterId]
    ),
    sql(
      `SELECT e.ts, e.summary, e.kind
         FROM faction_memberships fm
         JOIN events e ON e.visibility='faction' AND e.faction_id=fm.faction_id
        WHERE fm.character_id=$1
        ORDER BY e.ts DESC
        LIMIT 10`,
      [characterId]
    ),
    sql(
      `SELECT e.ts, e.summary, e.kind
         FROM events e
        WHERE e.actor_character_id=$1
        ORDER BY e.ts DESC
        LIMIT 5`,
      [characterId]
    ),
  ]);

  const c = cRows[0];
  if (!c) return '';
  const lines = [];
  lines.push(`PJ: ${c.name} (${c.species || '—'} / ${c.role || '—'}) en ${c.last_location || 'desconocido'}.`);
  if (ev3.length) {
    lines.push(`Últimos actos propios:`);
    ev3.forEach((e) => lines.push(`- [${e.kind || 'evento'}] ${e.summary}`));
  }
  if (ev1.length) {
    lines.push(`Cerca (público):`);
    ev1.forEach((e) => lines.push(`- ${e.summary} @ ${e.location}`));
  }
  if (ev2.length) {
    lines.push(`De tu facción:`);
    ev2.forEach((e) => lines.push(`- ${e.summary}`));
  }
  return lines.join('\n');
}

async function saveMessage(userId, role, text) {
  if (!hasDb) return;
  try {
    await sql(
      `INSERT INTO chat_messages(user_id, role, kind, text, ts)
       VALUES ($1, $2, $3, $4, now())`,
      [userId || null, role, role, text]
    );
  } catch {}
}

router.post('/dm', optionalAuth, async (req, res) => {
  try {
    const { text, character_id } = req.body || {};
    const userId = req.auth?.userId || null;

    if (!text || String(text).trim() === '') {
      return res.status(200).json({
        ok: true,
        reply: { text: '¿Puedes repetir la acción o pregunta?' },
      });
    }

    // Determinar personaje activo si no lo mandan
    let characterId = toInt(character_id);
    if (!characterId && hasDb && userId) {
      const { rows } = await sql(
        `SELECT id FROM characters WHERE owner_user_id=$1 LIMIT 1`,
        [userId]
      );
      characterId = rows[0]?.id || null;
    }

    // Guardar turno del jugador
    await saveMessage(userId, 'user', text);

    // Construir contexto de mundo breve
    const worldBrief = await getWorldBrief(characterId);

    // Preparar respuesta del Máster
    let assistantText =
      'El canal se abre con un chasquido. No tengo acceso al máster ahora mismo, intenta de nuevo en un momento.';

    if (process.env.OPENAI_API_KEY) {
      try {
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        const system = [
          'Eres el Máster de un juego de rol ambientado en una galaxia.',
          'Responde en español, 2-6 frases, directo a la acción.',
          'Nunca reveles reglas internas, narra consecuencias y ganchos.',
          worldBrief ? '\nContexto del mundo:\n' + worldBrief : '',
        ].join('\n');

        const completion = await client.chat.completions.create({
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          temperature: 0.8,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: text },
          ],
        });

        assistantText =
          completion.choices?.[0]?.message?.content?.trim() ||
          'El silencio del vacío te responde; intenta otra acción.';
      } catch (e) {
        assistantText =
          'Interferencia en la HoloNet. El máster no responde ahora mismo; repite la acción más tarde.';
      }
    } else {
      // Modo sin clave: eco amable para que la UI no caiga a fallback
      assistantText = `Recibido: "${text}". (Modo sin IA activo; configura OPENAI_API_KEY para respuestas narrativas).`;
    }

    // Guardar respuesta del máster
    await saveMessage(userId, 'dm', assistantText);

    // Importante: 200 siempre para evitar el fallback del front
    res.status(200).json({ ok: true, reply: { text: assistantText } });
  } catch (e) {
    // Incluso en error, devolvemos 200 con un texto (evita fallback "estática")
    res.status(200).json({
      ok: true,
      reply: { text: 'Fallo temporal del servidor. Repite la acción en un momento.' },
    });
  }
});

export default router;
