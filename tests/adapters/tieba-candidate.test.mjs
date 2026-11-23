import test from 'node:test'
import assert from 'node:assert/strict'
import definition from '../../modules/tieba-reader/index.mjs'
import {harness,message} from '../core/harness.mjs'

function fixture(t,{ask,ack=42,html}={}){
 const now=()=>clock
 let clock=Date.parse('2026-11-23T04:00:00Z'),calls=0,sends=0,privateLast=0
 const h=harness(t,{now})
 const {api,cfg,core,modules}=h
 cfg.speakUp={awakeFrom:0,awakeTo:24,idleMinutes:0,minIntervalMinutes:1}
 cfg.ext['tieba-reader']={autoBrowse:true,bars:'纸风车',maxSharesPerDay:1}
 modules['life-core']=core
 Object.assign(api.core,{modules:{status:()=>[{id:'tieba-reader',running:true}]},personas:{current:()=>''},onebot:{state:'connected'},mutes:{muted:()=>false}})
 Object.assign(api.core.hub,{lastPrivateAt:()=>privateLast,sendText:async(chatId,text)=>{
  sends++
  if(!String(ack).startsWith('sim-')){
   h.emit('sent',[{type:'text',data:{text}}],{chatId,at:clock,messageId:ack})
   h.rows.push({...message(98,text,'out',chatId,clock),messageId:String(ack)})
  }
  return{message_id:ack}
 }})
 const browser=async url=>url.includes('/p/')
  ?html?{html}:{title:'折纸',hasOpening:true,contents:['这是贴吧正文：试过三种纸风车的折法。']}
  :{links:[{title:'折纸',url:'https://tieba.baidu.com/p/123456789'}]}
 const adapter=modules['tieba-reader']=definition.setup({...api,id:'tieba-reader',lib:()=>({registerSecretField(){}}),
  settings:()=>({...definition.defaults,...cfg.ext['tieba-reader']}),ask:async opt=>{
   calls++
   assert.match(opt.text,/试过三种纸风车/)
   return ask?ask(opt):'{"share":true,"index":0,"text":"这篇写了三种折法，我觉得挺有意思。"}'
  },sendText:(...args)=>api.core.hub.sendText(...args)},{now,renderPage:browser})
 const tick=()=>{clock+=60000;return h.timers.get('统一后台调度')()}
 return {...h,adapter,tick,now,counts:()=>({calls,sends}),recent:()=>h.routes.get('/candidates')({headers:{host:'localhost'}}).items,
  incoming:()=>{privateLast=++clock;h.rows.push(message(99,'先聊聊其他事','in','private:10001',clock))}}
}

test('scheduled Tieba reads real evidence, then the core sends once and retains the native ACK for follow-up',async t=>{
 const f=fixture(t)
 await f.tick()
 const [queued]=f.recent()
 assert.equal(queued.status,'queued')
 assert.equal(queued.sourceIds.length,1)
 assert.deepEqual(f.counts(),{calls:0,sends:0})
 await Promise.all([f.tick(),f.tick()])
 assert.deepEqual(f.counts(),{calls:1,sends:1})
 assert.equal(f.recent()[0].receipt,'42')
 assert.equal(f.adapter.state().shares,1)
 assert.equal(f.core.proactiveState().count,1)
 const snapshot=f.core.buildContext({chatId:'private:10001',purpose:'chat',query:'你刚才说什么'})
 assert.match(snapshot.text,/刚逛纸风车吧看到这个：折纸/)
 assert.doesNotMatch(f.core.buildContext({chatId:'private:10003',purpose:'chat',query:'折纸'}).text,/刚逛纸风车吧看到这个/)
})

test('a new message disqualifies an in-flight draft, and a simulated ACK never records a send',async t=>{
 let f
 f=fixture(t,{ask:()=>{f.incoming();return '{"share":true,"index":0,"text":"有意思。"}'}})
 await f.tick();await f.tick()
 assert.equal(f.recent()[0].status,'cancelled')
 assert.equal(f.counts().sends,0)
 const sim=fixture(t,{ack:'sim-42'})
 await sim.tick();await sim.tick()
 assert.equal(sim.recent()[0].status,'unknown')
 assert.equal(sim.adapter.state().shares,0)
 await sim.tick()
 assert.equal(sim.counts().sends,1)
})

test('forgetting the read revokes an unsent candidate and removes a sent derivative from recall',async t=>{
 const waiting=fixture(t)
 await waiting.tick()
 const revoke=f=>f.core.forgetPerson('10001','',{exactSources:true,sourceIds:f.recent()[0].sourceIds,chatId:'private:10001'})
 assert.equal(revoke(waiting).ok,true)
 await waiting.tick()
 assert.deepEqual(waiting.counts(),{calls:0,sends:0})
 assert.equal(waiting.recent()[0].status,'cancelled')
 const sent=fixture(t)
 await sent.tick();await sent.tick()
 assert.equal(revoke(sent).ok,true)
 assert.equal(sent.recent()[0].receipt,'42')
 assert.deepEqual(sent.recent()[0].sourceIds,[])
 assert.equal(sent.rows.length,1,'the original QQ speech remains archived')
 assert.doesNotMatch(sent.core.buildContext({chatId:'private:10001',purpose:'chat',query:'你刚才的折纸分享'}).text,/刚逛纸风车吧看到这个/)
})

test('the dispatcher needs the continuity compiler at claim and at send',async t=>{
 let f
 f=fixture(t,{ask:()=>{delete f.modules['history-vault'];return '{"share":true,"index":0,"text":"有意思。"}'}})
 await f.tick()
 const vault=f.modules['history-vault']
 delete f.modules['history-vault'];await f.tick()
 assert.equal(f.core.proactiveState().count,0)
 assert.equal(f.recent()[0].status,'queued')
 f.modules['history-vault']=vault;await f.tick()
 assert.equal(f.recent()[0].status,'cancelled')
 assert.deepEqual(f.counts(),{calls:1,sends:0})
})

test('a QQ-shaped event with a non-native ID must not enter confirmed experiences',async t=>{
 const f=fixture(t,{ack:'invalid-42'})
 await f.tick();await f.tick()
 assert.equal(f.recent()[0].status,'unknown')
 assert(!f.core.queryExperiences({purpose:'private-diary'}).some(r=>r.evidenceType==='qq-ack'))
 assert(!f.core.timeline({chatId:'private:10001'}).some(r=>r.type==='utterance'&&r.status==='confirmed'))
})

test('legacy reply-only HTML without explicit floor metadata never queues as a real opening',async t=>{
 const f=fixture(t,{html:'<title>折纸</title><div class="l_post"><div class="d_post_content">这是一个没有楼层资料的块。</div></div>'})
 await f.tick();await f.tick()
 assert.deepEqual(f.recent(),[])
 assert.deepEqual(f.counts(),{calls:0,sends:0})
})
