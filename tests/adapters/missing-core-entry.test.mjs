import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture} from './legacy-adapters-fixture.mjs'
import social from '../../modules/qzone-social/index.mjs'
import rss from '../../modules/rss-reader/index.mjs'
import {createBili,bindApi} from '../../modules/bili/lib/bili/duty.js'
import {createLifeAdapter} from '../../modules/bili/life.mjs'
test('missing core stops automatic RSS before feed fetch, while explicit manual run remains',async()=>{
 const f=fixture();try{f.api.use=()=>null;let calls=0;f.api.settings=()=>({enabled:true,feeds:'https://feed.example/rss',carrier:'pool',minScore:0,dailyMax:5});f.api.__rssTestHooks={fetch:async()=>{calls++;return {ok:true,arrayBuffer:async()=>new TextEncoder().encode('<rss><channel></channel></rss>').buffer}}};const s=rss.setup(f.api);const auto=await s.run();assert.equal(auto.ok,false);assert.equal(calls,0);await s.run({fresh:true});assert.equal(calls,1)}finally{f.close()}
})
test('missing core stops automatic Bili before any provider read',async()=>{
 const f=fixture();try{f.api.use=()=>null;f.cfg.bili={enabled:true,keywords:['星'],perRun:1};let calls=0;bindApi(f.api);const b=createBili({getConfig:f.api.config,hub:f.hub,log:f.api.log,life:createLifeAdapter(f.api),ask:async()=>{calls++;return '["星"]'},api:{search:async()=>{calls++;return []},popular:async()=>[]}});const r=await b.run();assert.equal(r.ok,false);assert.equal(calls,0)}finally{f.close()}
})
test('missing core stops automatic space visits before feed reads or likes',async()=>{
 const f=fixture();try{f.api.use=()=>null;f.cfg.qzoneSocial={enabled:true,commentFriends:true,maxPerDay:10,friendChance:1,ownerChance:1,like:true};let calls=0;f.api.core.onebot.call=async()=>{calls++;return {feeds:[]}};const r=await social.setup(f.api).run();assert.equal(r.ok,false);assert.equal(calls,0)}finally{f.close()}
})
test('missing core stops automatic Tieba before reading posts',async()=>{
 const {default:tieba}=await import('../../modules/tieba-reader/index.mjs');const f=fixture();try{f.api.use=()=>null;const lib=f.api.lib;f.api.lib=k=>k==='core/config.js'?{registerSecretField(){}}:lib(k);f.api.settings=()=>({enabled:true,autoBrowse:true,bars:'星空',maxSharesPerDay:3,startHour:0,endHour:23});let reads=0;f.api.__tiebaRenderPage=async()=>{reads++;return {links:[]}};const s=tieba.setup(f.api);const r=await s.run();assert.equal(r.ok,false);assert.match(r.message,/life-core/);assert.equal(reads,0)}finally{f.close()}
})

test('missing core stops automatic diary before consuming the due slot',async()=>{
 const {default:diary}=await import('../../modules/diary/index.mjs');const f=fixture();try{f.api.use=()=>null;const now=new Date(),day=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;f.files.set((await import('node:path')).join(f.dir,'diary.json'),{plan:{day,times:[0],done:[]},history:[]});const d=diary.setup(f.api);await d.tick();assert.deepEqual(f.files.get((await import('node:path')).join(f.dir,'diary.json')).plan.done,[])}finally{f.close()}
})
test('legacy explicit Bili force entry still runs manually without a core',async()=>{
 const f=fixture();try{f.api.use=()=>null;f.cfg.bili={enabled:true,keywords:['星'],perRun:1};let calls=0;f.api.ask=async()=>{calls++;return '["星"]'};bindApi(f.api);const b=createBili({getConfig:f.api.config,hub:f.hub,log:f.api.log,life:createLifeAdapter(f.api),ask:f.api.ask,api:{search:async()=>{calls++;return []},popular:async()=>[]}});await b.run({force:true});assert.ok(calls>0)}finally{f.close()}
})
