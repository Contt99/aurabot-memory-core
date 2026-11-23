import test from 'node:test'
import assert from 'node:assert/strict'
import {harness} from './harness.mjs'

const incomingId='market-weather--current'
test('host module inventory discovers an opt-in read tool and records the real result once',async t=>{
 const h=harness(t)
 h.api.core.modules={status:()=>Object.keys(h.modules).map(id=>({id,running:'user'}))}
 let calls=0
 h.modules['market-weather']={lifeCapabilities:()=>[{
  id:'current',name:'读取天气',effect:'read',args:{city:'城市名'},required:['city'],run:async({city})=>{calls++;return{ok:true,message:city+' 阴天',url:'https://weather.example.test/cities'}}
 }]}
 const tool=()=>h.core.capabilities().find(x=>x.id===incomingId)
 assert.equal(tool()?.available,false)
 assert.equal((await h.core.execute(incomingId,{city:'苏州'})).status,'unavailable')
 h.cfg.ext['life-core']={autonomyTools:incomingId}
 assert.deepEqual(tool()?.args,{city:'城市名'})
 assert.equal(tool()?.available,true)
 assert.equal((await h.core.execute(incomingId,{})).ok,false)
 assert.equal(calls,0)
 const ctx={callId:'weather-one',source:'autonomy',chatId:'private:10001'}
 const r=await h.core.execute(incomingId,{city:'苏州'},ctx)
 const replay=await h.core.execute(incomingId,{city:'苏州'},ctx)
 assert.equal(r.value.message,'苏州 阴天')
 assert.equal(r.experienceId,replay.experienceId)
 assert.equal(calls,1)
 assert.equal((await h.core.execute(incomingId,{city:'苏州'},{...ctx,chatId:'private:10003'})).status,'unavailable')
 assert.match(h.core.experienceDetail(r.experienceId,'private:10001').item.text,/苏州 阴天/)
 const scheduled=await h.core.execute(incomingId,{city:'苏州'})
 assert.equal(h.core.experienceDetail(scheduled.experienceId,'private:10003').ok,false)
 assert.equal(h.core.experienceDetail(scheduled.experienceId,'private:10001').ok,true)
 h.cfg.ext['life-core'].autonomyTools=''
 assert.equal(tool()?.available,false)
 assert.equal((await h.core.execute(incomingId,{city:'苏州'})).status,'unavailable')
})

test('discovery never treats declared writes or unavailable providers as exploration tools',async t=>{
 const h=harness(t)
 h.api.core.modules={status:()=>[{id:'publisher',running:'user'}]}
 h.cfg.ext['life-core']={autonomyTools:'publisher--post publisher--browse'}
 let calls=0
 const run=()=>{calls++;return{ok:true,message:'unexpected'}}
 h.modules.publisher={lifeCapabilities:()=>[
  {id:'post',effect:'external-write',run},
  {id:'browse',effect:'read',available:false,run}
 ]}
 for(const id of ['publisher--post','publisher--browse']){
  assert.notEqual(h.core.capabilities().find(c=>c.id===id)?.available,true)
  assert.equal((await h.core.execute(id,{})).status,'unavailable')
 }
 assert.equal(calls,0)
})

test('a revoked tool cannot inject its late response into autonomy',async t=>{
 const h=harness(t),started=Promise.withResolvers(),reply=Promise.withResolvers()
 h.api.core.modules={status:()=>[{id:'market-weather',running:'user'}]}
 h.cfg.ext['life-core']={autonomyTools:incomingId}
 h.modules['market-weather']={lifeCapabilities:()=>[{
  id:'current',effect:'read',run:()=>{started.resolve();return reply.promise}
 }]}
 const attempt=h.core.execute(incomingId)
 await started.promise
 h.cfg.ext['life-core'].autonomyTools=''
 reply.resolve({ok:true,message:'late private response'})
 const r=await attempt
 assert.equal(r.status,'interrupted')
 assert.equal(r.ok,false)
 assert.doesNotMatch(JSON.stringify(r),/late private response/)
})

test('exploration never falls back to the Bili browse-and-interact runner',async t=>{
 const h=harness(t)
 let legacy=0,read=0
 h.modules.bili={run:async()=>{legacy++;return{ok:true}}}
 assert.equal((await h.core.execute('bili_browse',{})).status,'unavailable')
 h.modules.bili.browseReadOnly=async({query})=>{read++;return{ok:true,evidenceType:'video-metadata',message:'from '+query}}
 const r=await h.core.execute('bili_browse',{query:'座头鲸'})
 assert.match(r.value.message,/座头鲸/)
 assert.equal(read,1)
 assert.equal(legacy,0)
})
