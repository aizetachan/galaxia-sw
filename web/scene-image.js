import { joinUrl, API_BASE } from "./api.js";
import { AUTH, load, save } from "./auth/session.js";

const SCENE_JOBS = load('sw:scene_jobs', {}) || {};
const persistJobs = () => { try{ save('sw:scene_jobs', SCENE_JOBS); }catch{} };

export function decorateDMs(){
  const root=document.getElementById('chat'); if(!root) return;
  const candidates=root.querySelectorAll('.msg.dm');
  candidates.forEach((box)=>{
    if (box.dataset.enhanced==='1') return;
    const meta=box.querySelector('.meta, .header, .name')||box;
    const txt=box.querySelector('.text')||null;
    const key=box.getAttribute('data-key')||'';
    if (!meta || !txt) return;
    if (!box.querySelector('.scene-image-slot')){
      const slot=document.createElement('div');
      slot.className='scene-image-slot';
      slot.hidden=true; slot.style.minHeight='1px';
      txt.insertAdjacentElement('beforebegin',slot);
    }
    if (!box.querySelector('.brush-btn')){
      const btn=document.createElement('button');
      btn.type='button'; btn.className='brush-btn';
      btn.title='Ilustrar escena'; btn.textContent='🖌️';
      meta.appendChild(btn);
    }
    box.dataset.enhanced='1';
    const job=SCENE_JOBS[key];
    if (job?.status==='done' && job?.dataUrl) injectSceneImageForKey(key, job.dataUrl);
    else if (job && job.status==='processing') paintShimmerForKey(key);
  });
}

function getBoxKey(box){ return box?.getAttribute('data-key')||''; }
function findBoxByKey(key){ try{ return document.querySelector(`.msg.dm[data-key="${key}"]`);}catch{ return null; } }
function paintShimmerForKey(key){ const box=findBoxByKey(key); if(!box) return; const txtEl=box.querySelector('.text'); if(!txtEl) return; if(box.querySelector('.scene-image-loading')) return; const shim=document.createElement('div'); shim.className='scene-image-loading'; box.insertBefore(shim, txtEl); }
function injectSceneImageForKey(key,src){ const box=findBoxByKey(key); if(!box) return; const slot=box.querySelector('.scene-image-slot'); if(!slot) return; injectSceneImage(slot, src); }
export function hydrateSceneJobs(){ try{ Object.entries(SCENE_JOBS).forEach(([key,job])=>{ if(job.status==='done'&&job.dataUrl){ injectSceneImageForKey(key, job.dataUrl); } else if(job.status==='processing'){ paintShimmerForKey(key); } }); }catch(e){ console.warn('[IMG] hydrateSceneJobs error:', e); } }

function getMasterTextFromBox(box){
  let t=(box.querySelector('.text')?.textContent||'').trim();
  if (!t) t = (box.querySelector('.text')?.dataset?.raw || '').trim();
  if (!t) t=[...box.childNodes].map(n=>n.nodeType===3?n.textContent:'').join(' ').replace(/\s+/g,' ').trim();
  return t;
}

function showInlineImageError(box, txtEl, message){
  const existing = box.querySelector('.scene-image-error');
  if (existing) existing.remove();
  const err=document.createElement('div');
  err.className='scene-image-error';
  err.textContent=message || 'No se pudo generar la imagen. Puedes reintentar.';
  box.insertBefore(err, txtEl);
  setTimeout(()=>{ try{ err.remove(); }catch{} }, 6000);
}

async function handleBrushClick(btn){
  const box=btn.closest('.msg.dm'); if(!box||btn.disabled) return;
  const txtEl=box.querySelector('.text'); const slot=box.querySelector('.scene-image-slot'); if(!txtEl||!slot) return;
  const key=getBoxKey(box);
  btn.disabled=true; btn.classList.add('loading');
  let shimmer=document.createElement('div'); shimmer.className='scene-image-loading'; box.insertBefore(shimmer, txtEl);
  try{
    const headers={'Content-Type':'application/json'}; if (AUTH?.token) headers.Authorization=`Bearer ${AUTH.token}`;
    const text=getMasterTextFromBox(box);
    const base=(text||'').trim() || 'Escena sci-fi de aventura espacial.';
    const prompt = [
      'Genera UNA imagen narrativa cinematográfica basada en esta escena.',
      'Sin explicaciones largas. Prioriza composición visual, personajes, entorno e iluminación.',
      `Escena: ${base}`
    ].join(' ');

    SCENE_JOBS[key] = { status:'processing', prompt, at: Date.now() };
    persistJobs();

    const r=await fetch(joinUrl(API_BASE,'/ai/image'),{ method:'POST', headers, body:JSON.stringify({ prompt }) });
    const payload = await r.json().catch(()=>({}));

    if (!r.ok || !payload?.ok){
      console.error('[IMG] /ai/image failed:', r.status, payload);
      SCENE_JOBS[key] = { ...SCENE_JOBS[key], status:'error', error: payload?.message || `http_${r.status}` };
      persistJobs();
      shimmer.remove();
      showInlineImageError(box, txtEl, 'No se pudo generar la imagen ahora. Puedes seguir jugando y reintentar.');
      return;
    }

    const mime = payload.mimeType || 'image/png';
    const b64 = payload.imageBase64;
    if (!b64){
      SCENE_JOBS[key] = { ...SCENE_JOBS[key], status:'error', error:'no_image_base64' };
      persistJobs();
      shimmer.remove();
      showInlineImageError(box, txtEl, 'La IA no devolvió imagen en esta respuesta. Puedes reintentar.');
      return;
    }

    const dataUrl=`data:${mime};base64,${b64}`;
    SCENE_JOBS[key] = { ...SCENE_JOBS[key], status:'done', dataUrl, model: payload.model || null };
    persistJobs();
    shimmer.remove();
    injectSceneImage(slot, dataUrl);
  }catch(e){
    console.warn('[IMG] generation error:', e?.message || e);
    try{ shimmer.remove(); }catch{}
    SCENE_JOBS[key] = { ...(SCENE_JOBS[key]||{}), status:'error', error: e?.message || 'unknown' };
    persistJobs();
    showInlineImageError(box, txtEl, 'No se pudo generar la imagen por un error de red. Puedes reintentar.');
  } finally { btn.disabled=false; btn.classList.remove('loading'); }
}

function dataUrlToBlobUrl(dataUrl){
  try{ const [head,b64]=dataUrl.split(','); const mime=(head.match(/data:(.*?);base64/)||[,'image/png'])[1]; const bin=atob(b64); const u8=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i); return URL.createObjectURL(new Blob([u8],{type:mime})); }catch(e){ console.warn('[IMG] dataUrlToBlobUrl failed:',e); return null; }
}

export function injectSceneImage(slot, src){
  let finalSrc=src; if (src && src.startsWith('data:image/')){ const blobUrl=dataUrlToBlobUrl(src); if (blobUrl) finalSrc=blobUrl; }
  const img=new Image(); img.alt='Escena generada'; img.decoding='async'; img.loading='lazy'; img.style.display='block'; img.style.width='100%';
  slot.hidden=false; slot.innerHTML=''; slot.appendChild(img);
  img.onload=()=>console.log('[IMG] loaded', img.naturalWidth, 'x', img.naturalHeight);
  img.onerror=()=>{
    console.error('[IMG] image load error');
    if(src&&src.startsWith('data:image/')&&!String(finalSrc).startsWith('blob:')){
      const blobUrl=dataUrlToBlobUrl(src);
      if (blobUrl){ img.src=blobUrl; return; }
    }
    slot.hidden=false;
    slot.innerHTML='<div class="scene-image-error">No se pudo cargar la imagen. Puedes reintentar con el botón 🖌️.</div>';
  };
  img.src=finalSrc;
}

document.addEventListener('click', (ev)=>{ const btn=ev.target.closest('.brush-btn'); if (btn) handleBrushClick(btn); });
