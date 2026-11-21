import test from 'node:test'
import assert from 'node:assert/strict'
import {createDiaryMedia} from '../../modules/diary/lib/modules/diary/media.js'
test('public diary uses independent stateless requests after a source is revoked',async()=>{
 let sources=[{id:'one',text:'REVOKED_GROUP_SECRET',sourceScopes:['group:1'],status:'succeeded'}],requests=[],systemTurns=0
 const core={diarySources:()=>sources,assertSourcesCurrent(){},assertNarrationSupported(){},contextManaged:()=>true,buildContext:o=>({id:'s',text:'【记忆快照:s】',...o}),runWithContext:(s,f)=>f(),assertContextCurrent(){},validateDraft:()=>({ok:true})}
 const api={use:()=>core,config:()=>({diary:{rich:{enabled:false},attachImage:false,minChars:1,maxChars:100}}),dataDir:()=>'.',log:{warn(){}},core:{personas:{current:()=> 'PERSONA'},hub:{runSystemTurn:async()=>{systemTurns++;return '{"text":"旧草稿","imageIds":[]}'}}},ask:async o=>{requests.push(o);return '{"text":"日记","imageIds":[]}'} }
 const media=createDiaryMedia(api);await media.compose();sources=[];await media.compose()
 assert.equal(systemTurns,0);assert.equal(requests.length,2);assert.match(requests[0].text,/REVOKED_GROUP_SECRET/);assert.doesNotMatch(requests[1].text,/REVOKED_GROUP_SECRET|旧草稿/);assert.match(requests[1].system,/PERSONA/)
})
