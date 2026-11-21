import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { safeValue } from './policy.mjs'
const outcomes = {
  simulated: new Set(['dry-run','simulated','preview']),
  interrupted: new Set(['interrupted','cancelled','canceled','aborted']),
  failed: new Set(['failure','failed','error','blocked','muted','disabled']),
  deferred: new Set(['accepted','waiting','busy','queued','pending','running','deferred','unavailable','skipped','sent-unconfirmed','unknown','unconfirmed']),
}
export function outcomeStatus(r) {
  const codes = [r?.status,r?.outcome]
  if (r?.dryRun || r?.simulated || r?.dry || codes.some(c => outcomes.simulated.has(c))) return 'simulated'
  for (const state of ['interrupted','failed','deferred']) if(codes.some(c => outcomes[state].has(c))) return state
  if (r == null || r?.ok === false || r?.isError) return 'failed'
  if (typeof r?.outcome === 'string' && !['sent','completed','success','succeeded'].includes(r.outcome)) return /fail|error/.test(r.outcome)?'failed':'deferred'
  return 'succeeded'
}
export function createLedger(file) {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2000; CREATE TABLE IF NOT EXISTS actions(id TEXT PRIMARY KEY,callKey TEXT UNIQUE,at INTEGER NOT NULL,updatedAt INTEGER NOT NULL,status TEXT NOT NULL,meta TEXT NOT NULL,result TEXT,deletedAt INTEGER NOT NULL DEFAULT 0); CREATE INDEX IF NOT EXISTS actions_at ON actions(at); CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL);')
  db.exec(`CREATE TABLE IF NOT EXISTS action_changes(seq INTEGER PRIMARY KEY AUTOINCREMENT,actionId TEXT NOT NULL);
   CREATE TRIGGER IF NOT EXISTS memory_action_insert AFTER INSERT ON actions BEGIN INSERT INTO action_changes(actionId) VALUES(new.id); END;
   CREATE TRIGGER IF NOT EXISTS memory_action_update AFTER UPDATE ON actions BEGIN INSERT INTO action_changes(actionId) VALUES(new.id); END;`)
  if(!db.prepare("SELECT 1 FROM kv WHERE key='memory-action-feed-v1'").get()) {
   db.exec('BEGIN IMMEDIATE')
   try {
    db.exec('INSERT INTO action_changes(actionId) SELECT id FROM actions ORDER BY rowid')
    db.prepare("INSERT INTO kv(key,value) VALUES('memory-action-feed-v1','true')").run()
    db.exec('COMMIT')
   }catch(e){db.exec('ROLLBACK');throw e}
  }
  db.prepare("UPDATE actions SET status='interrupted',updatedAt=? WHERE status='running'").run(Date.now())
  const parse = r => r && ({...r,meta:JSON.parse(r.meta),result:r.result ? JSON.parse(r.result) : null})
  const get = id => parse(db.prepare('SELECT * FROM actions WHERE id=?').get(id))
  const byKey = key => key ? parse(db.prepare('SELECT * FROM actions WHERE callKey=?').get(key)) : null
  function start(meta) {
    const key = meta.callId ? String(meta.module || '') + ':' + meta.callId : null
    const old = byKey(key)
    if (old) return old
    const id=randomUUID(),now=Date.now()
    db.prepare('INSERT INTO actions(id,callKey,at,updatedAt,status,meta) VALUES(?,?,?,?,?,?)').run(id,key,now,now,'running',JSON.stringify(safeValue(meta)))
    return get(id)
  }
  function finish(id, status, value, meta) {
    const before=get(id),m=meta||before?.meta||{}
    const forgotten=JSON.parse(db.prepare("SELECT value FROM kv WHERE key='forget-tombstones'").get()?.value||'[]').some(t=>
      (m.sourceIds||[]).some(s=>(t.sourceIds||[]).includes(s)) ||
      (t.pendingIds||[]).includes(id)&&t.query&&JSON.stringify({meta:m,result:value}).toLowerCase().includes(t.query.toLowerCase()))
    if(forgotten){db.prepare("UPDATE actions SET status='interrupted',deletedAt=?,result=NULL,meta='{}' WHERE id=?").run(Date.now(),id);return get(id)}
    db.prepare('UPDATE actions SET status=?,updatedAt=?,result=?,meta=COALESCE(?,meta) WHERE id=? AND deletedAt=0').run(status,Date.now(),JSON.stringify(safeValue(value??null)),meta ? JSON.stringify(safeValue(meta)) : null,id)
    return get(id)
  }
  async function perform(meta, run) {
    const old = meta.callId && byKey(String(meta.module || '') + ':' + meta.callId)
    if (old) return old.status==='succeeded' || old.status==='failed' || old.status==='simulated' ? old.result : {ok:false,status:old.status,message:'同一行动已记录，未重复执行'}
    const row = start(meta)
    try { const r=await run();finish(row.id,outcomeStatus(r),r,meta);return r }
    catch(error) { finish(row.id,'failed',{ok:false,message:error.message},meta);throw error }
  }
  const list = (limit=500) => db.prepare('SELECT * FROM actions WHERE deletedAt=0 ORDER BY at DESC,rowid DESC LIMIT ?').all(Math.min(10000,Math.max(1,Number(limit)||500))).map(parse)
  return {start,finish,perform,list,get,byKey,database:db,
    changesPage:(after=0,limit=200)=>db.prepare('SELECT c.seq AS sequence,a.* FROM action_changes c JOIN actions a ON a.id=c.actionId WHERE c.seq>? ORDER BY c.seq LIMIT ?').all(Number(after)||0,Math.min(500,Math.max(1,Number(limit)||200))).map(parse),
    all:()=>db.prepare('SELECT * FROM actions WHERE deletedAt=0 ORDER BY at DESC,rowid DESC').all().map(parse),
    updateMeta:(id,meta)=>db.prepare('UPDATE actions SET meta=? WHERE id=? AND deletedAt=0').run(JSON.stringify(safeValue(meta)),id),
    invalidate:ids=>{for(const id of ids) db.prepare("UPDATE actions SET deletedAt=?,result=NULL,meta='{}' WHERE id=?").run(Date.now(),id)},
    kv:(key,fallback=null)=>{const r=db.prepare('SELECT value FROM kv WHERE key=?').get(key);return r?JSON.parse(r.value):fallback},
    setKv:(key,v)=>db.prepare('INSERT OR REPLACE INTO kv(key,value) VALUES(?,?)').run(key,JSON.stringify(v)),
    close:()=>db.close()}
}
