import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import definition from '../../modules/life-core/index.mjs'

export function harness(t,{directory,rows=[],lib}={}) {
 const dir=directory||fs.mkdtempSync(path.join(os.tmpdir(),'memory-core-'))
 const events=new Map(),hooks=new Map(),routes=new Map(),offs=[],modules={},warnings=[]
 const cfg={enabled:true,dryRun:false,ownerQQ:'10001',botQQ:'10002',allow:{groups:['20001'],private:['10003']},ext:{},modules:{},diary:{sourceGroups:[]}}
 const chatOfSession=id=>({owner:'private:10001',guest:'private:10003',group:'group:20001',purpose:'system:purpose'})[String(id).replace(/^session-/,'')]||''
 const on=(map,n,f)=>{const a=map.get(n)||[];a.push(f);map.set(n,a);return()=>{const i=a.indexOf(f);if(i>=0)a.splice(i,1)}}
 const emit=(n,...args)=>{let value=args[0];for(const f of events.get(n)||[]){const r=f(value,...args.slice(1));if(r!==undefined)value=r}return value}
 let reset=[]
 modules['history-vault']={
  timelinePage:({afterId=0,limit=200}={})=>{const all=rows.filter(r=>r.sequence>afterId),page=all.slice(0,limit);return{rows:page,nextId:page.at(-1)?.sequence||afterId,hasMore:page.length<all.length}},
  timelineRecent:({chatId,limit=12})=>rows.filter(r=>r.chatId===chatId).slice(-limit),
  timelineCurrent:(ids,{chatId}={})=>ids.every(id=>rows.some(r=>r.id===id&&(!chatId||r.chatId===chatId))),
  diaryMaterial:()=>[],diaryMaterialCurrent:()=>true
 }
 const api={id:'life-core',lib,dataDir:(...p)=>path.join(dir,...p),config:()=>cfg,settings:()=>({...definition.defaults,...cfg.ext['life-core']}),use:id=>modules[id],
  log:{info(){},warn:(...v)=>warnings.push(v.join(' ')),error:(...v)=>warnings.push(v.join(' '))},
  on:(n,f)=>on(events,n,f),onDispose:f=>offs.push(f),every(){},route:(n,f)=>routes.set(n,f),tool(){},defineTool:x=>x,rule(){},
  dsh:{get:()=>null,on:(n,f)=>on(hooks,n,f)},core:{hub:{chatOfSession,sessions:()=>({}),resetChat:id=>{reset.push(id);return true},turnSenders:()=>[],lastPrivateAt:()=>0},http:{query:r=>r?.query||{},body:async r=>r.body||{}}}}
 const core=definition.setup(api)
 const close=()=>{offs.reverse().forEach(f=>f());offs.length=0}
 t.after(()=>{close();if(!directory)fs.rmSync(dir,{recursive:true,force:true})})
 const stream=async(options,chunks=[{type:'finish',reason:{kind:'stop'}}])=>{
  const functions=hooks.get('llm/stream')||[]
  const next=i=>()=>i<functions.length?functions[i](options,next(i+1)):(async function*(){yield*chunks})()
  const out=[];for await(const c of next(0)())out.push(c);return out
 }
 const enter=async(incoming,{history=[],sessionId='owner'}={})=>{
  const stored=history.map((m,seq)=>({seq,type:m.role==='assistant'?'assistant/message':'user/message',data:m})),nodes=stored.map(r=>r.seq)
  const session={id:sessionId,surface:{nodes},eventAt:seq=>stored[seq],deriveEventMessage:event=>event.data,append:(type,data,opts)=>{
   const row={seq:stored.length,type,data,sourceEventSeqs:opts.sourceEventSeqs,surfaceOp:opts.surfaceOp};stored.push(row)
   const index=nodes.indexOf(opts.surfaceOp.startSeq);nodes.splice(index,1,row.seq);return row
  }}
  const payload={agent:{session},messages:incoming,signal:new AbortController().signal},functions=hooks.get('agent/pre-step')||[]
  const next=i=>()=>i<functions.length?functions[i](payload,next(i+1)):Promise.resolve({kind:'enter',messages:incoming})
  const decision=await next(0)()
  return{messages:[...nodes.map(n=>stored[n].data),...decision.messages],stored,decision,session}
 }
 return{dir,api,core,cfg,rows,modules,events,hooks,routes,warnings,emit,stream,enter,close,resets:reset}
}
export const message=(n,text,dir='in',chatId='private:10001',t=Date.now()-1000)=>({id:'vault:'+n,sequence:n,t,chatId,dir,who:dir==='out'?'大肥鱼':'发言者',uid:dir==='out'?'10002':chatId.split(':')[1],text,messageId:'native-'+n,atQQs:[]})
