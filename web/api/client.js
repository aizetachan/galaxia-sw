// Cliente API unificado para el frontend
export async function api(path, body, init = {}) {
  const headers = { 
    'Content-Type': 'application/json', 
    ...(init.headers || {}) 
  };
  
  const res = await fetch(`/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include' // cookies HttpOnly (login)
  });
  
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }
  
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

// Funciones específicas de autenticación
export const register = (data) =>
  api('/auth/register', data);

export const login = (data) =>
  api('/auth/login', data);

export const logout = () =>
  api('/auth/logout', {}, { method: 'POST' });

export const getMe = () =>
  api('/auth/me');

// Health check
export const health = () => api('/health');

// Funciones de DM
export const dmAction = (data) =>
  api('/dm/action', data);

export const getWorldState = () =>
  api('/world/state');

// Funciones de chat
export const sendChatMessage = (data) =>
  api('/chat/message', data);

// Funciones de tiradas
export const rollDice = (data) =>
  api('/roll', data);

// Funciones de imágenes de escena
export const startSceneImage = (data) =>
  api('/scene-image/start', data);

export const getSceneImageStatus = (jobId) =>
  api(`/scene-image/status?jobId=${jobId}`);

// Funciones de admin
export const getUsers = () =>
  api('/admin/users');

export const updateUser = (id, data) =>
  api(`/admin/users/${id}`, data, { method: 'PUT' });

export const deleteUser = (id) =>
  api(`/admin/users/${id}`, {}, { method: 'DELETE' });
