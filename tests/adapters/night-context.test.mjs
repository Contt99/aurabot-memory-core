import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {Dreamer} from '../../modules/night/dream.mjs'
test('dream creation blocks a revoked private snapshot before saving',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dream-test-'));let current=true,called
 const core={contextManaged:()=>true,buildContext:o=>(called=o,{id:'s',text:'marker',...o}),assertContextCurrent(){if(!current)throw Error('revoked')},runWithContext:async(s,f)=>f(),validateDraft:()=>({ok:true}),recordOutcome(){}}
 const api={config:()=>({ownerQQ:'1'}),use:id=>id==='life-core'?core:null,dataDir:f=>path.join(dir,f),ask:async opts=>{assert.match(opts.text,/marker/);current=false;return '{"text":"梦境","level":2}'},log:{warn(){},info(){}}}
 const d=new Dreamer({api,cfgOf:()=>({dreamEnabled:true}),log:api.log});const result=await d.make();assert.equal(called.chatId,'private:1');assert.equal(result,null);assert.equal(d.items.length,0)
})
