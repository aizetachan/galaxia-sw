// Máster IA - versión funcional mínima para onboarding + chat base
const express = require('express');
const router = express.Router();
const recommendationMemory = new Map(); // key: player name -> { species, role, at }
const buildProposalMemory = new Map(); // key: player name -> { species, role, at }
const sessionStoryMemory = new Map(); // key: player name -> lightweight scene memory

function replyWithMemory(mem, baseText, altText) {
  const next = String(baseText || '').trim();
  if (!next) return '';
  if (mem.lastReply && mem.lastReply === next) {
    const alt = String(altText || '').trim();
    mem.lastReply = alt || `${next}\n(La situación cambia ligeramente: se oyen pasos acercándose.)`;
    return mem.lastReply;
  }
  mem.lastReply = next;
  return next;
}

function hasTag(msg, tag) {
  return String(msg || '').toUpperCase().includes(`<<${tag}`);
}

function parseConfirmAck(msg = '') {
  const m = String(msg).match(/<<CONFIRM_ACK\s+TYPE="([^"]+)"\s+DECISION="([^"]+)"\s*>>/i);
  if (!m) return null;
  return { type: (m[1] || '').toLowerCase(), decision: (m[2] || '').toLowerCase() };
}

function parseQuotedValue(msg = '', key = 'NAME') {
  const re = new RegExp(`${key}="([^"]+)"`, 'i');
  const m = String(msg).match(re);
  return m ? m[1].trim() : null;
}

function extractNameFromText(msg = '') {
  const s = String(msg).trim();
  if (!s) return null;
  if (s.startsWith('<<')) return null;
  return s.slice(0, 42);
}

const SPECIES_CATALOG = [
  { key: 'humano', label: 'Humano' },
  { key: 'twilek', label: "Twi'lek" },
  { key: 'twi lek', label: "Twi'lek" },
  { key: 'zabrak', label: 'Zabrak' },
  { key: 'mirialan', label: 'Mirialan' },
  { key: 'rodiano', label: 'Rodiano' },
  { key: 'rodian', label: 'Rodiano' },
  { key: 'mandaloriano', label: 'Mandaloriano' },
  { key: 'ewok', label: 'Ewok' },
  { key: 'wookie', label: 'Wookiee' },
  { key: 'wookiee', label: 'Wookiee' }
];

const ROLE_CATALOG = [
  { key: 'piloto', label: 'Piloto' },
  { key: 'contrabandista', label: 'Contrabandista' },
  { key: 'cazarrecompensas', label: 'Cazarrecompensas' },
  { key: 'diplomatic', label: 'Diplomátic@' },
  { key: 'diplomatico', label: 'Diplomátic@' },
  { key: 'diplomatica', label: 'Diplomátic@' },
  { key: 'ingeniero', label: 'Ingenier@' },
  { key: 'ingeniera', label: 'Ingenier@' },
  { key: 'jedi', label: 'Jedi' },
  { key: 'sith', label: 'Sith' },
  { key: 'explorador', label: 'Explorador/a' },
  { key: 'mercenario', label: 'Mercenario/a' }
];

function normalizeText(s = '') {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s'\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectFromCatalog(text, catalog) {
  const n = normalizeText(text);
  for (const item of catalog) {
    if (n.includes(item.key)) return item.label;
  }
  return null;
}

function parseBuildIntent(message = '') {
  const raw = String(message || '').trim();
  const n = normalizeText(raw);

  const asksOptions = /\?|opcion|opciones|raza|razas|especie|especies|rol|roles|clase|profesion|que puedo ser|que puedo hacer|que me recomiendas|recomiend|recomend/.test(n);
  const asksClarify = /no se|no se que|duda|explica|mas info/.test(n);

  let species = detectFromCatalog(raw, SPECIES_CATALOG);
  let role = detectFromCatalog(raw, ROLE_CATALOG);

  // Refuerzo para frases naturales: "quiero ser un ewok con el rol de jedi"
  if (!species) {
    const m = n.match(/ser\s+(?:un|una)?\s*([a-z'\-\s]+)/);
    if (m) species = detectFromCatalog(m[1], SPECIES_CATALOG);
  }
  if (!role) {
    const m = n.match(/rol\s+(?:de)?\s*([a-z'\-\s]+)/);
    if (m) role = detectFromCatalog(m[1], ROLE_CATALOG);
  }

  const confirms = /confirm|si$|vale$|ok$|perfecto$/.test(n);

  return { asksOptions, asksClarify, species, role, confirms };
}

router.post('/respond', (req, res) => {
  const message = String(req.body?.message || '').trim();
  const stage = String(req.body?.stage || 'name').toLowerCase();
  const state = req.body?.clientState || {};

  // Kickoff
  if (hasTag(message, 'CLIENT_HELLO')) {
    return res.json({
      ok: true,
      text: '✨ Conexión al HoloCanal establecida. Para iniciar tu aventura, dime tu nombre en la galaxia.'
    });
  }

  // Confirmaciones del cliente
  const ack = parseConfirmAck(message);
  if (ack) {
    if (ack.type === 'name' && ack.decision === 'yes') {
      const n = state?.name || 'viajer@';
      return res.json({
        ok: true,
        text: `<<ONBOARD STEP="species">>Perfecto, ${n}. Ahora elige tu especie y rol (ejemplo: "Humano contrabandista" o "Twi'lek diplomática").`
      });
    }
    if (ack.type === 'name' && ack.decision === 'no') {
      return res.json({ ok: true, text: 'Entendido. Dime de nuevo cómo quieres llamarte en la galaxia.' });
    }
    if (ack.type === 'build' && ack.decision === 'yes') {
      const playerKey = (state?.name || 'anon').toLowerCase();
      buildProposalMemory.delete(playerKey);
      sessionStoryMemory.set(playerKey, {
        location: 'Dock 7 de la estación orbital',
        inventory: ['Credencial gastada', 'Comlink dañado', '42 créditos'],
        threat: 'Alerta amarilla',
        lastAction: 'Llegada',
        justFinishedOnboarding: true
      });
      return res.json({
        ok: true,
        text: '<<ONBOARD STEP="done">>✅ Identidad confirmada. Llegas al **Dock 7** de una estación orbital en alerta amarilla. Ves guardias, un panel de salidas y un pasillo hacia la cantina. ¿Qué haces primero?'
      });
    }
    if (ack.type === 'build' && ack.decision === 'no') {
      return res.json({ ok: true, text: 'Sin problema. Reescribe especie y rol con el formato que prefieras.' });
    }
  }

  // Flujo por etapas
  if (stage === 'name') {
    const nameFromTag = parseQuotedValue(message, 'NAME');
    const candidate = nameFromTag || extractNameFromText(message);
    if (!candidate) {
      return res.json({ ok: true, text: 'Para empezar, dime tu nombre en la galaxia.' });
    }
    return res.json({
      ok: true,
      text: `<<CONFIRM TYPE="name" NAME="${candidate}">>He entendido que tu nombre es **${candidate}**. ¿Lo confirmas?`
    });
  }

  if (stage === 'build') {
    if (!message || message.startsWith('<<')) {
      return res.json({ ok: true, text: 'Vamos paso a paso. Dime qué te atrae más: especie, rol, o ambas cosas, y yo te ayudo a cerrarlo.' });
    }

    const intent = parseBuildIntent(message);
    const nEarly = normalizeText(message);
    const playerKey = (state?.name || 'anon').toLowerCase();

    // Si el usuario responde afirmativo y había propuesta pendiente, recuperamos confirmación
    const isAffirmative = /^(si|sí|ok|vale|perfecto|confirmo|yes)\b/.test(nEarly);
    if (isAffirmative) {
      const pending = buildProposalMemory.get(playerKey);
      if (pending?.species && pending?.role) {
        return res.json({
          ok: true,
          text: `<<CONFIRM TYPE="build" SPECIES="${pending.species}" ROLE="${pending.role}">>Perfecto, recupero tu elección: **${pending.species} ${pending.role}**. ¿La confirmas?`
        });
      }
    }

    let speciesResolved = intent.species || detectFromCatalog(nEarly, SPECIES_CATALOG);
    let roleResolved = intent.role || detectFromCatalog(nEarly, ROLE_CATALOG);

    // Fallback explícito para frases largas: "me gustaria ser un ewok con el rol de jedi"
    const explicitCombo = nEarly.match(/(humano|twilek|twi lek|zabrak|mirialan|rodiano|mandaloriano|ewok|wookie|wookiee).*(piloto|contrabandista|cazarrecompensas|diplomatico|diplomatica|ingeniero|ingeniera|jedi|sith|explorador|mercenario)/);
    if (explicitCombo) {
      speciesResolved = speciesResolved || detectFromCatalog(explicitCombo[1], SPECIES_CATALOG);
      roleResolved = roleResolved || detectFromCatalog(explicitCombo[2], ROLE_CATALOG);
    }
    const acceptRecommendedEarly = /confirmo recomend|me quedo con esa|la recomendada|acepto recomend|esa me sirve/.test(nEarly);
    if (acceptRecommendedEarly) {
      const rec = recommendationMemory.get(playerKey);
      if (rec?.species && rec?.role) {
        return res.json({
          ok: true,
          text: `<<CONFIRM TYPE="build" SPECIES="${rec.species}" ROLE="${rec.role}">>Perfecto, usamos la recomendación: **${rec.species} ${rec.role}**. ¿La confirmas?`
        });
      }
    }

    // Si el usuario ya dio especie+rol en lenguaje natural, confirmar directamente
    if (speciesResolved && roleResolved) {
      buildProposalMemory.set(playerKey, { species: speciesResolved, role: roleResolved, at: Date.now() });
      return res.json({
        ok: true,
        text: `<<CONFIRM TYPE="build" SPECIES="${speciesResolved}" ROLE="${roleResolved}">>Perfecto: especie **${speciesResolved}**, rol **${roleResolved}**. ¿Confirmas esta identidad?`
      });
    }

    if (intent.asksOptions || intent.asksClarify) {
      const n = normalizeText(message);
      const askingRole = /rol|clase|profesion|que puedo hacer|funcion/.test(n);
      const askingRecommend = /recomiend|recomend|suger|que me conviene|que me recomiendas|ayudame a elegir/.test(n);
      const askingMoreSpecies = /mas raza|mas razas|raza mas|razas mas|otra raza|otras razas|mas especie|mas especies|especie mas|especies mas|alguna raza mas/.test(n);

      if (askingRecommend) {
        return res.json({
          ok: true,
          text: 'Perfecto, te propongo una recomendación personalizada. ¿Qué estilo prefieres?\n- **Combate**\n- **Sigilo**\n- **Social/negociación**\n- **Técnico/soporte**\n\nSi quieres, también puedes pedirme más info antes de elegir o crear tu combinación manual.'
        });
      }

      if (askingRole && !speciesResolved && !roleResolved) {
        return res.json({
          ok: true,
          text: 'Claro, para **rol** puedes elegir entre: **Piloto**, **Contrabandista**, **Cazarrecompensas**, **Diplomátic@**, **Ingenier@**, **Jedi**, **Explorador/a**.\n\nSi quieres, te recomiendo uno según estilo: combate, sigilo, social o técnico.'
        });
      }

      if (askingMoreSpecies) {
        return res.json({
          ok: true,
          text: 'Sí, además de las principales, también puedes usar: **Bothan**, **Chiss**, **Nautolano**, **Togruta**, **Mon Calamari**, **Kel Dor**, **Duros** o **Cathar**.\n\nSi quieres mantenerlo simple para empezar, te recomiendo elegir una de la lista base y luego ampliamos en la historia.'
        });
      }

      return res.json({
        ok: true,
        text: 'Te ayudo a elegir 👇\n**Especies (base):** Humano, Twi\'lek, Zabrak, Mirialan, Rodiano, Mandaloriano.\n**Roles:** Piloto, Contrabandista, Cazarrecompensas, Diplomátic@, Ingenier@, Jedi, Explorador/a.\n\nSi quieres más especies, dime: "¿hay más razas?". También puedo recomendarte según tu estilo.'
      });
    }

    // Recomendación personalizada por estilo (1-2 turnos antes de confirmar)
    const n2 = normalizeText(message);
    const asksMoreInfo = /mas info|explica|detalla|compar|pros|contras/.test(n2);
    if (asksMoreInfo) {
      return res.json({
        ok: true,
        text: 'Resumen rápido para decidir:\n- **Piloto**: movilidad y escapadas, ideal ritmo dinámico.\n- **Contrabandista**: sigilo, contactos y decisiones grises.\n- **Cazarrecompensas**: combate y rastreo.\n- **Diplomátic@**: influencia social y resolución por diálogo.\n- **Ingenier@**: hacks, soporte y soluciones técnicas.\n\nSi quieres, dime tu estilo y te doy una combinación lista (especie + rol).'
      });
    }

    const styleCombat = /combate|agresiv|accion|duelo/.test(n2);
    const styleStealth = /sigilo|sigilos|infiltr|furtiv/.test(n2);
    const styleSocial = /social|negoci|dialog|charla|persuasi/.test(n2);
    const styleTech = /tecnic|soporte|hack|ingenier|estrateg/.test(n2);

    if (styleCombat || styleStealth || styleSocial || styleTech) {
      let species = 'Humano';
      let role = 'Piloto';
      if (styleCombat) { species = 'Zabrak'; role = 'Cazarrecompensas'; }
      else if (styleStealth) { species = "Twi'lek"; role = 'Contrabandista'; }
      else if (styleSocial) { species = 'Mirialan'; role = 'Diplomátic@'; }
      else if (styleTech) { species = 'Humano'; role = 'Ingenier@'; }

      recommendationMemory.set(playerKey, { species, role, at: Date.now() });

      return res.json({
        ok: true,
        text: `Mi recomendación para tu estilo es: **${species} ${role}**.\nSi te encaja, responde: **confirmo recomendación**. Si no, puedes preguntar más o crear tu combinación libremente.`
      });
    }

    // Si el usuario solo da especie, pedimos rol de forma conversacional
    if (speciesResolved && !roleResolved) {
      return res.json({
        ok: true,
        text: `Genial, te quedas con **${speciesResolved}**. ¿Qué rol quieres para tu personaje? (ej: Piloto, Contrabandista, Ingenier@)`
      });
    }

    // Si solo da rol, pedimos especie
    if (!speciesResolved && roleResolved) {
      return res.json({
        ok: true,
        text: `Perfecto, rol **${roleResolved}**. ¿Qué especie prefieres para encajarlo mejor en la historia?`
      });
    }

    // fallback conversacional
    return res.json({
      ok: true,
      text: 'Te leo, pero aún no tengo clara tu combinación final. Dime algo como: "Humano piloto" o "quiero ser Mandaloriano cazarrecompensas".'
    });
  }

  // stage done (chat normal, flexible + narrativa con memoria anti-loop)
  const name = state?.name || 'agente';
  const nDone = normalizeText(message);

  const asksIdentity = /quien soy|quien era|mi personaje|mi ficha|recordame|recuerdame|como me llamo|cual es mi nombre/.test(nDone);
  const asksSpecies = /que raza|que especie|mi raza|mi especie/.test(nDone);
  const asksRole = /que rol|mi rol|a que me dedico|mi profesion|mi clase/.test(nDone);
  const asksSummary = /resumen|resume|que paso|donde estoy/.test(nDone);

  const species = state?.species || 'No definida';
  const role = state?.role || 'No definido';
  const playerKey = (state?.name || 'anon').toLowerCase();
  const mem = sessionStoryMemory.get(playerKey) || {
    node: 'dock',
    location: 'Dock 7 de la estación orbital',
    inventory: ['Comlink básico', '12 créditos', 'Llave magnética B-12'],
    threat: 'Alerta moderada',
    lastAction: 'Inicio de misión',
    lastIntentSig: ''
  };

  if (asksIdentity) {
    return res.json({ ok: true, text: `Tu identidad actual es: **${name}**, especie **${species}**, rol **${role}**.` });
  }
  if (asksSpecies) return res.json({ ok: true, text: `Tu especie actual es **${species}**.` });
  if (asksRole) return res.json({ ok: true, text: `Tu rol actual es **${role}**.` });
  if (asksSummary) {
    return res.json({ ok: true, text: `Resumen: estás en **${mem.location}** (${mem.threat}). Última acción: ${mem.lastAction}. Inventario: ${mem.inventory.join(', ')}.` });
  }

  // Clasificación de intención de jugador (con sinónimos)
  let intent = 'free';
  if (/bolsillo|inventario|que tengo|que llevo/.test(nDone)) intent = 'inventory';
  else if (/cuanto.*dinero|credito|creditos|me da para|me alcanza|cuanto tengo/.test(nDone)) intent = 'credits';
  else if (/alrededor|observo|miro|examino|que hay|inspeccion|hay gente|gente cerca|alguien cerca|quien hay|quién hay|hay alguien/.test(nDone)) intent = 'observe';
  else if (/hablo|pregunto|guardia|npc|dialog|droide|camarero|barman|cantinero/.test(nDone)) intent = 'talk';
  else if (/cantina|bar|bebida/.test(nDone)) intent = 'go_cantina';
  else if (/b-12|compuerta|mantenimiento|forzar|abrir puerta/.test(nDone)) intent = 'go_b12';
  else if (/panel|salida|evacuacion|vuelo|transporte/.test(nDone)) intent = 'go_panel';
  else if (/voy|camino|ir a|me muevo|entro/.test(nDone)) intent = 'move';

  // Anti-loop: misma intención seguida => variar salida y avanzar micro-estado
  const intentSig = `${mem.node}:${intent}`;
  const repeated = mem.lastIntentSig === intentSig;
  mem.lastIntentSig = intentSig;

  const credits = (mem.inventory.join(' ').match(/(\d+)\s*credit/i) || [null, '12'])[1];

  if (intent === 'inventory') {
    mem.lastAction = 'Revisó inventario';
    const text = replyWithMemory(mem,
      `Llevas encima: ${mem.inventory.join(', ')}. La llave **B-12** podría abrir algo útil en mantenimiento.`,
      `Vuelves a revisar: ${mem.inventory.join(', ')}. Notas marcas recientes en la llave **B-12**, parece usada hace poco.`
    );
    sessionStoryMemory.set(playerKey, mem);
    return res.json({ ok: true, text });
  }

  if (intent === 'credits') {
    mem.lastAction = 'Consultó créditos';
    const text = replyWithMemory(mem,
      `Tienes **${credits} créditos**. Te alcanza para una bebida básica en la cantina y quizá sacar información.`,
      `Sigues con **${credits} créditos**. Si gastas 10 en la cantina, aún te quedará margen para un soborno menor.`
    );
    sessionStoryMemory.set(playerKey, mem);
    return res.json({ ok: true, text });
  }

  if (intent === 'observe') {
    mem.lastAction = 'Observó entorno';
    const asksPeopleNearby = /hay gente|gente cerca|alguien cerca|hay alguien|quien hay|quién hay/.test(nDone);
    const variant = asksPeopleNearby
      ? `Sí. Tienes cerca a dos guardias en el panel, un técnico nervioso saliendo de mantenimiento y una comerciante en dirección a la cantina.`
      : (repeated
        ? `Además detectas una cámara girando hacia el pasillo B-12 y una ruta secundaria poco vigilada.`
        : `Ves dos guardias discutiendo junto al panel de salidas, una puerta de mantenimiento entreabierta y señales de evacuación hacia cubierta C.`);
    const text = replyWithMemory(mem, `En **${mem.location}**: ${variant}`, `En **${mem.location}** ahora detectas movimiento en una pasarela superior y un aviso de acceso restringido.`);
    sessionStoryMemory.set(playerKey, mem);
    return res.json({ ok: true, text });
  }

  if (intent === 'talk') {
    mem.lastAction = 'Interacción social';
    const isDroidTalk = /droide|camarero|barman|cantinero/.test(nDone);

    let variant = '';
    let alt = '';

    if (isDroidTalk && mem.node === 'cantina') {
      variant = repeated
        ? `El droide inclina la cabeza: "Actualización: un cliente pagó en efectivo por acceso a B-12 hace 7 minutos."`
        : `El droide camarero te responde en binario suave y traduce: "Puedo venderte información. Tema recomendado: movimientos en B-12."`;
      alt = 'El droide proyecta un recibo parcial: **B12-KX / mesa 6**. Parece una pista útil.';
    } else if (isDroidTalk) {
      variant = `Intentas hablar con un droide, pero aquí no hay ninguno operativo cerca. Ves señalética hacia la cantina de cubierta C donde sí suele haber servicio.`;
      alt = 'Tu comlink detecta ping de servicio de cantina. Si vas allí, podrás hablar con el droide camarero.';
    } else {
      variant = repeated
        ? `El guardia añade: "Si llevas credencial B-12, no uses el acceso principal; te escanearán."`
        : `Un guardia te susurra: "Si buscas respuestas, evita el corredor iluminado y ve por mantenimiento. Hay algo raro en B-12."`;
      alt = 'El guardia baja aún más la voz: “Si vas a B-12, no actives luces. Hay sensores térmicos inestables.”';
    }

    const text = replyWithMemory(mem, variant, alt);
    sessionStoryMemory.set(playerKey, mem);
    return res.json({ ok: true, text });
  }

  if (intent === 'go_cantina') {
    mem.node = 'cantina';
    mem.location = 'Cantina de la cubierta C';
    mem.lastAction = 'Entró en cantina';
    sessionStoryMemory.set(playerKey, mem);
    return res.json({ ok: true, text: `Entras en la cantina. El ambiente está tenso. Un droide camarero te observa y en una mesa alguien menciona "el código B-12".` });
  }

  if (intent === 'go_b12' || intent === 'move') {
    mem.node = 'b12';
    mem.location = 'Corredor de mantenimiento B-12';
    mem.lastAction = 'Se movió a B-12';
    const text = replyWithMemory(mem,
      `Avanzas hacia **B-12**. Luces parpadeando, zumbido eléctrico y una compuerta con lector magnético. Puedes usar la llave o buscar bypass.`,
      `En **B-12** aparece un dron de mantenimiento averiado bloqueando parte del paso. Puedes apartarlo o intentar abrir la compuerta desde el panel lateral.`
    );
    sessionStoryMemory.set(playerKey, mem);
    return res.json({ ok: true, text });
  }

  if (intent === 'go_panel') {
    mem.node = 'panel';
    mem.location = 'Panel de salidas del Dock 7';
    mem.lastAction = 'Revisó panel de salidas';
    const text = replyWithMemory(mem,
      `El panel muestra retrasos y una salida marcada como restringida: **Ruta KX-9**. Parece vinculada a la alerta.`,
      `El panel se actualiza: la **Ruta KX-9** cambia a prioridad alta y aparece un código parcial: **B12-KX**.`
    );
    sessionStoryMemory.set(playerKey, mem);
    return res.json({ ok: true, text });
  }

  // fallback suave, sin bloquear ni exigir formato
  mem.lastAction = 'Acción libre';
  sessionStoryMemory.set(playerKey, mem);
  const fallbackBase = repeated
    ? `Sigo tu idea y la integro en la escena. Ahora mismo estás en **${mem.location}**; hay tensión por la alerta y varias rutas abiertas.`
    : `Entendido, ${name}. Tu acción impacta la historia. Estás en **${mem.location}** y la situación sigue en alerta.`;
  const fallback = replyWithMemory(mem, fallbackBase, `Recibido. La escena avanza en **${mem.location}**: se activa un aviso sonoro y aparecen nuevas oportunidades de acción.`);
  sessionStoryMemory.set(playerKey, mem);
  return res.json({ ok: true, text: fallback });
});

router.get('/resume', (req, res) => {
  res.json({
    ok: true,
    resume: 'Sesión activa. Usa /resumen para una síntesis contextual (placeholder v1).'
  });
});

module.exports = router;
