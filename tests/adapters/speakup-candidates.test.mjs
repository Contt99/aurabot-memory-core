import test from 'node:test'
import assert from 'node:assert/strict'
import definition from '../../modules/speakup/index.mjs'
import {fixture} from './legacy-adapters-fixture.mjs'
import {harness,message} from '../core/harness.mjs'
import {join} from 'node:path'
import autonomyDefinition from '../../modules/autonomy/index.mjs'

function setup(t,{friend=false,model=()=> '刚才那个话题后来怎么样？'}={}){
 const disk=fixture();t.after(disk.close)
 const target=friend?'private:10003':'private:10001'
 const rows=[message(1,'可以问的同一私聊话题','in',target),message(2,'别的私聊不能带进来','in',friend?'private:10001':'private:10003')]
 const h=harness(t,{rows})
 h.cfg.speakUp={enabled:true,awakeFrom:0,awakeTo:24,idleMinutes:0,minIntervalMinutes:1,maxIntervalMinutes:1,maxPerDay:10,allow:friend?['10003']:[]}
 h.cfg.ext.purpose={enabled:false}
 h.modules['life-core']=h.core
 h.modules.autonomy={canSpeak:()=>true}
 h.api.core.mutes={muted:id=>friend&&id==='private:10001'}
 h.api.core.personas={current:()=>'一种合成角色'}
 const writes=[],prompts=[]
 let pushed=0
 const seg=text=>[{type:'text',data:{text}}]
 h.api.core.hub.pushToSession=async()=>{pushed++;return {queued:true}}
 h.api.core.hub.sendText=async(chatId,text,_r,_m,_u,opt)=>{
  if(h.emit('send',seg(text),{chatId})===null||!opt.isCurrent())return null
  writes.push({chatId,text})
  h.emit('sent',seg(text),{chatId,at:Date.now(),messageId:'92'})
  return {message_id:'92'}
 }
 const speakup=h.modules.speakup=definition.setup({...h.api,id:'speakup',lib:disk.api.lib,ask:async o=>{
  prompts.push(o);return model(h)
 }})
 return {...h,speakup,target,writes,prompts,pushed:()=>pushed,
   tick:()=>h.timers.get('统一后台调度')(),recent:()=>h.routes.get('/candidates')({headers:{host:'localhost'}}).items}
}

test('legacy schedule sends only after core arbitration and never pushes a turn into the recipient agent',async t=>{
 const f=setup(t,{friend:true})
 await f.speakup.tick();await f.speakup.tick()
 assert.equal(f.recent().length,1)
 assert.equal(f.recent()[0].target,f.target)
 assert.equal(f.prompts.length,0);assert.equal(f.pushed(),0)
 await f.tick()
 assert.equal(f.writes.length,1)
 assert.equal(f.core.proactiveState().count,1)
 assert.equal(f.recent()[0].receipt,'92')
 assert.match(f.prompts[0].text,/可以问的同一私聊话题/)
 assert.doesNotMatch(f.prompts[0].text,/别的私聊不能/)
 assert.equal(f.writes[0].chatId,'private:10003')
 assert.match(f.core.buildContext({chatId:f.target,purpose:'chat'}).text,/刚才那个话题后来怎么样/)
})

test('turning on purpose suppresses existing legacy timer candidates, while the panel keeps its original entry',async t=>{
 const f=setup(t)
 await f.speakup.tick()
 f.cfg.ext.purpose.enabled=true
 await f.tick()
 assert.equal(f.recent()[0].status,'cancelled')
 assert.equal(f.writes.length,0)
 await f.speakup.fire('手动')
 assert.equal(f.pushed(),1)
})

test('a core with only the older purpose queue keeps the established speakup timer usable',async t=>{
 const f=setup(t)
 const {supportsContactJob,...olderCore}=f.core
 f.modules['life-core']=olderCore
 await f.speakup.tick()
 assert.equal(f.pushed(),1)
 assert.deepEqual(f.recent(),[])
})

test('a request from an autonomy wake queues a distinct owner action without claiming an actual send',async t=>{
 const f=setup(t)
 f.cfg.ext.purpose.enabled=true
 const a=await f.speakup.autonomous('wake-2026-11')
 const b=await f.speakup.autonomous('wake-2026-11')
 const c=await f.speakup.autonomous('wake-2026-12')
 assert.equal(a.status,'queued')
 assert.equal(a.id,b.id)
 assert.notEqual(a.id,c.id)
 assert.equal(f.pushed(),0)
 assert.equal(f.writes.length,0)
 await f.tick()
 assert.equal(f.writes.length,1)
 assert.equal(f.recent().find(row=>row.id===a.id).status,'sent')
 assert.equal(f.recent().find(row=>row.id===c.id).status,'queued')
 assert.equal(f.core.proactiveState().count,1)
})

test('a newer confirmed question replaces only the obsolete nudge, without losing the new identity',async t=>{
 const f=setup(t),oldRandom=Math.random
 Math.random=()=>0;t.after(()=>{Math.random=oldRandom})
 f.rows.splice(0);f.cfg.speakUp.nudge=true
 const question=(id,age,text)=>f.emit('sent',[{type:'text',data:{text}}],{chatId:f.target,messageId:id,at:Date.now()-age*60_000})
 question('42',22,'要听第一个故事吗？');await f.speakup.tick()
 question('43',20,'要听第二个故事吗？');await f.speakup.tick()
 assert.equal(f.recent().filter(r=>r.job==='nudge').length,2)
 await f.tick()
 assert.equal(f.recent().find(r=>r.status==='sent')?.receipt,'92')
 assert(f.recent().some(r=>r.status==='cancelled'))
 assert.match(f.prompts[0].text,/对方暂时没回应你刚刚问过的话：.*第二个故事/)
})

test('revoking autonomy after the request prevents a later model call',async t=>{
 const f=setup(t)
 await f.speakup.autonomous('revoked-wake')
 f.modules.autonomy.canSpeak=()=>false
 await f.tick()
 assert.equal(f.recent()[0].status,'cancelled')
 assert.equal(f.prompts.length,0)
 assert.equal(f.writes.length,0)
})

test('the actual autonomy wake records the linked pending candidate and leaves the QQ write to the core',async t=>{
 const f=setup(t)
 const options={...autonomyDefinition.defaults,enabled:true,awakeFrom:0,awakeTo:24,grants:{model:true}}
 const dsh={...f.api.dsh,
  get:name=>name==='agentDefaultModel'?{currentSelection:()=>({provider:'fake',model:'test'})}:null,
  llm:{async *stream(){yield{type:'text-delta',text:'{"action":"speak","why":"想接着聊"}'};yield{type:'finish',reason:{kind:'stop'}}}}
 }
 const autonomy=f.modules.autonomy=autonomyDefinition.setup({...f.api,id:'autonomy',settings:()=>options,command(){},dsh,
  dataDir:(...parts)=>join(f.dir,'autonomy',...parts)})
 const wake=await autonomy.wake()
 assert.equal(wake.status,'queued',JSON.stringify(wake))
 assert.equal(f.writes.length,0)
 assert.equal(autonomy.activity()[0].candidateId,f.recent()[0].id)
 await f.tick()
 assert.equal(f.recent()[0].receipt,'92')
 assert.equal(f.writes.length,1)
})
