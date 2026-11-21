import test from 'node:test'
import assert from 'node:assert/strict'
import { createDiaryMedia } from '../../modules/diary/lib/modules/diary/media.js'
test('public diary checks the prepared snapshot again before publishing', async()=>{
 let current=true, options, used=false
 const core={diarySources:async()=>[],assertSourcesCurrent:async()=>{},assertNarrationSupported(){},contextManaged:()=>true,buildContext:o=>(options=o,{id:'d',text:'【记忆快照:00000000-0000-0000-0000-000000000001】\nAUTHORIZED DIARY TEXT',...o}),runWithContext:async(s,f)=>{used=true;return f()},assertContextCurrent(){if(!current)throw Error('revoked')},validateDraft:()=>({ok:true})}
 let prompt=''; const api={use:()=>core,config:()=>({diary:{rich:{enabled:false},attachImage:false,minChars:1,maxChars:100}}),dataDir:()=>'.',ask:async({text:p})=>{prompt=p;return '{"text":"心情不错","imageIds":[]}'},core:{hub:{}}}
 const draft=await createDiaryMedia(api).compose(); assert.equal(options.purpose,'public-diary'); assert.equal(used,true); assert.equal(prompt.includes('AUTHORIZED DIARY TEXT'),true); assert.match(prompt,/【记忆快照:/); assert.deepEqual(options.diarySources,[])
 current=false; await assert.rejects(draft.beforeSend(),/revoked/)
})
