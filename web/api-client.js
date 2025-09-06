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
  dgroup('api POST ' + url, () => console.log({ body }));

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body ?? {}),
      mode: 'cors',
      credentials: 'include',
    });
  } catch (e) {
    console.error('[API] network error', e);
    throw new Error('Network error while calling API');
  }

  const data = await readMaybeJson(res);
  dgroup('api POST result ' + url, () => console.log(data));

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

export async function apiGet(path) {
  const headers = { 'Accept': 'application/json' };
  if (AUTH?.token) headers.Authorization = `Bearer ${AUTH.token}`;

  const url = joinUrl(API_BASE, path);
  dgroup('api GET ' + url, () => console.log({}));

  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers,
      mode: 'cors',
      credentials: 'include',
    });
  } catch (e) {
    console.error('[API] network error', e);
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

