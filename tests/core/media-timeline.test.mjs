import test from 'node:test'
import assert from 'node:assert/strict'
import {harness,message} from './harness.mjs'
const chatId='private:10001',chat={chatId,kind:'private',userId:'10001'}
const visual={sourceId:'image:synthetic',description:'折纸风车在窗前转动',uncertainty:'旋转方向仅从采样推测',confidence:.9,frames:11}
const refs=[
 {id:'media:1',dir:'out',messageId:'native-1',identity:'same-animation',at:Date.now()-3000,visual},
 {id:'media:2',dir:'in',messageId:'native-2',identity:'same-animation',at:Date.now()-2000,visual},
 {id:'media:3',dir:'out',messageId:'native-3',identity:'same-animation',at:Date.now()-1000,visual},
]
const records=()=>refs.map((r,i)=>message(i+1,'[图片]',r.dir,chatId,r.at))
function install(h,occurrences=refs) {
 h.modules['image-familiar']={
  mediaFor:(scope,keys)=>scope!==chatId?[]:occurrences.filter(r=>keys.some(k=>k.dir===r.dir&&k.messageId===r.messageId)),
  mediaCurrent:(ids,{chatId:scope})=>scope===chatId&&ids.every(id=>occurrences.some(r=>r.id===id)),
  contextCurrent:ids=>ids.every(id=>id===visual.sourceId),
  prepareTimelineImages:async content=>({content:content.filter(c=>c.type!=='image'),current:occurrences.filter(r=>r.dir==='in')})
 }
}
test('one visual description ties together two sends and one incoming picture',async t=>{
 const h=harness(t,{rows:records()});install(h)
 h.core.recordObservation({sourceId:visual.sourceId,chatId,evidenceType:'visual-interpretation'},{text:visual.description})
 const assembled=await h.emit('prompt',[{type:'image',data:'test'}],{chat,sessionId:'owner',senderId:'10001',queryText:''})
 const prompt=assembled.map(b=>b.text).join('\n')
 assert.equal(assembled.some(b=>b.type==='image'),false)
 assert.match(prompt,/同一张动图.*3 次.*发出 2 次.*收到 1 次/)
 assert.equal(prompt.split(visual.description).length,2)
 assert.doesNotMatch(prompt,/\[图片\]/)
 const s=h.core.memoryStatus().snapshots[0]
 assert.equal(h.core.contextDetail(s.id).data.items.find(i=>i.refKind==='media').occurrenceIds.length,3)
 await h.stream({sessionId:'owner',messages:[{role:'user',content:assembled}]})
 assert.equal(h.core.contextDetail(s.id).status,'observed')
 h.rows.splice(0,1)
 assert.throws(()=>h.core.assertContextCurrent(s),/图片|原文|来源/)
})

test('outbound only proves media identity and cannot supply a made-up observation',t=>{
 const rows=records();rows.splice(1,1)
 const h=harness(t,{rows});install(h,refs.filter(r=>r.dir==='out').map(({visual,...r})=>r))
 const s=h.core.buildContext({chatId,sessionId:'owner'})
 assert.match(s.text,/同一份图片素材.*2 次.*发出 2 次/)
 assert.match(s.text,/无已保存的画面理解/)
 assert.doesNotMatch(s.text,new RegExp(visual.description))
 assert.doesNotMatch(h.core.buildContext({chatId:'private:10003'}).text,/图片素材/)
})

test('different identities in the same conversation are not combined',t=>{
 const h=harness(t,{rows:records()});install(h,[refs[0],refs[1],{...refs[2],identity:'distinct',visual:undefined}])
 const s=h.core.buildContext({chatId})
 assert.match(s.text,/同一张动图.*2 次.*发出 1 次.*收到 1 次/)
 assert.doesNotMatch(s.text,/3 次/)
})

test('a prebuilt snapshot does not claim the separate incoming image prompt hook',async t=>{
 const h=harness(t);install(h)
 const info={chat,sessionId:'owner',senderId:'10001',queryText:''}
 assert.equal(h.core.mediaTimelineManaged(info),true)
 const s=h.core.buildContext({chatId,sessionId:'owner'})
 await h.core.runWithContext(s,async()=>{
  assert.equal(h.core.mediaTimelineManaged(info),false)
  const assembled=await h.emit('prompt',[{type:'image',data:'test'}],info)
  assert.ok(assembled.some(b=>b.type==='image'))
 })
})

test('low confidence image description is marked on first sight and not recalled later',async t=>{
 const description='可能是一扇窗'
 const incoming={...refs[1],visual:{...visual,description,confidence:.3}}
 const h=harness(t,{rows:records()})
 install(h,[incoming])
 h.modules['image-familiar'].mediaFor=()=>[{...incoming,visual:undefined}]
 h.core.recordObservation({sourceId:visual.sourceId,chatId,evidenceType:'visual-interpretation',mediaIdentity:incoming.identity},
  {text:description,confidence:.3,uncertain:true})
 const current=await h.emit('prompt',[{type:'image',data:'test'}],{chat,sessionId:'owner',senderId:'10001',queryText:''})
 const prompt=current.map(b=>b.text).join('\n')
 assert.match(prompt,/低置信度/)
 assert.equal(prompt.split(description).length,2)
 assert.doesNotMatch(h.core.buildContext({chatId}).text,new RegExp(description))
})

test('follow-up to recent speech is not hijacked by an old image observation or pending receipt',t=>{
 const now=Date.now(),old=now-75*60000
 const history=refs.map((r,i)=>message(i+1,'[图片]',r.dir,chatId,old+i))
 const rows=[...history,message(4,'刚逛贴吧看到大家在数三','out',chatId,now-10000),
  message(5,'我也想跟着发一个','out',chatId,now-8000),
  message(6,'可你从来没这么干过呀？','in',chatId,now-1000)]
 const h=harness(t,{rows})
 install(h,refs.map((r,i)=>({...r,at:old+i})))
 h.core.recordObservation({sourceId:visual.sourceId,chatId,evidenceType:'visual-interpretation',observedAt:old},{text:visual.description})
 const followup=h.core.buildContext({chatId,now,query:'可你从来没这么干过呀？'})
 assert.doesNotMatch(followup.text,new RegExp(visual.description))
 assert.match(followup.text,/可你从来没这么干过呀？[\s\S]*我也想跟着发一个[\s\S]*刚逛贴吧看到大家在数三/)
 const image=h.core.buildContext({chatId,now,query:'之前那张动图是什么？'})
 assert.match(image.text,new RegExp(visual.description))
 assert.equal(image.text.split(visual.description).length,2)
})
