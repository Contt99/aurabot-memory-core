import test from 'node:test'
import assert from 'node:assert/strict'
import {createLifeAdapter} from '../../modules/tieba-reader/life.mjs'
test('tieba adapter validates exact snapshot before send',async()=>{
 let ok=true
 const core={contextManaged:()=>true,buildContext:o=>({id:'x',text:'context',...o}),runWithContext:async(s,f)=>f(),assertContextCurrent(){if(!ok)throw Error('revoked')},validateDraft:()=>({ok:true})}
 const life=createLifeAdapter({id:'tieba-reader',use:()=>core,log:{warn(){}}})
 const s=life.prepareContext({purpose:'proactive',chatId:'private:1'});assert.equal(await life.runContext(s,()=>3),3);ok=false;assert.throws(()=>life.checkDraft('hi',s),/revoked/)
})
