import test from 'node:test'
import assert from 'node:assert/strict'
import {harness,message} from './harness.mjs'

test('management detail resolves a timeline identity to complete vault text rather than its index excerpt',async t=>{
 const original='完整原文'.repeat(2000),h=harness(t,{rows:[message(1,original)]})
 const event=h.core.timeline({chatId:'private:10001'})[0]
 const result=await h.routes.get('/memory/event')({method:'GET',headers:{host:'127.0.0.1:3080'},query:{id:event.id}})
 assert.equal(result.ok,true);assert.equal(result.source.kind,'vault');assert.equal(result.source.text,original);assert.equal(result.source.truncated,false)
})

test('management status includes actual provider, task and storage health fields without executing tasks',t=>{
 const h=harness(t);h.modules.autonomy={requestState:()=>({id:'request',status:'waiting',goal:'查鲸鱼',at:123,dueAt:456,chatId:'private:10001'})}
 const state=h.core.memoryStatus()
 assert.equal(state.providers.vault,true);assert(state.tasks.some(x=>x.id==='request'&&x.status==='waiting'));assert.equal(typeof state.storage.lifeBytes,'number')
})

test('raw confirmed promises are recorded as promises, never started tasks',t=>{
 const h=harness(t);h.emit('sent',[{type:'text',data:{text:'我等会去搜索一下鲸鱼的资料。'}}],{chatId:'private:10001',messageId:'promise',at:Date.now()})
 const task=h.core.memoryStatus().tasks.find(x=>x.status==='promised')
 assert(task);assert.match(task.goal,/鲸鱼/);assert.notEqual(task.status,'running')
})

test('actual compilation exclusions are visible and do not include unrelated private records',t=>{
 const h=harness(t,{rows:Array.from({length:12},(_,i)=>message(i+1,'TEXT_'+i+'长文'.repeat(500)))})
 const s=h.core.buildContext({chatId:'private:10001'})
 assert(s.omitted.length>0);assert(s.omitted.every(x=>x.id.startsWith('vault:')&&/预算|上限/.test(x.reason)))
})

test('new management write route rejects cross-site or unexpected-host requests before touching a correction',async t=>{
 const h=harness(t,{rows:[message(1,'old','out')]});h.core.buildContext({chatId:'private:10001'})
 const id=h.core.timeline({chatId:'private:10001'})[0].id,route=h.routes.get('/memory/correct')
 for(const headers of [{host:'evil.example'},{host:'127.0.0.1:3080',origin:'https://evil.example'},{host:'127.0.0.1:3080','sec-fetch-site':'cross-site'}]) {
  const r=await route({method:'POST',headers,body:{id,text:'new'}});assert.equal(r.ok,false)
 }
 assert.equal(h.core.memoryStatus().corrections.length,0)
})
