import test from 'node:test'
import assert from 'node:assert/strict'
import {createScheduleDispatcher} from '../../modules/life-core/lib/schedule-dispatch.mjs'

test('one host clock dispatches enabled providers and does not overlap a slow tick',async()=>{
 let at=100000,active=true,enabled=true,calls=0,other=0,release
 const wait=new Promise(r=>{release=r})
 const providers={
  bili:{lifeSchedules:()=>[{id:'browse',intervalMs:60000,run:async()=>{calls++;await wait}}]},
  rss:{lifeSchedules:()=>[{id:'read',intervalMs:60000,run:()=>{other++}}]}
 }
 const api={core:{modules:{status:()=>Object.keys(providers).map(id=>({id,running:'user'}))}},use:id=>providers[id]}
 const s=createScheduleDispatcher({api,active:()=>active,enabled:id=>id!=='bili'||enabled,now:()=>at})
 assert.equal(s.owns('bili','browse'),true)
 await s.tick()
 assert.equal(calls,0)
 at+=60000
 const first=s.tick()
 await new Promise(setImmediate)
 assert.equal(calls,1)
 assert.equal(other,1)
 at+=60000
 await s.tick()
 assert.equal(calls,1)
 assert.equal(other,2)
 release()
 await first
 await s.tick()
 assert.equal(calls,2)
 assert.equal(s.inventory().find(x=>x.module==='bili').status,'checked')
 active=false
 at+=60000
 await s.tick()
 assert.equal(calls,2)
 enabled=false
 assert.equal(s.owns('bili','browse'),false)
})
