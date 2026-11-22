import fs from 'node:fs'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
// Digests here are functional content identities, not release-integrity checks.
export const imageId=raw=>createHash('md5').update(raw).digest('hex')
export function createImageMemory({dir,prepare,describe,revision=()=>0,revisionAt=()=>0}) {
 fs.mkdirSync(dir,{recursive:true})
 const db=new DatabaseSync(path.join(dir,'images.sqlite')),pending=new Map(),versions=new Map()
 db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS images(scope TEXT NOT NULL,identity TEXT NOT NULL,description TEXT NOT NULL,uncertainty TEXT NOT NULL,confidence REAL NOT NULL,frames INTEGER NOT NULL,file TEXT NOT NULL,at INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(scope,identity));')
 db.exec('CREATE TABLE IF NOT EXISTS image_sources(id TEXT PRIMARY KEY,scope TEXT NOT NULL,identity TEXT NOT NULL,at INTEGER NOT NULL)')
 const sourceColumns=new Set(db.prepare('PRAGMA table_info(image_sources)').all().map(r=>r.name));if(!sourceColumns.has('revision'))db.exec('ALTER TABLE image_sources ADD COLUMN revision INTEGER NOT NULL DEFAULT 0')
 const columns=new Set(db.prepare('PRAGMA table_info(images)').all().map(r=>r.name));if(!columns.has('observationId'))db.exec("ALTER TABLE images ADD COLUMN observationId TEXT NOT NULL DEFAULT ''")
 db.exec(`CREATE TABLE IF NOT EXISTS image_occurrences(
  id TEXT PRIMARY KEY,scope TEXT NOT NULL,dir TEXT NOT NULL,messageId TEXT NOT NULL,position INTEGER NOT NULL,
  identity TEXT NOT NULL,at REAL NOT NULL,revision INTEGER NOT NULL,UNIQUE(scope,dir,messageId,identity));
 CREATE TABLE IF NOT EXISTS image_occurrence_forget(scope TEXT PRIMARY KEY,at REAL NOT NULL)`)
 const readOccurrence=db.prepare('SELECT * FROM image_occurrences WHERE scope=? AND dir=? AND messageId=? AND identity=?')
 const insertOccurrence=db.prepare(`INSERT INTO image_occurrences(id,scope,dir,messageId,position,identity,at,revision) VALUES(?,?,?,?,?,?,?,?)
  ON CONFLICT(scope,dir,messageId,identity) DO UPDATE SET id=excluded.id,position=excluded.position,at=excluded.at,revision=excluded.revision
  WHERE image_occurrences.revision<>excluded.revision`)
 const byMessage=db.prepare('SELECT * FROM image_occurrences WHERE scope=? AND dir=? AND messageId=? AND revision=? ORDER BY position, rowid')
 const byId=db.prepare('SELECT scope,revision FROM image_occurrences WHERE id=?')
 const forgetCutoff=db.prepare('SELECT at FROM image_occurrence_forget WHERE scope=?')
 let live=true
 const read=(scope,id)=>db.prepare('SELECT * FROM images WHERE scope=? AND identity=?').get(scope,id)
 const capture=scope=>({scope,version:versions.get(scope)||0,rev:revision(scope)})
 const valid=({scope,version,rev})=>live&&Number.isFinite(rev)&&(versions.get(scope)||0)===version&&revision(scope)===rev
 const afterForget=(scope,at)=>at>Math.max(forgetCutoff.get(scope)?.at||0,revisionAt(scope)||0)
 const occurrence=t=>({id:t.id,dir:t.dir,messageId:t.messageId,identity:t.identity,at:t.at})
 function append(token,{dir,messageId,position,identity,at}) {
  const {scope,rev}=token
  if(!valid(token)||!identity||!afterForget(scope,at))return null
  insertOccurrence.run('media:'+randomUUID(),scope,dir,messageId,position,identity,at,rev)
  return occurrence(readOccurrence.get(scope,dir,messageId,identity))
 }
 function mediaFor(scope,refs) {
  const rev=revision(scope)
  if(!live||!Number.isFinite(rev)||!Array.isArray(refs))return []
  const seen=new Set(),out=[]
  for(const ref of refs.slice(0,200)){
   const dir=ref?.dir,messageId=String(ref?.messageId??'')
   if((dir!=='in'&&dir!=='out')||!messageId||seen.has(dir+':'+messageId))continue
   seen.add(dir+':'+messageId)
   for(const t of byMessage.all(scope,dir,messageId,rev)){
    const hit=read(scope,t.identity)
    out.push({...occurrence(t),...(hit?.revision===rev&&hit.observationId&&{visual:visualOf({...hit,sourceId:hit.observationId})})})
   }
  }
  return out
 }
 async function resolve(raw,scope,options={}) {
  if(!live)throw Error('图片模块已停止')
  const token=options.capture||capture(scope),{rev}=token
  if(!Number.isFinite(rev))throw Error('忘记状态暂不可验证，未复用图片缓存')
  if(!valid(token))return{invalidated:true}
  const p=await prepare(raw)
  if(!valid(token))return{invalidated:true}
  if(options.onPrepared?.(p)===false)return{invalidated:true}
  const key=scope+':'+p.identity,hit=read(scope,p.identity)
  if(hit&&hit.revision===rev&&!options.refresh)return{...hit,sourceId:hit.observationId,reused:true}
  if(pending.has(key))return pending.get(key)
  const task=(async()=>{
   const result=await describe(p,options.question||'')
   if(!valid(token))return{invalidated:true}
   const description=String(result?.description||'').trim().slice(0,700),uncertainty=String(result?.uncertainty||'').slice(0,300),confidence=Number(result?.confidence)
   if(!description||!Number.isFinite(confidence)||confidence<0||confidence>1)throw Error('识图未返回有效描述与置信度，未保存')
   const sourceId='image:'+scope+':'+p.identity+'@'+randomUUID(),at=Date.now()
   const supersededSourceIds=options.refresh?db.prepare('SELECT id FROM image_sources WHERE scope=? AND identity=?').all(scope,p.identity).map(r=>r.id):[]
   db.exec('BEGIN IMMEDIATE');try{if(options.refresh)db.prepare('DELETE FROM image_sources WHERE scope=? AND identity=?').run(scope,p.identity);db.prepare('INSERT INTO image_sources(id,scope,identity,at,revision) VALUES(?,?,?,?,?)').run(sourceId,scope,p.identity,at,rev);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
   if(confidence<0.6){if(options.refresh&&hit){db.prepare('DELETE FROM images WHERE scope=? AND identity=?').run(scope,p.identity);try{fs.unlinkSync(path.join(dir,'raw',hit.file))}catch{}}return{sourceId,at,identity:p.identity,description,uncertainty,confidence,frames:p.frames,reused:false,uncertain:true,supersededSourceIds}}
   const rawDir=path.join(dir,'raw');fs.mkdirSync(rawDir,{recursive:true})
   const filename=(hit?.file||randomUUID()+'.bin');fs.writeFileSync(path.join(rawDir,filename),raw,{mode:0o600})
   db.prepare('INSERT OR REPLACE INTO images(scope,identity,description,uncertainty,confidence,frames,file,at,revision,observationId) VALUES(?,?,?,?,?,?,?,?,?,?)').run(scope,p.identity,description,uncertainty,confidence,p.frames,filename,at,rev,sourceId)
   return{...read(scope,p.identity),sourceId,reused:false,supersededSourceIds}
  })();pending.set(key,task)
  try{return await task}finally{pending.delete(key)}
 }
 return {resolve,capture,valid,append,mediaFor,afterForget,
  mediaCurrent:(ids,scope)=>live&&Array.isArray(ids)&&ids.every(id=>{const r=byId.get(String(id));return Boolean(r&&r.scope===scope&&revision(scope)===r.revision)}),
  current:(ids,scope)=>live&&Array.isArray(ids)&&ids.every(id=>{const r=db.prepare('SELECT scope,revision FROM image_sources WHERE id=?').get(String(id));return Boolean(r&&(!scope||r.scope===scope)&&revision(r.scope)===Number(r.revision))}),list:()=>db.prepare('SELECT scope,identity,description,uncertainty,confidence,frames,at FROM images ORDER BY at DESC').all(),
  forget(scope){
   const sourceIds=db.prepare('SELECT id FROM image_sources WHERE scope=?').all(scope).map(r=>r.id),rows=db.prepare('SELECT file FROM images WHERE scope=?').all(scope)
   const occurrenceIds=db.prepare('SELECT id FROM image_occurrences WHERE scope=?').all(scope).map(r=>r.id)
   db.exec('BEGIN IMMEDIATE')
   try{
    db.prepare('INSERT OR REPLACE INTO image_occurrence_forget(scope,at) VALUES(?,?)').run(scope,performance.timeOrigin+performance.now())
    db.prepare('DELETE FROM image_occurrences WHERE scope=?').run(scope)
    db.prepare('DELETE FROM image_sources WHERE scope=?').run(scope)
    db.prepare('DELETE FROM images WHERE scope=?').run(scope)
    db.exec('COMMIT')
   }catch(e){db.exec('ROLLBACK');throw e}
   versions.set(scope,(versions.get(scope)||0)+1)
   for(const r of rows)try{fs.unlinkSync(path.join(dir,'raw',r.file))}catch{}
   return {sourceIds,occurrenceIds}
  },
  close(){live=false;db.close()}}
}
export const visualOf=r=>({sourceId:r.sourceId,description:r.description,uncertainty:r.uncertainty,confidence:r.confidence,frames:r.frames})
