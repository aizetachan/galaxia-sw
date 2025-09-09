// web/onboarding.js
import { resetMsgs, handleIncomingDMText, msgs, mapStageForDM } from './chat/chat-controller.js';
import { KEY_CHAR, KEY_STEP, KEY_CONFIRM, load, save } from './auth/session.js';
import { getDmMode } from './state.js';
import { api } from './api-client.js';
import { dlog } from './api.js';

export let character = load(KEY_CHAR, null);
export let step = character ? 'done' : load(KEY_STEP, 'name'); // Si hay personaje, step es 'done'
export let pendingConfirm = load(KEY_CONFIRM, null);

export function setCharacter(c){ character = c; save(KEY_CHAR, c); }
export function setStep(s){ step = s; save(KEY_STEP, s); }
export function setPendingConfirm(pc){ pendingConfirm = pc; save(KEY_CONFIRM, pc); }

export function getClientState(){
  return {
    step,
    name: (character?.name || pendingConfirm?.name || null),
    species: (character?.species || pendingConfirm?.species || null),
    role: (character?.role || pendingConfirm?.role || null),
    pendingConfirm: pendingConfirm || null,
    sceneMemo: load('sw:scene_memo', []),
  };
}

/* -------------------------
   Arranque idempotente
------------------------- */
let ONBOARDING_BOOTED = false;
export async function startOnboardingOnce(opts = {}) {
  if (ONBOARDING_BOOTED) return;
  ONBOARDING_BOOTED = true;
  await startOnboarding(opts);
}

/* -------------------------
   Conversación con el Máster
------------------------- */
export async function dmSay(message){
  const hist = msgs.slice(-8);
  try{
    const r = await api('/dm/respond', {
      message,
      history: hist,
      character_id: Number(character?.id) || null,
      stage: mapStageForDM(step),
      clientState: getClientState(),
      config: { mode: getDmMode() }
    });
    if (r?.text) handleIncomingDMText(r.text);
  } catch(e){
    dlog('dmSay fail', e?.data||e);
    showConnectionErrorBanner(e?.data?.error || e?.message || 'Fallo de red');
  }
}

/**
 * Kickoff del onboarding:
 * - NO inyecta ningún texto de bienvenida local.
 * - Después de CLIENT_HELLO exitoso, cambia el estado para permitir chat normal.
 * - Solo muestra un banner de error si el backend responde 4xx/5xx o viene vacío.
 */
async function startOnboardingKickoff(){ // ← interna (sin export)
  try{
    const kick = await api('/dm/respond', {
      message: '<<CLIENT_HELLO>>',
      history: [],
      character_id: Number(character?.id) || null,
      stage: mapStageForDM(step),
      clientState: getClientState(),
      config: { mode: getDmMode() }
    });

    if (kick?.text && String(kick.text).trim()) {
      handleIncomingDMText(kick.text);

      // ✅ Después de CLIENT_HELLO exitoso, permitir chat normal
      // Cambiar el estado para que el placeholder sea "Habla con el Máster…" en lugar de "Tu nombre en el HoloNet…"
      console.log('[ONBOARDING] CLIENT_HELLO successful, enabling chat mode');
      setStep('done'); // Esto hace que el placeholder cambie a "Habla con el Máster…"

      // Llamar render y actualizar placeholder para reflejar el nuevo estado
      try {
        // Intentar acceder a render desde el contexto global
        if (window.render) {
          window.render();
        } else {
          console.warn('[ONBOARDING] render function not available globally');
        }
        // Actualizar placeholder después de cambiar el step
        if (window.updatePlaceholder) {
          window.updatePlaceholder();
        } else {
          console.warn('[ONBOARDING] updatePlaceholder function not available globally');
        }
      } catch (e) {
        console.error('[ONBOARDING] Failed to call render/updatePlaceholder:', e);
      }

    } else {
      showConnectionErrorBanner('Respuesta vacía del Máster');
    }
  } catch (e) {
    dlog('kickoff fail', e?.data||e);
    showConnectionErrorBanner(e?.data?.error || e?.message || 'Fallo al contactar con el Máster');
  }
}

/**
 * Entrada al flujo de onboarding (usuario nuevo):
 * - Limpia estado local si hard=true.
 * - NO pinta mensajes locales de bienvenida.
 * - Llama al kickoff (única fuente de verdad: el Máster).
 */
export async function startOnboarding({ hard=false } = {}){
  try{ document.getElementById('guest-card')?.setAttribute('hidden','hidden'); }catch{}
  if (hard) resetMsgs();

  setCharacter(null);
  setStep('name');
  setPendingConfirm(null);

  await startOnboardingKickoff();
}

/* -------------------------
   Confirmaciones Sí/No
------------------------- */
let busyConfirm=false;
let ui = { setConfirmLoading: () => {}, render: () => {} };
export function setupOnboardingUI(cfg = {}){ ui = { ...ui, ...cfg }; }

export async function handleConfirmDecision(decision){
  if (!pendingConfirm || busyConfirm) return;
  busyConfirm=true; ui.setConfirmLoading(true);
  const { type } = pendingConfirm;

  try{
    if (decision==='yes'){
      if (type==='name'){
        // Guardar en el cliente
        if (!character){
          setCharacter({ name: pendingConfirm.name, species:'', role:'', publicProfile:true, lastLocation:'Tatooine — Cantina de Mos Eisley' });
        } else {
          character.name = pendingConfirm.name; setCharacter(character);
        }
        // Upsert en backend (no avanza fase por sí mismo)
        try{
          const r = await api('/world/characters', {
            name: character.name,
            species: character.species,
            role: character.role,
            publicProfile: character.publicProfile,
            lastLocation: character.lastLocation,
            character
          });
          if (r?.character?.id){ character.id=r.character.id; setCharacter(character); }
        }catch(e){ dlog('upsert name fail', e?.data||e); }
        setStep('species');

        // No inyectar mensajes locales → evita duplicados
        ui.render?.();

        // Actualizar placeholder después de cambiar step
        if (window.updatePlaceholder) {
          window.updatePlaceholder();
        }

        // Avisamos al Máster del avance de subpaso
        dmSay(`<<ONBOARD STEP="species" NAME="${character.name}">>`).catch(()=>{});

      } else if (type==='build'){
        // Guardar en el cliente
        if (!character){
          setCharacter({ name:'Aventurer@', species:pendingConfirm.species, role:pendingConfirm.role, publicProfile:true });
        } else {
          character.species = pendingConfirm.species;
          character.role = pendingConfirm.role;
          setCharacter(character);
        }
        // Upsert en backend
        try{
          const r = await api('/world/characters', {
            name: character.name,
            species: character.species,
            role: character.role,
            publicProfile: character.publicProfile,
            lastLocation: character.lastLocation,
            character
          });
          if (r?.character?.id && !character.id){ character.id=r.character.id; setCharacter(character); }
        }catch(e){ dlog('upsert build fail', e?.data||e); }
        setStep('done');

        // Actualizar placeholder después de completar onboarding
        if (window.updatePlaceholder) {
          window.updatePlaceholder();
        }
      }
    }

    setPendingConfirm(null);

    // Enviamos ACK de confirmación al Máster (quien responde lo que toca)
    const hist = msgs.slice(-8);
    const follow = await api('/dm/respond', {
      message: `<<CONFIRM_ACK TYPE="${type}" DECISION="${decision}">>`,
      history: hist,
      character_id: Number(character?.id) || null,
      stage: mapStageForDM(step),
      clientState: getClientState(),
      config: { mode: getDmMode() }
    });

    handleIncomingDMText((follow && follow.text) ? follow.text : '');

  } catch(e){
    dlog('handleConfirmDecision error', e?.data||e);
    alert(e?.message || 'No se pudo procesar la confirmación');
  } finally {
    busyConfirm=false; ui.setConfirmLoading(false); ui.render();
  }
}

/* -------------------------
   Banner de error (no bienvenida local)
------------------------- */
function showConnectionErrorBanner(reasonText = ''){
  const id = 'holonet-conn-error';
  if (document.getElementById(id)) return; // evita duplicados

  const el = document.createElement('div');
  el.id = id;
  el.style.cssText = `
    position: fixed; inset: auto 16px 16px 16px; z-index: 9999;
    background: rgba(255,80,80,.12); border:1px solid rgba(255,80,80,.45);
    color:#fff; padding:12px 14px; border-radius:10px;
    backdrop-filter: blur(6px); display:flex; gap:10px; justify-content:space-between; align-items:center;
  `;
  el.innerHTML = `
    <div style="max-width: calc(100% - 120px);">
      <strong>Interferencia en la HoloRed.</strong>
      <div style="opacity:.9">No pudimos contactar con el Máster. ${reasonText ? `("${String(reasonText)}")` : ''}</div>
    </div>
    <button id="btn-retry-holonet" style="
      cursor:pointer; border:0; padding:8px 12px; border-radius:8px;
      background:#fff; color:#111; font-weight:600;
    ">Reintentar</button>
  `;
  document.body.appendChild(el);

  document.getElementById('btn-retry-holonet')?.addEventListener('click', () => {
    el.remove();
    ONBOARDING_BOOTED = false; // permitimos reintentar el arranque
    startOnboardingOnce();
  }, { once: true });
}
