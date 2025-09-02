import { joinUrl, API_BASE } from "./api.js";
import { AUTH, load, save } from "./auth/session.js";

const SCENE_JOBS = load('sw:scene_jobs', {}) || {};
const POLLERS = {};
const persistJobs = () => { try{ save('sw:scene_jobs', SCENE_JOBS); }catch{} };
const authHeaders = () => { const h={}; if (AUTH?.token) h.Authorization=`Bearer ${AUTH.token}`; return h; };

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
    else if (job && (job.status==='queued'||job.status==='processing')){
      paintShimmerForKey(key); ensurePollingForJob(key);
    }
  });
}

function getBoxKey(box){ return box?.getAttribute('data-key')||''; }
function findBoxByKey(key){ try{ return document.querySelector(`.msg.dm[data-key="${key}"]`);}catch{ return null; } }
function paintShimmerForKey(key){ const box=findBoxByKey(key); if(!box) return; const txtEl=box.querySelector('.text'); if(!txtEl) return; if(box.querySelector('.scene-image-loading')) return; const shim=document.createElement('div'); shim.className='scene-image-loading'; box.insertBefore(shim, txtEl); }
function removeShimmerForKey(key){ const box=findBoxByKey(key); if(!box) return; const shim=box.querySelector('.scene-image-loading'); if(shim) shim.remove(); }
function injectSceneImageForKey(key,src){ const box=findBoxByKey(key); if(!box) return; const slot=box.querySelector('.scene-image-slot'); if(!slot) return; injectSceneImage(slot, src); }
export function hydrateSceneJobs(){ try{ Object.entries(SCENE_JOBS).forEach(([key,job])=>{ if(job.status==='done'&&job.dataUrl){ injectSceneImageForKey(key, job.dataUrl); } else if(job.status==='queued'||job.status==='processing'){ paintShimmerForKey(key); ensurePollingForJob(key); } }); }catch(e){ console.warn('[IMG] hydrateSceneJobs error:', e); } }
function ensurePollingForJob(key){
  const job=SCENE_JOBS[key]; if(!job?.jobId) return; if (POLLERS[job.jobId]) return;
  let tries=0; const maxTries=120; const intervalMs=2000;
  POLLERS[job.jobId]=setInterval(async()=>{
    tries++;
    try{
      const url=new URL(joinUrl(API_BASE,'/scene-image/status')); url.searchParams.set('jobId', job.jobId);
      const rs=await fetch(url,{ headers:authHeaders() }); if(!rs.ok) throw new Error('status_http_'+rs.status);
      const st=await rs.json();
      if (st.status==='done' && st.dataUrl){ SCENE_JOBS[key]={...SCENE_JOBS[key],status:'done',dataUrl:st.dataUrl}; persistJobs(); removeShimmerForKey(key); injectSceneImageForKey(key, st.dataUrl); clearInterval(POLLERS[job.jobId]); delete POLLERS[job.jobId]; }
      else if (st.status==='error'){ SCENE_JOBS[key]={...SCENE_JOBS[key],status:'error'}; persistJobs(); removeShimmerForKey(key); clearInterval(POLLERS[job.jobId]); delete POLLERS[job.jobId]; }
    }catch(e){ console.warn('[IMG] status poll error:', e.message); }
    if (tries>=maxTries){ console.warn('[IMG] job timeout key=',key); removeShimmerForKey(key); clearInterval(POLLERS[job.jobId]); delete POLLERS[job.jobId]; }
  }, intervalMs);
}

function getMasterTextFromBox(box){
  let t=(box.querySelector('.text')?.textContent||'').trim();
  if (!t) t = (box.querySelector('.text')?.dataset?.raw || '').trim();
  if (!t) t=[...box.childNodes].map(n=>n.nodeType===3?n.textContent:'').join(' ').replace(/\s+/g,' ').trim();
  return t;
}

async function handleBrushClick(btn){
  const box=btn.closest('.msg.dm'); if(!box||btn.disabled) return;
  const txtEl=box.querySelector('.text'); const slot=box.querySelector('.scene-image-slot'); if(!txtEl||!slot) return;
  btn.disabled=true; btn.classList.add('loading');
  let shimmer=document.createElement('div'); shimmer.className='scene-image-loading'; box.insertBefore(shimmer, txtEl);
  try{
    let sceneMemo=[]; try{ sceneMemo=load('sw:scene_memo',[]);}catch{}; const scene=(Array.isArray(sceneMemo)&&sceneMemo.length)?{memo:sceneMemo.slice(-6)}:null;
    const headers={'Content-Type':'application/json'}; if (AUTH?.token) headers.Authorization=`Bearer ${AUTH.token}`;
    const text=getMasterTextFromBox(box);
    const rStart=await fetch(joinUrl(API_BASE,'/scene-image/start'),{ method:'POST', headers, body:JSON.stringify({ masterText:(text||'').trim(), scene }) });
    if (!rStart.ok){ const t=await rStart.text().catch(()=> ''); console.error('[IMG] start failed:', rStart.status, t); shimmer.remove(); const err=document.createElement('div'); err.className='scene-image-error'; err.textContent='No se pudo iniciar la generación.'; box.insertBefore(err, txtEl); setTimeout(()=>err.remove(),4000); return; }
    const { jobId } = await rStart.json(); let tries=0; const maxTries=120; const intervalMs=2000;
    await new Promise((resolve)=>{
      const iv=setInterval(async()=>{
        tries++;
        try{
          const url=new URL(joinUrl(API_BASE,'/scene-image/status')); url.searchParams.set('jobId', jobId);
          const rs=await fetch(url,{headers}); if(!rs.ok) throw new Error('status_http_'+rs.status);
          const st=await rs.json();
          if (st.status==='done' && st.dataUrl){ try{ shimmer.remove(); }catch{} injectSceneImage(slot, st.dataUrl); clearInterval(iv); resolve(); }
          else if (st.status==='error'){ try{ shimmer.remove(); }catch{} const err=document.createElement('div'); err.className='scene-image-error'; err.textContent='No se pudo generar la imagen.'; box.insertBefore(err, txtEl); setTimeout(()=>err.remove(),4000); clearInterval(iv); resolve(); }
        }catch(e){ console.warn('[IMG] status poll error:', e.message); }
        if (tries>=maxTries){ try{ shimmer.remove(); }catch{} const err=document.createElement('div'); err.className='scene-image-error'; err.textContent='La generación tardó demasiado.'; box.insertBefore(err, txtEl); setTimeout(()=>err.remove(),4000); clearInterval(iv); resolve(); }
      }, intervalMs);
    });
  }catch(e){
    try{ shimmer.remove(); }catch{} const err=document.createElement('div'); err.className='scene-image-error'; err.textContent='No se pudo generar la imagen.'; box.insertBefore(err, txtEl); setTimeout(()=>err.remove(),4000);
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
  img.onerror=()=>{ console.error('[IMG] image load error'); if(src&&src.startsWith('data:image/')&&!String(finalSrc).startsWith('blob:')){ const blobUrl=dataUrlToBlobUrl(src); if (blobUrl){ img.src=blobUrl; return; } } slot.hidden=true; slot.innerHTML=''; };
  img.src=finalSrc;
}

document.addEventListener('click', (ev)=>{ const btn=ev.target.closest('.brush-btn'); if (btn) handleBrushClick(btn); });
