import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture} from './legacy-adapters-fixture.mjs'
import {createLifeAdapter} from '../../modules/bili/life.mjs'
import {createBili,bindApi} from '../../modules/bili/lib/bili/duty.js'
test('public Bili keyword selection excludes unscoped private legacy memory',async()=>{
 const f=fixture();try{
  Object.assign(f.cfg,{bili:{enabled:true,keywords:['星'],perRun:1,minViews:0,maxAgeDays:100}})
  Object.assign(f.life,{contextManaged:()=>true,buildContext:o=>({id:'s',...o,text:'PUBLIC',items:[]}),assertContextCurrent(){},validateDraft:()=>({ok:true}),runWithContext:(s,fn)=>fn()})
  let prompt='';f.api.ask=async({text:p})=>{prompt=p;return '["星"]'}
  const memory={recentEvents:()=>[{tags:['B站'],text:'不应外泄的私人B站记录'}]}
  bindApi(f.api);const b=createBili({getConfig:f.api.config,hub:f.hub,log:f.api.log,memory,life:createLifeAdapter(f.api),ask:f.api.ask,api:{search:async()=>[],popular:async()=>[]}})
  await b.run();assert.match(prompt,/PUBLIC/);assert.doesNotMatch(prompt,/不应外泄/)
 }finally{f.close()}
})
