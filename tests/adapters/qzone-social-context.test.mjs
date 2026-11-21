import test from 'node:test'
import assert from 'node:assert/strict'
import {createLifeAdapter} from '../../modules/qzone-social/life.mjs'
test('public social draft refuses revoked context',()=>{
 let current=true;const c={contextManaged:()=>true,buildContext:o=>({id:'s',text:'public',...o}),runWithContext:(s,f)=>f(),assertContextCurrent(){if(!current)throw Error('revoked')},validateDraft:()=>({ok:true})};const l=createLifeAdapter({id:'qzone-social',use:()=>c,log:{warn(){}}});const s=l.prepareContext({purpose:'public-share',chatId:''});current=false;assert.throws(()=>l.checkDraft('reply',s),/revoked/)
})
