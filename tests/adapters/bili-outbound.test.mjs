import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture} from './legacy-adapters-fixture.mjs'
import {createLifeAdapter} from '../../modules/bili/life.mjs'
import {createBili,bindApi} from '../../modules/bili/lib/bili/duty.js'
test('revoked Bili snapshot blocks actual comment and QQ share calls',async()=>{
 const f=fixture();try{
  Object.assign(f.cfg,{bili:{enabled:true,keywords:['星'],perRun:1,minViews:0,maxAgeDays:100,comment:true,maxCommentsPerDay:2,shareToOwner:true,like:false,vision:false,shotChance:0}})
  let current=true, calls=0, comments=0,sends=0
  Object.assign(f.life,{contextManaged:()=>true,buildContext:o=>({id:'s',...o,text:'PUBLIC',items:[]}),assertContextCurrent(){if(!current)throw Error('revoked')},validateDraft:()=>({ok:true}),runWithContext:(s,fn)=>fn()})
  f.api.ask=async()=>{if(++calls===1)return '["星"]';current=false;return '[{"i":1,"comment":"评论","share":"分享"}]'}
  f.hub.sendText=async()=>{sends++;return {message_id:1}};const info={bvid:'BV1234567890',aid:1,title:'星空'}
  const upstream={search:async()=>[info],popular:async()=>[],view:async()=>info,subtitle:async()=>'',comments:async()=>[],postComment:async()=>{comments++;return {rpid:1}}}
  bindApi(f.api);const b=createBili({getConfig:f.api.config,hub:f.hub,log:f.api.log,life:createLifeAdapter(f.api),ask:f.api.ask,api:upstream});await b.run();assert.equal(calls,2);assert.equal(comments,0);assert.equal(sends,0)
 }finally{f.close()}
})
