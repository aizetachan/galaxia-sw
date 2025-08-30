import { handleLogout, isLogged, AUTH } from "../auth/session.js";

// Identity bar setup
const chatEl = document.getElementById('chat');
const chatWrap = document.querySelector('.chat-wrap');
const adminSection = document.getElementById('admin-section');
const composerEl = document.querySelector('.composer');
let identityEl = document.getElementById('identity-bar');
if (!identityEl) {
  identityEl = document.createElement('section');
  identityEl.id = 'identity-bar';
  identityEl.className = 'identity-bar hidden';
  chatWrap?.insertBefore(identityEl, chatEl);
}

export function setIdentityBar(userName, characterName){
  const u = String(userName || '').trim();
  const isGuest = /^guest$/i.test(u);
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
    ${ u === 'admin' ? `<button id="settings-btn" class="settings-btn" title="Ajustes" aria-label="Ajustes">⚙</button>` : '' }
    <button id="logout-btn" class="logout-btn" title="Cerrar sesión" aria-label="Cerrar sesión">⎋</button>
  </div>
`;
  const _logoutBtn = identityEl.querySelector('#logout-btn');
  if (_logoutBtn) _logoutBtn.onclick = async () => {
    await handleLogout();
    setIdentityBar('', '');
    updateAuthUI();
  };
  const _settingsBtn = identityEl.querySelector('#settings-btn');
  if (_settingsBtn) _settingsBtn.onclick = () => {
    if (adminSection) {
      chatEl.classList.add('hidden');
      composerEl?.classList.add('hidden');
      adminSection.hidden = false;
      adminSection.classList.remove('hidden');
      if (AUTH?.user?.username === 'admin') {
        try { window.refreshAdminUsers?.(); } catch {}
      }
    }
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

const adminCloseBtn = document.getElementById('admin-close');
if (adminCloseBtn) adminCloseBtn.onclick = () => {
  if (!adminSection) return;
  adminSection.hidden = true;
  adminSection.classList.add('hidden');
  chatEl.classList.remove('hidden');
  composerEl?.classList.remove('hidden');
};

// Simple HTML escaper reused from main
function escapeHtml(s='') {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
