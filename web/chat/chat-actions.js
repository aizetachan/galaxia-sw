import { pushDM, pushUser, pendingRoll, setPendingRoll, talkToDM, msgs, handleIncomingDMText, mapStageForDM, setMsgs } from "./chat-controller.js";
import { setCharacter, setPendingConfirm, setStep, step, character, pendingConfirm, startOnboarding, getClientState, handleConfirmDecision } from "../onboarding.js";
import { load, save, KEY_MSGS, KEY_CHAR, KEY_STEP, KEY_CONFIRM } from "../auth/session.js";
import { api, apiGet } from "../api-client.js";
import { getDmMode, setDmMode } from "../state.js";
import { dlog } from "../api.js";
import { setSending, updatePlaceholder, updateRollCta, getChatElements, readInputValue, clearInputValue, renderChat } from "./chat-ui.js";

let busyResolving = false;

export function initChatActions() {
  const { inputEl, sendBtn, resolveBtn, cancelBtn } = getChatElements();
  if (sendBtn) sendBtn.addEventListener('click', sendMessage);
  if (inputEl) inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });
  if (resolveBtn) resolveBtn.addEventListener('click', resolveRoll);
  if (cancelBtn) cancelBtn.addEventListener('click', cancelRoll);
}

async function sendMessage() {
  const value = (readInputValue()?.trim?.() || '');
  if (!value) return;

  dlog('send', { value, step });
  setSending(true);
  clearInputValue();

  const m = value.match(/^\/modo\s+(fast|rich)\b/i);
  if (m) { setDmMode(m[1].toLowerCase()); setSending(false); return; }

  if ((value === '/privado' || value === '/publico') && character) {
    character.publicProfile = (value === '/publico');
    setCharacter(character);
    try {
      await api('/world/characters', {
        name: character.name,
        species: character.species,
        role: character.role,
        publicProfile: character.publicProfile,
        lastLocation: character.lastLocation,
        character
      });
    } catch (e) { dlog('privacy update fail', e?.data || e); }
    setSending(false); return;
  }
  if (value === '/resumen' || value === '/resume') { await showResumeOnDemand(); setSending(false); return; }
  if (value === '/restart') {
    localStorage.removeItem(KEY_MSGS);
    localStorage.removeItem(KEY_CHAR);
    localStorage.removeItem(KEY_STEP);
    localStorage.removeItem(KEY_CONFIRM);
    resetLocalState();
    await startOnboarding({ hard: true });
    setSending(false); return;
  }

  pushUser(value, character);

  // Rehidratar confirmación pendiente desde el último mensaje del DM (si se perdió estado)
  if (!pendingConfirm && step !== 'done') {
    const lastDM = [...msgs].reverse().find(m => m.kind === 'dm' && typeof m.text === 'string');
    const t = (lastDM?.text || '').trim();
    const nameMatch = t.match(/nombre\s+es\s+\*\*([^*]+)\*\*|nombre\s+es\s+([^\.\?]+)/i);
    const buildMatch = t.match(/especie\s+\*\*?([^*.,]+)\*\*?[,\s]+rol\s+\*\*?([^*\.\?]+)\*\*?/i);
    const asksConfirm = /confirmas|lo confirmas|confirmas esta identidad/i.test(t);
    if (asksConfirm && buildMatch) {
      setPendingConfirm({ type: 'build', species: (buildMatch[1] || '').trim(), role: (buildMatch[2] || '').trim() });
    } else if (asksConfirm && nameMatch) {
      const nm = (nameMatch[1] || nameMatch[2] || '').trim();
      if (nm) setPendingConfirm({ type: 'name', name: nm });
    }
  }

  // Confirmación natural por texto cuando hay confirm pendiente (name/build)
  const effectiveConfirm = pendingConfirm || load(KEY_CONFIRM, null);
  if (effectiveConfirm && step !== 'done') {
    const n = value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const isYes = /^(si|sí|ok|vale|perfecto|confirmo|yes)\b/.test(n);
    const isNo = /^(no|nop|negativo|cambiar|nope)\b/.test(n);
    if (isYes || isNo) {
      await handleConfirmDecision(isYes ? 'yes' : 'no');
      setSending(false);
      return;
    }
  }

  if (step !== 'done') {
    if (step === 'name') {
      const name = value || 'Aventurer@';
      setCharacter({ name, species: '', role: '', publicProfile: true, lastLocation: 'Tatooine — Cantina de Mos Eisley' });
      setPendingConfirm({ type: 'name', name });
      updatePlaceholder();
      setSending(false);
      return;
    }

    if (step === 'species' || step === 'role') {
      try { await talkToDM(api, value, step, character, pendingConfirm, getClientState, getDmMode); }
      finally { setSending(false); }
      return;
    }

    try { await talkToDM(api, value, step, character, pendingConfirm, getClientState, getDmMode); }
    finally { setSending(false); }
    return;
  }

  try { await talkToDM(api, value, step, character, pendingConfirm, getClientState, getDmMode); }
  finally { setSending(false); }
}

async function resolveRoll() {
  if (!pendingRoll || busyResolving) return;
  busyResolving = true;
  const { rollSkillEl, resolveBtn } = getChatElements();
  try {
    if (resolveBtn) {
      resolveBtn.disabled = true;
      resolveBtn.classList.add('loading');
      resolveBtn.setAttribute('aria-busy', 'true');
    }
    const skill = pendingRoll.skill || 'Acción';
    if (rollSkillEl) rollSkillEl.textContent = pendingRoll.skill ? ` · ${pendingRoll.skill} — resolviendo…` : ' — resolviendo…';
    const res = await api('/roll', { skill });
    const hist = msgs.slice(-8);
    const follow = await api('/dm/respond', {
      message: `<<DICE_OUTCOME SKILL="${skill}" OUTCOME="${res.outcome}">>`,
      history: hist,
      character_id: Number(character?.id) || null,
      stage: mapStageForDM(step),
      clientState: getClientState(),
      config: { mode: getDmMode() }
    });
    pushDM(`🎲 **Tirada** (${skill}): ${res.roll} → ${res.outcome}`);
    handleIncomingDMText(follow?.text || res.text || 'La situación evoluciona…');
  } catch (e) {
    dlog('resolveRoll error', e?.data || e);
    pushDM('Algo se interpone; la situación se complica.');
  } finally {
    busyResolving = false;
    setPendingRoll(null);
    updateRollCta();
    renderAfterRoll();
    const { resolveBtn } = getChatElements();
    if (resolveBtn) {
      resolveBtn.disabled = false;
      resolveBtn.classList.remove('loading');
      resolveBtn.removeAttribute('aria-busy');
    }
  }
}

function renderAfterRoll() {
  requestAnimationFrame(() => {
    renderChat();
  });
}

function cancelRoll() {
  pushDM('🎲 Tirada cancelada (… )');
  setPendingRoll(null);
  updateRollCta();
  renderChat();
}

function resetLocalState() {
  setMsgs([]);
  save(KEY_MSGS, []);
  setCharacter(null);
  setStep('name');
  setPendingConfirm(null);
  setPendingRoll(null);
  updateRollCta();
  updatePlaceholder();
  renderChat();
}

async function showResumeOnDemand() {
  try {
    const r = await apiGet('/dm/resume');
    if (r?.ok && r.text) {
      const bullets = summarizeResumeEvents(r.text, 6);
      pushDM(bullets.length ? `**Resumen (eventos clave):**\n- ${bullets.join('\n- ')}` : 'No encontré eventos destacados en tu sesión.');
    } else pushDM('No hay resumen disponible.');
  } catch (e) {
    dlog('resume on demand fail', e?.data || e);
    pushDM('No se pudo obtener el resumen ahora.');
  }
}

function summarizeResumeEvents(rawText, maxItems = 6) {
  const bullets = [];
  const seen = new Set();
  const short = s => String(s).replace(/\s{2,}/g, ' ').trim().slice(0, 180);
  const cleaned = stripProtoTags(rawText).replace(/\(kickoff\)/ig, '').trim();
  const parts = cleaned.split(/\s*·\s*/g).map(s => s.trim()).filter(Boolean);
  const dmParts = parts.map(p => p.match(/^(?:Máster|Master):\s*(.+)$/i)?.[1]).filter(Boolean);
  const userParts = parts.map(p => p.match(/^Jugador(?:\/a|x|@)?\s*:\s*(.+)$/i)?.[1]).filter(Boolean);
  const loc = rawText.match(/Salud de nuevo.*?\s+en\s+([^.—]+)[.—]/i);
  if (loc && loc[1]) bullets.push(`Ubicación actual: ${short(loc[1])}`);
  const pick = (re, label) => {
    for (const t of dmParts) {
      const m = t.match(re);
      if (m) {
        const key = (label + '|' + m[0]).toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          bullets.push(`${label}: ${short(t)}`);
          return true;
        }
      }
    }
    return false;
  };
  pick(/\b(minidat|chip|coordenad|esquema|holoc|llave|contraseñ|mensaje cifrado|paquete|datacard)\b/i, 'Pista/objeto');
  pick(/\b(dirígete|ve a|reúnete|entrega|llega a|punto de encuentro|Faro|muelle|cantina|puerto|mercado)\b/i, 'Objetivo');
  pick(/\b(media hora|\d+\s*(?:minutos?|horas?)|plazo|en\s+\d+\s*(?:minutos?|horas?))\b/i, 'Tiempo límite');
  pick(/\b(dron(?:es)?|patrullas?|guardias?|imperiales?|alarma|persecución|enemig|cazarrecompensas)\b/i, 'Amenaza');
  pick(/\b(tienes|llevas|guardas|consigues|obtienes|te entregan|recibes)\b/i, 'Estado');
  const lastUser = userParts.reverse().find(t => t && !/^\/\w+/.test(t) && !/confirmo/i.test(t) && t.length > 6);
  if (lastUser) bullets.push(`Última acción: ${short(lastUser)}`);
  return bullets.slice(0, maxItems);
}

function stripProtoTags(s = '') {
  return String(s).replace(/<<[\s\S]*?>>/g, '').replace(/\s{2,}/g, ' ').trim();
}
