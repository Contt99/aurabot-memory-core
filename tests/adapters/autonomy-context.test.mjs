import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareAutonomyContext } from '../../modules/autonomy/lib/context.mjs'
test('autonomy snapshot is public-scoped and revocation blocks acting',async()=>{
 let valid=true;const core={contextManaged:()=>true,buildContext:o=>({id:'s',text:'public experience',...o}),runWithContext:async(s,f)=>f(),assertContextCurrent(){if(!valid)throw Error('revoked')},validateDraft:()=>({ok:true})}
 const ctx=prepareAutonomyContext(core,{chatId:'',query:'goal'},()=>{});assert.equal(await ctx.run(()=>42),42);valid=false;assert.throws(()=>ctx.check('action'),/revoked/)
})
