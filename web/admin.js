import { API_BASE, joinUrl, ensureApiBase } from './api.js';
import { AUTH, setAuth, listenAuthChanges } from './auth/session.js';

let userEl,
    pinEl,
    loginBtn,
    statusEl,
    panelEl,
    loginSectionEl,
    usersTabBtn,
    usersTabEl;

export function setupAdminDom(root = document) {
  userEl = root.querySelector('#admin-user');
  pinEl = root.querySelector('#admin-pin');
  loginBtn = root.querySelector('#admin-login');
  statusEl = root.querySelector('#admin-status');
  panelEl = root.querySelector('#admin-panel');
  loginSectionEl = root.querySelector('#login-section');
  usersTabBtn = root.querySelector('.tabs .tab[data-tab="users"]');
  usersTabEl = root.querySelector('#tab-users');

  if (loginBtn) loginBtn.addEventListener('click', handleLogin);
  if (usersTabBtn) usersTabBtn.addEventListener('click', () => showTab('users'));
}

function authHeaders() {
  const h = {};
  if (AUTH?.token) h['Authorization'] = `Bearer ${AUTH.token}`;
  return h;
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...authHeaders(), ...(opts.headers || {}) };
  const r = await fetch(joinUrl(API_BASE, path), { ...opts, headers });
  const text = await r.text();
  try {
    const json = text ? JSON.parse(text) : {};
    if (!r.ok) throw json;
    return json;
  } catch (e) {
    throw e || { error: 'error' };
  }
}

async function handleLogin() {
  statusEl.textContent = '';
  try {
    const { token, user } = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: userEl.value, pin: pinEl.value })
    });
    setAuth({ token, user });
    try { localStorage.setItem('sw:auth', JSON.stringify({ token, user })); } catch {}
    if (user?.username === 'settings') {
      loginSectionEl.hidden = true;
      panelEl.hidden = false;
      showTab('users');
    }
  } catch (e) {
    statusEl.textContent = e?.error || 'login_failed';
  }
}

async function loadUsers() {
  await ensureApiBase();
  const tbody = panelEl ? panelEl.querySelector('#users-table tbody')
                        : document.querySelector('#users-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  try {
    const { users } = await api('/admin/users');
    if (!users || users.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="3">No hay usuarios registrados</td>';
      tbody.appendChild(tr);
      return;
    }
    users.forEach(u => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${u.id}</td><td>${escapeHtml(u.username)}</td><td></td>`;
      const actions = tr.lastElementChild;

      const editBtn = document.createElement('button');
      editBtn.textContent = 'Editar';
      editBtn.className = 'btn btn-secondary';
      editBtn.addEventListener('click', () => editUser(u));

      const delBtn = document.createElement('button');
      delBtn.textContent = 'Eliminar';
      delBtn.className = 'btn btn-danger';
      delBtn.addEventListener('click', () => deleteUser(u.id));

      actions.append(editBtn, delBtn);
      tbody.appendChild(tr);
    });
  } catch (e) {
    const msg = e?.error === 'DB_NOT_CONFIGURED'
      ? 'Base de datos no configurada'
      : (e?.error || e?.message || 'error');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="3">Error al cargar usuarios: ${escapeHtml(msg)}</td>`;
    tbody.appendChild(tr);
  }
}

function showTab(tab) {
  if (tab === 'users') {
    if (usersTabEl) usersTabEl.hidden = false;
    loadUsers();
  }
  if (usersTabBtn) usersTabBtn.classList.toggle('active', tab === 'users');
}

async function deleteUser(id) {
  if (!confirm('¿Eliminar usuario?')) return;
  await api(`/admin/users/${id}`, { method: 'DELETE' });
  await loadUsers();
}

async function editUser(u) {
  const username = prompt('Nuevo nombre de usuario:', u.username);
  if (username === null) return;
  const pin = prompt('Nuevo PIN (opcional):', '');
  await api(`/admin/users/${u.id}`, { method: 'PUT', body: JSON.stringify({ username, pin: pin || undefined }) });
  await loadUsers();
}

// Abrir panel SOLO cuando el usuario pulsa ⚙️ y SOLO si es 'settings'
document.addEventListener('admin-open', async () => {
  await ensureApiBase();
  const isAdmin = AUTH?.token && AUTH?.user?.username === 'settings';
  if (!isAdmin) return;
  loginSectionEl.hidden = true;
  panelEl.hidden = false;
  showTab('users');
});

// Si cambia el estado de auth mientras el panel está abierto, sincroniza
listenAuthChanges(async () => {
  const open = !!panelEl?.isConnected;
  if (!open) return;
  const isAdmin = AUTH?.token && AUTH?.user?.username === 'settings';
  if (isAdmin) {
    loginSectionEl.hidden = true;
    panelEl.hidden = false;
    showTab('users');
  } else {
    loginSectionEl.hidden = true;
    panelEl.hidden = true;
  }
});

// Init: solo asegurar API_BASE
(async function init(){
  try { await ensureApiBase(); } catch {}
})();

function escapeHtml(s='') {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
// === Preload helper para evitar flicker en Settings ===
export async function prepareAdminPanel() {
  try { await ensureApiBase(); } catch {}
  const isAdmin = AUTH?.token && AUTH?.user?.username === 'settings';
  if (isAdmin) {
    // Asegura estado del panel aunque esté oculto
    if (loginSectionEl) loginSectionEl.hidden = true;
    if (panelEl) panelEl.hidden = false;
    // Pre-carga de usuarios en la tabla (está oculta, así que no parpadea)
    try { await loadUsers(); } catch {}
  } else {
    // No admin: dejamos la sección de login lista (sin cargar nada)
    if (panelEl) panelEl.hidden = true;
    if (loginSectionEl) loginSectionEl.hidden = false;
  }
}
// Exponer global por compatibilidad
window.prepareAdminPanel = prepareAdminPanel;
