import {DatabaseSync} from 'node:sqlite'
import {randomUUID} from 'node:crypto'
import {safeValue} from './policy.mjs'
export function createTelemetry(api) {
 const db=new DatabaseSync(api.dataDir('telemetry.sqlite'));let live=true,lastError=''
 db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,at INTEGER,scope TEXT,provider TEXT,model TEXT,status TEXT,usage TEXT); CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY,at INTEGER,data TEXT); CREATE TABLE IF NOT EXISTS info(key TEXT PRIMARY KEY,value TEXT); UPDATE calls SET status='interrupted' WHERE status='running';")
 db.prepare("INSERT OR IGNORE INTO info VALUES('since',?)").run(String(Date.now()))
 const safe=fn=>{if(!live)return;try{return fn()}catch(e){lastError=e.message;api.log.warn('运行统计未落盘：'+e.message)}}
 const record=data=>safe(()=>db.prepare('INSERT INTO decisions VALUES(?,?,?)').run(randomUUID(),Date.now(),JSON.stringify(safeValue(data))))
 const belongs=o=>{
  if(o.sessionId)return api.core.hub.chatOfSession(o.sessionId)||''
  return(o.messages||[]).some(m=>m.source?.kind==='aurabot'||m.source?.kind==='plugin'&&m.source?.plugin==='aurabot')?'background:aurabot':''
 }
 const hook=(options,next)=>{
  const scope=belongs(options);if(!scope||!live)return next()
  const id=randomUUID();safe(()=>db.prepare('INSERT INTO calls VALUES(?,?,?,?,?,?,NULL)').run(id,Date.now(),scope,String(options.provider||''),String(options.model||''),'running'))
  return(async function*(){let usage=null,status='interrupted'
   try{for await(const chunk of next()){
    if(chunk?.type==='usage'&&chunk.usage)usage={...usage,...chunk.usage}
    if(chunk?.type==='finish')status=chunk.reason?.kind==='error'?'failed':chunk.reason?.kind==='max-tokens'?'length-limited':'completed'
    yield chunk
   }}catch(e){status='failed';throw e}finally{safe(()=>db.prepare('UPDATE calls SET status=?,usage=? WHERE id=?').run(status,usage?JSON.stringify(usage):null,id))}
  })()
 }
 let off
 try{off=api.dsh.on?.('llm/stream',hook,{global:true})}catch(e){lastError=e.message;api.log.warn('全局模型统计未接入：'+e.message)}
 api.onDispose(()=>{live=false;off?.();db.close()})
 function snapshot(){
  const rows=db.prepare('SELECT * FROM calls ORDER BY at DESC').all(),n=(u,k)=>Number.isFinite(Number(u[k]))?Number(u[k]):0
  let input=0,cachedInput=0,cacheWrite=0,output=0,withoutUsage=0
  for(const r of rows){if(!r.usage){withoutUsage++;continue}const u=JSON.parse(r.usage);input+=n(u,'inputTokens');cachedInput+=n(u,'cacheReadTokens');cacheWrite+=n(u,'cacheWriteTokens');output+=n(u,'outputTokens')}
  return{since:Number(db.prepare("SELECT value FROM info WHERE key='since'").get().value),streamHook:typeof off==='function',calls:rows.length,input,cachedInput,cacheWrite,fullInput:input+cachedInput+cacheWrite,output,withoutUsage,lastError,recent:rows.slice(0,30).map(r=>({...r,usage:r.usage?JSON.parse(r.usage):null})),decisions:db.prepare('SELECT at,data FROM decisions ORDER BY rowid DESC LIMIT 60').all().map(r=>({at:r.at,...JSON.parse(r.data)}))}
 }
 return{record,snapshot}
}
