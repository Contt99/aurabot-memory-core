import {randomUUID} from 'node:crypto'
import {safeValue} from './policy.mjs'

const snapshotLimit=256
const sessionKey=s=>String(s||'').replace(/^session-/,'')
const aliases=id=>[id,...(String(id).includes('@')?[id.split('@')[0],id.split('@')[0].replace(/^(memory|impression):/,'')]:[])]
const matches=(s,set)=>aliases(s).some(a=>set.has(a))
const parse=r=>r&&({...r,data:JSON.parse(r.data)})
export function createMemoryStore(db) {
 db.exec(`CREATE TABLE IF NOT EXISTS memory_events(id TEXT PRIMARY KEY,nativeKey TEXT UNIQUE,type TEXT NOT NULL,chatId TEXT NOT NULL,occurredAt INTEGER,observedAt INTEGER,recordedAt INTEGER NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,invalidatedAt INTEGER NOT NULL DEFAULT 0);
 CREATE INDEX IF NOT EXISTS memory_events_chat ON memory_events(chatId,occurredAt);
 CREATE TABLE IF NOT EXISTS memory_snapshots(id TEXT PRIMARY KEY,chatId TEXT NOT NULL,purpose TEXT NOT NULL,sessionId TEXT NOT NULL,createdAt INTEGER NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,invalidatedAt INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS memory_handoffs(eventId TEXT NOT NULL,chatId TEXT NOT NULL,sessionId TEXT NOT NULL DEFAULT '',snapshotId TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,observedAt INTEGER,PRIMARY KEY(eventId,chatId,sessionId));
 CREATE INDEX IF NOT EXISTS memory_handoffs_chat ON memory_handoffs(chatId,sessionId,status);
 CREATE TABLE IF NOT EXISTS memory_corrections(id TEXT PRIMARY KEY,targetId TEXT NOT NULL,at INTEGER NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS memory_retired(sourceId TEXT PRIMARY KEY,reason TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS memory_seen_scopes(sourceId TEXT NOT NULL,chatId TEXT NOT NULL,PRIMARY KEY(sourceId,chatId));`)
 const event=id=>parse(db.prepare('SELECT * FROM memory_events WHERE id=?').get(id))
 const retired=db.prepare('SELECT reason FROM memory_retired WHERE sourceId=?')
 const reason=id=>aliases(id).map(a=>retired.get(a)?.reason).find(Boolean)
 const retire=db.prepare("INSERT INTO memory_retired VALUES(?,?) ON CONFLICT(sourceId) DO UPDATE SET reason=excluded.reason WHERE excluded.reason='forgotten'")
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}
 const liveSinceKey='memory-handoff-live-since'
 let liveSince=JSON.parse(db.prepare('SELECT value FROM kv WHERE key=?').get(liveSinceKey)?.value||'0')
 if(!liveSince)transaction(()=>{
  liveSince=db.prepare('SELECT MIN(recordedAt) AS at FROM memory_events').get().at||Date.now()
  // v1 queued the entire vault during its initial indexing. Keep the events and
  // seen scope lineage; drop only the obsolete queue entries, not their sources.
  db.prepare(`DELETE FROM memory_handoffs WHERE sessionId='' AND status='pending' AND eventId IN (
   SELECT id FROM memory_events WHERE type='utterance' AND COALESCE(occurredAt,0)<?
   AND COALESCE(json_extract(data,'$.origin'),'')!='onebot')`).run(liveSince)
  db.prepare('INSERT INTO kv(key,value) VALUES(?,?)').run(liveSinceKey,JSON.stringify(liveSince))
 })
 const corrections=id=>db.prepare('SELECT * FROM memory_corrections WHERE targetId=? ORDER BY at DESC,rowid DESC').all(id).map(parse)
 function putEvent(row) {
  const old=event(row.id);if(old?.invalidatedAt)return old
  const data={...old?.data,...safeValue(row.data||{})}
  data.sourceIds=[...new Set([...(old?.data.sourceIds||[]),...(data.sourceIds||[])])]
  const corrected=old?.status==='corrected'
  if([row.id,...data.sourceIds].some(id=>{const r=reason(id);return r&&(r==='forgotten'||!corrected)}))return {id:row.id,invalidatedAt:1,data:{}}
  if(corrected&&data.vaultId&&!old.data.vaultId)retire.run(data.vaultId,'corrected')
  const handoff=row.type==='utterance'&&!corrected&&(row.data?.origin==='onebot'||Number(row.occurredAt)>=liveSince)
  const enqueue=()=>db.prepare("INSERT OR IGNORE INTO memory_handoffs(eventId,chatId,status) VALUES(?,?,'pending')").run(row.id,row.chatId)
  // A late duplicate receipt must not replace the authority's timestamp or excerpt.
  if(old?.data.vaultId&&row.data?.origin==='onebot'){if(handoff)enqueue();return old}
  db.prepare(`INSERT INTO memory_events(id,nativeKey,type,chatId,occurredAt,observedAt,recordedAt,status,data) VALUES(?,?,?,?,?,?,?,?,?)
   ON CONFLICT(id) DO UPDATE SET data=excluded.data,status=excluded.status,occurredAt=excluded.occurredAt`).run(row.id,row.nativeKey||null,row.type,row.chatId||'',row.occurredAt||null,row.observedAt||null,old?.recordedAt||Date.now(),corrected?'corrected':row.status||'observed',JSON.stringify(data))
  if(handoff)enqueue()
  return event(row.id)
 }
 const pending=(chatId,sessionId,limit=12)=>db.prepare(`SELECT e.* FROM memory_handoffs h JOIN memory_events e ON h.eventId=e.id
  WHERE h.chatId=? AND h.sessionId='' AND h.status='pending' AND e.invalidatedAt=0 AND NOT EXISTS
  (SELECT 1 FROM memory_handoffs x WHERE x.eventId=h.eventId AND x.chatId=h.chatId AND x.sessionId=? AND x.status='observed')
  ORDER BY e.occurredAt DESC,e.rowid DESC LIMIT ?`).all(chatId,sessionKey(sessionId),limit).map(parse)
 const snapshot=id=>parse(db.prepare('SELECT * FROM memory_snapshots WHERE id=?').get(String(id)))
 function prepare(data) {
  const id=randomUUID(),createdAt=Number(data.createdAt)||Date.now()
  const value={...safeValue(data),id,createdAt,text:String(data.text||'').replaceAll('@@SNAPSHOT@@',id)}
  transaction(()=>{
   db.prepare("INSERT INTO memory_snapshots VALUES(?,?,?,?,?,'prepared',?,0)").run(id,value.chatId,value.purpose,value.sessionId||'',createdAt,JSON.stringify(value))
   db.prepare('DELETE FROM memory_snapshots WHERE rowid<=(SELECT rowid FROM memory_snapshots ORDER BY rowid DESC LIMIT 1 OFFSET ?)').run(snapshotLimit)
  })
  return value
 }
 function observed(id,sessionId,at,visibleIds,{chatScope='',handoff=false}={}) {
  const s=snapshot(id);if(!s||s.invalidatedAt)return false
  return transaction(()=>{
   const ids=new Set(visibleIds),data=s.data
   data.requestStatus='started';data.observedSourceIds=[...new Set([...(data.observedSourceIds||[]),...ids])]
   db.prepare("UPDATE memory_snapshots SET status='observed',sessionId=CASE WHEN sessionId='' THEN ? ELSE sessionId END,data=? WHERE id=?").run(sessionId,JSON.stringify(data),id)
   for(const item of data.items||[]) {
    if(!ids.has(item.id))continue
    const e=event(item.eventId||item.id)
    if(chatScope)for(const source of new Set([item.id,item.eventId,...item.providerIds||[],...item.correctionSources||[],...item.mediaSourceIds||[]].filter(Boolean)))
     db.prepare('INSERT OR IGNORE INTO memory_seen_scopes VALUES(?,?)').run(source,chatScope)
    if(!e||e.invalidatedAt)continue
    db.prepare('UPDATE memory_events SET observedAt=COALESCE(observedAt,?) WHERE id=?').run(at,e.id)
    if(handoff&&e.type==='utterance'&&e.chatId===chatScope&&sessionId&&db.prepare("SELECT 1 FROM memory_handoffs WHERE eventId=? AND chatId=? AND sessionId=''").get(e.id,e.chatId))
     db.prepare("INSERT INTO memory_handoffs VALUES(?,?,?,?,'observed',?) ON CONFLICT(eventId,chatId,sessionId) DO UPDATE SET snapshotId=excluded.snapshotId,status='observed',observedAt=excluded.observedAt").run(e.id,e.chatId,sessionKey(sessionId),id,at)
   }
   return true
  })
 }
 const finishRequest=(ids,status)=>{const update=db.prepare("UPDATE memory_snapshots SET data=json_set(data,'$.requestStatus',?) WHERE id=? AND invalidatedAt=0");for(const id of ids)update.run(status,id)}
 const allEvents=({chatId='',limit=100,type=''}={})=>db.prepare(`SELECT * FROM memory_events WHERE invalidatedAt=0 ${chatId?'AND chatId=?':''} ${type?'AND type=?':''} ORDER BY COALESCE(occurredAt,recordedAt) DESC,rowid DESC LIMIT ?`).all(...(chatId?[chatId]:[]),...(type?[type]:[]),Math.min(500,Math.max(1,Number(limit)||100))).map(parse)
 function invalidateViews(ids) {
  const affected=new Set()
  for(const r of db.prepare('SELECT * FROM memory_snapshots WHERE invalidatedAt=0').all().map(parse)) {
   if([...(r.data.sourceIds||[]),...(r.data.items||[]).map(i=>i.eventId).filter(Boolean)].some(s=>matches(s,ids))) {
    db.prepare("UPDATE memory_snapshots SET invalidatedAt=?,status='invalidated',data='{}' WHERE id=?").run(Date.now(),r.id);affected.add(r.chatId)
   }
  }
  for(const row of db.prepare('SELECT * FROM memory_seen_scopes').all())if(matches(row.sourceId,ids)){
   affected.add(row.chatId);db.prepare('DELETE FROM memory_seen_scopes WHERE sourceId=? AND chatId=?').run(row.sourceId,row.chatId)
  }
  return affected
 }
 function retireDerived(ids,mode,keep='') {
  const rows=db.prepare('SELECT * FROM memory_events WHERE invalidatedAt=0').all().map(parse),affected=new Set()
  let changed=true
  while(changed){changed=false
   for(const r of rows){
    if(r.invalidatedAt||r.id===keep)continue
    if(matches(r.id,ids)||(r.data.sourceIds||[]).some(x=>matches(x,ids))){
     ids.add(r.id);r.invalidatedAt=Date.now();affected.add(r.chatId);changed=true
     if(r.data.vaultId)ids.add(r.data.vaultId)
     db.prepare("UPDATE memory_events SET invalidatedAt=?,data='{}',status=? WHERE id=?").run(r.invalidatedAt,mode,r.id)
     db.prepare('DELETE FROM memory_handoffs WHERE eventId=?').run(r.id)
    }
   }
  }
  for(const id of ids)retire.run(id,mode)
  for(const chat of invalidateViews(ids))affected.add(chat)
  return [...affected].filter(Boolean)
 }
 function invalidate(sourceIds,{chatId='',query=''}={}) {
  const ids=new Set(sourceIds),q=String(query).toLowerCase()
  return transaction(()=>{
   if(chatId&&q)for(const r of db.prepare('SELECT * FROM memory_events WHERE chatId=? AND invalidatedAt=0').all(chatId).map(parse))if(JSON.stringify(r.data).toLowerCase().includes(q))ids.add(r.id)
   for(const r of db.prepare('SELECT * FROM memory_corrections').all().map(parse)){
    if(matches(r.targetId,ids)||event(r.targetId)?.data.sourceIds?.some(s=>matches(s,ids)))
     db.prepare('DELETE FROM memory_corrections WHERE id=?').run(r.id)
    else if((r.data.sourceIds||[]).some(s=>matches(s,ids)))
     db.prepare("UPDATE memory_corrections SET data='{}' WHERE id=?").run(r.id)
   }
   return retireDerived(ids,'forgotten')
  })
 }
 function correct(target,data) {
  const old=event(target);if(!old||old.invalidatedAt)throw Error('纠正目标不存在或已忘记')
  if(data.sourceIds.some(id=>reason(id)))throw Error('纠正证据已失效')
  const id=randomUUID()
  return transaction(()=>{
   db.prepare('INSERT INTO memory_corrections VALUES(?,?,?,?)').run(id,target,Date.now(),JSON.stringify(safeValue(data)))
   db.prepare("UPDATE memory_events SET status='corrected' WHERE id=?").run(target)
   const affected=retireDerived(new Set([target,old.data.vaultId].filter(Boolean)),'corrected',target)
   return{id,targetId:target,...data,affected}
  })
 }
 const status=()=>({events:db.prepare('SELECT COUNT(*) n FROM memory_events WHERE invalidatedAt=0').get().n,pendingHandoffs:db.prepare("SELECT COUNT(*) n FROM memory_handoffs h WHERE h.status='pending' AND NOT EXISTS(SELECT 1 FROM memory_handoffs x WHERE x.eventId=h.eventId AND x.status='observed')").get().n,snapshotLimit,
  snapshots:db.prepare('SELECT id,chatId,purpose,sessionId,createdAt,status,invalidatedAt FROM memory_snapshots ORDER BY createdAt DESC,rowid DESC LIMIT 40').all(),corrections:db.prepare('SELECT id,targetId,at FROM memory_corrections ORDER BY at DESC LIMIT 40').all()})
 return{event,reason,pending,putEvent,prepare,snapshot,observed,finishRequest,allEvents,invalidate,correct,corrections,status}
}
