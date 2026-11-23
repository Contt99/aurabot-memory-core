import test from 'node:test'
import assert from 'node:assert/strict'
import {harness,message} from '../core/harness.mjs'
import {fixture} from './legacy-adapters-fixture.mjs'
import definition from '../../modules/purpose/index.mjs'
import {localDateKey} from '../../modules/purpose/lib/purpose/engine.js'

function setup(t,{beforeAsk=()=>{},ack='88',friend=false}={}){
 const store=fixture();t.after(store.close)
 const rows=[
  message(1,'今天好想一起看看流星雨？','in',friend?'private:10003':'private:10001'),
  message(2,'不该进入对方上下文的合成资料','in',friend?'private:10001':'private:10003'),
 ]
 const h=harness(t,{rows})
 h.cfg.speakUp={awakeFrom:0,awakeTo:24,idleMinutes:0,minIntervalMinutes:1,maxIntervalMinutes:1,allow:friend?['10003']:[]}
 h.cfg.ext.purpose={enabled:true,minMaterials:0,initialDelayMinutes:1}
 h.modules['life-core']=h.core
 h.api.core.mutes={muted:id=>friend&&id==='private:10001'}
 h.api.core.personas={current:()=> '喜欢看鲸鱼和流星雨。'}
 const hstore=store.api.lib('core/store.js')
 const statePath=friend?hstore.dataDir('purpose','friends','10003.json'):hstore.dataDir('purpose','purpose-state.json')
 hstore.writeJson(statePath,{day:localDateKey(),lastRunAt:Date.now()-60000,nextFireAt:Date.now()-1000})
 const replies=[]
 const target=friend?'private:10003':'private:10001'
 const segments=text=>[{type:'text',data:{text}}]
 h.api.core.hub.sendText=async(chatId,text,_reply,_missed,_user,opts)=>{
  assert.equal(chatId,target)
  if(h.emit('send',segments(text),{chatId})===null)return
  if(!opts.isCurrent())return
  replies.push(text)
  if(ack){
   h.emit('sent',segments(text),{chatId,messageId:ack,at:Date.now()})
   h.emit('sent',segments(text),{chatId,messageId:ack,at:Date.now()})
  }
  return{message_id:ack}
 }
 let prompts=[]
 const purpose=h.modules.purpose=definition.setup({...h.api,id:'purpose',lib:store.api.lib,settings:()=>h.cfg.ext.purpose,
  ask:async opt=>{prompts.push(opt.text);await beforeAsk(h);return '要一起看流星雨吗？'}})
 return {...h,purpose,target,replies,prompts,tick:()=>h.timers.get('统一后台调度')(),
  recent:()=>h.routes.get('/candidates')({headers:{host:'localhost'}}).items}
}

test('purpose finds one eligible recipient then the core claims, accounts and captures the real private ACK',async t=>{
 const f=setup(t,{friend:true})
 await f.purpose.tick();await f.purpose.tick()
 assert.equal(f.prompts.length,0)
 assert.equal(f.recent().length,1)
 assert.equal(f.recent()[0].target,'private:10003')
 await Promise.all([f.tick(),f.tick()])
 assert.equal(f.replies.length,1)
 assert.equal(f.core.proactiveState().count,1)
 assert.equal(f.recent()[0].status,'sent')
 assert.equal(f.recent()[0].receipt,'88')
 assert.doesNotMatch(f.prompts[0],/不该进入对方上下文/)
 const next=f.core.buildContext({chatId:'private:10003',purpose:'chat',query:'你刚才说什么'})
 assert.match(next.text,/要一起看流星雨吗/)
})

test('purpose withdrawal in the model wait stops delivery; a missing native ACK is never counted as sent',async t=>{
 const waiting=setup(t,{beforeAsk:h=>{h.api.core.hub.lastPrivateAt=()=>Date.now()+1}})
 await waiting.purpose.tick();await waiting.tick()
 assert.equal(waiting.replies.length,0)
 assert.notEqual(waiting.recent()[0].status,'sent')
 const noack=setup(t,{ack:null})
 await noack.purpose.tick();await noack.tick();await noack.tick()
 assert.equal(noack.replies.length,1)
 assert.equal(noack.recent()[0].status,'unknown')
})

test('scheduled follow-up requires the authorized native utterance, not the host display string',async t=>{
 const f=setup(t),oldRandom=Math.random
 Math.random=()=>0;t.after(()=>{Math.random=oldRandom})
 f.rows.splice(0)
 f.cfg.speakUp.nudge=true
 f.api.core.hub.lastBotToOwner={at:Date.now()-20*60_000,text:'假设已经问过你吗？'}
 f.emit('sent',[{type:'text',data:{text:'想看流星雨吗？'}}],{chatId:f.target,messageId:'-72',at:Date.now()-20*60_000})
 await f.purpose.tick()
 assert.equal(f.recent()[0].job,'nudge')
 await f.tick()
 assert.match(f.prompts[0],/想看流星雨吗/)
 assert.doesNotMatch(f.prompts[0],/假设已经问过/)
 assert.equal(f.recent()[0].status,'sent')
 const revoked=setup(t)
 revoked.rows.splice(0);revoked.cfg.speakUp.nudge=true
 revoked.emit('sent',[{type:'text',data:{text:'愿意再听一句吗？'}}],{chatId:revoked.target,messageId:'-73',at:Date.now()-20*60_000})
 await revoked.purpose.tick()
 const speech=revoked.core.latestConfirmedSpeech(revoked.target)
 assert(revoked.core.forgetPerson('10001','',{exactSources:true,sourceIds:[speech.id],chatId:revoked.target}).ok)
 await revoked.tick()
 assert.equal(revoked.recent()[0].status,'cancelled')
 assert.equal(revoked.prompts.length,0)
})
