import test from 'node:test'
import assert from 'node:assert/strict'
import {harness} from '../core/harness.mjs'
import {fixture} from './legacy-adapters-fixture.mjs'
import {bindApi,createQzone} from '../../modules/diary/lib/features/qzone.js'
import {createLifeAdapter} from '../../modules/diary/life.mjs'
import {createPrivateJournal,journalDate} from '../../modules/autonomy/lib/private-journal.mjs'

function setup(t,{remote={tid:'space001',time:1795413600},compose}={}){
 const store=fixture();t.after(store.close)
 let now=new Date(2026,10,23,14).getTime(),asks=0,calls=0
 const h=harness(t,{now:()=>now})
 h.cfg.diary={...store.cfg.diary,windowStart:'13:59',windowEnd:'15:00'}
 h.modules['life-core']=h.core
 const diaryApi={...h.api,id:'diary',lib:store.api.lib}
 bindApi(diaryApi)
 const qzone=h.modules.diary=createQzone({getConfig:diaryApi.config,life:createLifeAdapter(diaryApi),hub:h.api.core.hub,
  onebot:{call:async(action,params,options)=>{
   calls++
   assert.equal(action,'send_qzone_msg')
   assert.equal(params.ugc_right,4)
   assert.equal(options.retries,0)
   return remote
  }},log:h.api.log,now:()=>now,rand:()=>0,composeDiary:async args=>{
   asks++
   return compose?compose(h,args):{text:'读了一篇纸风车的文章。',images:[],media:[]}
  }})
 return{...h,qzone,now:()=>now,advance:mins=>{now+=mins*60000},tick:()=>h.timers.get('统一后台调度')(),
  counts:()=>({asks,calls}),recent:()=>h.routes.get('/candidates')({headers:{host:'localhost'}}).items}
}

test('automatic public diary queues first and consumes one day slot only once with a native space receipt',async t=>{
 const f=setup(t)
 await f.qzone.tick();await f.qzone.tick()
 assert.deepEqual(f.counts(),{asks:0,calls:0})
 assert.equal(f.recent().length,1)
 assert.equal(f.recent()[0].status,'queued')
 await f.tick()
 assert.deepEqual(f.counts(),{asks:1,calls:1})
 assert.equal(f.recent()[0].receipt,'space001')
 assert.equal(f.recent()[0].status,'sent')
 assert.equal(f.core.proactiveState().count,0)
 await f.qzone.tick();await f.tick()
 assert.deepEqual(f.counts(),{asks:1,calls:1})
 assert.equal(f.qzone.history()[0].tid,'space001')
})

test('space dispatch expires outside its window; an unconfirmed response is not retried',async t=>{
 const late=setup(t)
 await late.qzone.tick();late.advance(60);await late.tick()
 assert.equal(late.recent()[0].status,'expired')
 assert.deepEqual(late.counts(),{asks:0,calls:0})
 const missing=setup(t,{remote:{ok:true}})
 await missing.qzone.tick();await missing.tick();await missing.qzone.tick();await missing.tick()
 assert.equal(missing.recent()[0].status,'unknown')
 assert.deepEqual(missing.counts(),{asks:1,calls:1})
 const manual=await missing.qzone.writeDiary()
 assert.equal(manual.ok,false)
 assert.match(manual.message,/待核实/)
 assert.deepEqual(missing.counts(),{asks:1,calls:1})
})

test('revoked group sources stop the scheduled publish without saving draft text',async t=>{
 const f=setup(t,{compose:async h=>{
  const sources=h.core.diarySources('public')
  assert.equal(sources.length,1)
  h.cfg.diary.sourceGroups=[]
  return {text:'这个群素材不再获准。',images:[],media:[],sourceRefs:sources}
 }})
 f.cfg.diary.sourceGroups=['20001']
 f.cfg.ext.autonomy={diarySourceGroups:[]}
 f.modules['history-vault'].diaryMaterial=({groups})=>groups.includes('group:20001')?
  [{id:'vault:1',chatId:'group:20001',uid:'10003',text:'合成群聊材料',t:f.now()}]:[]
 assert.equal(f.core.diarySources('private').length,0)
 await f.qzone.tick();await f.tick()
 assert.deepEqual(f.counts(),{asks:1,calls:0})
 assert.equal(f.recent()[0].status,'not-sent')
 assert.equal(f.qzone.history()[0].text,'')
})

test('switching to dry run during generation never writes the scheduled draft to history',async t=>{
 const f=setup(t,{compose:async h=>{
  h.cfg.dryRun=true
  return{text:'这段未提交的正文不能出现在历史。',images:[],media:[]}
 }})
 await f.qzone.tick();await f.tick()
 assert.deepEqual(f.counts(),{asks:1,calls:0})
 assert.equal(f.recent()[0].status,'not-sent')
 assert.equal(f.qzone.history()[0].text,'')
})

test('a simulated native-shaped receipt is still unconfirmed',async t=>{
 const f=setup(t,{remote:{tid:'space001',time:1795413600,simulated:true}})
 await f.qzone.tick();await f.tick()
 assert.equal(f.recent()[0].status,'unknown')
 assert.equal(f.qzone.history()[0].ok,false)
})

test('registering a market tool does not grant the diary publish outlet',async t=>{
 const f=setup(t),[job]=f.qzone.lifeJobs()
 f.modules['other-module']={lifeJobs:()=>[job]}
 const result=f.core.queueCandidate({module:'other-module',job:'publish',key:'slot',target:'qzone:10002',expiresAt:f.now()+60000})
 assert.equal(result.status,'unavailable')
 assert.deepEqual(f.recent(),[])
})

test('private journal receipt is from the local file only, with forgetting independent of public diary',async t=>{
 const f=setup(t)
 f.cfg.ext.autonomy={diarySourceGroups:[]}
 const row=await f.core.performEvidence({module:'web',action:'read',public:true,evidenceType:'web-body'},async()=>({ok:true,text:'纸风车文章正文'}))
 const id=row.experienceId
 let asks=0
 const journal=createPrivateJournal({...f.api,id:'autonomy'}, {assertActive(){},ask:async()=>++asks===1
  ?JSON.stringify({text:'读了纸风车文章。',sourceIds:[id],notes:[],unresolvedQuestions:[]})
  :JSON.stringify({approved:true,sourceIds:[id],issues:[]})})
 f.modules.autonomy={lifeJobs:()=>[journal.job]}
 const res=await f.core.runDiaryCandidate({module:'autonomy',job:'journal',key:'wake-1',target:'server:private-journal',expiresAt:f.now()+180000})
 assert.equal(res.status,'saved')
 const [receipt]=f.recent()
 assert.equal(receipt.status,'saved')
 assert.equal(receipt.receipt,journal.day(journalDate())[0].id)
 assert.deepEqual(receipt.sourceIds,[id])
 assert.deepEqual(f.counts(),{asks:0,calls:0})
 assert.equal(f.core.proactiveState().count,0)
 f.core.forgetPerson('10001','',{exactSources:true,sourceIds:[id]})
 assert.deepEqual(journal.dates(),[])
 assert.deepEqual(f.recent()[0].sourceIds,[])
 assert.equal(f.recent()[0].receipt,null)
})
