import { dlog, dgroup, API_BASE, joinUrl } from './api.js';
import { AUTH } from './auth/session.js';

async function readMaybeJson(res){
  const ct = res.headers.get('content-type')||'';
  const body = await res.text();
  if (ct.includes('application/json')){
    try{
      return { json: JSON.parse(body), raw: body, ct, status: res.status };
    }catch(e){
      return { json:null, raw:body, ct, status:res.status, parseError:String(e) };
    }
  }
  return { json:null, raw:body, ct, status:res.status };
}

export async function api(path, body) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  if (AUTH?.token) headers.Authorization = `Bearer ${AUTH.token}`;

  const url = joinUrl(API_BASE, path);
  console.log('[API] POST request to:', url);
  console.log('[API] Request body:', body);
  console.log('[API] Request headers:', headers);
  
  dgroup('api POST ' + url, () => console.log({ body }));

  let res;
  let controller;
  let timeoutId;

  try {
    // Agregar timeout de 30 segundos
    controller = new AbortController();
    timeoutId = setTimeout(() => {
      console.log('[API] Timeout reached (30s), aborting request');
      controller.abort('timeout');
    }, 30000);

    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body ?? {}),
      mode: 'cors',
      credentials: 'include',
      signal: controller.signal,
    });

    console.log('[API] Response status:', res.status, res.statusText);
    console.log('[API] Response headers:', Object.fromEntries(res.headers.entries()));
  } catch (e) {
    console.error('[API] network error', e);
    if (e.name === 'AbortError') {
      const reason = e.message || 'timeout';
      console.log('[API] Request was aborted:', reason);
      throw new Error(`Request ${reason} - server took too long to respond`);
    }
    throw new Error('Network error while calling API');
  } finally {
    // Limpiar timeout de manera segura
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

  const data = await readMaybeJson(res);
  console.log('[API] Response data:', data);
  dgroup('api POST result ' + url, () => console.log(data));

  if (!res.ok) {
    const msg =
      (data && data.json && (data.json.error || data.json.message)) ||
      (data && data.text) ||
      `${res.status} ${res.statusText}`;
    console.error('[API] Error response:', msg);
    const err = new Error(`HTTP ${res.status} ${res.statusText} – ${msg}`);
    err.response = res;
    err.data = data;
    throw err;
  }
  console.log('[API] Success, returning:', data.json ?? {});
  return data.json ?? {};
}

export async function apiGet(path) {
  const headers = { 'Accept': 'application/json' };
  if (AUTH?.token) headers.Authorization = `Bearer ${AUTH.token}`;

  const url = joinUrl(API_BASE, path);
  dgroup('api GET ' + url, () => console.log({}));

  let res;
  let controller;
  let timeoutId;

  try {
    // Agregar timeout de 30 segundos
    controller = new AbortController();
    timeoutId = setTimeout(() => {
      console.log('[API] Timeout reached (30s), aborting GET request');
      controller.abort('timeout');
    }, 30000);

    res = await fetch(url, {
      method: 'GET',
      headers,
      mode: 'cors',
      credentials: 'include',
      signal: controller.signal,
    });

  } catch (e) {
    console.error('[API] network error', e);
    if (e.name === 'AbortError') {
      const reason = e.message || 'timeout';
      console.log('[API] GET request was aborted:', reason);
      throw new Error(`GET request ${reason} - server took too long to respond`);
    }
    throw new Error('Network error while calling API');
  } finally {
    // Limpiar timeout de manera segura
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

  const data = await readMaybeJson(res);
  dgroup('api GET result ' + url, () => console.log(data));

  if (!res.ok) {
    const msg =
      (data && data.json && (data.json.error || data.json.message)) ||
      (data && data.text) ||
      `${res.status} ${res.statusText}`;
    const err = new Error(`HTTP ${res.status} ${res.statusText} – ${msg}`);
    err.response = res;
    err.data = data;
    throw err;
  }
  return data.json ?? {};
}

