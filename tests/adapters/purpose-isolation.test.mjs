import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture} from './legacy-adapters-fixture.mjs'
import purpose from '../../modules/purpose/index.mjs'
test('managed purpose preview derives materials only from the authorized snapshot',()=>{
 const f=fixture();try{
  Object.assign(f.life,{contextManaged:()=>true,buildContext:o=>({id:'s',...o,text:'MARKER',items:[{id:'vault:1',type:'message',who:'主人',at:Date.now(),occurredAt:Date.now(),text:'合法私人聊天内容'}]}),assertContextCurrent(){},validateDraft:()=>({ok:true}),runWithContext:(s,fn)=>fn()})
  f.hub.chatLogDays=()=>['today'];f.hub.chatLogOf=()=>[{chatId:'group:444',who:'other',text:'不应泄漏的群聊秘密？',t:Date.now()}]
  const use=f.api.use;f.api.use=id=>id==='memory'?{list:()=>[{id:'x',text:'不应泄漏的私聊记忆',importance:1,at:Date.now()}]}:use(id)
  const p=purpose.setup(f.api).preview(), all=JSON.stringify(p)
  assert.match(all,/合法私人聊天内容/);assert.doesNotMatch(all,/不应泄漏/)
 }finally{f.close()}
})
test('managed purpose generation does not use unrelated legacy material and aborts revoked snapshot',async()=>{
 const f=fixture();try{
  let current=true, prompt='', delivers=0;Object.assign(f.life,{contextManaged:()=>true,buildContext:o=>({id:'s',...o,text:'【记忆快照:s】',items:[{id:'vault:1',type:'message',who:'主人',at:Date.now(),text:'今天好想一起看看流星雨？'}]}),assertContextCurrent(){if(!current)throw Error('revoked')},validateDraft:()=>({ok:true}),runWithContext:(s,fn)=>fn()})
  f.hub.chatLogDays=()=>['today'];f.hub.chatLogOf=()=>[{chatId:'group:444',who:'other',text:'不应泄漏的群聊秘密？',t:Date.now()}]
  const use=f.api.use;f.api.use=id=>id==='memory'?{list:()=>[{id:'x',text:'不应泄漏的私聊记忆',importance:1,at:Date.now()}]}:use(id)
  f.api.ask=async({text:p})=>{prompt=p;current=false;return '我想一起看看'};f.hub.deliver=async()=>{delivers++;return {ok:true}}
  const result=await purpose.setup(f.api).fire();assert.ok(prompt);assert.doesNotMatch(prompt,/不应泄漏/);assert.equal(delivers,0);assert.equal(result.outcome,'failed')
 }finally{f.close()}
})
