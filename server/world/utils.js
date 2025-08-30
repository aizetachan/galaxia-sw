export function ensureInt(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}

export function rollFormula(formula) {
  const m = String(formula).trim().match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!m) throw new Error('Fórmula inválida, usa p.ej. "2d6+1"');
  const [, nStr, fStr, modStr] = m;
  const n = parseInt(nStr, 10);
  const f = parseInt(fStr, 10);
  const mod = modStr ? parseInt(modStr, 10) : 0;
  const dice = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * f));
  const total = dice.reduce((a, b) => a + b, 0) + mod;
  return { dice, mod, faces: f, nDice: n, total };
}

export function outcomeFromDC(total, dc) {
  if (dc == null) return null;
  if (total >= dc + 3) return 'success';
  if (total >= dc) return 'mixed';
  return 'fail';
}

export function applyStatePatch(current, patch) {
  const out = { ...current };
  if (patch?.attrs) {
    out.attrs = { ...(current.attrs || {}) };
    for (const [k, v] of Object.entries(patch.attrs)) {
      if (v && typeof v === 'object' && 'delta' in v) {
        const from = Number(out.attrs?.[k] ?? 0);
        out.attrs[k] = from + Number(v.delta || 0);
      } else {
        out.attrs[k] = v;
      }
    }
  }
  if (patch?.inventory) {
    const cur = Array.isArray(current.inventory) ? [...current.inventory] : [];
    for (const it of patch.inventory) {
      const { op, id, qty = 1 } = it || {};
      if (!id || !op) continue;
      const idx = cur.findIndex((x) => x.id === id);
      if (op === 'add') {
        if (idx >= 0) cur[idx] = { ...cur[idx], qty: (cur[idx].qty || 0) + qty };
        else cur.push({ id, qty });
      } else if (op === 'remove' && idx >= 0) {
        const newQty = (cur[idx].qty || 0) - qty;
        if (newQty > 0) cur[idx] = { ...cur[idx], qty: newQty };
        else cur.splice(idx, 1);
      }
    }
    out.inventory = cur;
  }
  if (patch?.tags) {
    const cur = new Set(Array.isArray(current.tags) ? current.tags : []);
    const adds = patch.tags?.add || [];
    const rems = patch.tags?.remove || [];
    adds.forEach((t) => cur.add(t));
    rems.forEach((t) => cur.delete(t));
    out.tags = [...cur];
  }
  return out;
}

// Normalizador de strings cortos (para inserts/updates)
export function s(v, max = 200) {
  if (v == null) return null;
  const t = String(v).trim();
  return t ? t.slice(0, max) : null;
}
