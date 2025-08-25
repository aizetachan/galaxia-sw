// server/world.js
import { Router } from 'express';
import { q } from './db.js';

const router = Router();

function ensureInt(v, fallback = null) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function pick(obj, keys){ const out={}; for(const k of keys) if(k in obj) out[k]=obj[k]; return out; }
function rollFormula(formula){ const m=String(formula).trim().match(/^(\d+)d(\d+)([+-]\d+)?$/i); if(!m) throw new Error('Fórmula inválida, usa p.ej. "2d6+1"');
  const [,nStr,fStr,modStr]=m; const n=parseInt(nStr,10); const f=parseInt(fStr,10); const mod=modStr?parseInt(modStr,10):0;
  const dice=Array.from({length:n},()=>1+Math.floor(Math.random()*f)); const total=dice.reduce((a,b)=>a+b,0)+mod; return {dice,mod,faces:f,nDice:n,total}; }
function outcomeFromDC(total,dc){ if(dc==null) return null; if(total>=dc+3) return 'success'; if(total>=dc) return 'mixed'; return 'fail'; }
function applyStatePatch(current,patch){ const out={...current};
  if(patch?.attrs){ out.attrs={...(current.attrs||{})};
    for(const [k,v] of Object.entries(patch.attrs)){ if(v&&typeof v==='object'&&'delta'in v){ const from=Number(out.attrs?.[k]??0); out.attrs[k]=from+Number(v.delta||0);} else out.attrs[k]=v; } }
  if(patch?.inventory){ const cur=Array.isArray(current.inventory)?[...current.inventory]:[];
    for(const it of patch.inventory){ const {op,id,qty=1}=it||{}; if(!id||!op) continue; const idx=cur.findIndex(x=>x.id===id);
      if(op==='add'){ if(idx>=0) cur[idx]={...cur[idx],qty:(cur[idx].qty||0)+qty}; else cur.push({id,qty}); }
      else if(op==='remove'&&idx>=0){ const newQty=(cur[idx].qty||0)-qty; if(newQty>0) cur[idx]={...cur[idx],qty:newQty}; else cur.splice(idx,1); } }
    out.inventory=cur; }
  if(patch?.tags){ const cur=new Set(Array.isArray(current.tags)?current.tags:[]); const adds=patch.tags?.add||[]; const rems=patch.tags?.remove||[];
    adds.forEach(t=>cur.add(t)); rems.forEach(t=>cur.delete(t)); out.tags=[...cur]; }
  return out; }

/* ---- Contexto ---- */
router.get('/world/context', async (req,res)=>{ try{
  const characterId=ensureInt(req.query.character_id); const limit=Math.min(ensureInt(req.query.limit,20)||20,100);
  if(!characterId) return res.status(400).json({ ok:false, error:'character_id requerido' });

  const { rows:charRows }=await q(
   `SELECT c.*, cs.attrs, cs.inventory, cs.tags FROM characters c
     LEFT JOIN character_state cs ON cs.character_id=c.id WHERE c.id=$1`,[characterId]);
  if(!charRows.length) return res.status(404).json({ ok:false, error:'Personaje no encontrado' });
  const character=charRows[0];

  const { rows:nearby }=await q(
   `SELECT e.* FROM events e WHERE e.visibility='public' AND e.location IS NOT NULL AND e.location=$1
     ORDER BY e.ts DESC LIMIT $2`,[character.last_location||null, limit]);

  const { rows:facEvents }=await q(
   `SELECT e.* FROM faction_memberships fm
     JOIN events e ON e.visibility='faction' AND e.faction_id=fm.faction_id
     WHERE fm.character_id=$1 ORDER BY e.ts DESC LIMIT $2`,[characterId,limit]);

  const { rows:targeted }=await q(
   `SELECT e.* FROM event_targets t JOIN events e ON e.id=t.event_id
     WHERE t.target_character_id=$1 ORDER BY e.ts DESC LIMIT $2`,[characterId,limit]);

  const { rows:myActs }=await q(
   `SELECT e.* FROM events e WHERE e.actor_character_id=$1 ORDER BY e.ts DESC LIMIT $2`,[characterId,Math.min(limit,10)]);

  const { rows:unreadRows }=await q(
   `SELECT COUNT(*)::int AS c FROM (
      SELECT e.id FROM event_targets t JOIN events e ON e.id=t.event_id WHERE t.target_character_id=$1
      UNION
      SELECT e.id FROM faction_memberships fm JOIN events e ON e.visibility='faction' AND e.faction_id=fm.faction_id WHERE fm.character_id=$1
      UNION
      SELECT e.id FROM events e JOIN characters c ON c.id=$1 WHERE e.visibility='public' AND e.location=c.last_location
    ) x LEFT JOIN event_reads r ON r.event_id=x.id AND r.character_id=$1 WHERE r.event_id IS NULL`,[characterId]);

  res.json({ ok:true, character, nearby_events:nearby, faction_events:facEvents, targeted_events:targeted, recent_actor_events:myActs, unread_count:unreadRows?.[0]?.c??0 });
}catch(e){ res.status(500).json({ ok:false, error:e.message }); }});

/* ---- Inbox ---- */
router.get('/world/inbox', async (req,res)=>{ try{
  const characterId=ensureInt(req.query.character_id); const limit=Math.min(ensureInt(req.query.limit,50)||50,200);
  if(!characterId) return res.status(400).json({ ok:false, error:'character_id requerido' });
  const { rows }=await q(
   `SELECT e.* FROM (
      SELECT e.id FROM event_targets t JOIN events e ON e.id=t.event_id WHERE t.target_character_id=$1
      UNION
      SELECT e.id FROM faction_memberships fm JOIN events e ON e.visibility='faction' AND e.faction_id=fm.faction_id WHERE fm.character_id=$1
      UNION
      SELECT e.id FROM events e JOIN characters c ON c.id=$1 WHERE e.visibility='public' AND e.location=c.last_location
    ) x LEFT JOIN event_reads r ON r.event_id=x.id AND r.character_id=$1
    JOIN events e ON e.id=x.id WHERE r.event_id IS NULL ORDER BY e.ts DESC LIMIT $2`,[characterId,limit]);
  res.json({ ok:true, events:rows });
}catch(e){ res.status(500).json({ ok:false, error:e.message }); }});

router.post('/events/read', async (req,res)=>{ try{
  const cid=ensureInt(req.body?.character_id); const eid=ensureInt(req.body?.event_id);
  if(!cid||!eid) return res.status(400).json({ ok:false, error:'character_id y event_id requeridos' });
  await q(`INSERT INTO event_reads(character_id,event_id,read_at) VALUES ($1,$2,now())
           ON CONFLICT (character_id,event_id) DO NOTHING`,[cid,eid]);
  res.json({ ok:true });
}catch(e){ res.status(500).json({ ok:false, error:e.message }); }});

/* ---- State ---- */
router.get('/characters/:id/state', async (req,res)=>{ try{
  const id=ensureInt(req.params.id);
  const { rows }=await q(`SELECT c.*,cs.attrs,cs.inventory,cs.tags FROM characters c
                          LEFT JOIN character_state cs ON cs.character_id=c.id WHERE c.id=$1`,[id]);
  if(!rows.length) return res.status(404).json({ ok:false, error:'Personaje no encontrado' });
  res.json({ ok:true, character:rows[0] });
}catch(e){ res.status(500).json({ ok:false, error:e.message }); }});

router.patch('/characters/:id/state', async (req,res)=>{ try{
  const id=ensureInt(req.params.id); const { patch={}, note=null, event_id=null }=req.body||{};
  const { rows:curRows }=await q(`SELECT COALESCE(cs.attrs,'{}'::jsonb) AS attrs,
                                         COALESCE(cs.inventory,'[]'::jsonb) AS inventory,
                                         COALESCE(cs.tags,'{}'::text[]) AS tags
                                  FROM character_state cs WHERE cs.character_id=$1`,[id]);
  const current=curRows[0]||{attrs:{},inventory:[],tags:[]};
  const merged=applyStatePatch(current,patch);
  await q(`INSERT INTO character_state(character_id,attrs,inventory,tags,updated_at)
           VALUES ($1,$2::jsonb,$3::jsonb,$4::text[],now())
           ON CONFLICT (character_id) DO UPDATE SET
             attrs=EXCLUDED.attrs, inventory=EXCLUDED.inventory, tags=EXCLUDED.tags, updated_at=now()`,
           [id, JSON.stringify(merged.attrs||{}), JSON.stringify(merged.inventory||[]), merged.tags||[]]);
  await q(`INSERT INTO character_state_history(character_id,event_id,patch,note)
           VALUES ($1,$2,$3::jsonb,$4)`,[id,event_id,JSON.stringify(patch||{}),note]);
  res.json({ ok:true, state:merged });
}catch(e){ res.status(500).json({ ok:false, error:e.message }); }});

/* ---- Tiradas & Eventos ---- */
router.post('/rolls', async (req,res)=>{ try{
  const { character_id, user_id, skill=null, formula, target_dc=null }=req.body||{};
  const cid=ensureInt(character_id); const uid=ensureInt(user_id); if(!cid||!formula) return res.status(400).json({ ok:false, error:'character_id y formula requeridos' });
  const detail=rollFormula(formula); const outcome=outcomeFromDC(detail.total, ensureInt(target_dc));
  const { rows }=await q(`INSERT INTO dice_rolls(character_id,user_id,skill,formula,target_dc,roll_detail,outcome)
                          VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *`,
                         [cid,uid,skill,formula,ensureInt(target_dc),JSON.stringify(detail),outcome]);
  res.json({ ok:true, roll:rows[0] });
}catch(e){ res.status(500).json({ ok:false, error:e.message }); }});

router.post('/events', async (req,res)=>{ try{
  const b=req.body||{}; const allowed=pick(b,['summary','kind','visibility','location','actor_character_id','payload','faction_id']);
  if(!allowed.summary) return res.status(400).json({ ok:false, error:'summary requerido' });
  if(!allowed.visibility) allowed.visibility='public';
  const payload=allowed.payload?JSON.stringify(allowed.payload):null;
  const { rows:evRows }=await q(`INSERT INTO events(ts,actor,location,summary,visibility,user_id,actor_character_id,kind,payload,faction_id)
                                 VALUES (now(),COALESCE($1,'system'),$2,$3,$4,NULL,$5,$6,$7::jsonb,$8)
                                 RETURNING *`,
                                 [b.actor||null, allowed.location||null, allowed.summary, allowed.visibility,
                                  ensureInt(allowed.actor_character_id), allowed.kind||null, payload, ensureInt(allowed.faction_id)]);
  const event=evRows[0];
  const targets=Array.isArray(b.targets)?b.targets.map(ensureInt).filter(Boolean):[];
  if(targets.length){ const values=targets.map((t,i)=>`($1,$${i+2})`).join(','); await q(`INSERT INTO event_targets(event_id,target_character_id) VALUES ${values} ON CONFLICT DO NOTHING`,[event.id,...targets]); }
  res.json({ ok:true, event, targets });
}catch(e){ res.status(500).json({ ok:false, error:e.message }); }});

/* ---- Timeline ---- */
router.get('/characters/:id/timeline', async (req,res)=>{ try{
  const id=ensureInt(req.params.id); const limit=Math.min(ensureInt(req.query.limit,100)||100,300);
  const [a,b,c,d]=await Promise.all([
    q(`SELECT e.*, 'event_actor' AS kind FROM events e WHERE e.actor_character_id=$1 ORDER BY e.ts DESC LIMIT $2`,[id,limit]),
    q(`SELECT e.*, 'event_target' AS kind FROM event_targets t JOIN events e ON e.id=t.event_id WHERE t.target_character_id=$1 ORDER BY e.ts DESC LIMIT $2`,[id,limit]),
    q(`SELECT h.*, 'state_change' AS kind FROM character_state_history h WHERE h.character_id=$1 ORDER BY h.ts DESC LIMIT $2`,[id,limit]),
    q(`SELECT r.*, 'roll' AS kind FROM dice_rolls r WHERE r.character_id=$1 ORDER BY r.ts DESC LIMIT $2`,[id,limit]),
  ]);
  const merged=[...a.rows.map(x=>({...x,ts:x.ts||x.created_at})), ...b.rows.map(x=>({...x,ts:x.ts||x.created_at})), ...c.rows, ...d.rows]
               .sort((x,y)=>new Date(y.ts)-new Date(x.ts)).slice(0,limit);
  res.json({ ok:true, items:merged });
}catch(e){ res.status(500).json({ ok:false, error:e.message }); }});

export default router;
