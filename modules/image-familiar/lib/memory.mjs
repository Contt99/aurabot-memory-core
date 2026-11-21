import fs from 'node:fs'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
// Digests here are functional content identities, not release-integrity checks.
export const imageId=raw=>createHash('md5').update(raw).digest('hex')
export function createImageMemory({dir,prepare,describe,revision=()=>0}) {
 fs.mkdirSync(dir,{recursive:true})
 const db=new DatabaseSync(path.join(dir,'images.sqlite')),pending=new Map(),versions=new Map()
 db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS images(scope TEXT NOT NULL,identity TEXT NOT NULL,description TEXT NOT NULL,uncertainty TEXT NOT NULL,confidence REAL NOT NULL,frames INTEGER NOT NULL,file TEXT NOT NULL,at INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(scope,identity));')
 db.exec('CREATE TABLE IF NOT EXISTS image_sources(id TEXT PRIMARY KEY,scope TEXT NOT NULL,identity TEXT NOT NULL,at INTEGER NOT NULL)')
 const sourceColumns=new Set(db.prepare('PRAGMA table_info(image_sources)').all().map(r=>r.name));if(!sourceColumns.has('revision'))db.exec('ALTER TABLE image_sources ADD COLUMN revision INTEGER NOT NULL DEFAULT 0')
 const columns=new Set(db.prepare('PRAGMA table_info(images)').all().map(r=>r.name));if(!columns.has('observationId'))db.exec("ALTER TABLE images ADD COLUMN observationId TEXT NOT NULL DEFAULT ''")
 let live=true
 const read=(scope,id)=>db.prepare('SELECT * FROM images WHERE scope=? AND identity=?').get(scope,id)
 async function resolve(raw,scope,options={}) {
  if(!live)throw Error('图片模块已停止')
  const version=versions.get(scope)||0
  const rev=revision(scope);if(!Number.isFinite(rev))throw Error('忘记状态暂不可验证，未复用图片缓存')
  const p=await prepare(raw)
  if(!live||(versions.get(scope)||0)!==version||revision(scope)!==rev)return{invalidated:true,description:'图片来源已失效',reused:false}
  const key=scope+':'+p.identity,hit=read(scope,p.identity)
  if(hit&&hit.revision===rev&&!options.refresh)return{...hit,reused:true}
  if(pending.has(key))return pending.get(key)
  const task=(async()=>{
   const result=await describe(p,options.question||'')
   if(!live||(versions.get(scope)||0)!==version||revision(scope)!==rev)return{invalidated:true,description:'图片来源已被忘记，本轮结果弃用',reused:false}
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
 return {resolve,current:(ids,scope)=>live&&Array.isArray(ids)&&ids.every(id=>{const r=db.prepare('SELECT scope,revision FROM image_sources WHERE id=?').get(String(id));return Boolean(r&&(!scope||r.scope===scope)&&revision(r.scope)===Number(r.revision))}),list:()=>db.prepare('SELECT scope,identity,description,uncertainty,confidence,frames,at FROM images ORDER BY at DESC').all(),
  forget(scope){const sourceIds=db.prepare('SELECT id FROM image_sources WHERE scope=?').all(scope).map(r=>r.id);db.prepare('DELETE FROM image_sources WHERE scope=?').run(scope);versions.set(scope,(versions.get(scope)||0)+1);const rows=db.prepare('SELECT file FROM images WHERE scope=?').all(scope);db.prepare('DELETE FROM images WHERE scope=?').run(scope);for(const r of rows)try{fs.unlinkSync(path.join(dir,'raw',r.file))}catch{};return sourceIds},
  close(){live=false;db.close()}}
}
