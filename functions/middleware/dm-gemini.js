const { sanitizeDmText, polishStageDoneText, finalizeNarrative, looksTruncatedNarrative } = require('../lib/dm-text');

function createDmGeminiMiddleware(options) {
  const {
    db,
    logger,
    askGemini,
    withTimeout,
    updateConversationMemory,
    saveLastDmReply,
    guidance = {},
    config = {}
  } = options;

  const {
    masterNatural = '',
    diceNatural = '',
    game = ''
  } = guidance;

  const {
    forceGeminiDefault = true,
    geminiChatModel = 'gemini',
    vertexLocation = 'global'
  } = config;

  return async function dmMiddleware(req, res, next) {
    try {
      if (req.method !== 'POST' || req.path !== '/respond') {
        return next();
      }

      const message = String(req.body?.message || '').trim();
      const stage = String(req.body?.stage || 'name').toLowerCase();
      const mode = String(req.body?.config?.mode || 'rich').toLowerCase();
      const forceGemini = forceGeminiDefault === true;
      const userAskedOptions = /\b(opciones?|alternativas|que puedo hacer|qué puedo hacer|dame opciones|sugerencias)\b/i.test(message);

      if (message && !message.startsWith('<<')) {
        await db.collection('users').doc(req.user.id).collection('messages').add({
          role: 'user',
          text: message,
          ts: new Date().toISOString()
        });
      }

      const originalJson = res.json.bind(res);
      res.json = async (payload) => {
        try {
          const cleanText = (stage === 'done'
            ? polishStageDoneText(payload?.text || '', { userAskedOptions })
            : sanitizeDmText(payload?.text || '')
          ).slice(0, 4000);

          if (payload && typeof payload === 'object' && cleanText) {
            payload.text = cleanText;
          }

          if (cleanText) {
            saveLastDmReply(req.user.id, cleanText);
            await db.collection('users').doc(req.user.id).collection('messages').add({
              role: 'dm',
              text: cleanText,
              ts: new Date().toISOString(),
              meta: {
                stage,
                engine: payload?.engine || 'rules',
                model: payload?.model || null,
                mode,
                forceGemini
              }
            });
          }
        } catch (persistError) {
          logger.error('[DM persist]', persistError);
        }

        if (stage === 'done' && payload && !payload.engine) {
          payload.engine = 'rules';
          payload.mode = mode;
        }

        return originalJson(payload);
      };

      const isProtocolMsg = message.startsWith('<<');
      const diceOutcomeMatch = message.match(/<<DICE_OUTCOME\s+SKILL="([^"]+)"\s+OUTCOME="([^"]+)"\s*>>/i);
      const isDiceOutcomeProtocol = Boolean(diceOutcomeMatch);
      const allowGemini = forceGemini || mode === 'rich';
      const shouldUseGemini = stage === 'done' && allowGemini && (!isProtocolMsg || isDiceOutcomeProtocol);

      if (!shouldUseGemini) {
        return next();
      }

      try {
        const state = req.body?.clientState || {};
        const history = Array.isArray(req.body?.history) ? req.body.history.slice(-8) : [];
        const effectiveMessage = isDiceOutcomeProtocol
          ? `Resultado de tirada: habilidad ${diceOutcomeMatch[1]}, outcome ${diceOutcomeMatch[2]}. Narra consecuencias naturales y continuidad de escena.`
          : message;
        const convMem = updateConversationMemory(req.user.id, effectiveMessage, history);

        const promptParts = [
          'Eres el máster narrativo de una aventura sci-fi estilo Star Wars.',
          'Conversación abierta y natural: sigue la intención reciente del jugador sin forzarlo a estructura rígida.',
          'Mantén continuidad explícita con lo último que hizo o preguntó el jugador.',
          'Evita repetir frases o cierres idénticos al turno anterior del máster.',
          'Adapta el tono a la energía del jugador: directo si va al grano, cálido si pide ayuda, ligero si usa humor.',
          'Responde en español natural, corto-medio, con avance narrativo concreto y útil.',
          'Cierra cada idea: si introduces una acción, describe también la consecuencia inmediata y termina la frase con sentido completo.',
          'Aplica la guidance internamente, pero NO muestres su formato, reglas ni estructura al usuario.',
          userAskedOptions
            ? 'El jugador pidió opciones: puedes dar 2-3 alternativas breves dentro del flujo natural (sin encabezados).'
            : 'Evita listas o menús salvo que el jugador pida explícitamente opciones.',
          masterNatural ? `\n[GUIDANCE_MASTER_NATURAL]\n${masterNatural}` : '',
          game ? `\n[GUIDANCE_GAME]\n${game}` : '',
          diceNatural ? `\n[GUIDANCE_DICE_NATURAL]\n${diceNatural}` : '',
          `Jugador: ${state?.name || 'Jugador'} | Especie: ${state?.species || 'N/D'} | Rol: ${state?.role || 'N/D'}`,
          `Memoria conversacional: tono=${convMem.tone}; intención reciente=${convMem.recentIntent}; última respuesta del máster="${String(convMem.lastDmReply || '').slice(0, 180)}"`,
          'Contexto reciente:',
          ...history.map((h) => `- ${(h?.kind || 'dm')}: ${String(h?.text || '').slice(0, 240)}`),
          `Mensaje actual del jugador: ${effectiveMessage}`
        ].filter(Boolean);

        const basePrompt = promptParts.join('\n');

        let out = null;
        let clean = '';
        const maxAttempts = 2;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const promptToSend = attempt === 0
            ? basePrompt
            : `${basePrompt}\n\nLa respuesta anterior quedó incompleta. Continúa sin reiniciar la escena y ciérrala con frases completas.`;
          out = await withTimeout(askGemini(promptToSend), 12000, 'gemini_timeout');
          clean = sanitizeDmText(out?.text || '').slice(0, 4000);
          logger.info('[DM gemini raw]', { raw: out?.text ?? '(no text)' });
          logger.info('[DM gemini clean]', { clean });
          const finishReason = String(out?.finishReason || '').toUpperCase();
          const truncatedByModel = finishReason === 'MAX_TOKENS';
          const truncated = truncatedByModel || looksTruncatedNarrative(clean);
          if (!truncated) break;
          logger.warn('[DM gemini] respuesta truncada, reintentando', { attempt: attempt + 1, finishReason });
        }

        if (looksTruncatedNarrative(clean)) {
          const repairPrompt = [
            'Reescribe de forma completa y natural la respuesta del máster para que NO quede cortada.',
            'No uses etiquetas, ni JSON, ni listas rígidas.',
            `Respuesta cortada: ${clean}`,
            `Intención del jugador: ${effectiveMessage}`
          ].join('\n');
          const repaired = await withTimeout(askGemini(repairPrompt), 9000, 'gemini_repair_timeout');
          const repairedClean = sanitizeDmText(repaired?.text || '').slice(0, 4000);
          logger.info('[DM gemini repair raw]', { raw: repaired?.text ?? '(no text)' });
          logger.info('[DM gemini repair clean]', { clean: repairedClean });
          if (repairedClean && !looksTruncatedNarrative(repairedClean)) {
            out = repaired;
            clean = repairedClean;
          }
        }

        if (clean) {
          const finalText = finalizeNarrative(clean).slice(0, 5000);
          return res.json({ ok: true, text: finalText, engine: 'gemini', model: out.model, mode, forceGemini });
        }
      } catch (geminiError) {
        logger.error('[DM gemini fallback]', {
          message: geminiError?.message,
          code: geminiError?.code,
          status: geminiError?.status,
          model: geminiChatModel,
          location: vertexLocation
        });
      }

      return next();
    } catch (middlewareError) {
      logger.error('[DM middleware]', middlewareError);
      return next();
    }
  };
}

module.exports = { createDmGeminiMiddleware };
