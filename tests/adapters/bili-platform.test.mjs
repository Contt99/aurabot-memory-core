import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdirSync} from 'node:fs'
import {harness} from '../core/harness.mjs'
import {fixture} from './legacy-adapters-fixture.mjs'
import {createLifeAdapter} from '../../modules/bili/life.mjs'
import {createBili,bindApi as bindDuty} from '../../modules/bili/lib/bili/duty.js'
import {bindApi as bindShots} from '../../modules/bili/lib/bili/shots.js'
import {bindApi as bindVision} from '../../modules/bili/lib/bili/vision.js'
import {createBiliApi,bindApi as bindTransport} from '../../modules/bili/lib/bili/api.js'

const video={bvid:'BV1234567890',aid:177,title:'纸风车',author:'示例 UP'}
const notice={id:'733',type:1,oid:177,root:710,parent:711,title:'纸风车',name:'示例观众',text:'风车很好看',myText:'我也喜欢'}
function setup(t,{reply,liked,afterDraft=()=>{},beforeWrite=()=>{},share=false,shot=false,beforeQQ=()=>{},filterQQ=x=>x}={}){
 const f=fixture();t.after(f.close)
 bindDuty(f.api);bindShots(f.api);bindVision(f.api)
 let clock=Date.now()
 t.mock.method(Date,'now',()=>clock)
 const h=harness(t,{now:()=>clock})
 h.cfg.group={interests:[]}
 h.cfg.speakUp={awakeFrom:0,awakeTo:24,maxPerDay:5,idleMinutes:0,minIntervalMinutes:1,maxIntervalMinutes:1}
 h.cfg.bili={enabled:true,autoBrowse:true,reply:true,comment:true,like:true,
  cookie:'SESSDATA=synthetic;bili_jct=fixture;DedeUserID=22222',keywords:['风车'],perRun:1,
  maxCommentsPerDay:3,maxRepliesPerDay:3,shareToOwner:share,vision:shot,shotChance:shot?1:0}
 mkdirSync(f.api.lib('core/store.js').dataDir('bili-shots'))
 h.api.core.modules={status:()=>[{id:'bili',running:'user'}]}
 h.modules['life-core']=h.core
 const sent=[],asks=[]
 const qq=[]
 const deliver=async(target,segments,options)=>{
  await beforeQQ(h)
  if(options?.isCurrent&&!options.isCurrent())return null
  segments=filterQQ(segments)
  const id=String(870+qq.length)
  qq.push({target,segments})
  h.emit('sent',segments,{chatId:target,messageId:id,at:clock})
  return {message_id:id}
 }
 Object.assign(h.api.core.hub,{
  sendText:(target,text,_a,_b,_c,options)=>deliver(target,[{type:'text',data:{text}}],options),
  sendSegments:(target,segments,_note,options)=>deliver(target,segments,options),
  sendImage:(target,file)=>deliver(target,[{type:'image',data:{file}}]),
 })
 const recent=()=>h.routes.get('/candidates')({headers:{host:'localhost'}}).items
 const api={
  nav:async()=>({isLogin:true,mid:22222}),search:async()=>[video],popular:async()=>[],view:async()=>video,
  subtitle:async()=> '用纸做的风轮',comments:async()=>[],replyFeed:async()=>[notice],
  postComment:async(aid,text,options)=>{
   await beforeWrite(h)
   options?.beforePost?.()
   sent.push({op:options?.root?'reply':'comment',aid,text,root:options?.root,parent:options?.parent,rows:recent()})
   return reply?reply(options):{rpid_str:options?.root?'92000000000000319':'92000000000000318'}
  },
  likeVideo:async(aid,options)=>{
   options?.beforePost?.()
   sent.push({op:'like',aid,rows:recent()})
   return liked?liked():{accepted:true}
  },
 }
 const adapterApi={...h.api,id:'bili',ask:async o=>{
  asks.push(o)
  if(o.text.includes('挑 3 个'))return '["风车"]'
  await afterDraft(h)
  if(o.text.includes('回复你'))return '谢谢！'
  return JSON.stringify([{i:1,feeling:'喜欢风车',comment:'做得真好呀',share:share?'这段风车视频挺有意思':''}])
 }}
 const mod=h.modules.bili=createBili({getConfig:h.api.config,hub:h.api.core.hub,log:{...h.api.log,debug(){}},
  life:createLifeAdapter(adapterApi),ask:adapterApi.ask,api,
  vision:async()=>({text:'画面里有个风轮',frames:[{buf:Buffer.from([0xff,0xd8,0xff,0xd9]),sec:3}]})})
 return {...h,mod,sent,recent,asks,qq,resetLegacy:()=>f.files.clear(),
  tick:()=>{clock+=60000;return h.timers.get('统一后台调度')()}}
}

test('Bili timer uses durable candidates, exact native IDs, and separate platform quotas',async t=>{
 const f=setup(t)
 await f.mod.checkReplies({allowLegacy:false})
 await f.mod.run({automatic:true})
 assert.deepEqual(f.sent.map(x=>x.op),['reply','comment','like'])
 assert.ok(f.sent.every(x=>x.rows.some(r=>r.job===x.op&&r.status==='sending'&&r.sourceIds.length)))
 assert.equal(f.sent[0].root,'710')
 assert.equal(f.sent[0].parent,'711')
 assert.equal(f.recent().find(x=>x.job==='reply').receipt,'92000000000000319')
 assert.equal(f.recent().find(x=>x.job==='comment').receipt,'92000000000000318')
 assert.equal(f.mod.state().comments,1)
 assert.equal(f.mod.state().replies,1)
 assert.equal(f.core.proactiveState().count,0)
})

test('Bili refuses to repeat an unconfirmed comment and does not call it sent',async t=>{
 const f=setup(t,{reply:()=>({rpid:9007199254740992}),liked:()=>undefined})
 await f.mod.run({automatic:true})
 f.resetLegacy()
 await f.mod.run({automatic:true})
 assert.deepEqual(f.sent.map(x=>x.op),['comment','like'])
 assert.deepEqual(f.recent().map(x=>x.status),['unknown','unknown'])
 assert.equal(f.mod.state().comments,0)
})

test('Bili rechecks the account and source immediately before writes',async t=>{
 const f=setup(t,{beforeWrite:h=>{h.cfg.bili.cookie='SESSDATA=changed;bili_jct=replaced;DedeUserID=33333'}})
 await f.mod.run({automatic:true})
 assert.deepEqual(f.sent,[])
 assert.equal(f.recent()[0].status,'not-sent')
})

test('a forgotten video cannot become a public comment or like',async t=>{
 const f=setup(t,{afterDraft:h=>{
  const watched=h.core.queryExperiences({purpose:'public-diary'}).find(x=>x.evidence?.evidenceType!=='search-summary'&&x.evidence?.bvid===video.bvid)
  assert.ok(watched)
  h.core.forgetPerson('10001','',{exactSources:true,sourceIds:[watched.id]})
 }})
 await f.mod.run({automatic:true})
 assert.deepEqual(f.sent,[])
 assert.deepEqual(f.recent(),[])
})

test('Bili transport uses string replies and distinguishes HTTP uncertainty from platform rejection',async t=>{
 const f=fixture();t.after(f.close);bindTransport(f.api)
 const requests=[]
 let response=new Response(JSON.stringify({code:0,data:{rpid:92000000000000318,rpid_str:'92000000000000318'}}))
 const api=createBiliApi({getCookie:()=> 'SESSDATA=synthetic;bili_jct=fixture',fetchImpl:async (url,options)=>{
  requests.push({url,options})
  return response
 }})
 const guard=()=>{assert.equal(requests.length,0)}
 assert.equal((await api.postComment('177','好看',{root:'710',parent:'711',beforePost:guard})).rpid_str,'92000000000000318')
 assert.equal(new URLSearchParams(requests[0].options.body).get('parent'),'711')
 response=new Response(JSON.stringify({code:-352,message:'blocked'}))
 await assert.rejects(api.likeVideo('177'),{code:-352,biliRejected:true})
 response=new Response(JSON.stringify({code:0}),{status:502})
 await assert.rejects(api.likeVideo('177'),e=>e.biliRejected!==true)
 await assert.rejects(api.postComment('177','好看',{beforePost:()=>{throw Error('revoked')}}),/revoked/)
 assert.equal(requests.length,3)
 response=new Response(JSON.stringify({code:0,data:null}))
 assert.deepEqual(await api.likeVideo('177'),{accepted:true})
})

test('Bili preserves its one draft and sends link and screenshot once under shared contact policy',async t=>{
 const f=setup(t,{share:true,shot:true})
 const r=await f.mod.run({automatic:true})
 assert.equal(r.shared,0)
 assert.equal(f.qq.length,0)
 assert.deepEqual(f.recent().filter(x=>x.target==='private:10001').map(x=>x.status),['queued','queued'])
 assert.equal(f.asks.length,2)
 await f.tick();await f.tick()
 assert.equal(f.asks.length,2)
 assert.equal(f.qq.length,2)
 assert.equal(f.qq[0].target,'private:10001')
 assert.equal(f.qq[0].segments[0].data.text,'这段风车视频挺有意思\nhttps://www.bilibili.com/video/BV1234567890')
 assert.deepEqual(f.qq[1].segments.map(s=>s.type),['image','text'])
 assert.match(f.qq[1].segments[0].data.file,/^base64:/)
 assert.equal(f.qq[1].segments[1].data.text,'喜欢风车')
 assert.equal(f.core.proactiveState().count,2)
 const snap=f.core.buildContext({purpose:'chat',chatId:'private:10001',query:'你刚才发的风车'})
 assert.match(snap.text,/这段风车视频挺有意思/)
 assert.doesNotMatch(f.core.buildContext({purpose:'chat',chatId:'private:10003',query:'风车'}).text,/这段风车视频挺有意思/)
})

test('withdrawing sources at the final filtering boundary prevents a Bili share',async t=>{
 let f
 f=setup(t,{share:true,beforeQQ:({core})=>{
  const row=f.recent().find(x=>x.job==='share')
  core.forgetPerson('10001','',{exactSources:true,sourceIds:row.sourceIds})
 }})
 await f.mod.run({automatic:true});await f.tick()
 assert.equal(f.qq.length,0)
 const row=f.recent().find(x=>x.job==='share')
 assert.equal(row.status,'not-sent')
 assert.deepEqual(row.sourceIds,[])
})

test('a gateway ACK for a rewritten caption alone is not a confirmed Bili screenshot',async t=>{
 const f=setup(t,{shot:true,filterQQ:segments=>segments.filter(s=>s.type!=='image')})
 await f.mod.run({automatic:true});await f.tick()
 const shot=f.recent().find(x=>x.job==='shot')
 assert.equal(f.qq.length,1)
 assert.deepEqual(f.qq[0].segments.map(s=>s.type),['text'])
 assert.equal(shot.status,'unknown')
 assert.equal(shot.reason,'content-unconfirmed')
 assert.equal(shot.receipt,null)
 await f.tick()
 assert.equal(f.qq.length,1)
})

test('an outbound filter replacing frame bytes cannot confirm the original Bili frame',async t=>{
 const f=setup(t,{shot:true,filterQQ:segments=>{
  segments[0].data.file='base64://REPLACED'
  return segments
 }})
 await f.mod.run({automatic:true});await f.tick()
 assert.equal(f.qq[0].segments[0].data.file,'base64://REPLACED')
 assert.equal(f.recent().find(x=>x.job==='shot')?.status,'unknown')
})
