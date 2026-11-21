import test from 'node:test'
import assert from 'node:assert/strict'
import {Dreamer} from '../../modules/night/dream.mjs'
import {NightService} from '../../modules/night/state.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
test('revoked or untraceable dreams are never automatically injected, while manual recall remains',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'night-context-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let valid=true
 const core={contextManaged:()=>true,buildContext:o=>({id:'snap',text:'SCOPE',...o}),assertContextCurrent(){if(!valid)throw Error('revoked')},runWithContext:(s,fn)=>fn(),validateDraft:()=>({ok:true}),recordOutcome(){}}
 const api={id:'night',use:id=>id==='life-core'?core:null,config:()=>({ownerQQ:'1'}),dataDir:f=>path.join(dir,f),ask:async()=>JSON.stringify({text:'梦里的秘密',level:3}),log:{warn(){},info(){}}}
 const cfg=()=>({enabled:true,dreamEnabled:true,dreamTags:[],energyMax:100});const d=new Dreamer({api,cfgOf:cfg,log:api.log});const entry=await d.make();assert.ok(entry);const service=new NightService({api,cfgOf:cfg,dreamer:d,lullaby:{},log:api.log});service.state.morningDreamId=entry.id
 assert.doesNotMatch(service.promptHint({kind:'private',userId:'1',chatId:'private:1'}),/梦里的秘密/);service.state.dreamHintUses=0;valid=false;assert.doesNotMatch(service.promptHint({kind:'private',userId:'1',chatId:'private:1'}),/梦里的秘密/);assert.equal(d.byId(entry.id).text,'梦里的秘密')
})
