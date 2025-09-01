import { handleLogout, isLogged } from "../auth/session.js";
import { prepareAdminPanel, setupAdminDom } from "../admin.js";

// Identity bar setup
const viewportEl = document.getElementById('main-viewport');
const chatWrap = document.querySelector('.chat-wrap');
const composerEl = document.querySelector('.composer');
const rollCtaEl = document.getElementById('roll-cta');
const confirmCtaEl = document.getElementById('confirm-cta');
const prevState = { composer: false, roll: false, confirm: false };
let savedViewNodes = null;
let panelOpen = false;

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
  const isAdmin = u === 'admin';

  // Si NO es admin, cierra cualquier panel abierto
  if (u && !isAdmin) closePanel();

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
    ${ isAdmin ? `<button id="settings-btn" class="settings-btn" title="Ajustes" aria-label="Ajustes">⚙</button>` : '' }
    <button id="logout-btn" class="logout-btn" title="Cerrar sesión" aria-label="Cerrar sesión">⎋</button>
  </div>
`;

  const _logoutBtn = identityEl.querySelector('#logout-btn');
  if (_logoutBtn) _logoutBtn.onclick = async () => {
    await handleLogout();
    // 🔒 Cierra el panel si estaba abierto
    closePanel();
    setIdentityBar('', '');
    updateAuthUI();
  };

  const _settingsBtn = identityEl.querySelector('#settings-btn');
  if (_settingsBtn) _settingsBtn.onclick = async () => {
    if (panelOpen) {
      closePanel();
      return;
    }
    await openSettings();
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
async function openPanel(options){
  panelOpen = true;
  prevState.composer = !!composerEl?.hidden;
  prevState.roll = !!rollCtaEl?.hidden;
  prevState.confirm = !!confirmCtaEl?.hidden;
  savedViewNodes = Array.from(viewportEl.childNodes);

  viewportEl.classList.add('settings-panel');
  viewportEl.replaceChildren(options.markup());
  options.setup?.(viewportEl);
  const closeBtn = viewportEl.querySelector(options.closeSelector || '#panel-close');
  if (closeBtn) closeBtn.onclick = () => closePanel();

  try { await options.prepare?.(); } catch {}

  if (composerEl) { composerEl.hidden = true; composerEl.classList.add('hidden'); }
  if (rollCtaEl) { rollCtaEl.hidden = true; }
  if (confirmCtaEl) { confirmCtaEl.hidden = true; }

  if (options.event) document.dispatchEvent(new Event(options.event));
}

function closePanel(){
  if (!panelOpen) return;
  panelOpen = false;

  if (savedViewNodes) viewportEl.replaceChildren(...savedViewNodes);
  viewportEl.classList.remove('settings-panel');

  if (composerEl) { composerEl.hidden = prevState.composer; composerEl.classList.toggle('hidden', prevState.composer); }
  if (rollCtaEl) { rollCtaEl.hidden = prevState.roll; }
  if (confirmCtaEl) { confirmCtaEl.hidden = prevState.confirm; }
}

async function openSettings(){
  await openPanel({
    markup: createAdminMarkup,
    setup: setupAdminDom,
    prepare: prepareAdminPanel,
    closeSelector: '#admin-close',
    event: 'admin-open'
  });
}

function createAdminMarkup(){
  const tpl = document.createElement('template');
  tpl.innerHTML = `
        <h2>Panel de administración</h2>
        <section id="login-section">
          <input id="admin-user" placeholder="Usuario" />
          <input id="admin-pin" placeholder="PIN" maxlength="4" inputmode="numeric" />
          <button id="admin-login">Entrar</button>
          <span id="admin-status" class="muted"></span>
        </section>
        <section id="admin-panel" hidden>
          <nav class="tabs">
            <button class="tab active" data-tab="users">Usuarios</button>
            <!-- futuro: <button class="tab" data-tab="generator">Generar</button> -->
          </nav>
          <div id="tab-users" class="tab-panel">
            <table class="table" id="users-table">
              <thead>
                <tr><th>ID</th><th>Usuario</th><th>Acciones</th></tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
        </section>
        <button id="admin-close" class="outline">Volver</button>
  `;
  return tpl.content.cloneNode(true);
}

// Simple HTML escaper reused from main
function escapeHtml(s='') {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
