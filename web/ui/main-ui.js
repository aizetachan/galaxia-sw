import { handleLogout, isLogged } from "../auth/session.js";
import { prepareAdminPanel } from "../admin.js";

// Identity bar setup
const chatEl = document.getElementById('chat');
const chatWrap = document.querySelector('.chat-wrap');
const adminEl = document.getElementById('admin-settings');
const composerEl = document.querySelector('.composer');
const rollCtaEl = document.getElementById('roll-cta');
const confirmCtaEl = document.getElementById('confirm-cta');
const adminCloseBtn = document.getElementById('admin-close');
const prevState = { composer: false, roll: false, confirm: false };

let identityEl = document.getElementById('identity-bar');
if (!identityEl) {
  identityEl = document.createElement('section');
  identityEl.id = 'identity-bar';
  identityEl.className = 'identity-bar hidden';
  chatWrap?.insertBefore(identityEl, chatEl);
}

/* === Garantiza mismo contenedor/ancho que el chat === */
if (adminEl && chatWrap && adminEl.parentElement !== chatWrap) {
  chatWrap.insertBefore(adminEl, chatEl.nextSibling);
}
// Igual look que el chat y oculto al inicio
if (adminEl && !adminEl.classList.contains('chat')) adminEl.classList.add('chat');
if (adminEl) { adminEl.hidden = true; adminEl.classList.add('hidden'); }

/* === Botón "volver" dentro de settings === */
if (adminCloseBtn) adminCloseBtn.onclick = () => closeSettings();

/* === Render de la barra de identidad === */
export function setIdentityBar(userName, characterName){
  const u = String(userName || '').trim();
  const isGuest = /^guest$/i.test(u);

  // Si NO es settings, cierra el panel si estuviera abierto
  if (u && u !== 'settings') closeSettings();

  if (!u || isGuest){
    identityEl.classList.add('hidden');
    identityEl.innerHTML = '';
    return;
  }

  const c = String(characterName || '').trim();
  identityEl.innerHTML = `
  <div class="id-row">
    <div class="id-left">
      <div class="id-user">${escapeHtml(u)}</div>
      ${ c ? `<div class="id-char muted">— ${escapeHtml(c)}</div>` : '' }
    </div>
    ${ u === 'settings' ? `<button id="settings-btn" class="settings-btn" title="Ajustes" aria-label="Ajustes">⚙</button>` : '' }
    <button id="logout-btn" class="logout-btn" title="Cerrar sesión" aria-label="Cerrar sesión">⎋</button>
  </div>
`;

  const _logoutBtn = identityEl.querySelector('#logout-btn');
  if (_logoutBtn) _logoutBtn.onclick = async () => {
    await handleLogout();
    // 🔒 Cierra el panel de settings si estaba abierto
    closeSettings();
    setIdentityBar('', '');
    updateAuthUI();
  };

  const _settingsBtn = identityEl.querySelector('#settings-btn');
  if (_settingsBtn) _settingsBtn.onclick = async () => {
    // TOGGLE: si está abierto, cerrar; si está cerrado, abrir
    const isOpen = adminEl && !adminEl.hidden;
    if (isOpen) {
      closeSettings();
      return;
    }
    // 1) Guardar estado actual
    prevState.composer = !!composerEl?.hidden;
    prevState.roll = !!rollCtaEl?.hidden;
    prevState.confirm = !!confirmCtaEl?.hidden;
  
    // 2) Prepara el panel (carga datos con el contenedor aún oculto)
    try { await prepareAdminPanel(); } catch {}
  
    // 3) Abrir settings “de golpe” (sin estados intermedios visibles)
    chatEl.hidden = true;  chatEl.classList.add('hidden');
    adminEl.hidden = false; adminEl.classList.remove('hidden');
  
    if (composerEl) { composerEl.hidden = true; composerEl.classList.add('hidden'); }
    if (rollCtaEl) { rollCtaEl.hidden = true; }
    if (confirmCtaEl) { confirmCtaEl.hidden = true; }
  
    // Notificar apertura para flujos existentes
    document.dispatchEvent(new Event('admin-open'));
  };  

  identityEl.classList.remove('hidden');
}

export function updateIdentityFromState(auth, character){
  const user = auth?.user?.username || '';
  const char = character?.name || '';
  setIdentityBar(user, char);
}

export function updateAuthUI(){
  const logged = isLogged();
  document.body.classList.toggle('is-guest', !logged);
  document.body.classList.toggle('is-logged', logged);
  const card = document.getElementById('guest-card');
  if (card) {
    card.hidden = !!logged;
    card.classList.toggle('hidden', !!logged);
    card.style.display = logged ? 'none' : '';
  }
}

/* === Helpers === */
function closeSettings(){
  if (!adminEl) return;
  adminEl.hidden = true; adminEl.classList.add('hidden');
  chatEl.hidden = false; chatEl.classList.remove('hidden');
  if (composerEl) { composerEl.hidden = prevState.composer; composerEl.classList.toggle('hidden', prevState.composer); }
  if (rollCtaEl) { rollCtaEl.hidden = prevState.roll; }
  if (confirmCtaEl) { confirmCtaEl.hidden = prevState.confirm; }
}

// Simple HTML escaper reused from main
function escapeHtml(s='') {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
