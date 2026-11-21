import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import module from '../../modules/image-familiar/index.mjs';
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aurabot-images-')),hooks={},disposed=[],tools=[],observations=[],forgotten=[];let calls=0,forget;const config={enabled:true,ownerQQ:'10001',botQQ:'99999',allow:{private:['10002'],groups:[]}};const core={forgetRevision:()=>0,onForget:fn=>{forget=fn;return()=>{}},recordObservation:(m,v)=>{observations.push({m,v});return{id:m.sourceId}},forgetPerson:(q,t,o)=>{forgotten.push(o);forget?.({...o,qq:q,query:t});return{ok:true}}};const api={dataDir:()=>dir,settings:()=>({enabled:true}),config:()=>config,use:()=>core,log:{warn(){}},every(){},onDispose:fn=>disposed.push(fn),on:(n,f)=>hooks[n]=f,tool:fn=>tools.push(fn),defineTool:x=>x,route(){},core:{hub:{chatOfSession:()=> 'private:10001'}}};const deps={prepare:async()=>({identity:'same-pixels',frames:3}),describe:async()=>{calls++;return{description:'小猫走过画面',confidence:0.9,uncertainty:'尾部被挡住'}}};let image=module.setup(api,deps);t.after(()=>{disposed.reverse().forEach(fn=>fn());fs.rmSync(dir,{recursive:true,force:true})});const prompt=async chatId=>hooks.prompt([{type:'image',data:Buffer.from('synthetic').toString('base64')}],{chat:{kind:'private',chatId,userId:chatId.slice(8)},queryText:'看看'});return{prompt,observations,forgotten,config,tools,api,core,deps,fireForget:e=>forget(e),current:ids=>image.contextCurrent(ids,{chatId:'private:10001'}),calls:()=>calls,restart:()=>{disposed.splice(0).reverse().forEach(f=>f());image=module.setup(api,deps)}}}
test('actual first visual interpretation reports scoped evidence, cache hits do not become new facts',async t=>{
 const f=fixture(t);await f.prompt('private:10001');assert.equal(f.observations.length,1);assert.equal(f.observations[0].m.chatId,'private:10001');assert.equal(f.observations[0].m.evidenceType,'visual-interpretation');assert.equal(f.observations[0].v.frames,3);assert.ok(f.observations[0].v.uncertainty.includes('挡住'));assert.equal('userId' in f.observations[0].m,false);await f.prompt('private:10001');assert.equal(f.calls(),1);assert.equal(f.observations.length,1);f.restart();await f.prompt('private:10001');assert.equal(f.calls(),1);await f.prompt('private:10002');assert.equal(f.calls(),2);assert.equal(f.observations.length,2);
});
test('explicit image cache forget also invalidates the exact observation sources',async t=>{
 const f=fixture(t);await f.prompt('private:10001');const tool=f.tools[0]({chat:{kind:'private',chatId:'private:10001'},sessionId:'s',level:'owner'})[0];const r=await tool.execute({action:'forget'},{sessionId:'s'});assert.equal(r.ok,true);assert.ok(f.forgotten[0].sourceIds.length);assert.equal(f.forgotten[0].exactSources,true);await f.prompt('private:10001');assert.equal(f.calls(),2);
});

test('uncertain corrective reread cannot make the next cache hit resurrect a disproven confident description',async t=>{
 const f=fixture(t);await f.prompt('private:10001');f.deps.describe=async()=>({description:'可能不是小猫',confidence:0.3,uncertainty:'遮挡太多'});
 const tool=f.tools[0]({chat:{kind:'private',chatId:'private:10001'},sessionId:'s',level:'owner'})[0];await tool.execute({action:'review',question:'看错了'},{sessionId:'s'});
 const out=await f.prompt('private:10001');assert.ok(!out[0].text.includes('小猫走过画面'));assert.ok(out[0].text.includes('可能不是小猫'));
});

test('a missed forget callback still revokes old visual source IDs through the persistent core revision',async t=>{
 const f=fixture(t);await f.prompt('private:10001');const ids=[f.observations[0].m.sourceId];assert.equal(f.current(ids),true);f.core.forgetRevision=()=>1;assert.equal(f.current(ids),false);f.restart();assert.equal(f.current(ids),false);
});

test('scope forget propagates removed image source IDs exactly once without recursive scope clearing',async t=>{
 const f=fixture(t);await f.prompt('private:10001');f.core.forgetPerson('10001','图片',{chatId:'private:10001',sourceIds:[]});assert.equal(f.forgotten.length,2);assert.deepEqual(f.forgotten[1].sourceIds,[f.observations[0].m.sourceId]);assert.equal(f.forgotten[1].chatId,undefined);assert.equal(f.forgotten[1].exactSources,true);assert.equal(f.current([f.observations[0].m.sourceId]),false);
});
test('image source cleanup reports nested core failure instead of claiming all linked observations are forgotten',async t=>{
 const f=fixture(t);await f.prompt('private:10001');f.core.forgetPerson=()=>({ok:false,errors:['source erasure failed']});assert.throws(()=>f.fireForget({chatId:'private:10001',qq:'10001',query:'图片'}),/source erasure failed/);
});
