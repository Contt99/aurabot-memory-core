import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture} from './legacy-adapters-fixture.mjs'
import {harness} from '../core/harness.mjs'
import definition from '../../modules/qzone-social/index.mjs'

function setup(t,{responses={like_qzone:null,comment_qzone:{comment_id:'51'}},afterModel=()=>{},classifyError,tid='post-A'}={}){
 const legacy=fixture();t.after(legacy.close)
 const h=harness(t,{lib:key=>key==='onebot/client.js'?{isDefiniteFailure:classifyError}:undefined})
 h.cfg.speakUp={awakeFrom:0,awakeTo:24,idleMinutes:0,maxPerDay:10}
 h.cfg.qzoneSocial={enabled:true,commentFriends:true,replyOwn:false,like:true,intervalMin:1,maxPerDay:2,friendChance:1,ownerChance:1}
 h.modules['life-core']=h.core
 h.api.core.modules={status:()=>[{id:'qzone-social',running:'user'}]}
 const writes=[],reads=[]
 h.api.core.onebot={call:async(action,params,options)=>{
  if(action.startsWith('get_'))reads.push(action)
  else writes.push({action,params,options,state:h.routes.get('/candidates')({headers:{host:'localhost'}}).items.find(c=>c.status==='sending')})
  if(action==='get_qzone_feeds')return {feeds:[{appid:311,uin:77777,key:'feed-A',tid,time:Math.floor(Date.now()/1000),html:'纸风车',nickname:'朋友'}]}
  if(action==='get_qzone_msg_detail')return {tid:params.tid,content:'今天试做了一个纸风车。',comments:[]}
  if(action==='get_qzone_msg_list')return {msglist:[]}
  if(responses[action] instanceof Error)throw responses[action]
  return responses[action]
 }}
 let models=0
 const mod=h.modules['qzone-social']=definition.setup({...h.api,id:'qzone-social',lib:legacy.api.lib,lazy:()=>null,
  ask:async ()=>{models++;await afterModel(h);return '纸风车挺有意思呀。'}})
 const recent=()=>h.routes.get('/candidates')({headers:{host:'localhost'}}).items
 return{...h,mod,writes,reads,models:()=>models,recent,
  resetCompatibilityState:()=>legacy.files.delete(legacy.api.lib('core/store.js').dataDir('qzone-social.json'))}
}

test('space timer uses distinct durable like/comment attempts and trusts only the platform contracts',async t=>{
 const f=setup(t)
 assert.equal(f.core.ownsSchedule('qzone-social','interact-tick'),true)
 await f.mod.tick()
 assert.deepEqual(f.writes.map(w=>w.action),['like_qzone','comment_qzone'])
 for(const w of f.writes){
  assert(w.state,'running write must already be durable')
  assert.equal(w.options.retries,0)
  assert.equal(w.params.tid,'post-A')
 }
 assert.deepEqual(f.recent().map(r=>r.status),['sent','sent'])
 assert.equal(f.recent().find(r=>r.job==='comment').receipt,'51')
 assert(f.recent().find(r=>r.job==='like').receipt)
 assert.equal(f.mod.state().count,1)
 assert.equal(f.core.proactiveState().count,0)
 const detail=f.core.queryExperiences({purpose:'chat',chatId:'private:10001'}).find(r=>r.evidence?.tid==='post-A')
 f.core.forgetPerson('10001','',{exactSources:true,sourceIds:[detail.id],chatId:'private:10001'})
 assert(!f.mod.state().history.some(r=>r.kind==='comment'))
 assert.equal(f.mod.state().count,1,'forget does not restore an already-used daily slot')
})

test('missing remote identifiers stay unknown, and a revoked draft is never sent',async t=>{
 const noAck=setup(t,{responses:{like_qzone:undefined,comment_qzone:{comment_id:''}}})
 await noAck.mod.tick()
 noAck.resetCompatibilityState()
 await noAck.mod.run()
 assert.deepEqual(noAck.recent().map(r=>r.status),['unknown','unknown'])
 assert.equal(noAck.mod.state().count,0)
 assert.equal(noAck.mod.state().reserved,1,'an uncertain comment may already count on QQ Space')
 assert.equal(noAck.writes.length,2)
 const revoked=setup(t,{afterModel:h=>{h.cfg.qzoneSocial.commentFriends=false}})
 await revoked.mod.tick()
 assert.deepEqual(revoked.writes.map(w=>w.action),['like_qzone'])
 assert.equal(revoked.mod.state().count,0)
})

test('forgetting the exact post detail while composing suppresses its derived comment',async t=>{
 const f=setup(t,{afterModel:h=>{
  const row=h.core.queryExperiences({purpose:'chat',chatId:'private:10001'}).find(r=>r.evidence?.tid==='post-A')
  assert.ok(row)
  assert(h.core.forgetPerson('10001','',{exactSources:true,sourceIds:[row.id],chatId:'private:10001'}).ok)
 }})
 await f.mod.tick()
 assert.equal(f.models(),1)
 assert.deepEqual(f.writes.map(r=>r.action),['like_qzone'])
 assert.equal(f.mod.state().count,0)
})

test('an unrelated caller cannot use a prior observation to issue a Qzone write',async t=>{
 const f=setup(t)
 const ready=await f.core.performEvidence({module:'qzone-social',action:'feed-read',sourceScopes:['private:10001']},async()=>({
  feeds:[{appid:311,uin:77777,key:'post-A',time:Math.floor(Date.now()/1000)}]
 }))
 const result=await f.core.runQzoneInteraction({job:'like',postId:'post-A',targetUin:'77777',sourceId:ready.experienceId})
 assert.equal(result.status,'unavailable')
 assert.deepEqual(f.writes,[])
})

test('an incomplete life-core pauses automatic space writes without removing manual entry',async t=>{
 const f=setup(t)
 f.modules['life-core']={}
 assert.equal((await f.mod.run()).ok,false)
 assert.equal(f.writes.length,0)
 assert.equal(f.reads.length,0)
 assert.equal((await f.mod.run({force:true})).comments,1)
})

test('a confirmed platform rejection does not reserve a daily comment slot',async t=>{
 const failure=new Error('platform refused')
 const f=setup(t,{responses:{like_qzone:null,comment_qzone:failure},classifyError:error=>error===failure})
 await f.mod.tick()
 assert.equal(f.recent().find(r=>r.job==='comment').status,'not-sent')
 assert.equal(f.mod.state().reserved,0)
})

test('a comment drafted for one logged-in QQ account cannot send from another',async t=>{
 const f=setup(t,{afterModel:h=>{h.api.core.hub.selfId='10005'}})
 await f.mod.tick()
 assert.equal(f.models(),1)
 assert.deepEqual(f.writes.map(r=>r.action),['like_qzone'])
})

test('a dynamic feed handle is never passed off as a writable post ID',async t=>{
 const f=setup(t,{tid:null})
 await f.mod.tick()
 assert.deepEqual(f.reads,['get_qzone_feeds'])
 assert.deepEqual(f.writes,[])
 assert.equal(f.models(),0)
})
