import { API_BASE, joinUrl, ensureApiBase } from './api.js';
import { AUTH, setAuth, listenAuthChanges } from './auth/session.js';

const userEl = document.getElementById('admin-user');
const pinEl = document.getElementById('admin-pin');
const loginBtn = document.getElementById('admin-login');
const statusEl = document.getElementById('admin-status');
const panelEl = document.getElementById('admin-panel');
const listEl = document.getElementById('users-list');
const loginSectionEl = document.getElementById('login-section');
const usersTabBtn = document.getElementById('admin-users-tab');
const usersTabEl = document.getElementById('admin-tab-users');

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
  listEl.innerHTML = '';
  try {
    const { users } = await api('/admin/users');
    if (!users || users.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No hay usuarios registrados';
      listEl.appendChild(li);
      return;
    }
    users.forEach(u => {
      const li = document.createElement('li');
      li.textContent = `${u.id} - ${u.username} `;
      const editBtn = document.createElement('button');
      editBtn.textContent = 'Editar';
      editBtn.addEventListener('click', () => editUser(u));
      li.appendChild(editBtn);
      const btn = document.createElement('button');
      btn.textContent = 'Eliminar';
      btn.addEventListener('click', () => deleteUser(u.id));
      li.appendChild(btn);
      listEl.appendChild(li);
    });
  } catch (e) {
    const li = document.createElement('li');
    const msg = e?.error === 'DB_NOT_CONFIGURED'
      ? 'Base de datos no configurada'
      : (e?.error || e?.message || 'error');
    li.textContent = `Error al cargar usuarios: ${msg}`;
    listEl.appendChild(li);
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
  if (AUTH?.token && AUTH?.user?.username === 'admin') {
    loginSectionEl.hidden = true;
    panelEl.hidden = false;
    showTab('users');
  } else {
    panelEl.hidden = true;
    loginSectionEl.hidden = false;
    listEl.innerHTML = '';
  }
});

(async function init(){
  try{
    await ensureApiBase();
    const saved = JSON.parse(localStorage.getItem('sw:auth') || 'null');
    if(saved?.token && saved?.user?.username === 'admin'){
      setAuth(saved);
      loginSectionEl.hidden = true;
      panelEl.hidden = false;
      showTab('users');
    }
  } catch{}
})();
