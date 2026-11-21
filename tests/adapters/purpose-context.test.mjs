import test from 'node:test'
import assert from 'node:assert/strict'
import { createLifeAdapter } from '../../modules/purpose/life.mjs'
const make = core => createLifeAdapter({id:'purpose',use:()=>core,on(){},log:{warn(){}},core:{hub:{}}})
test('prepared proactive context binds generation and rejects revoked sources before delivery', async () => {
 let current=true, bound=false
 const c={contextManaged:()=>true,buildContext:o=>({id:'s',text:'[context]',...o}),runWithContext:async(s,fn)=>{bound=true;return fn()},assertContextCurrent:()=>{if(!current)throw Error('revoked')},validateDraft:()=>({ok:true})}
 const life=make(c), s=life.prepareContext({chatId:'private:1',purpose:'proactive'})
 assert.equal(s.text,'[context]'); assert.equal(await life.runContext(s,()=>42),42); assert.equal(bound,true)
 current=false; assert.throws(()=>life.checkDraft('hello',s),/revoked/)
})
test('managed compiler failures do not silently fall back',()=>{
 const life=make({contextManaged:()=>true,buildContext:()=>{throw Error('read failed')},runWithContext(){},assertContextCurrent(){},validateDraft(){}})
 assert.throws(()=>life.prepareContext({chatId:'private:1',purpose:'proactive'}),/read failed/)
})

test('installed but unhealthy compiler fails closed rather than using legacy context',()=>{
 const life=make({contextManaged:()=>false})
 assert.throws(()=>life.prepareContext({chatId:'private:1',purpose:'proactive'}),/不可用/)
})

test('only the durable managed handoff replaces the legacy hub pending-speech queue',async()=>{
 const delivered=[]
 const core={contextManaged:()=>true,runWithContext:(_s,fn)=>fn(),assertContextCurrent(){},validateDraft:()=>({ok:true})}
 const adapter=createLifeAdapter({id:'purpose',use:()=>core,on(){},log:{warn(){}},core:{hub:{deliver:async(_chat,_text,opts)=>{delivered.push(opts);return{}}}}})
 const options={own:false,userText:'proactive'}
 await adapter.deliver('private:1','第一句',options,{id:'s',purpose:'proactive'})
 await adapter.deliver('private:1','第二句',options,null)
 assert.deepEqual(delivered,[{own:true,userText:'proactive'},{own:false,userText:'proactive'}])
})
