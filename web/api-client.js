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
  try {
    // Agregar timeout de 30 segundos
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body ?? {}),
      mode: 'cors',
      credentials: 'include',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    console.log('[API] Response status:', res.status, res.statusText);
    console.log('[API] Response headers:', Object.fromEntries(res.headers.entries()));
  } catch (e) {
    console.error('[API] network error', e);
    if (e.name === 'AbortError') {
      throw new Error('Request timeout - server took too long to respond');
    }
    throw new Error('Network error while calling API');
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
  try {
    // Agregar timeout de 30 segundos
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    res = await fetch(url, {
      method: 'GET',
      headers,
      mode: 'cors',
      credentials: 'include',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
  } catch (e) {
    console.error('[API] network error', e);
    if (e.name === 'AbortError') {
      throw new Error('Request timeout - server took too long to respond');
    }
    throw new Error('Network error while calling API');
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

