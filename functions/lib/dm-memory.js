function inferTone(message = '') {
  const text = String(message || '');
  if (/\b(jaja|jajaja|xd|jeje|😂|🤣)\b/i.test(text)) return 'ligero';
  if (/[?¿]|ayuda|no entiendo|explica|como|cómo|que hago|qué hago/i.test(text)) return 'apoyo';
  if (/!{2,}|\b(rapido|rápido|ya|vamos|urgente)\b/i.test(text)) return 'directo';
  return 'neutral';
}

function buildRecentIntent(history = [], currentMessage = '') {
  const recentUser = [...(history || [])]
    .reverse()
    .find((h) => h?.kind === 'user' && String(h?.text || '').trim());
  const prev = String(recentUser?.text || '').trim();
  const now = String(currentMessage || '').trim();
  const basis = now || prev;
  if (!basis) return 'continuar la escena';

  const normalized = basis.toLowerCase();
  if (/inventario|que tengo|qué tengo|bolsillo|llevo/.test(normalized)) return 'revisar inventario';
  if (/credit|dinero|pagar|cuanto tengo|cuánto tengo/.test(normalized)) return 'gestionar créditos';
  if (/hablo|pregunto|convencer|negoci|guardia|npc/.test(normalized)) return 'interacción social';
  if (/observo|miro|inspeccion|alrededor|que hay|qué hay/.test(normalized)) return 'observar entorno';
  if (/voy|entro|camino|muevo|b12|cantina|panel/.test(normalized)) return 'desplazarse';
  return 'acción libre';
}

function createDmConversationMemory() {
  const store = new Map();

  function getMemory(userId) {
    return store.get(String(userId || 'anon')) || null;
  }

  function updateConversationMemory(userId, message, history) {
    const key = String(userId || 'anon');
    const prev = store.get(key) || {};
    const tone = inferTone(message);
    const recentIntent = buildRecentIntent(history, message);
    const mem = {
      tone,
      recentIntent,
      lastUserMessage: String(message || '').slice(0, 220),
      lastDmReply: prev.lastDmReply || '',
      updatedAt: Date.now()
    };
    store.set(key, mem);
    return mem;
  }

  function saveLastDmReply(userId, replyText = '') {
    const key = String(userId || 'anon');
    const prev = store.get(key) || {};
    store.set(key, {
      ...prev,
      lastDmReply: String(replyText || '').slice(0, 280),
      updatedAt: Date.now()
    });
  }

  return { getMemory, updateConversationMemory, saveLastDmReply };
}

module.exports = { createDmConversationMemory };
