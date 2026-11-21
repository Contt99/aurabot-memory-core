import test from 'node:test'
import assert from 'node:assert/strict'
import { createPrivateJournal } from '../../modules/autonomy/lib/private-journal.mjs'
test('private diary blocks a revoked context before local save',async()=>{
 let current=true, purpose, input, call=0, bound=0
 const core={diarySources:async()=>[{id:'e'}],assertSourcesCurrent(){},assertNarrationSupported(){},contextManaged:()=>true,buildContext:o=>(purpose=o.purpose,input=o,{id:'s',text:'【记忆快照:00000000-0000-0000-0000-000000000002】\nAUTHORIZED DIARY TEXT',...o}),assertContextCurrent(){if(!current)throw Error('revoked')},validateDraft:()=>({ok:true}),runWithContext:async(s,f)=>{bound++;return f()}}
 const api={use:()=>core,on(){},onDispose(){},config:()=>({dryRun:true}),dataDir:()=>'.',core:{personas:{current:()=>''}},log:{warn(){}}}
 const journal=createPrivateJournal(api,{assertActive(){},ask:async o=>{assert.equal(o.text.includes('AUTHORIZED DIARY TEXT'),true);assert.match(o.text,/【记忆快照:/);if(++call===1)return JSON.stringify({text:'日记',sourceIds:['e'],notes:[],unresolvedQuestions:[]});current=false;return JSON.stringify({approved:true,sourceIds:['e'],issues:[]})}})
 const result=await journal.write(); assert.equal(purpose,'private-diary');assert.deepEqual(input.diarySources,[{id:'e'}]);assert.equal(bound,2);assert.equal(result.ok,false);assert.match(result.message,/revoked/)
})
test('private draft and audit bind exactly their respective source selections',async()=>{
 const calls=[];let generated=0
 const sources=[{id:'e1'},{id:'e2'}]
 const core={diarySources:async()=>sources,assertSourcesCurrent(){},assertNarrationSupported(){},contextManaged:()=>true,buildContext:o=>(calls.push(o.diarySources.map(s=>s.id)),{id:'s'+calls.length,text:'【记忆快照:s'+calls.length+'】',...o}),assertContextCurrent(){},validateDraft:()=>({ok:true}),runWithContext:async(s,f)=>f()}
 const api={use:()=>core,on(){},onDispose(){},config:()=>({dryRun:true}),dataDir:()=>'.',core:{personas:{current:()=>''}},log:{warn(){}}}
 const journal=createPrivateJournal(api,{assertActive(){},ask:async()=>++generated===1?JSON.stringify({text:'日记',sourceIds:['e1'],notes:[],unresolvedQuestions:[]}):JSON.stringify({approved:true,sourceIds:['e1'],issues:[]})})
 const r=await journal.write();assert.equal(r.ok,true);assert.deepEqual(calls,[['e1','e2'],['e1']])
})
