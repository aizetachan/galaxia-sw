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

export async function api(path, body){
  const headers = { 'Content-Type':'application/json' };
  if (AUTH?.token) headers.Authorization = `Bearer ${AUTH.token}`;
  const url = joinUrl(API_BASE, path);
  dgroup('api POST '+url, ()=>console.log({body}));
  const res = await fetch(url, { method:'POST', headers, body: JSON.stringify(body||{}) });
  const data = await readMaybeJson(res);
  dgroup('api POST result '+url, ()=>console.log(data));
  if (!res.ok){ const err = new Error(`HTTP ${res.status}`); err.response=res; err.data=data; throw err; }
  return data.json ?? {};
}

export async function apiGet(path){
  const headers = {}; if (AUTH?.token) headers.Authorization = `Bearer ${AUTH.token}`;
  const url = joinUrl(API_BASE, path);
  dgroup('api GET '+url, ()=>console.log({}));
  const res = await fetch(url, { method:'GET', headers });
  const data = await readMaybeJson(res);
  dgroup('api GET result '+url, ()=>console.log(data));
  if (!res.ok){ const err=new Error(`HTTP ${res.status}`); err.response=res; err.data=data; throw err; }
  return data.json ?? {};
}
