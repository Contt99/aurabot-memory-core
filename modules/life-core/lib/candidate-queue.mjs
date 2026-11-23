import {randomUUID} from 'node:crypto'

export const nativeAck=id=>/^-?[1-9]\d{0,19}$/.test(String(id??''))

export function createCandidateQueue(db,now){
 db.exec(`CREATE TABLE IF NOT EXISTS life_candidates(
  id TEXT PRIMARY KEY,module TEXT NOT NULL,job TEXT NOT NULL,jobKey TEXT NOT NULL,target TEXT NOT NULL,
  sourceIds TEXT NOT NULL,createdAt INTEGER NOT NULL,expiresAt INTEGER NOT NULL,updatedAt INTEGER NOT NULL,
  status TEXT NOT NULL,receipt TEXT,reason TEXT,UNIQUE(module,job,jobKey,target));
  CREATE INDEX IF NOT EXISTS life_candidates_status ON life_candidates(status,createdAt);
  CREATE INDEX IF NOT EXISTS life_candidates_receipt ON life_candidates(target,receipt) WHERE receipt IS NOT NULL;
  CREATE INDEX IF NOT EXISTS life_candidates_ack ON life_candidates(module,job,target,status,updatedAt);`)
 db.prepare("UPDATE life_candidates SET status=CASE WHEN status='sending' THEN 'unknown' ELSE 'interrupted' END,updatedAt=?,reason='restarted' WHERE status IN ('running','sending')").run(now())
 const parse=r=>r?{...r,sourceIds:JSON.parse(r.sourceIds)}:null
 const get=id=>parse(db.prepare('SELECT * FROM life_candidates WHERE id=?').get(id))
 const byKey=({module,job,key,target})=>parse(db.prepare('SELECT * FROM life_candidates WHERE module=? AND job=? AND jobKey=? AND target=?').get(module,job,key,target))
 const pending=({module,job,target})=>parse(db.prepare("SELECT * FROM life_candidates WHERE module=? AND job=? AND target=? AND status IN ('queued','running','sending') AND expiresAt>? ORDER BY createdAt LIMIT 1").get(module,job,target,now()))
 const update=(id,from,to,reason=null)=>db.prepare('UPDATE life_candidates SET status=?,updatedAt=?,reason=? WHERE id=? AND status=?').run(to,now(),reason,id,from).changes===1
 function submit(spec){
  const before=byKey(spec)
  if(before)return before
  const id=randomUUID(),at=now()
  db.prepare("INSERT INTO life_candidates VALUES(?,?,?,?,?,?,?,?,?,'queued',NULL,NULL)")
   .run(id,spec.module,spec.job,spec.key,spec.target,JSON.stringify([...new Set(spec.sourceIds)]),at,spec.expiresAt,at)
  return get(id)
 }
 function ready(){
  const at=now()
  db.prepare("UPDATE life_candidates SET status='expired',updatedAt=?,reason='expired' WHERE status='queued' AND expiresAt<=?").run(at,at)
  return db.prepare("SELECT * FROM life_candidates WHERE status='queued' ORDER BY createdAt,rowid LIMIT 20").all().map(parse)
 }
 function claim(id){
  const at=now()
  return db.prepare("UPDATE life_candidates SET status='running',updatedAt=? WHERE id=? AND status='queued' AND expiresAt>?").run(at,id,at).changes===1
 }
 function sending(id){
  const at=now()
  return db.prepare("UPDATE life_candidates SET status='sending',updatedAt=? WHERE id=? AND status='running' AND expiresAt>?").run(at,id,at).changes===1
 }
 function ack(id,target,receipt){
  return nativeAck(receipt)&&confirm(id,target,'sent',receipt)
 }
 function confirm(id,target,status,receipt){
  return db.prepare(`UPDATE life_candidates SET status=?,receipt=?,updatedAt=?,reason=NULL
   WHERE id=? AND target=? AND status='sending' AND NOT EXISTS(SELECT 1 FROM life_candidates WHERE target=? AND receipt=?)`)
   .run(status,String(receipt),now(),id,target,target,String(receipt)).changes===1
 }
 function forget(ids){
  if(!ids.size)return
  const candidates=db.prepare('SELECT id,status,sourceIds FROM life_candidates WHERE sourceIds<>\'[]\'').iterate()
  const touched=[]
  for(const c of candidates)if(JSON.parse(c.sourceIds).some(id=>ids.has(id)))touched.push(c.id)
  const clear=db.prepare("UPDATE life_candidates SET sourceIds='[]',receipt=CASE WHEN status='saved' THEN NULL ELSE receipt END,status=CASE WHEN status IN ('queued','running') THEN 'cancelled' ELSE status END,reason=CASE WHEN status IN ('queued','running','saved') THEN 'forgotten' ELSE reason END,updatedAt=CASE WHEN status IN ('queued','running') THEN ? ELSE updatedAt END WHERE id=?")
  for(const id of touched)clear.run(now(),id)
 }
 return {get,byKey,pending,submit,ready,claim,sending,ack,confirm,forget,
  bindSources:(id,sourceIds)=>db.prepare("UPDATE life_candidates SET sourceIds=? WHERE id=? AND status='running'").run(JSON.stringify([...new Set(sourceIds)]),id).changes===1,
  cancel:(id,reason)=>update(id,'queued','cancelled',reason)||update(id,'running','cancelled',reason),
  finish:(id,status,reason)=>status==='unknown'?update(id,'sending',status,reason):update(id,'running',status,reason)||(status==='not-sent'&&update(id,'sending',status,reason)),
  count:({module,job,target,from})=>db.prepare("SELECT COUNT(*) n FROM life_candidates WHERE module=? AND job=? AND target=? AND status='sent' AND updatedAt>=?")
   .get(module,job,target,from).n,
  latestSentAt:(module,target)=>db.prepare("SELECT MAX(updatedAt) n FROM life_candidates WHERE module=? AND target=? AND status='sent'").get(module,target).n||0,
  recent:()=>db.prepare('SELECT * FROM life_candidates ORDER BY createdAt DESC,rowid DESC LIMIT 30').all().map(parse)}
}
