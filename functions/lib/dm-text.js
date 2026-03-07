function stripLeadingMetaJson(text = '') {
  let s = String(text || '').trim();
  if (!s) return '';

  for (let i = 0; i < 4; i++) {
    const firstLineRaw = s.split('\n')[0] || '';
    const firstLine = firstLineRaw.trim();

    const looksLikeMetaLine =
      firstLine.startsWith('{') &&
      (/(")?(roll|memo|engine|stage|hook|escena)(")?\s*:/.test(firstLine) || firstLine.includes('"memo"'));

    if (looksLikeMetaLine) {
      s = s.slice(firstLineRaw.length).trim();
      continue;
    }

    const inlineMatch = s.match(/^\s*\{[\s\S]{1,1200}?\}\s*/);
    if (inlineMatch) {
      const first = inlineMatch[0].trim();
      try {
        const obj = JSON.parse(first);
        const keys = Object.keys(obj || {}).map((k) => String(k).toLowerCase());
        const hasMetaKey = ['roll', 'memo', 'engine', 'stage', 'hook', 'escena', 'consecuencia', 'opciones'].some((k) => keys.includes(k));
        if (hasMetaKey) {
          s = s.slice(inlineMatch[0].length).trim();
          continue;
        }
      } catch (_) {}
    }

    if (firstLine.includes('\\"roll\\"') || firstLine.includes('"roll"') || firstLine.includes('\\"memo\\"') || firstLine.includes('"memo"')) {
      const unescaped = firstLine.replace(/\\"/g, '"');
      try {
        const obj = JSON.parse(unescaped);
        const keys = Object.keys(obj || {}).map((k) => String(k).toLowerCase());
        const hasMetaKey = ['roll', 'memo', 'engine', 'stage', 'hook', 'escena', 'consecuencia', 'opciones'].some((k) => keys.includes(k));
        if (hasMetaKey) {
          s = s.slice(firstLineRaw.length).trim();
          continue;
        }
      } catch (_) {}
    }

    break;
  }

  return s.trim();
}

function sanitizeDmText(rawText = '') {
  let text = String(rawText || '');
  if (!text) return '';

  text = text.replace(/```(?:json)?\s*[\s\S]*?```/gi, (block) => {
    const snippet = String(block || '');
    return /("?roll"?|"?memo"?|"?hook"?|"?escena"?|"?consecuencia"?|"?opciones"?)/i.test(snippet) ? '' : snippet;
  });

  text = text
    .replace(/<<[\s\S]*?>>/g, '')
    .replace(/^\s*\[(?:meta|system|debug)[^\]]*\]\s*:?\n?/gim, '')
    .replace(/^\s*<(?:meta|system|debug)[^>]*>\s*/gim, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(?:\*\*|__)?\s*(hook|escena|consecuencia|opciones?|accion|acción|contexto|estado)\s*(?:\*\*|__)?\s*:[ \t]*/gim, '')
    .replace(/^\s*[-*]\s*(hook|escena|consecuencia|opciones?|accion|acción|contexto|estado)\s*:[ \t]*/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ');

  text = stripLeadingMetaJson(text).trim();
  return text;
}

function polishStageDoneText(rawText = '', { userAskedOptions = false } = {}) {
  let text = sanitizeDmText(rawText);
  if (!text) return '';

  text = text
    .replace(/\b(?:como\s+m[aá]ster|como\s+director\s+de\s+juego)\b[^.\n]*[.\n]/gi, '')
    .replace(/\b(?:json|meta\s*json|roll\s*:\s*[A-Za-zÁÉÍÓÚáéíóúñÑ]+\s*:\s*\d+)\b/gi, '')
    .replace(/^\s*(?:sistema|reglas\s+internas?)\s*:\s*.*$/gim, '')
    .trim();

  if (!userAskedOptions) {
    text = text
      .replace(/\n?\s*opciones?\s*:\s*\n(?:\s*(?:[-*]|\d+[.)])\s+.+\n?){2,6}$/gim, '')
      .replace(/\n(?:\s*(?:[-*]|\d+[.)])\s+.+\n?){3,6}$/gim, (match) => {
        return /(?:sigilo|social|tecnic|retirada|opci[oó]n|elegir)/i.test(match) ? '' : match;
      })
      .trim();
  }

  return text;
}

function looksTruncatedNarrative(text = '') {
  const t = String(text || '').trim();
  if (!t) return false;
  if (t.length < 40) return false;
  if (/\b(mi|tu|tus|su|sus|nuestro|nuestra|nuestros|nuestras)\s*[.!?…]?$/i.test(t)) return true;
  if (/\b(de|del|de la|de los|de las|y|o|que|con|para|por|en|al|la|el)\s*[.!?…]?$/i.test(t)) return true;
  if (/[.!?…]$/.test(t)) return false;
  return true;
}

function finalizeNarrative(text = '') {
  let t = String(text || '').trim();
  if (!t) return '';

  if (looksTruncatedNarrative(t)) {
    t = t.replace(/[,:;\-–—\s]+$/g, '').trim();
    t += '. La situación sigue en movimiento a tu alrededor.';
    return t;
  }

  if (!/[.!?…]$/.test(t)) t += '.';
  return t;
}

module.exports = {
  stripLeadingMetaJson,
  sanitizeDmText,
  polishStageDoneText,
  looksTruncatedNarrative,
  finalizeNarrative
};
