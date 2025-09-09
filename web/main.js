import { dlog, dgroup, API_BASE, setServerStatus, probeHealth } from "./api.js";
import { getDmMode, setDmMode } from "./state.js";
import { setIdentityBar, updateAuthUI, updateIdentityFromState as _updateIdentityFromState } from "./ui/main-ui.js";
import { AUTH, setAuth, KEY_MSGS, KEY_CHAR, KEY_STEP, KEY_CONFIRM, load, save, isLogged, listenAuthChanges } from "./auth/session.js";
import { msgs, pendingRoll, pushDM, pushUser, talkToDM, resetMsgs, handleIncomingDMText, mapStageForDM, setRenderCallback, setMsgs, setPendingRoll } from "./chat/chat-controller.js";
import { api, apiGet } from "./api-client.js";
// ⬇️ Import actualizado: usamos startOnboardingOnce; mantenemos startOnboarding solo para /restart
import { character, step, pendingConfirm, setCharacter, setStep, setPendingConfirm, getClientState, dmSay, startOnboardingOnce, startOnboarding, handleConfirmDecision, setupOnboardingUI } from "./onboarding.js";
import { setSending as applySending, setAuthLoading as applyAuthLoading, setConfirmLoading as applyConfirmLoading } from "./ui/helpers.js";
import { now, hhmm, escapeHtml, formatMarkdown, titleCase } from "./utils.js";
import { decorateDMs, hydrateSceneJobs } from "./scene-image.js";

/* ============================================================
 *                       Estado
 * ========================================================== */
const UI = { sending:false, authLoading:false, authKind:null, confirmLoading:false };

setRenderCallback(render);

/* ============================================================
 *                        DOM
 * ========================================================== */
const chatEl = document.getElementById('chat'); // ← sin pantalla intermedia

const updateIdentityFromState = () => _updateIdentityFromState(AUTH, character);
window.setIdentityBar = setIdentityBar;
window.updateIdentityFromState = updateIdentityFromState;
window.pushDM = pushDM;

let firstRenderDone = false;

const authUserEl = document.getElementById('auth-username');
const authPinEl = document.getElementById('auth-pin');
const authLoginBtn = document.getElementById('auth-login');
const authRegisterBtn = document.getElementById('auth-register');
const authStatusEl = document.getElementById('auth-status');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');
const rollCta = document.getElementById('roll-cta');
const rollSkillEl = document.getElementById('roll-skill');
const resolveBtn = document.getElementById('resolve-btn');
const cancelBtn = document.getElementById('cancel-btn');

/* ============================================================
 *        UI helpers
 * ========================================================== */
const setSending = (on)=>applySending(UI,on,{sendBtn,inputEl});
const setAuthLoading = (on,kind=null)=>applyAuthLoading(UI,on,kind,{authUserEl,authPinEl,authLoginBtn,authRegisterBtn});
const setConfirmLoading = (on)=>{ const yes=document.getElementById('confirm-yes-inline'); const no=document.getElementById('confirm-no-inline'); applyConfirmLoading(UI,on,yes,no); };

/* ============================================================
 *                          BOOT
 * ========================================================== */
async function boot(){
  console.log('[BOOT] ===== BOOT START =====');
  dlog('Boot start');
  
  console.log('[BOOT] Starting health check...');
  console.log('[BOOT] Current URL:', window.location.href);
  console.log('[BOOT] API_BASE:', API_BASE);
  
  const health = await probeHealth();
  console.log('[BOOT] Health check completed');
  console.log('[BOOT] Health check result:', health);
  console.log('[BOOT] Health check ok:', health.ok);
  console.log('[BOOT] Health check reason:', health.reason);
  
  dlog('API_BASE =', API_BASE);
  
  const statusMessage = health.ok ? `Server: OK — M: ${getDmMode()}` : 'Server: FAIL';
  console.log('[BOOT] Setting server status:', { ok: health.ok, message: statusMessage });
  setServerStatus(health.ok, statusMessage);
  
  console.log('[BOOT] Server status set, continuing with auth...');

  try{
    console.log('[BOOT] 🔍 Attempting to load auth from localStorage...');
    const rawAuthData = localStorage.getItem('sw:auth');
    console.log('[BOOT] 📋 Raw auth data from localStorage:', rawAuthData);

    if (!rawAuthData || rawAuthData === 'null' || rawAuthData === 'undefined') {
      console.log('[BOOT] 📋 No auth data in localStorage, starting as guest');
      setAuth(null);
      localStorage.removeItem('sw:auth');
      setMsgs([]);
      setCharacter(null);
      setStep('name');
      setPendingConfirm(null);
    } else {
      // Validación robusta del JSON
      let saved = null;
      try {
        saved = JSON.parse(rawAuthData);
        console.log('[BOOT] ✅ Auth data parsed successfully:', saved);
      } catch (parseError) {
        console.error('[BOOT] ❌ CRÍTICO: Auth data corrupted in localStorage!');
        console.error('[BOOT] ❌ Raw corrupted data:', rawAuthData);
        console.error('[BOOT] ❌ Parse error:', parseError.message);

        // Limpiar datos corruptos
        console.log('[BOOT] 🧹 Cleaning corrupted auth data...');
        localStorage.removeItem('sw:auth');
        setAuth(null);
        setMsgs([]);
        setCharacter(null);
        setStep('name');
        setPendingConfirm(null);
        return;
      }

      // Validar estructura del auth data
      if (!saved || typeof saved !== 'object') {
        console.error('[BOOT] ❌ Auth data is not a valid object:', saved);
        localStorage.removeItem('sw:auth');
        setAuth(null);
        setMsgs([]);
        setCharacter(null);
        setStep('name');
        setPendingConfirm(null);
        return;
      }

      if (!saved.token || !saved.user?.id) {
        console.log('[BOOT] 📋 Auth data incomplete, missing token or user.id:', saved);
        localStorage.removeItem('sw:auth');
        setAuth(null);
        setMsgs([]);
        setCharacter(null);
        setStep('name');
        setPendingConfirm(null);
        return;
      }

      // Validar que el token se vea como un JWT
      if (typeof saved.token !== 'string' || !saved.token.includes('.')) {
        console.error('[BOOT] ❌ Token format invalid:', saved.token);
        localStorage.removeItem('sw:auth');
        setAuth(null);
        setMsgs([]);
        setCharacter(null);
        setStep('name');
        setPendingConfirm(null);
        return;
      }

      console.log('[BOOT] ✅ Auth data validation passed, setting auth...');
      console.log('[BOOT] 📋 Setting auth for user:', saved.user.username);
      setAuth(saved);
      console.log('[BOOT] 📋 AUTH after setAuth:', AUTH);

      // Validar el token con el servidor
      try {
        console.log('[BOOT] 🔍 Validating token with server...');
        await apiGet('/auth/me');
        console.log('[BOOT] ✅ Token validated with server');

        // Cargar datos del usuario desde el servidor
        console.log('[BOOT] 📥 Loading user data from server...');
        await loadUserData();

        // Mostrar mensaje de bienvenida
        if (authStatusEl) authStatusEl.textContent = `Hola, ${saved.user.username}`;
        console.log('[BOOT] ✅ User authentication restored successfully');

      } catch (validationError) {
        console.error('[BOOT] ❌ Token validation failed:', validationError.message);
        console.log('[BOOT] 🧹 Removing invalid auth data...');

        // Limpiar auth inválido
        localStorage.removeItem('sw:auth');
        setAuth(null);
        setMsgs([]);
        setCharacter(null);
        setStep('name');
        setPendingConfirm(null);
      }
    }
  } catch(e){
    console.error('[BOOT] ❌ Unexpected error in auth restoration:', e);
    console.log('[BOOT] 🧹 Cleaning up due to unexpected error...');

    // Limpiar todo en caso de error inesperado
    localStorage.removeItem('sw:auth');
    setAuth(null);
    setMsgs([]);
    setCharacter(null);
    setStep('name');
    setPendingConfirm(null);

    dlog('Auth restore error:', e);
    if (authStatusEl) authStatusEl.textContent = 'Error al restaurar sesión';
  }

  // No llamar loadHistory() aquí porque ya se hace en loadUserData()
  updateAuthUI();

  // ⬇️ Cambio clave: arrancar onboarding SOLO UNA VEZ y sin mensajes locales duplicados
  if (isLogged() && msgs.length === 0){
    let me=null; try{ me = await apiGet('/world/characters/me'); }catch{}
    if (!me?.character){ await startOnboardingOnce({ hard:true }); }
  }

  // Bienvenida SOLO para invitados no logueados (no afecta al onboarding del usuario registrado)
  if (msgs.length === 0 && !isLogged()){
    pushDM(`Bienvenid@ al **HoloCanal**. Aquí jugamos una historia viva de Star Wars.
Para empezar, inicia sesión (usuario + PIN). Luego crearemos tu identidad y entramos en escena.`);
  }

  // Listeners
  if (sendBtn) sendBtn.addEventListener('click', send);
  if (inputEl) inputEl.addEventListener('keydown', (e)=>{ if(e.key==='Enter') send(); });
  if (resolveBtn) resolveBtn.addEventListener('click', resolveRoll);
  if (authLoginBtn) authLoginBtn.addEventListener('click', ()=>doAuth('login'));
  if (authRegisterBtn) authRegisterBtn.addEventListener('click', ()=>doAuth('register'));
  if (cancelBtn) cancelBtn.addEventListener('click', ()=>{ pushDM('🎲 Tirada cancelada (… )'); setPendingRoll(null); updateRollCta(); });

  render();
  updatePlaceholder();
  dlog('Boot done');
}

(async()=>{ 
  try{ await boot(); }
  finally{
    try{ document.documentElement.classList.remove('preload'); document.documentElement.classList.add('ready'); }catch{}
  }
})();

/* ============================================================
 *                         Render
 * ========================================================== */
function render(){
  console.log('[RENDER] Starting render with:', { msgsCount: msgs.length, step, character: !!character, pendingConfirm });
  dgroup('render', ()=>console.log({ msgsCount: msgs.length, step, character, pendingConfirm }));

  let html = msgs.map((m,i)=>{
    const kind = (m && m.kind)==='user' ? 'user':'dm';
    const tsSafe = Number(m?.ts) || (Date.now()+i);
    const isUser = (kind==='user');
    const metaAlign = isUser ? 'text-right' : '';
    const labelUser = m?.user ? escapeHtml(m.user) : (isUser ? escapeHtml(character?.name||'Tú') : 'Máster');
    const label = labelUser + ':';
    const msgBoxStyle = isUser
      ? 'display:flex; flex-direction:column; align-items:flex-end; width:fit-content; max-width:min(72ch, 92%); margin-left:auto;'
      : 'width:fit-content; max-width:min(72ch, 92%);';
    const textStyle = isUser ? 'text-align:left; width:100%;' : '';
    const timeBoxBase  = 'background:none;border:none;box-shadow:none;padding:0;margin-top:2px;';
    const timeBoxStyle = isUser ? timeBoxBase+'width:fit-content; margin-left:auto;' : timeBoxBase+'width:fit-content;';

    return `
      <div class="msg ${kind}" data-key="${tsSafe}" style="${msgBoxStyle}">
        <div class="meta ${metaAlign}">${label}</div>
        <div class="text" style="${textStyle}">${formatMarkdown(m?.text||'')}</div>
      </div>
      <div class="msg ${kind}" style="${timeBoxStyle}">
        <div class="meta ${metaAlign}" style="line-height:1;">${hhmm(tsSafe)}</div>
      </div>
    `;
  }).join('');

  if (pendingConfirm){
    const summary = (pendingConfirm.type==='name')
      ? `¿Confirmas el nombre: “${escapeHtml(pendingConfirm.name)}”?`
      : `¿Confirmas: ${escapeHtml(pendingConfirm.species)} — ${escapeHtml(pendingConfirm.role)}?`;
    html += `
      <div class="msg dm" style="width:fit-content; max-width:min(72ch, 85%);">
        <div class="meta meta--label">Máster:</div>
        <div class="text">
          <div class="confirm-cta-card">
            <strong>Confirmación:</strong> <span>${summary}</span>
            <div class="roll-cta__actions" style="margin-top:6px">
              <button id="confirm-yes-inline" type="button">Sí</button>
              <button id="confirm-no-inline" type="button" class="outline">No</button>
            </div>
          </div>
        </div>
      </div>
      <div class="msg dm" style="background:none;border:none;box-shadow:none;padding:0;margin-top:2px; width:fit-content;">
        <div class="meta meta--time" style="line-height:1;">${hhmm(now())}</div>
      </div>
    `;
  }

  if (!firstRenderDone){
    document.getElementById('identity-bar')?.classList.add('hidden');
  }

  requestAnimationFrame(()=>{
    if (chatEl){
      chatEl.innerHTML = html;
      decorateDMs();
      hydrateSceneJobs();
      chatEl.scrollTop = chatEl.scrollHeight;
    }
    updateIdentityFromState();

    const yes = document.getElementById('confirm-yes-inline');
    const no  = document.getElementById('confirm-no-inline');
    if (yes) yes.onclick = () => handleConfirmDecision('yes');
    if (no)  no.onclick  = () => handleConfirmDecision('no');

    setConfirmLoading(UI.confirmLoading);
    firstRenderDone = true;
  });

  updatePlaceholder();
  updateRollCta();
  setSending(UI.sending);
  setAuthLoading(UI.authLoading, UI.authKind);
}

setupOnboardingUI({ setConfirmLoading, render });

function updatePlaceholder(){
  const placeholders = {
    name:'Tu nombre en el HoloNet…',
    species:'Elige especie… (el Máster te da opciones)',
    role:'Elige rol… (el Máster te da opciones)',
    done:'Habla con el Máster… (usa /restart para reiniciar)'
  };
  if (inputEl) {
    const newPlaceholder = placeholders[step] || placeholders.done;
    console.log('[PLACEHOLDER] Setting placeholder for step:', step, '->', newPlaceholder, 'inputEl found:', !!inputEl);
    inputEl.placeholder = newPlaceholder;
    console.log('[PLACEHOLDER] Placeholder set successfully:', inputEl.placeholder);
  } else {
    console.warn('[PLACEHOLDER] inputEl not found!');
  }
}
function updateRollCta(){
  if (!rollCta || !rollSkillEl) return;
  if (pendingRoll){
    rollCta.classList.remove('hidden');
    rollSkillEl.textContent = pendingRoll.skill ? ` · ${pendingRoll.skill}` : '';
  } else {
    rollCta.classList.add('hidden');
    rollSkillEl.textContent = '';
  }
}

/* ===== Resume helpers (igual que antes) ===== */
function stripProtoTags(s=''){ return String(s).replace(/<<[\s\S]*?>>/g,'').replace(/\s{2,}/g,' ').trim(); }
function inflateTranscriptFromResume(text){
  const cleaned = stripProtoTags(text).replace(/\(kickoff\)/ig,'').trim();
  const parts = cleaned.split(/\s*·\s*/g).map(p=>p.trim()).filter(Boolean);
  const out=[]; const ts=now();
  for (const p of parts){
    const mDM = p.match(/^(Máster|Master):\s*(.*)$/i);
    const mUser = p.match(/^Jugador(?:\/a|x|@)?\s*:\s*(.*)$/i);
    if (mDM) out.push({ user:'Máster', text:mDM[2], kind:'dm', ts });
    else if (mUser) out.push({ user: character?.name || 'Tú', text:mUser[1], kind:'user', ts });
    else if (/^Salud de nuevo/i.test(p)) out.push({ user:'Máster', text:p, kind:'dm', ts });
  }
  return out;
}
async function showResumeOnDemand(){
  try{
    const r = await apiGet('/dm/resume');
    if (r?.ok && r.text){
      const bullets = summarizeResumeEvents(r.text, 6);
      pushDM(bullets.length ? `**Resumen (eventos clave):**\n- ${bullets.join('\n- ')}` : 'No encontré eventos destacados en tu sesión.');
    } else pushDM('No hay resumen disponible.');
  }catch(e){ dlog('resume on demand fail', e?.data||e); pushDM('No se pudo obtener el resumen ahora.'); }
}
function summarizeResumeEvents(rawText, maxItems=6){
  const bullets=[]; const seen=new Set(); const short = s=>String(s).replace(/\s{2,}/g,' ').trim().slice(0,180);
  const cleaned = stripProtoTags(rawText).replace(/\(kickoff\)/ig,'').trim();
  const parts = cleaned.split(/\s*·\s*/g).map(s=>s.trim()).filter(Boolean);
  const dmParts = parts.map(p=>p.match(/^(?:Máster|Master):\s*(.+)$/i)?.[1]).filter(Boolean);
  const userParts = parts.map(p=>p.match(/^Jugador(?:\/a|x|@)?\s*:\s*(.+)$/i)?.[1]).filter(Boolean);
  const loc = rawText.match(/Salud de nuevo.*?\s+en\s+([^.—]+)[.—]/i);
  if (loc && loc[1]) bullets.push(`Ubicación actual: ${short(loc[1])}`);
  const pick=(re,label)=>{ for(const t of dmParts){ const m=t.match(re); if(m){ const key=(label+'|'+m[0]).toLowerCase(); if(!seen.has(key)){ seen.add(key); bullets.push(`${label}: ${short(t)}`); return true; } } } return false; };
  pick(/\b(minidat|chip|coordenad|esquema|holoc|llave|contraseñ|mensaje cifrado|paquete|datacard)\b/i,'Pista/objeto');
  pick(/\b(dirígete|ve a|reúnete|entrega|llega a|punto de encuentro|Faro|muelle|cantina|puerto|mercado)\b/i,'Objetivo');
  pick(/\b(media hora|\d+\s*(?:minutos?|horas?)|plazo|en\s+\d+\s*(?:minutos?|horas?))\b/i,'Tiempo límite');
  pick(/\b(dron(?:es)?|patrullas?|guardias?|imperiales?|alarma|persecución|enemig|cazarrecompensas)\b/i,'Amenaza');
  pick(/\b(tienes|llevas|guardas|consigues|obtienes|te entregan|recibes)\b/i,'Estado');
  const lastUser = userParts.reverse().find(t=>t && !/^\/\w+/.test(t) && !/confirmo/i.test(t) && t.length>6);
  if (lastUser) bullets.push(`Última acción: ${short(lastUser)}`);
  return bullets.slice(0,maxItems);
}

/* ============================================================
 *                       Send flow
 * ========================================================== */
async function send(){
  const value = inputEl?.value?.trim?.() || '';
  if (!value) return;

  if (pendingConfirm && step!=='done'){ setPendingConfirm(null); render(); }

  dlog('send',{value,step});
  setSending(true);
  if (inputEl) inputEl.value='';

  const m = value.match(/^\/modo\s+(fast|rich)\b/i);
  if (m){ setDmMode(m[1].toLowerCase()); setSending(false); return; }

  if ((value==='/privado'||value==='/publico')&&character){
    character.publicProfile = (value==='/publico'); setCharacter(character);
    try{ await api('/world/characters', { name:character.name, species:character.species, role:character.role, publicProfile:character.publicProfile, lastLocation:character.lastLocation, character }); }catch(e){ dlog('privacy update fail', e?.data||e); }
    setSending(false); return;
  }
  if (value==='/resumen'||value==='/resume'){ await showResumeOnDemand(); setSending(false); return; }
  if (value==='/restart'){
    localStorage.removeItem(KEY_MSGS);
    localStorage.removeItem(KEY_CHAR);
    localStorage.removeItem(KEY_STEP);
    localStorage.removeItem(KEY_CONFIRM);
    resetMsgs(); setCharacter(null); setStep('name'); setPendingRoll(null); setPendingConfirm(null);

    // Reinicio del onboarding: permitimos reiniciar directamente
    await startOnboarding({ hard:true });
    setSending(false); return;
  }

  pushUser(value);

  if (step!=='done'){
    if (step==='name'){
      const name = value || 'Aventurer@';
      setCharacter({ name, species:'', role:'', publicProfile:true, lastLocation:'Tatooine — Cantina de Mos Eisley' });
      setPendingConfirm({ type:'name', name });
      render(); setSending(false); return;
    }
    if (step==='species'){
      const species = titleCase(value);
      if (species.length>=2){
        character.species = species; setCharacter(character);
        try{
          console.log('[ONBOARD] Saving character after species selection:', character);
          const r = await api('/world/characters', { name:character.name, species:character.species, role:character.role, publicProfile:character.publicProfile, lastLocation:character.lastLocation, character });
          console.log('[ONBOARD] Character save response:', r);
          if (r?.character?.id && !character.id){
            character.id=r.character.id;
            setCharacter(character);
            console.log('[ONBOARD] Character ID set:', character.id);
          }
        }catch(e){
          console.error('[ONBOARD] Update species fail:', e?.data||e);
          dlog('update species fail', e?.data||e);
        }
        setStep('role');

        // ⛔️ Eliminado fallback local (antes hacía pushDM “Genial, … ahora elige rol”)
        // El Máster llevará la conversación en la siguiente respuesta.
        dmSay(`<<ONBOARD STEP="role" NAME="${character.name}" SPECIES="${character.species}">>`)
          .catch(()=>{});

        setSending(false); return;
      }
    } else if (step==='role'){
      const role = titleCase(value);
      if (role.length>=2){
        character.role = role; setCharacter(character);
        try{
          console.log('[ONBOARD] Saving character after role selection:', character);
          const r = await api('/world/characters', { name:character.name, species:character.species, role:character.role, publicProfile:character.publicProfile, lastLocation:character.lastLocation, character });
          console.log('[ONBOARD] Character save response:', r);
          if (r?.character?.id && !character.id){
            character.id=r.character.id;
            setCharacter(character);
            console.log('[ONBOARD] Character ID set:', character.id);
          }
        }catch(e){
          console.error('[ONBOARD] Update role fail:', e?.data||e);
          dlog('update role fail', e?.data||e);
        }
        setStep('done');

        // ⛔️ Eliminado fallback local (“¡Listo! Preparando escena…”)
        dmSay(`<<ONBOARD DONE NAME="${character.name}" SPECIES="${character.species}" ROLE="${character.role}">>`)
          .catch(()=>{});

        setSending(false); return;
      }
    }
    try{ await talkToDM(api, value, step, character, pendingConfirm, getClientState, getDmMode); }
    finally{ setSending(false); }
    return;
  }

  try{ await talkToDM(api, value, step, character, pendingConfirm, getClientState, getDmMode); }
  finally{ setSending(false); }
}

/* ============================================================
 *                       Tiradas
 * ========================================================== */
let busy=false;
async function resolveRoll(){
  if (!pendingRoll || busy) return;
  busy=true;
  try{ if (resolveBtn){ resolveBtn.disabled=true; resolveBtn.classList.add('loading'); resolveBtn.setAttribute('aria-busy','true'); } }catch{}
  const skill = pendingRoll.skill||'Acción';
  try{
    if (rollSkillEl) rollSkillEl.textContent = pendingRoll.skill ? ` · ${pendingRoll.skill} — resolviendo…` : ' — resolviendo…';
    const res = await api('/roll', { skill });
    const hist = msgs.slice(-8);
    const follow = await api('/dm/respond', { message:`<<DICE_OUTCOME SKILL="${skill}" OUTCOME="${res.outcome}">>`, history:hist, character_id:Number(character?.id)||null, stage:mapStageForDM(step), clientState:getClientState(), config:{ mode:getDmMode() } });
    pushDM(`🎲 **Tirada** (${skill}): ${res.roll} → ${res.outcome}`);
    handleIncomingDMText(follow?.text || res.text || 'La situación evoluciona…');
  } catch(e){
    dlog('resolveRoll error', e?.data||e);
    pushDM('Algo se interpone; la situación se complica.');
  } finally {
    busy=false; setPendingRoll(null); updateRollCta(); render();
    try{ if (resolveBtn){ resolveBtn.disabled=false; resolveBtn.classList.remove('loading'); resolveBtn.removeAttribute('aria-busy'); } }catch{}
  }
}

// Función para cargar datos del usuario desde el servidor
async function loadUserData() {
  console.log('[BOOT] Loading user data from server...');

  try {
    // Verificar si el usuario ya tiene un personaje guardado
    console.log('[BOOT] Checking for existing character...');
    const meResponse = await apiGet('/world/characters/me');
    console.log('[BOOT] Character response:', meResponse);

    let userCharacter = null;
    let userMsgs = [];
    let userStep = 'name';

    if (meResponse?.character) {
      userCharacter = meResponse.character;
      userStep = 'done'; // Usuario ya completó onboarding
      console.log('[BOOT] Found existing character:', userCharacter);

      // Si tiene personaje, intentar cargar historial
      try {
        console.log('[BOOT] Loading chat history...');
        const historyResponse = await apiGet('/chat/history');
        console.log('[BOOT] History response:', historyResponse);

        if (historyResponse?.messages && Array.isArray(historyResponse.messages)) {
          userMsgs = historyResponse.messages.map((m) => ({
            user: m.role === 'user' ? (userCharacter?.name || 'Tú') : 'Máster',
            text: m.text,
            kind: m.role === 'user' ? 'user' : 'dm',
            ts: m.ts ? new Date(m.ts).getTime() : Date.now(),
          }));
          console.log('[BOOT] Loaded', userMsgs.length, 'messages from history');
        }
      } catch (historyError) {
        console.error('[BOOT] Error loading chat history:', historyError);
        // Si falla la carga del historial, usar mensajes locales como fallback
        userMsgs = load(KEY_MSGS, []);
      }
    } else {
      console.log('[BOOT] No character found, will start onboarding');
      userMsgs = load(KEY_MSGS, []);
    }

    // Configurar el estado del usuario
    console.log('[BOOT] Setting user state - Character:', !!userCharacter, 'Messages:', userMsgs.length, 'Step:', userStep);
    setMsgs(userMsgs);
    setCharacter(userCharacter);
    setStep(userStep);
    setPendingConfirm(null);

    // Forzar render y actualización de UI después de configurar el estado
    console.log('[BOOT] Forcing render and UI update...');
    render();
    updatePlaceholder();
    updateAuthUI();

    // Guardar en localStorage para futuras sesiones
    if (userCharacter) {
      save(KEY_CHAR, userCharacter);
      save(KEY_STEP, userStep);
    }

  } catch (error) {
    console.error('[BOOT] Error loading user data:', error);
    // En caso de error, usar datos locales como fallback
    setMsgs(load(KEY_MSGS, []));
    setCharacter(load(KEY_CHAR, null));
    setStep(load(KEY_STEP, 'name'));
    setPendingConfirm(load(KEY_CONFIRM, null));
  }
}

/* ============================================================
 *           Migración guest → user y helpers de historia
 * ========================================================== */
function migrateGuestToUser(userId){
  const loadK=(k)=>{ try{ const r=localStorage.getItem(k); return r?JSON.parse(r):null; }catch{ return null; } };
  const gMsgs=loadK('sw:guest:msgs'), gChar=loadK('sw:guest:char'), gStep=loadK('sw:guest:step'), gConfirm=loadK('sw:guest:confirm');
  const kMsgs=`sw:${userId}:msgs`, kChar=`sw:${userId}:char`, kStep=`sw:${userId}:step`, kConfirm=`sw:${userId}:confirm`;
  if (gMsgs && !localStorage.getItem(kMsgs)) localStorage.setItem(kMsgs, JSON.stringify(gMsgs));
  if (gChar && !localStorage.getItem(kChar)) localStorage.setItem(kChar, JSON.stringify(gChar));
  if (gStep && !localStorage.getItem(kStep)) localStorage.setItem(kStep, JSON.stringify(gStep));
  if (gConfirm && !localStorage.getItem(kConfirm)) localStorage.setItem(kConfirm, JSON.stringify(gConfirm));
  localStorage.removeItem('sw:guest:msgs'); localStorage.removeItem('sw:guest:char'); localStorage.removeItem('sw:guest:step'); localStorage.removeItem('sw:guest:confirm');
}
async function showResumeIfAny(){
  try{
    const r = await apiGet('/dm/resume');
    if (r?.ok && r.text && msgs.length===0){
      if (r.character){ setCharacter(r.character); setStep('done'); }
      const transcript = inflateTranscriptFromResume(r.text);
      if (transcript.length){ setMsgs(transcript); save(KEY_MSGS, msgs); }
    }
  }catch(e){ dlog('resume fail', e?.data||e); }
}
// Carga historial desde el servidor. Si force=true, reemplaza siempre.
async function loadHistory({ force = false } = {}) {
  if (!isLogged()) return;
  if (!force && msgs.length > 0) return;

  try {
    const r = await apiGet('/chat/history');
    const rows = r?.messages;

    if (Array.isArray(rows)) {
      const mapped = rows.map((m) => ({
        user: m.role === 'user' ? (character?.name || 'Tú') : 'Máster',
        text: m.text,
        kind: m.role === 'user' ? 'user' : 'dm',
        ts: m.ts ? new Date(m.ts).getTime() : Date.now(),
      }));
      setMsgs(mapped);
      save(KEY_MSGS, msgs);
    }
  } catch (e) {
    dlog('history load fail', e?.data || e);
  }
}


// ============================================================
//                     Auth (robusto con 404)
// ============================================================
async function doAuth(kind) {
  console.log('[AUTH] ===== doAuth START =====');
  console.log('[AUTH] Kind:', kind);
  console.log('[AUTH] UI.authLoading:', UI.authLoading);
  
  if (UI.authLoading) {
    console.log('[AUTH] Already loading, returning');
    return;
  }
  
  const username = (authUserEl?.value || '').trim();
  const pin = (authPinEl?.value || '').trim();
  console.log('[AUTH] ===== INPUT VALIDATION =====');
  console.log('[AUTH] Raw username from input:', authUserEl?.value);
  console.log('[AUTH] Raw PIN from input:', authPinEl?.value);
  console.log('[AUTH] Trimmed username:', username);
  console.log('[AUTH] Trimmed PIN:', pin);
  console.log('[AUTH] Username length:', username.length);
  console.log('[AUTH] PIN length:', pin.length);
  console.log('[AUTH] Username regex test:', /^[a-zA-Z0-9_]{3,24}$/.test(username));
  console.log('[AUTH] PIN regex test:', /^\d{4}$/.test(pin));

  if (!username || !/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
    console.log('[AUTH] ❌ Invalid username');
    if (authStatusEl) authStatusEl.textContent = 'Usuario inválido (3-24 caracteres, letras/números/_)';
    return;
  }

  if (!pin || !/^\d{4}$/.test(pin)) {
    console.log('[AUTH] ❌ Invalid PIN');
    if (authStatusEl) authStatusEl.textContent = 'PIN inválido (4 dígitos)';
    return;
  }

  console.log('[AUTH] ✅ Input validation passed');

  dlog('doAuth', { kind, username });
  console.log('[AUTH] Setting auth loading to true');
  setAuthLoading(true, kind);

  try {
    const url = kind === 'register' ? '/auth/register' : '/auth/login';
    console.log('[AUTH] Starting', kind, 'for user:', username);
    console.log('[AUTH] Calling API:', url, { username, pin });
    console.log('[AUTH] API_BASE:', API_BASE);
    console.log('[AUTH] Full URL:', `${API_BASE}${url}`);

    const response = await api(url, { username, pin });
    console.log('[AUTH] API response received:', response);
    console.log('[AUTH] Response status:', response?.status || 'unknown');
    console.log('[AUTH] Response ok:', response?.ok);
    console.log('[AUTH] Response user:', response?.user);
    console.log('[AUTH] Response token exists:', !!response?.token);
    
    // El backend devuelve { ok: true, user: {...}, token: '...' }
    if (response.ok && response.user) {
      console.log('[AUTH] Success! User:', response.user);
      console.log('[AUTH] Token received:', !!response.token);

      // Usar el token real del backend
      const token = response.token || 'dummy-token';
      const userData = { token, user: response.user };

      // El token JWT ya está listo para usar - no necesitamos decodificarlo aquí
      console.log('[AUTH] Token received and ready to use');
      console.log('[AUTH] Token length:', response.token?.length || 0);

      console.log('[AUTH] 📋 About to save auth data to localStorage...');
      console.log('[AUTH] 📋 userData to save:', userData);
      console.log('[AUTH] 📋 userData.token length:', userData.token?.length || 0);

      setAuth(userData);
      console.log('[AUTH] ✅ setAuth called successfully');

      localStorage.setItem('sw:auth', JSON.stringify(userData));
      console.log('[AUTH] 💾 Auth data saved to localStorage');
      console.log('[AUTH] 📋 localStorage content after save:', localStorage.getItem('sw:auth'));
    } else {
      console.error('[AUTH] Invalid response:', response);
      throw new Error('Invalid response from server');
    }

    migrateGuestToUser(response.user.id);

    // Cargar datos del usuario desde el servidor usando la nueva función centralizada
    console.log('[AUTH] Loading user data after authentication...');
    await loadUserData();

    // Quitar "bienvenida de invitado" si quedó
    {
      const t0 = (Array.isArray(msgs) && msgs[0]?.text) ? String(msgs[0].text) : '';
      const esSoloBienvenida =
        Array.isArray(msgs) && msgs.length <= 1 && t0.includes('HoloCanal') && t0.includes('inicia sesión');
      if (esSoloBienvenida) { resetMsgs(); }
    }

    // ✅ La función loadUserData() ya determinó si el usuario tiene personaje o no
    // Si tiene personaje, ya está en step='done' y listo para jugar
    // Si no tiene personaje, está en step='name' y necesita onboarding

    if (step === 'done') {
      // Usuario existente con personaje - mostrar info completa
      console.log('[AUTH] Existing user with character - ready to play');
      if (authStatusEl) authStatusEl.textContent = `Hola, ${response.user.username}`;
      setIdentityBar(response.user.username, character?.name || '');
      updateAuthUI();
      render();
      return; // listo para seguir jugando
    }

    // === Usuario nuevo sin personaje: empezamos onboarding ===
    console.log('[AUTH] New user without character - starting onboarding');

    // Limpiar estado para onboarding limpio
    resetMsgs();
    setCharacter(null);
    setStep('name');
    setPendingConfirm(null);

    console.log('[AUTH] Setting identity bar for new user - User:', response.user.username);
    if (authStatusEl) authStatusEl.textContent = `Hola, ${response.user.username}`;
    setIdentityBar(response.user.username, '');
    updateAuthUI();
    render();

    // ⬇️ Cambio clave: arrancar onboarding una sola vez (sin pushDM locales)
    await startOnboardingOnce({ hard: true });

  } catch (e) {
    console.error('[AUTH] Error in doAuth:', e);
    console.error('[AUTH] Error details:', {
      message: e.message,
      data: e?.data,
      response: e?.response,
      stack: e.stack
    });
    
    dlog('doAuth error:', e?.data || e);
    let code = '';
    try { code = (e.data?.json?.error) || (await e.response?.json?.())?.error || ''; } catch {}
    const friendly = {
      INVALID_CREDENTIALS: 'Usuario (3–24 minúsculas/números/_) y PIN de 4 dígitos.',
      USERNAME_TAKEN: 'Ese usuario ya existe.',
      USER_NOT_FOUND: 'Usuario no encontrado.',
      INVALID_PIN: 'PIN incorrecto.',
      unauthorized: 'No autorizado.',
      not_found: 'Recurso no encontrado.',
    };
    const errorMessage = (code && (friendly[code] || code)) || 'Error de autenticación';
    console.log('[AUTH] Setting error message:', errorMessage);
    if (authStatusEl) authStatusEl.textContent = errorMessage;
  } finally {
    console.log('[AUTH] Setting loading to false');
    setAuthLoading(false);
  }
}


/* ============================================================
 *      Vídeo invitado + SW (igual que antes)
 * ========================================================== */
(function setupGuestCardVideo(){
  const VIDEO_SOURCES=[{ src:'assets/video/hero-home-720p.webm', type:'video/webm' }];
  function createVideo(){ const v=document.createElement('video'); v.id='guest-card-video'; v.className='guest__bg'; v.autoplay=true; v.muted=true; v.loop=true; v.playsInline=true; v.preload='metadata'; v.setAttribute('aria-hidden','true'); VIDEO_SOURCES.forEach(s=>{ const src=document.createElement('source'); src.src=s.src; src.type=s.type; v.appendChild(src); }); return v; }
  function guestCardVisible(){ const el=document.getElementById('guest-card'); return !!el && !el.hasAttribute('hidden'); }
  function mount(){ if (navigator.connection?.saveData) return unmount(); const wrap=document.getElementById('guest-card'); if(!wrap) return; if(!guestCardVisible()||isLogged()) return unmount(); let v=document.getElementById('guest-card-video'); if(!v){ v=createVideo(); wrap.prepend(v); } v.play?.().catch(()=>{}); }
  function unmount(){ const v=document.getElementById('guest-card-video'); if(!v) return; try{ v.pause(); }catch{} try{ v.removeAttribute('src'); while(v.firstChild) v.removeChild(v.firstChild); v.load(); }catch{} v.remove(); }
  const apply=()=>{ guestCardVisible() && !isLogged() ? mount() : unmount(); };
  if (document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', apply, { once:true }); } else { apply(); }
  document.addEventListener('visibilitychange', ()=>{ const v=document.getElementById('guest-card-video'); if(!v) return; if(document.hidden) v.pause(); else v.play?.().catch(()=>{}); });
  const orig=window.updateIdentityFromState; window.updateIdentityFromState=function(...args){ try{ return orig?.apply(this,args); } finally{ apply(); } };
  const card=document.getElementById('guest-card'); if(card && window.MutationObserver){ new MutationObserver(apply).observe(card,{attributes:true,attributeFilter:['hidden','class','style']}); }
})();
if ('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    const swUrl = './service-worker.js';
    navigator.serviceWorker
      .register(swUrl)
      .catch(e=>dlog('SW registration failed', e));
  });
}

// Exportar funciones globalmente para que puedan ser llamadas desde otros módulos
window.render = render;
window.updatePlaceholder = updatePlaceholder;
