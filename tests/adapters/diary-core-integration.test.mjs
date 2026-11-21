import test from 'node:test'
import assert from 'node:assert/strict'
import {harness} from '../core/harness.mjs'
import {createDiaryMedia} from '../../modules/diary/lib/modules/diary/media.js'
test('real core observes exactly the public diary snapshot that entered the model request',async t=>{
 const h=harness(t);await h.core.perform({module:'web',action:'read',public:true},async()=>({ok:true,text:'公开文章'}))
 const original=h.core.diarySources('public');assert.equal(original.length,1)
 let snapshotId=''
 const api={use:id=>id==='life-core'?h.core:null,config:()=>({diary:{rich:{enabled:false},attachImage:false,minChars:1,maxChars:100}}),dataDir:()=>h.dir,log:h.api.log,core:{hub:{}},ask:async({text:p})=>{snapshotId=p.match(/【记忆快照:([\da-f-]{36})】/)?.[1]||'';await h.stream({sessionId:'purpose',messages:[{content:[{type:'text',text:p}]}]});return '{"text":"有趣的文章","imageIds":[]}'}}
 await createDiaryMedia(api).compose()
 assert.ok(snapshotId);const detail=h.core.contextDetail(snapshotId);assert.equal(detail.status,'observed');assert.deepEqual(detail.data.sourceIds,original.map(s=>s.id))
})
import {createPrivateJournal} from '../../modules/autonomy/lib/private-journal.mjs'
test('real core observes separate private writing and selected-source audit snapshots',async t=>{
 const h=harness(t);for(const title of ['公开文章甲','公开文章乙'])await h.core.perform({module:'web',action:'read',public:true},async()=>({ok:true,text:title}))
 const sources=h.core.diarySources('private');assert.equal(sources.length,2);const selected=sources[0].id;const ids=[]
 const api={use:id=>id==='life-core'?h.core:null,on(){},onDispose(){},config:()=>({dryRun:true}),dataDir:f=>h.api.dataDir(f),core:{personas:{current:()=>''}},log:h.api.log}
 let n=0;const journal=createPrivateJournal(api,{assertActive(){},ask:async({text})=>{const id=text.match(/【记忆快照:([\da-f-]{36})】/)?.[1];ids.push(id);await h.stream({sessionId:'purpose',messages:[{content:[{type:'text',text}]}]});return ++n===1?JSON.stringify({text:'读了文章',sourceIds:[selected],notes:[],unresolvedQuestions:[]}):JSON.stringify({approved:true,sourceIds:[selected],issues:[]})}})
 const result=await journal.write();assert.equal(result.ok,true);assert.equal(ids.length,2);assert.notEqual(ids[0],ids[1]);const write=h.core.contextDetail(ids[0]),audit=h.core.contextDetail(ids[1]);assert.equal(write.status,'observed');assert.equal(audit.status,'observed');assert.deepEqual(new Set(write.data.sourceIds),new Set(sources.map(s=>s.id)));assert.deepEqual(audit.data.sourceIds,[selected])
})
