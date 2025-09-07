import { handleLogout, isLogged } from "../auth/session.js";

// Identity bar setup
const viewportEl = document.getElementById('main-viewport');
const chatWrap = document.querySelector('.chat-wrap');
const composerEl = document.querySelector('.composer');
const rollCtaEl = document.getElementById('roll-cta');
const confirmCtaEl = document.getElementById('confirm-cta');
const prevState = { composer: false, roll: false, confirm: false };
let savedViewNodes = null;
// Panel functionality removed - admin features not needed

let identityEl = document.getElementById('identity-bar');
if (!identityEl) {
  identityEl = document.createElement('section');
  identityEl.id = 'identity-bar';
  identityEl.className = 'identity-bar hidden';
  chatWrap?.insertBefore(identityEl, viewportEl);
}


/* === Render de la barra de identidad === */
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
    <button id="logout-btn" class="logout-btn" title="Cerrar sesión" aria-label="Cerrar sesión">⎋</button>
  </div>
`;

  const _logoutBtn = identityEl.querySelector('#logout-btn');
  if (_logoutBtn) _logoutBtn.onclick = async () => {
    await handleLogout();
    setIdentityBar('', '');
    updateAuthUI();
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

// Admin functionality removed - keeping only essential UI functions

// Simple HTML escaper reused from main
function escapeHtml(s='') {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
