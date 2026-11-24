import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import night from '../../modules/night/index.mjs'
import {harness} from '../core/harness.mjs'

async function setup(t,{afterModel=()=>{},shared={},settings={},model='早呀，我刚醒。'}={}){
 let clock=new Date(2026,10,24,12,0).getTime()
 t.mock.method(Date,'now',()=>clock)
 const h=harness(t,{now:()=>clock}),asks=[],sent=[],heartbeats=[]
 h.cfg.speakUp={awakeFrom:0,awakeTo:24,idleMinutes:0,maxPerDay:5,...shared}
 h.modules['life-core']=h.core
 h.cfg.ext.night={enabled:true,morningGreeting:true,dreamAutoEnabled:false,latestSleepTime:'invalid',nightFatigue:'',noonFatigue:'',...settings}
 h.api.core.modules={status:()=>[{id:'night',running:'user'}]}
 h.api.core.hub.sendText=async(chatId,text,_reply,_missed,_user,options)=>{
  if(!options.isCurrent())return null
  const current=h.routes.get('/candidates')({headers:{host:'localhost'}}).items[0]
  assert.equal(current.status,'sending')
  sent.push({chatId,text})
  return {message_id:'771'}
 }
 const module=h.modules.night=await night.setup({...h.api,id:'night',settings:()=>h.cfg.ext.night,
  command(){},later(){},every:(_interval,tick)=>heartbeats.push(tick),ask:async options=>{
   asks.push(options);await afterModel(h);return model
  },send:async()=>assert.fail('the scheduled greeting must not go directly through api.send')})
 const {state}=module.service
 Object.assign(state,{mode:'asleep',sleepAt:clock-60*60000,wakeAt:clock+60000,sleepKind:'night'})
 module.dreamer.items.push({id:'private-dream',createdAt:clock-3600000,text:'PRIVATE_DREAM_BODY'})
 state.morningDreamId='private-dream'
 return {...h,module,asks,sent,
  async wake(){clock+=60000;await heartbeats[0]();await h.timers.get('统一后台调度')()},
  async tick(minutes=1){clock+=minutes*60000;await h.timers.get('统一后台调度')()},
  recent:()=>h.routes.get('/candidates')({headers:{host:'localhost'}}).items,
  dreams(){
   const db=new DatabaseSync(h.api.dataDir('life.sqlite'),{readOnly:true})
   try{return db.prepare("SELECT status,meta,result FROM actions WHERE json_extract(meta,'$.action') = 'dream-generate'").all()}
   finally{db.close()}
  }}
}

test('natural waking uses one timely owner-scoped candidate and one native receipt',async t=>{
 const f=await setup(t)
 await f.wake()
 assert.equal(f.module.service.state.mode,'awake')
 assert.equal(f.recent()[0].status,'sent')
 assert.deepEqual(f.sent,[{chatId:'private:10001',text:'早呀，我刚醒。'}])
 assert.doesNotMatch(JSON.stringify(f.asks),/PRIVATE_DREAM_BODY/)
 assert.equal(f.recent()[0].receipt,'771')
 assert.equal(f.core.proactiveState().count,1)
 await f.tick()
 assert.equal(f.sent.length,1)
})

test('wake events in quiet time expire rather than becoming late greetings',async t=>{
 const f=await setup(t,{shared:{awakeFrom:15,awakeTo:23}})
 await f.wake()
 await f.tick(5)
 assert.equal(f.recent()[0].status,'expired')
 assert.equal(f.asks.length,0)
 assert.equal(f.core.proactiveState().count,0)
})

test('changing the owner during generation withdraws the wake greeting',async t=>{
 const f=await setup(t,{afterModel:h=>{h.cfg.ownerQQ='10019'}})
 await f.wake()
 await f.tick()
 assert.equal(f.asks.length,1)
 assert.equal(f.sent.length,0)
 assert.equal(f.recent()[0].status,'not-sent')
})

test('a dream that fails to reach disk is not recorded as a successful private experience',async t=>{
 const f=await setup(t,{model:'{"text":"合成梦的正文","level":5}'})
 f.module.dreamer.save=()=>false
 assert.equal(await f.module.dreamer.make(),null)
 assert.equal(f.module.dreamer.items.some(d=>d.text==='合成梦的正文'),false)
 assert.deepEqual(f.dreams().map(d=>d.status),['failed'])
})

test('automatic dreams run on the central clock, with no body in the action ledger',async t=>{
 const f=await setup(t,{settings:{dreamAutoEnabled:true,dreamInRemOnly:false,dreamIntervalMinutes:5},model:'{"text":"SYNTHETIC_DREAM_ONLY","level":5}'})
 f.module.service.state.wakeAt+=3600000
 assert.equal(f.core.ownsSchedule('night','night-action-tick'),true)
 await f.tick()
 assert.equal(f.asks.length,1)
 assert.ok(f.module.dreamer.items.some(d=>d.text==='SYNTHETIC_DREAM_ONLY'))
 const [row]=f.dreams()
 assert.equal(row.status,'succeeded')
 assert.equal(JSON.parse(row.meta).chatId,'private:10001')
 assert.doesNotMatch(JSON.stringify(row),/SYNTHETIC_DREAM_ONLY/)
 assert.doesNotMatch(JSON.stringify(f.core.buildContext({purpose:'chat',chatId:'private:10001'})),/SYNTHETIC_DREAM_ONLY/)
 assert.equal(f.core.queryExperiences({purpose:'chat',chatId:'private:10003'}).some(a=>a.action==='dream-generate'),false)
 await f.tick()
 assert.equal(f.asks.length,1)
})

test('an automatic dream cannot complete after that sleep has ended',async t=>{
 const f=await setup(t,{settings:{dreamAutoEnabled:true,dreamInRemOnly:false,morningGreeting:false},
  afterModel:async h=>h.modules.night.wake(),model:'{"text":"SYNTHETIC_DREAM_ENDED","level":5}'})
 f.module.service.state.wakeAt+=3600000
 await f.tick()
 assert.deepEqual(f.dreams().map(d=>d.status),['interrupted'])
 assert.equal(f.module.dreamer.items.some(d=>d.text==='SYNTHETIC_DREAM_ENDED'),false)
})
