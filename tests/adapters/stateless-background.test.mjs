import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture} from './legacy-adapters-fixture.mjs'
import purpose from '../../modules/purpose/index.mjs'
import social from '../../modules/qzone-social/index.mjs'
import {createBili,bindApi} from '../../modules/bili/lib/bili/duty.js'
import {createLifeAdapter} from '../../modules/bili/life.mjs'
const managed = f => Object.assign(f.life,{contextManaged:()=>true,buildContext:o=>({id:'s',...o,text:'SCOPED',items:[{id:'vault:1',type:'message',who:'主人',at:Date.now(),text:'一起看看流星雨？'}]}),assertContextCurrent(){},validateDraft:()=>({ok:true}),runWithContext:(s,fn)=>fn()})
test('purpose uses no persistent system conversation',async()=>{
 const f=fixture();try{managed(f);let turns=0,asks=[];f.hub.runSystemTurn=async()=>{turns++;return '[沉默]'};f.api.ask=async o=>{asks.push(o);return '[沉默]'};await purpose.setup(f.api).fire();assert.equal(turns,0);assert.equal(asks.length,1);assert.match(asks[0].text,/SCOPED/)}finally{f.close()}
})
test('Bili browsing uses no persistent system conversation',async()=>{
 const f=fixture();try{managed(f);f.cfg.bili={enabled:true,keywords:['星'],perRun:1,minViews:0,maxAgeDays:100};let turns=0,asks=[];f.hub.runSystemTurn=async()=>{turns++;return '["星"]'};f.api.ask=async o=>{asks.push(o);return '["星"]'};bindApi(f.api);const b=createBili({getConfig:f.api.config,hub:f.hub,log:f.api.log,life:createLifeAdapter(f.api),ask:f.api.ask,api:{search:async()=>[],popular:async()=>[]}});await b.run();assert.equal(turns,0);assert.equal(asks.length,1);assert.match(asks[0].text,/SCOPED/)}finally{f.close()}
})
test('space comments use no persistent system conversation',async()=>{
 const f=fixture();try{managed(f);f.cfg.qzoneSocial={enabled:true,commentFriends:true,maxPerDay:10,friendChance:1,ownerChance:1,like:false};let turns=0,asks=[];f.hub.runSystemTurn=async()=>{turns++;return 'hello'};f.api.ask=async o=>{asks.push(o);return 'hello'};f.api.core.onebot.call=async action=>action==='get_qzone_feeds'?{feeds:[{appid:311,uin:77777,key:'tid1',time:Date.now()/1000,html:'星空',nickname:'朋友'}]}:action==='get_qzone_msg_detail'?{content:'星空',comments:[]}:{ok:true};await social.setup(f.api).run({force:true});assert.equal(turns,0);assert.equal(asks.length,1);assert.match(asks[0].text,/SCOPED/)}finally{f.close()}
})
