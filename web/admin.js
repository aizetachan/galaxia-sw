import { API_BASE, joinUrl, ensureApiBase } from './api.js';
import { AUTH, setAuth, listenAuthChanges } from './auth/session.js';

const userEl = document.getElementById('admin-user');
const pinEl = document.getElementById('admin-pin');
const loginBtn = document.getElementById('admin-login');
const statusEl = document.getElementById('admin-status');
const panelEl = document.getElementById('admin-panel');
const loginSectionEl = document.getElementById('login-section');
const usersTabBtn = document.querySelector('.tabs .tab[data-tab="users"]');
const usersTabEl = document.getElementById('tab-users');

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
    loginSectionEl.hidden = true;
    panelEl.hidden = false;
    showTab('users');
  } catch (e) {
    statusEl.textContent = e?.error || 'login_failed';
  }
}

async function loadUsers() {
  await ensureApiBase();
  const tbody = document.querySelector('#users-table tbody');
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
      editBtn.addEventListener('click', () => editUser(u));
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Eliminar';
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

loginBtn.addEventListener('click', handleLogin);
if (usersTabBtn) usersTabBtn.addEventListener('click', () => showTab('users'));
document.addEventListener('admin-open', () => showTab('users'));

listenAuthChanges(async () => {
  if (AUTH?.token && AUTH?.user?.username === 'settings') {
    loginSectionEl.hidden = true;
    panelEl.hidden = false;
    showTab('users');
  } else {
    panelEl.hidden = true;
    loginSectionEl.hidden = false;
    const tbody = document.querySelector('#users-table tbody');
    if (tbody) tbody.innerHTML = '';
  }
});

(async function init(){
  try{
    await ensureApiBase();
    const saved = JSON.parse(localStorage.getItem('sw:auth') || 'null');
    if(saved?.token && saved?.user?.username === 'settings'){
      setAuth(saved);
      loginSectionEl.hidden = true;
      panelEl.hidden = false;
      showTab('users');
    }
  } catch{}
})();

function escapeHtml(s='') {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
