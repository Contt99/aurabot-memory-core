import test from 'node:test'
import assert from 'node:assert/strict'
import {createLifeAdapter} from '../../modules/purpose/life.mjs'
test('pet dispatch is checked immediately inside its bound call',async()=>{
 let current=true,dispatched=0
 const c={contextManaged:()=>true,buildContext:o=>({id:'s',text:'marker',...o}),assertContextCurrent(){if(!current)throw Error('revoked')},validateDraft:()=>({ok:true}),runWithContext:async(s,f)=>{current=false;return f()}}
 const l=createLifeAdapter({id:'purpose',use:()=>c,on(){},log:{warn(){}},core:{hub:{}}});const snap=l.prepareContext({purpose:'proactive',chatId:'private:1'});await assert.rejects(l.dispatchPet({dispatch:()=>{dispatched++}},'hi','p',snap),/revoked/);assert.equal(dispatched,0)
})
