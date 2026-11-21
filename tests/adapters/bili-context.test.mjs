import test from 'node:test'
import assert from 'node:assert/strict'
import {createLifeAdapter} from '../../modules/bili/life.mjs'
test('Bili generated public text is checked against its source snapshot',()=>{
 let live=true; const c={contextManaged:()=>true,buildContext:o=>({id:'s',text:'public',...o}),runWithContext:(s,f)=>f(),assertContextCurrent(){if(!live)throw Error('revoked')},validateDraft:()=>({ok:true})};const l=createLifeAdapter({id:'bili',use:()=>c,log:{warn(){}}}); const s=l.prepareContext({purpose:'public-share',chatId:''}); live=false;assert.throws(()=>l.checkDraft('comment',s),/revoked/)
})
