import test from 'node:test'
import assert from 'node:assert/strict'
import {createLifeAdapter} from '../../modules/speakup/life.mjs'
import {createSpeakUp} from '../../modules/speakup/lib/features/companion.js'
test('speakup sends a target-specific prepared snapshot into its session',async()=>{
 let request, bound=false;const core={contextManaged:()=>true,buildContext:o=>(request=o,{id:'s',text:'marker',...o}),assertContextCurrent(){},validateDraft:()=>({ok:true}),runWithContext:async(s,f)=>{bound=true;return f()},propose:async o=>o.run()};const api={id:'speakup',use:()=>core,log:{warn(){}}};let content;const hub={lastOwnerChatAt:0,lastBotToOwner:{at:0},pushToSession:async(chat,blocks)=>{content=blocks.map(x=>x.text).join('\n');return {ok:true}}};const x=createSpeakUp({getConfig:()=>({ownerQQ:'1',ownerName:'A'}),hub,log:{info(){}},life:createLifeAdapter(api)});await x.fire('test');assert.equal(request.purpose,'proactive');assert.equal(request.chatId,'private:1');assert.equal(bound,true);assert.match(content,/marker/)
})
