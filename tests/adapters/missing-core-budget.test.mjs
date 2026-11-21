import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture} from './legacy-adapters-fixture.mjs'
import speakup from '../../modules/speakup/index.mjs'
import purpose from '../../modules/purpose/index.mjs'
test('missing core does not consume a pending proactive nudge or quota',async()=>{
 const f=fixture();try{f.api.use=()=>null;f.cfg.ext.purpose.enabled=false;f.cfg.speakUp={...f.cfg.speakUp,nudge:true,awakeFrom:0,awakeTo:24};f.hub.lastBotToOwner={at:Date.now()-20*60000,text:'在吗？'};f.hub.lastOwnerChatAt=0;let pushes=0;f.hub.pushToSession=async()=>{pushes++};const s=speakup.setup(f.api);const random=Math.random;Math.random=()=>0;try{await s.tick()}finally{Math.random=random}assert.equal(pushes,0);assert.equal(s.state().nudgedFor,undefined);assert.equal(s.state().count,0)}finally{f.close()}
})
test('missing core never advances the purpose follow-up marker',async()=>{
 const f=fixture();try {
  f.api.use=()=>null;f.cfg.speakUp.nudge=true
  f.hub.lastBotToOwner={at:Date.now()-20*60000,text:'你喜欢纸风车吗？'}
  f.hub.lastOwnerChatAt=0
  await purpose.setup(f.api).tick()
  assert.equal([...f.files.values()].some(x=>x?.nudgedFor),false)
 }finally{f.close()}
})
