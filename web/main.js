import { dlog, dgroup, API_BASE, joinUrl, setServerStatus, probeHealth, ensureApiBase } from "./api.js";
import { getDmMode, setDmMode } from "./state.js";
import { setIdentityBar, updateAuthUI, updateIdentityFromState as _updateIdentityFromState } from "./ui/main-ui.js";
import { AUTH, setAuth, KEY_MSGS, KEY_CHAR, KEY_STEP, KEY_CONFIRM, load, save, isLogged, listenAuthChanges } from "./auth/session.js";
import { msgs, pendingRoll, pushDM, pushUser, talkToDM, resetMsgs, handleIncomingDMText, mapStageForDM, setRenderCallback, setMsgs, setPendingRoll } from "./chat/chat-controller.js";

/* ============================================================
 *                       Estado
 * ========================================================== */
let character = load(KEY_CHAR, null);
let step = load(KEY_STEP, 'name');
let pendingConfirm = load(KEY_CONFIRM, null);

const UI = { sending:false, authLoading:false, authKind:null, confirmLoading:false };

/* ===== Scene image re-hydration (igual que tenías) ===== */
const SCENE_JOBS = load('sw:scene_jobs', {}) || {};
const POLLERS = {};
function persistJobs(){ try{ save('sw:scene_jobs', SCENE_JOBS); }catch{} }
function authHeaders(){ const h={}; if (AUTH?.token) h.Authorization = `Bearer ${AUTH.token}`; return h; }

setRenderCallback(render);

/* ============================================================
 *                        DOM
 * ========================================================== */
const chatEl = document.getElementById('chat'); // ← quitado el placeholder “pantalla intermedia”

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
function lockWidth(el,on){ if(!el) return; if(on){ if(!el.dataset.w) el.dataset.w = el.offsetWidth+'px'; el.style.width = el.dataset.w; } else { el.style.width=''; delete el.dataset.w; } }
function setSending(on){
  UI.sending = !!on;
  try{
    if (sendBtn) sendBtn.disabled = !!on;
    if (inputEl) inputEl.disabled = !!on;
    if (on){
      if (sendBtn){ lockWidth(sendBtn,true); sendBtn.classList.add('loading'); if(!sendBtn.dataset.prev) sendBtn.dataset.prev = sendBtn.textContent||'Enviar'; sendBtn.textContent = sendBtn.dataset.prev; }
    } else {
      if (sendBtn){ sendBtn.classList.remove('loading'); lockWidth(sendBtn,false); sendBtn.textContent = sendBtn.dataset.prev||'Enviar'; }
      if (inputEl) inputEl.disabled = false;
    }
  }catch{}
}
function setAuthLoading(on, kind=null){
  UI.authLoading = !!on; UI.authKind = on ? kind : null;
  const targetBtn = (kind==='login')?authLoginBtn:(kind==='register')?authRegisterBtn:null;
  try{
    if (authUserEl) authUserEl.disabled = !!on;
    if (authPinEl) authPinEl.disabled = !!on;
    if (authLoginBtn) authLoginBtn.disabled = !!on;
    if (authRegisterBtn) authRegisterBtn.disabled = !!on;
    if (on && targetBtn){
      lockWidth(targetBtn,true); targetBtn.classList.add('loading');
      if(!targetBtn.dataset.prev) targetBtn.dataset.prev = targetBtn.textContent || (kind==='login'?'Entrar':'Crear');
      targetBtn.textContent = targetBtn.dataset.prev;
    } else {
      for (const b of [authLoginBtn, authRegisterBtn]){ if(!b) continue; b.classList.remove('loading'); lockWidth(b,false); if(b.dataset.prev) b.textContent = b.dataset.prev; }
    }
  }catch{}
}
function setConfirmLoading(on){
  UI.confirmLoading = !!on;
  try{
    const yes = document.getElementById('confirm-yes-inline');
    const no  = document.getElementById('confirm-no-inline');
    if (yes) yes.disabled = !!on;
    if (no)  no.disabled  = !!on;
    const set = (btn, txt) => { if(!btn) return; lockWidth(btn,on); btn.classList.toggle('loading',on); btn.textContent = txt; };
    if (on){ set(yes,'Sí'); set(no,'No'); } else { set(yes,'Sí'); set(no,'No'); }
  }catch{}
}

/* ============================================================
 *                       Utils
 * ========================================================== */
const now = () => Date.now();
const hhmm = (ts) => new Date(ts).toLocaleTimeString();
function escapeHtml(s=''){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function formatMarkdown(t=''){ const safe=escapeHtml(t); return safe.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>'); }
const titleCase = (s='') => String(s).toLowerCase().replace(/\b\w/g, m=>m.toUpperCase()).replace(/\s+/g,' ').trim();

/* ============================================================
 *                    API helpers
 * ========================================================== */
async function readMaybeJson(res){
  const ct = res.headers.get('content-type')||''; const body = await res.text();
  if (ct.includes('application/json')){ try{ return { json: JSON.parse(body), raw: body, ct, status: res.status }; } catch(e){ return { json:null, raw:body, ct, status:res.status, parseError:String(e) }; } }
  return { json:null, raw:body, ct, status:res.status };
}
async function api(path, body){
  const headers = { 'Content-Type':'application/json' };
  if (AUTH?.token) headers.Authorization = `Bearer ${AUTH.token}`;
  const url = joinUrl(API_BASE, path);
  dgroup('api POST '+url, ()=>console.log({body}));
  const res = await fetch(url, { method:'POST', headers, body: JSON.stringify(body||{}) });
  const data = await readMaybeJson(res);
  dgroup('api POST result '+url, ()=>console.log(data));
  if (!res.ok){ const err = new Error(`HTTP ${res.status}`); err.response=res; err.data=data; throw err; }
  return data.json ?? {};
}
async function apiGet(path){
  const headers = {}; if (AUTH?.token) headers.Authorization = `Bearer ${AUTH.token}`;
  const url = joinUrl(API_BASE, path);
  dgroup('api GET '+url, ()=>console.log({}));
  const res = await fetch(url, { method:'GET', headers });
  const data = await readMaybeJson(res);
  dgroup('api GET result '+url, ()=>console.log(data));
  if (!res.ok){ const err=new Error(`HTTP ${res.status}`); err.response=res; err.data=data; throw err; }
  return data.json ?? {};
}

/* ============================================================
 *               Onboarding (el Máster guía)
 * ========================================================== */
async function dmSay(message){
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

async function startOnboarding({ hard=false } = {}){
  try{ document.getElementById('guest-card')?.setAttribute('hidden','hidden'); }catch{}

  if (hard) resetMsgs();

  // Estado base
  character = null;            save(KEY_CHAR, character);
  step = 'name';               save(KEY_STEP, step);
  pendingConfirm = null;       save(KEY_CONFIRM, null);

  // Fallback visible inmediato para NO dejar negro
  if (msgs.length === 0) {
    pushDM(
      'Bienvenid@ al **HoloCanal**. Soy tu **Máster**.\n\n' +
      'Vamos a registrar tu identidad para entrar en la historia.\n' +
      '**Primero:** ¿cómo se va a llamar tu personaje?'
    );
  }
  render();

  // Kickoff real al Máster (prompt-master). Si falla, queda el fallback.
  await startOnboardingKickoff();
}


/* ============================================================
 *                          BOOT
 * ========================================================== */
async function boot(){
  dlog('Boot start');
  await ensureApiBase();
  dlog('API_BASE ready =', API_BASE);
  setServerStatus(true, `Server: OK — M: ${getDmMode()}`);

  try{
    const saved = JSON.parse(localStorage.getItem('sw:auth')||'null');
    if (saved?.token && saved?.user?.id){
      setAuth(saved);
      await apiGet('/auth/me').catch(e => { if (e.response?.status===401) throw new Error('UNAUTHORIZED'); throw e; });
      setMsgs(load(KEY_MSGS, []));
      character = load(KEY_CHAR, null);
      step = load(KEY_STEP, 'name');
      pendingConfirm = load(KEY_CONFIRM, null);
      await loadHistory({ force: true });
      await showResumeIfAny();
      if (authStatusEl) authStatusEl.textContent = `Hola, ${saved.user.username}`;
    } else {
      setAuth(null);
      localStorage.removeItem('sw:auth');
      setMsgs(load(KEY_MSGS, []));
      character = load(KEY_CHAR, null);
      step = load(KEY_STEP, 'name');
      pendingConfirm = null; save(KEY_CONFIRM, null);
    }
  } catch(e){
    dlog('Auth restore error:', e);
    if (authStatusEl) authStatusEl.textContent = 'Sin conexión para validar sesión';
  }

  await loadHistory();
  updateAuthUI();

  // Si estoy logueado y sin personaje -> empezamos onboarding (PERO SIN cortar boot)
  if (isLogged() && msgs.length === 0){
    let me=null; try{ me = await apiGet('/world/characters/me'); }catch{}
    if (!me?.character){ await startOnboarding({ hard:true }); }
  }

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

function updatePlaceholder(){
  const placeholders = {
    name:'Tu nombre en el HoloNet…',
    species:'Elige especie… (el Máster te da opciones)',
    role:'Elige rol… (el Máster te da opciones)',
    done:'Habla con el Máster'
  };
  if (inputEl) inputEl.placeholder = placeholders[step] || placeholders.done;
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
function getClientState(){
  return {
    step,
    name: (character?.name || pendingConfirm?.name || null),
    species: (character?.species || pendingConfirm?.species || null),
    role: (character?.role || pendingConfirm?.role || null),
    pendingConfirm: (pendingConfirm || null),
    sceneMemo: load('sw:scene_memo', []),
  };
}
// Lanza el kickoff real al Máster (prompt). Si falla, ya habrá un fallback visible.
async function startOnboardingKickoff() {
  try {
    const kick = await api('/dm/respond', {
      message: '',
      history: [],
      character_id: Number(character?.id) || null,
      stage: mapStageForDM(step),   // ahora 'name'
      clientState: getClientState(),
      config: { mode: getDmMode() }
    });
    if (kick?.text) handleIncomingDMText(kick.text);
  } catch (e) {
    dlog('kickoff fail (fallback visible)', e?.data || e);
  }
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

  if (pendingConfirm && step!=='done'){ pendingConfirm=null; save(KEY_CONFIRM,null); render(); }

  dlog('send',{value,step});
  setSending(true);
  if (inputEl) inputEl.value='';

  const m = value.match(/^\/modo\s+(fast|rich)\b/i);
  if (m){ setDmMode(m[1].toLowerCase()); setSending(false); return; }

  if ((value==='/privado'||value==='/publico')&&character){
    character.publicProfile = (value==='/publico'); save(KEY_CHAR, character);
    try{ await api('/world/characters', { name:character.name, species:character.species, role:character.role, publicProfile:character.publicProfile, lastLocation:character.lastLocation, character }); }catch(e){ dlog('privacy update fail', e?.data||e); }
    setSending(false); return;
  }
  if (value==='/resumen'||value==='/resume'){ await showResumeOnDemand(); setSending(false); return; }
  if (value==='/restart'){
    localStorage.removeItem(KEY_MSGS);
    localStorage.removeItem(KEY_CHAR);
    localStorage.removeItem(KEY_STEP);
    localStorage.removeItem(KEY_CONFIRM);
    resetMsgs(); character=null; step='name'; setPendingRoll(null); pendingConfirm=null;
  
    // Onboarding robusto: fallback inmediato + kickoff real en paralelo
    await startOnboarding({ hard:true });
    setSending(false); return;
  }
  

  pushUser(value);

  if (step!=='done'){
    if (step==='name'){
      const name = value || 'Aventurer@';
      character = { name, species:'', role:'', publicProfile:true, lastLocation:'Tatooine — Cantina de Mos Eisley' };
      save(KEY_CHAR, character);
      pendingConfirm = { type:'name', name }; save(KEY_CONFIRM, pendingConfirm);
      render(); setSending(false); return;
    }
    if (step==='species'){
      const species = titleCase(value);
      if (species.length>=2){
        character.species = species; save(KEY_CHAR, character);
        try{ const r = await api('/world/characters', { name:character.name, species:character.species, role:character.role, publicProfile:character.publicProfile, lastLocation:character.lastLocation, character }); if (r?.character?.id && !character.id){ character.id=r.character.id; save(KEY_CHAR,character);} }catch(e){ dlog('update species fail', e?.data||e); }
        step='role'; save(KEY_STEP, step);

// Fallback visible al instante
pushDM(`Genial, ${character.name}. Ahora elige tu **rol** (Piloto, Contrabandista, Jedi, Cazarrecompensas, Ingeniero)…`);
render();

// Kickoff real (no bloquea la UI)
dmSay(`<<ONBOARD STEP="role" NAME="${character.name}" SPECIES="${character.species}">>`)
  .catch(()=>{});

setSending(false); return;

      }
    } else if (step==='role'){
      const role = titleCase(value);
      if (role.length>=2){
        character.role = role; save(KEY_CHAR, character);
        try{ const r = await api('/world/characters', { name:character.name, species:character.species, role:character.role, publicProfile:character.publicProfile, lastLocation:character.lastLocation, character }); if (r?.character?.id && !character.id){ character.id=r.character.id; save(KEY_CHAR,character);} }catch(e){ dlog('update role fail', e?.data||e); }
        step='done'; save(KEY_STEP, step);

// Fallback visible al instante
pushDM('¡Listo! Preparando escena inicial…');
render();

// Kickoff real (no bloquea la UI)
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

/* ============================================================
 *                    Confirmación
 * ========================================================== */
let busyConfirm=false;
async function handleConfirmDecision(decision){
  if (!pendingConfirm || busyConfirm) return;
  busyConfirm=true; setConfirmLoading(true);
  const { type } = pendingConfirm;
  try{
    if (decision==='yes'){
      if (type==='name'){
        if (!character){ character = { name: pendingConfirm.name, species:'', role:'', publicProfile:true, lastLocation:'Tatooine — Cantina de Mos Eisley' }; }
        else { character.name = pendingConfirm.name; }
        save(KEY_CHAR, character);
        try{ const r = await api('/world/characters', { name:character.name, species:character.species, role:character.role, publicProfile:character.publicProfile, lastLocation:character.lastLocation, character }); if (r?.character?.id){ character.id=r.character.id; save(KEY_CHAR,character);} }catch(e){ dlog('upsert name fail', e?.data||e); }
        step='species'; save(KEY_STEP, step);

        // Fallback visible al instante
        pushDM(`Perfecto, **${character.name}**. Ahora elige **especie** (Humano, Twi'lek, Wookiee, Zabrak, Droide)…`);
        render();
        
        // Kickoff real (no bloquea la UI)
        dmSay(`<<ONBOARD STEP="species" NAME="${character.name}">>`)
          .catch(()=>{});
        
      } else if (type==='build'){
        if (!character){ character = { name:'Aventurer@', species:pendingConfirm.species, role:pendingConfirm.role, publicProfile:true }; }
        else { character.species = pendingConfirm.species; character.role = pendingConfirm.role; }
        save(KEY_CHAR, character);
        try{ const r = await api('/world/characters', { name:character.name, species:character.species, role:character.role, publicProfile:character.publicProfile, lastLocation:character.lastLocation, character }); if (r?.character?.id && !character.id){ character.id=r.character.id; save(KEY_CHAR,character);} }catch(e){ dlog('upsert build fail', e?.data||e); }
        step='done'; save(KEY_STEP, step);
      }
    }
    pendingConfirm=null; save(KEY_CONFIRM,null);
    const hist = msgs.slice(-8);
    const follow = await api('/dm/respond', { message:`<<CONFIRM_ACK TYPE="${type}" DECISION="${decision}">>`, history:hist, character_id:Number(character?.id)||null, stage:mapStageForDM(step), clientState:getClientState(), config:{ mode:getDmMode() } });
    handleIncomingDMText((follow && follow.text) ? follow.text : '');
  } catch(e){
    dlog('handleConfirmDecision error', e?.data||e);
    alert(e.message || 'No se pudo procesar la confirmación');
  } finally { busyConfirm=false; setConfirmLoading(false); render(); }
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
      if (r.character){ character=r.character; save(KEY_CHAR, character); step='done'; save(KEY_STEP, step); }
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
  if (UI.authLoading) return;
  const username = (authUserEl?.value || '').trim();
  const pin = (authPinEl?.value || '').trim();
  if (!username || !/^\d{4}$/.test(pin)) {
    if (authStatusEl) authStatusEl.textContent = 'Usuario y PIN (4 dígitos)';
    return;
  }

  dlog('doAuth', { kind, username });
  setAuthLoading(true, kind);

  try {
    const url = kind === 'register' ? '/auth/register' : '/auth/login';
    const { token, user } = (await api(url, { username, pin }));
    setAuth({ token, user });
    localStorage.setItem('sw:auth', JSON.stringify({ token, user }));

    migrateGuestToUser(user.id);

    // Cargamos estado local "limpio"
    setMsgs(load(KEY_MSGS, []));
    character = load(KEY_CHAR, null);
    step = load(KEY_STEP, 'name');
    pendingConfirm = load(KEY_CONFIRM, null);

    // Quitar "bienvenida de invitado" si quedó
    {
      const t0 = (Array.isArray(msgs) && msgs[0]?.text) ? String(msgs[0].text) : '';
      const esSoloBienvenida =
        Array.isArray(msgs) && msgs.length <= 1 && t0.includes('HoloCanal') && t0.includes('inicia sesión');
      if (esSoloBienvenida) { resetMsgs(); }
    }

    // ¿Ya tiene personaje? → login con partida previa
    let me = null;
    try { me = await apiGet('/world/characters/me'); }
    catch (e) { if (e?.response?.status !== 404) throw e; dlog('characters/me not found', e?.data || e); }

    if (me?.character) {
      // Jugador existente: forzamos historial
      character = me.character; save(KEY_CHAR, character);
      step = 'done'; save(KEY_STEP, step);

      await loadHistory({ force: true });
      await showResumeIfAny();

      if (authStatusEl) authStatusEl.textContent = `Hola, ${user.username}`;
      setIdentityBar(user.username, character?.name || '');
      updateAuthUI();
      render();
      return; // listo para seguir jugando
    }

    // === Registro nuevo: empezamos onboarding ===
    // Estado inicial de onboarding
    resetMsgs();
    character = null; save(KEY_CHAR, character);
    step = 'name'; save(KEY_STEP, step);
    pendingConfirm = null; save(KEY_CONFIRM, null);

    if (authStatusEl) authStatusEl.textContent = `Hola, ${user.username}`;
    setIdentityBar(user.username, '');
    updateAuthUI();
    render();

    // Lanzamos el kickoff real; si falla, queda el fallback local
    await startOnboardingKickoff();

  } catch (e) {
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
    if (authStatusEl) authStatusEl.textContent = (code && (friendly[code] || code)) || 'Error de autenticación';
  } finally {
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
if ('serviceWorker' in navigator){ window.addEventListener('load', ()=>{ navigator.serviceWorker.register('/service-worker.js').catch(e=>dlog('SW registration failed',e)); }); }

/* ============================================================
 *     Imagen de escena (decoración + polling) – sin cambios
 * ========================================================== */
function decorateDMs(){
  const root=document.getElementById('chat'); if(!root) return;
  const candidates=root.querySelectorAll('.msg.dm');
  candidates.forEach((box)=>{
    if (box.dataset.enhanced==='1') return;
    const meta=box.querySelector('.meta, .header, .name')||box;
    const txt =box.querySelector('.text')||null;
    const key =box.getAttribute('data-key')||'';
    if (!meta || !txt) return;
    if (!box.querySelector('.scene-image-slot')){ const slot=document.createElement('div'); slot.className='scene-image-slot'; slot.hidden=true; slot.style.minHeight='1px'; txt.insertAdjacentElement('beforebegin',slot); }
    if (!box.querySelector('.brush-btn')){ const btn=document.createElement('button'); btn.type='button'; btn.className='brush-btn'; btn.title='Ilustrar escena'; btn.textContent='🖌️'; meta.appendChild(btn); }
    box.dataset.enhanced='1';
    const job=SCENE_JOBS[key];
    if (job?.status==='done' && job?.dataUrl){ const slot=box.querySelector('.scene-image-slot'); injectSceneImage(slot, job.dataUrl); }
    else if (job && (job.status==='queued'||job.status==='processing')){ paintShimmerForKey(key); ensurePollingForJob(key); }
  });
}
function getBoxKey(box){ return box?.getAttribute('data-key')||''; }
function findBoxByKey(key){ try{ return document.querySelector(`.msg.dm[data-key="${key}"]`);}catch{ return null; } }
function paintShimmerForKey(key){ const box=findBoxByKey(key); if(!box) return; const txtEl=box.querySelector('.text'); if(!txtEl) return; if(box.querySelector('.scene-image-loading')) return; const shim=document.createElement('div'); shim.className='scene-image-loading'; box.insertBefore(shim, txtEl); }
function removeShimmerForKey(key){ const box=findBoxByKey(key); if(!box) return; const shim=box.querySelector('.scene-image-loading'); if(shim) shim.remove(); }
function injectSceneImageForKey(key,src){ const box=findBoxByKey(key); if(!box) return; const slot=box.querySelector('.scene-image-slot'); if(!slot) return; injectSceneImage(slot, src); }
function hydrateSceneJobs(){ try{ Object.entries(SCENE_JOBS).forEach(([key,job])=>{ if(job.status==='done'&&job.dataUrl){ injectSceneImageForKey(key, job.dataUrl); } else if(job.status==='queued'||job.status==='processing'){ paintShimmerForKey(key); ensurePollingForJob(key); } }); }catch(e){ console.warn('[IMG] hydrateSceneJobs error:', e); } }
function ensurePollingForJob(key){
  const job=SCENE_JOBS[key]; if(!job?.jobId) return; if (POLLERS[job.jobId]) return;
  let tries=0; const maxTries=120; const intervalMs=2000;
  POLLERS[job.jobId]=setInterval(async()=>{
    tries++;
    try{
      const url=new URL(joinUrl(API_BASE,'/scene-image/status')); url.searchParams.set('jobId', job.jobId);
      const rs=await fetch(url,{ headers:authHeaders() }); if(!rs.ok) throw new Error('status_http_'+rs.status);
      const st=await rs.json();
      if (st.status==='done' && st.dataUrl){ SCENE_JOBS[key]={...SCENE_JOBS[key],status:'done',dataUrl:st.dataUrl}; persistJobs(); removeShimmerForKey(key); injectSceneImageForKey(key, st.dataUrl); clearInterval(POLLERS[job.jobId]); delete POLLERS[job.jobId]; }
      else if (st.status==='error'){ SCENE_JOBS[key]={...SCENE_JOBS[key],status:'error'}; persistJobs(); removeShimmerForKey(key); clearInterval(POLLERS[job.jobId]); delete POLLERS[job.jobId]; }
    }catch(e){ console.warn('[IMG] status poll error:', e.message); }
    if (tries>=maxTries){ console.warn('[IMG] job timeout key=',key); removeShimmerForKey(key); clearInterval(POLLERS[job.jobId]); delete POLLERS[job.jobId]; }
  }, intervalMs);
}
function getMasterTextFromBox(box){
  let t=(box.querySelector('.text')?.textContent||'').trim();
  if (!t) t = (box.querySelector('.text')?.dataset?.raw || '').trim();
  if (!t) t=[...box.childNodes].map(n=>n.nodeType===3?n.textContent:'').join(' ').replace(/\s+/g,' ').trim();
  return t;
}
async function handleBrushClick(btn){
  const box=btn.closest('.msg.dm'); if(!box||btn.disabled) return;
  const txtEl=box.querySelector('.text'); const slot=box.querySelector('.scene-image-slot'); if(!txtEl||!slot) return;
  btn.disabled=true; btn.classList.add('loading');
  let shimmer=document.createElement('div'); shimmer.className='scene-image-loading'; box.insertBefore(shimmer, txtEl);
  try{
    let sceneMemo=[]; try{ sceneMemo=load('sw:scene_memo',[]);}catch{}; const scene=(Array.isArray(sceneMemo)&&sceneMemo.length)?{memo:sceneMemo.slice(-6)}:null;
    const headers={'Content-Type':'application/json'}; if (AUTH?.token) headers.Authorization=`Bearer ${AUTH.token}`;
    const text=getMasterTextFromBox(box);
    const rStart=await fetch(joinUrl(API_BASE,'/scene-image/start'),{ method:'POST', headers, body:JSON.stringify({ masterText:(text||'').trim(), scene }) });
    if (!rStart.ok){ const t=await rStart.text().catch(()=> ''); console.error('[IMG] start failed:', rStart.status, t); shimmer.remove(); const err=document.createElement('div'); err.className='scene-image-error'; err.textContent='No se pudo iniciar la generación.'; box.insertBefore(err, txtEl); setTimeout(()=>err.remove(),4000); return; }
    const { jobId } = await rStart.json(); let tries=0; const maxTries=120; const intervalMs=2000;
    await new Promise((resolve)=>{
      const iv=setInterval(async()=>{
        tries++;
        try{
          const url=new URL(joinUrl(API_BASE,'/scene-image/status')); url.searchParams.set('jobId', jobId);
          const rs=await fetch(url,{headers}); if(!rs.ok) throw new Error('status_http_'+rs.status);
          const st=await rs.json();
          if (st.status==='done' && st.dataUrl){ try{ shimmer.remove(); }catch{} injectSceneImage(slot, st.dataUrl); clearInterval(iv); resolve(); }
          else if (st.status==='error'){ try{ shimmer.remove(); }catch{} const err=document.createElement('div'); err.className='scene-image-error'; err.textContent='No se pudo generar la imagen.'; box.insertBefore(err, txtEl); setTimeout(()=>err.remove(),4000); clearInterval(iv); resolve(); }
        }catch(e){ console.warn('[IMG] status poll error:', e.message); }
        if (tries>=maxTries){ try{ shimmer.remove(); }catch{} const err=document.createElement('div'); err.className='scene-image-error'; err.textContent='La generación tardó demasiado.'; box.insertBefore(err, txtEl); setTimeout(()=>err.remove(),4000); clearInterval(iv); resolve(); }
      }, intervalMs);
    });
  }catch(e){
    try{ shimmer.remove(); }catch{} const err=document.createElement('div'); err.className='scene-image-error'; err.textContent='No se pudo generar la imagen.'; box.insertBefore(err, txtEl); setTimeout(()=>err.remove(),4000);
  } finally { btn.disabled=false; btn.classList.remove('loading'); }
}
function dataUrlToBlobUrl(dataUrl){
  try{ const [head,b64]=dataUrl.split(','); const mime=(head.match(/data:(.*?);base64/)||[,'image/png'])[1]; const bin=atob(b64); const u8=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i); return URL.createObjectURL(new Blob([u8],{type:mime})); }catch(e){ console.warn('[IMG] dataUrlToBlobUrl failed:',e); return null; }
}
function injectSceneImage(slot, src){
  let finalSrc=src; if (src && src.startsWith('data:image/')){ const blobUrl=dataUrlToBlobUrl(src); if (blobUrl) finalSrc=blobUrl; }
  const img=new Image(); img.alt='Escena generada'; img.decoding='async'; img.loading='lazy'; img.style.display='block'; img.style.width='100%';
  slot.hidden=false; slot.innerHTML=''; slot.appendChild(img);
  img.onload=()=>console.log('[IMG] loaded', img.naturalWidth, 'x', img.naturalHeight);
  img.onerror=()=>{ console.error('[IMG] image load error'); if(src&&src.startsWith('data:image/')&&!String(finalSrc).startsWith('blob:')){ const blobUrl=dataUrlToBlobUrl(src); if (blobUrl){ img.src=blobUrl; return; } } slot.hidden=true; slot.innerHTML=''; };
  img.src=finalSrc;
}
document.addEventListener('click', (ev)=>{ const btn=ev.target.closest('.brush-btn'); if (btn) handleBrushClick(btn); });
