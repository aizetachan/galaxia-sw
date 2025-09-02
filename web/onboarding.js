import { pushDM, resetMsgs, handleIncomingDMText, msgs, mapStageForDM } from './chat/chat-controller.js';
import { KEY_CHAR, KEY_STEP, KEY_CONFIRM, load, save } from './auth/session.js';
import { getDmMode } from './state.js';
import { api } from './api-client.js';
import { dlog } from './api.js';

export let character = load(KEY_CHAR, null);
export let step = load(KEY_STEP, 'name');
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
  } catch(e){ dlog('dmSay fail', e?.data||e); }
}

export async function startOnboardingKickoff(){
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
    } else {
      // ✅ Fallback si el Máster devolvió vacío
      pushDM(
        'Bienvenid@ al **HoloCanal**. Soy tu **Máster**.\n\n' +
        'Vamos a registrar tu identidad para entrar en la historia.\n' +
        '**Primero:** ¿cómo se va a llamar tu personaje?'
      );
    }
  } catch (e) {
    // ✅ Fallback si el Máster falló (red/servidor)
    dlog('kickoff fail (fallback visible)', e?.data || e);
    pushDM(
      'Bienvenid@ al **HoloCanal**. Soy tu **Máster**.\n\n' +
      'Vamos a registrar tu identidad para entrar en la historia.\n' +
      '**Primero:** ¿cómo se va a llamar tu personaje?'
    );
  }
}

export async function startOnboarding({ hard=false } = {}){
  try{ document.getElementById('guest-card')?.setAttribute('hidden','hidden'); }catch{}
  if (hard) resetMsgs();

  setCharacter(null);
  setStep('name');
  setPendingConfirm(null);

  if (msgs.length === 0) {
    pushDM(
      'Bienvenid@ al **HoloCanal**. Soy tu **Máster**.\n\n' +
      'Vamos a registrar tu identidad para entrar en la historia.\n' +
      '**Primero:** ¿cómo se va a llamar tu personaje?'
    );
  }

  await startOnboardingKickoff();
}

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
        if (!character){ setCharacter({ name: pendingConfirm.name, species:'', role:'', publicProfile:true, lastLocation:'Tatooine — Cantina de Mos Eisley' }); }
        else { character.name = pendingConfirm.name; setCharacter(character); }
        try{ const r = await api('/world/characters', { name:character.name, species:character.species, role:character.role, publicProfile:character.publicProfile, lastLocation:character.lastLocation, character }); if (r?.character?.id){ character.id=r.character.id; setCharacter(character);} }catch(e){ dlog('upsert name fail', e?.data||e); }
        setStep('species');

        pushDM(`Perfecto, **${character.name}**. Ahora elige **especie** (Humano, Twi'lek, Wookiee, Zabrak, Droide)…`);
        ui.render?.();
        dmSay(`<<ONBOARD STEP="species" NAME="${character.name}">>`)
          .catch(()=>{});

      } else if (type==='build'){
        if (!character){ setCharacter({ name:'Aventurer@', species:pendingConfirm.species, role:pendingConfirm.role, publicProfile:true }); }
        else { character.species = pendingConfirm.species; character.role = pendingConfirm.role; setCharacter(character); }
        try{ const r = await api('/world/characters', { name:character.name, species:character.species, role:character.role, publicProfile:character.publicProfile, lastLocation:character.lastLocation, character }); if (r?.character?.id && !character.id){ character.id=r.character.id; setCharacter(character);} }catch(e){ dlog('upsert build fail', e?.data||e); }
        setStep('done');
      }
    }
    setPendingConfirm(null);
    const hist = msgs.slice(-8);
    const follow = await api('/dm/respond', { message:`<<CONFIRM_ACK TYPE="${type}" DECISION="${decision}">>`, history:hist, character_id:Number(character?.id)||null, stage:mapStageForDM(step), clientState:getClientState(), config:{ mode:getDmMode() } });
    handleIncomingDMText((follow && follow.text) ? follow.text : '');
  } catch(e){
    dlog('handleConfirmDecision error', e?.data||e);
    alert(e.message || 'No se pudo procesar la confirmación');
  } finally { busyConfirm=false; ui.setConfirmLoading(false); ui.render(); }
}
