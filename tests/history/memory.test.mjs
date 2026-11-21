import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'aurabot-memory-'));let active=root;
const store={dataDir:(...s)=>path.join(active,...s),readJson:(p,f)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return typeof f==='function'?f():f}},writeJson:(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v))}};
globalThis.aurabot={lib:n=>({'core/store.js':store,'core/llm.js':{askModel:()=>{throw Error('unexpected paid model')},lastEmptyInfo:()=>null},'core/text.js':{clipText:(s,n)=>String(s).slice(0,n)},'core/offpeak.js':{shouldDeferBackground:()=>false},'tools/tools.js':{defineTool:x=>x,str:x=>x}}[n]||{})};
const {createMemoryStore}=await import('../../modules/memory/memory.js');const {default:module}=await import('../../modules/memory/index.mjs');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
let i=0;function fixture(t,onForget,seed){active=path.join(root,String(++i));fs.mkdirSync(active);if(seed)fs.writeFileSync(path.join(active,'memories.json'),JSON.stringify(seed));const config={enabled:true,ownerQQ:'10001',ownerName:'主人',allow:{private:['10002'],groups:['20001','20002']},memory:{enabled:true,recallCount:4,groupMemory:true,vector:{enabled:false},shortTerm:false}};const notifications=[];const hub={speakersOf:()=>['10002'],chatLogDays:()=>[],chatLogOf:()=>[]};const memory=createMemoryStore({getConfig:()=>config,hub,log:{debug(){},warn(){},error(){}},onForget:onForget||((...args)=>{notifications.push(args);return{ok:true}})});return{memory,config,hub,notifications}}
test('core fact context is synchronous, scoped, bounded, and preserves original or unknown time',t=>{
 const {memory:m,config:c}=fixture(t);const own=m.add({text:'喜欢草莓蛋糕',about:'10001',source:'said',chatId:'private:10001',saidAt:1600000000000}); m.add({text:'喜欢草莓巧克力',about:'10002',source:'said',chatId:'private:10002'});
 assert.equal(typeof m.contextForCore,'function');const r=m.contextForCore({chat:{kind:'private',chatId:'private:10001',userId:'10001'},query:'草莓',maxChars:240});assert.equal(typeof r.then,'undefined');assert.ok(r.text.includes('草莓蛋糕'));assert.ok(!r.text.includes('巧克力'));assert.ok(r.text.includes('2020'));assert.ok(r.text.length<=240);assert.ok(r.sourceIds.length);assert.equal(m.contextCurrent(r.sourceIds,{chatId:'private:10001'}),true);
 m.update(own.id,{text:'不喜欢草莓蛋糕'});assert.equal(m.contextCurrent(r.sourceIds,{chatId:'private:10001'}),false);
});
test('fact sources revoke precisely and unknown source dates are not invented',t=>{
 const {memory:m,config:c}=fixture(t);m.add({text:'关于键盘的偏好',about:'10002',source:'panel',chatId:'group:20001'});const r=m.contextForCore({chat:{kind:'group',groupId:'20001',chatId:'group:20001'},query:'键盘',speakers:['10002']});assert.ok(r.text.includes('原事时间未知'));assert.ok(r.text.includes('记于'));assert.equal(m.contextCurrent(r.sourceIds,{chatId:'group:20001'}),true);c.allow.groups=['20001'];assert.equal(m.contextCurrent(r.sourceIds,{chatId:'group:20001'}),true);c.allow.groups=[];assert.equal(m.contextCurrent(r.sourceIds,{chatId:'group:20001'}),false);assert.equal(m.contextForCore({chat:{kind:'group',chatId:'group:20001'},query:'键盘'}).text,'');
});
test('managed chat removes duplicate facts but retains relationship and style context, old fallback works',t=>{
 const f=fixture(t),hooks={},contexts=[],config=f.config;let managed=true;const api={config:()=>config,use:()=>({contextManaged:()=>managed}),core:{hub:f.hub,http:{}},dsh:{},log:{debug(){},warn(){},error(){}},context:fn=>contexts.push(fn),on:(n,fn)=>hooks[n]=fn,onDispose(){},every(){},tool(){},route(){}};
 const m=module.setup(api);m.add({text:'喜欢猫猫',about:'10001',source:'said',chatId:'private:10001'});m.setStyle('self',['嗯哼']);m.saveRelation({id:'r',subj:'甲',subjQq:'10001',pred:'认识',obj:'乙',objQq:'10002',chatId:'private:10001'});
 const info={chat:{kind:'private',chatId:'private:10001',userId:'10001'},queryText:'猫猫',sessionId:''};const text=contexts[0](info);assert.ok(text.includes('嗯哼'));assert.ok(text.includes('人物关系'));assert.ok(!text.includes('喜欢猫猫'));const input=[{type:'text',text:'猫猫'}];return Promise.resolve(hooks.prompt(input,info)).then(out=>{assert.deepEqual(out,input);managed=false;assert.ok(contexts[0](info).includes('喜欢猫猫'))});
});

test('existing manual deletion still returns exact-link failure evidence when core forget is unavailable',t=>{
 const f=fixture(t,()=>{throw Error('core unavailable')});const added=f.memory.add({text:'应忘记的材料',about:'10001',source:'said',chatId:'private:10001'});const result=f.memory.remove(added.id);assert.equal(result.ok,true);assert.ok(result.lifeCoreForgetErrors.includes('core unavailable'));assert.equal(f.memory.list('').length,0);
});

test('accepted natural-language forgetting keeps the original single synchronous propagation contract',t=>{
 const f=fixture(t);f.memory.add({text:'喜欢苹果茶',about:'10001',source:'said',chatId:'private:10001'});f.memory.handleCommand({kind:'private',chatId:'private:10001',userId:'10001'},'忘记苹果茶');assert.equal(f.notifications.length,1);assert.equal(f.notifications[0][0],'10001');assert.equal(f.notifications[0][1],'苹果茶');
});

test('forgetting a compressed original invalidates its paraphrased abstract and preserves unknown original time',t=>{
 const f=fixture(t,undefined,{items:[
  {id:'p',text:'原文特征是苹果茶',about:'10001',chatId:'private:10001',source:'auto',at:1000,saidAt:1000,validFrom:1000,invalidAt:2000,validUntil:2000,compressedInto:'a'},
  {id:'a',text:'对方总是温柔地照顾她',about:'10001',chatId:'private:10001',source:'abstract',at:2000,saidAt:2000,validFrom:2000,abstractOf:['p']}
 ]});
 const info={chat:{kind:'private',chatId:'private:10001',userId:'10001'},query:'照顾'};const before=f.memory.contextForCore(info);assert.ok(before.text.includes('原事时间未知'));assert.ok(before.text.includes('温柔'));
 f.memory.handleCommand(info.chat,'忘记原文特征');assert.equal(f.memory.contextCurrent(before.sourceIds,{chatId:'private:10001'}),false);assert.ok(!f.memory.contextForCore(info).text.includes('温柔'));assert.ok(f.notifications[0][2].sourceIds.includes('memory:a'));
});

test('opaque old gists for affected personal sources cannot survive forgetting by paraphrasing, unrelated chats remain',t=>{
 const f=fixture(t,undefined,{items:[{id:'original',text:'记得苹果茶细节',about:'10001',chatId:'group:20001',source:'said',at:1000,saidAt:1000}],gists:[
  {id:'g1',kind:'gist',text:'这个群曾分享温暖的小事',chatId:'group:20001',scope:'group',at:2000},
  {id:'g2',kind:'gist',text:'无关群的安静记录',chatId:'group:20002',scope:'group',at:2000},
  {id:'g3',kind:'gist',text:'关于主人的早期印象',chatId:'private:10001',about:'10001',at:2000}
 ]});f.memory.handleCommand({kind:'private',userId:'10001',chatId:'private:10001'},'忘记苹果茶');assert.deepEqual(f.memory.gists().map(g=>g.id),['g2']);assert.ok(f.notifications[0][2].sourceIds.includes('memory:g1'));assert.ok(f.notifications[0][2].sourceIds.includes('memory:g3'));
});

test('correcting an original withdraws only old opaque summaries of that actual source chat',t=>{
 const f=fixture(t,undefined,{items:[{id:'p',text:'旧说法',about:'10001',chatId:'group:20001',source:'said',at:1000}],gists:[{id:'g1',kind:'gist',text:'改写的旧说法',chatId:'group:20001',at:2000},{id:'g2',kind:'gist',text:'无关摘要',chatId:'group:20002',kind:'gist',at:2000}]});f.memory.update('p',{text:'改正后的说法'});assert.deepEqual(f.memory.gists().map(g=>g.id),['g2']);assert.ok(f.notifications[0][2].sourceIds.includes('memory:g1'));
});
