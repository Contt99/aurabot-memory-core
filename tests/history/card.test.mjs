import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import cardModule from '../../modules/impression-card/index.mjs';
function fixture(t,records){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aurabot-card-'));fs.writeFileSync(path.join(dir,'affinity.json'),JSON.stringify({records:Object.fromEntries(records.map(r=>[r.id,{platform:'qq',userId:'10002',displayName:'测试者',total:5,scores:{},materialVersion:2,updatedAt:1000,...r}]))}));const config={enabled:true,ownerQQ:'10001',botQQ:'99999',allow:{private:['10002'],groups:['20001','20002']}};const hooks={},contexts=[],disposed=[],toolFactories=[];let managed=false,listener;const invalidations=[];const core={contextManaged:()=>managed,onForget:fn=>{listener=fn;return()=>{}},recordOutcome(){},forgetPerson:(q,t,o)=>{invalidations.push(o);return {ok:true}}};const api={dir:'',dataDir:(...p)=>path.join(dir,...p),settings:()=>({...cardModule.defaults}),config:()=>config,log:{info(){},warn(){},debug(){},error(){}},core:{hub:{chatLogOf:()=>[],chatLogDays:()=>[]},http:{}},use:id=>id==='life-core'?core:null,on:(n,f)=>hooks[n]=f,onDispose:fn=>disposed.push(fn),every(){},context:fn=>contexts.push(fn),rule(){},route(){},command(){},tool:fn=>toolFactories.push(fn),defineTool:x=>x};const card=cardModule.setup(api,{renderer:{renderCard:async()=>({ok:true,file:'synthetic.png',image:Buffer.from('synthetic')})}});t.after(()=>{for(const f of disposed.reverse())f();fs.rmSync(dir,{recursive:true,force:true})});return{card,config,contexts,core,api,invalidations,toolFactories,setManaged:x=>managed=x,forget:e=>listener?.(e)}}
test('card context is scoped reflection, versioned and revocable without dropping unrelated sources',t=>{
 const f=fixture(t,[{id:'qq:10002@group:20001',description:'这是群中关于测试者的印象'}]);const chat={kind:'group',chatId:'group:20001'};
 assert.equal(typeof f.card.contextForCore,'function');const r=f.card.contextForCore({chat,speakers:['10002'],maxChars:300});assert.ok(r.text.includes('主观印象'));assert.ok(r.text.includes('原事时间未知'));assert.ok(r.text.length<=300);assert.equal(f.card.contextCurrent(r.sourceIds,{chatId:chat.chatId}),true);f.config.allow.groups=['20001'];assert.equal(f.card.contextCurrent(r.sourceIds,{chatId:chat.chatId}),true);f.card.get('qq:10002@group:20001').description='已改正';assert.equal(f.card.contextCurrent(r.sourceIds,{chatId:chat.chatId}),false);assert.equal(f.card.contextForCore({chat:{kind:'group',chatId:'group:20002'},speakers:['10002']}).text,'');
});
test('composite cards cannot launder revoked groups or old unknown sources into private context',t=>{
 const f=fixture(t,[{id:'qq:10002@self',description:'两个群的综合印象',sourceScopes:['group:20001','group:20002']},{id:'qq:10002@public',description:'旧综合来源未知'}]);const chat={kind:'private',userId:'10002',chatId:'private:10002'};assert.ok(f.card.contextForCore({chat}).text.includes('综合印象'));f.config.allow.groups=['20001'];assert.equal(f.card.contextForCore({chat}).text,'');
});
test('managed legacy card context deduplicates; explicit forget invalidates scoped card',t=>{
 const f=fixture(t,[{id:'qq:10002@self',description:'私聊旧印象',sourceScopes:['private:10002']}]);const info={chat:{kind:'private',userId:'10002',chatId:'private:10002'}};assert.ok(f.contexts[0](info).includes('私聊旧印象'));f.setManaged(true);assert.equal(f.contexts[0](info),'');const r=f.card.contextForCore(info);f.forget({qq:'10002',query:'旧印象',chatId:'private:10002',sourceIds:[]});assert.equal(f.card.contextCurrent(r.sourceIds,{chatId:'private:10002'}),false);assert.equal(f.card.contextForCore(info).text,'');
});

test('new composite generation retains exact contributing scopes and rejects in-flight source revocation',async t=>{
 const f=fixture(t,[]);f.api.onebot=async()=>({nickname:'测试者'});
 const row={id:'vault:1',t:Date.now(),chatId:'group:20001',uid:'10002',who:'测试者',text:'我最近喜欢去博物馆'};
 const use=f.api.use;f.api.use=id=>id==='history-vault'?{impressionMaterial:()=>[row],impressionMaterialByIds:ids=>ids.includes(row.id)&&f.config.allow.groups.includes('20001')?[row]:[]}:use(id);
 const output=text=>JSON.stringify({claims:[{text,sourceIds:['vault:1']}]});
 f.api.ask=async()=>output('测试者最近对博物馆感兴趣');
 const r=await f.card.generate('qq:10002@self','private:10002');assert.deepEqual(r.sourceScopes,['group:20001']);assert.ok(f.card.contextForCore({chat:{kind:'private',chatId:'private:10002',userId:'10002'}}).text.includes('博物馆'));
 f.api.ask=async()=>{f.config.allow.groups=[];return output('撤权后生成的内容')};
 await assert.rejects(f.card.refresh('qq:10002@self','private:10002'),/来源|授权/);assert.notEqual(f.card.get('qq:10002@self').description,'撤权后生成的内容');
});

test('existing manual score entry works without new compiler and notifies exact source correction',async t=>{
 const f=fixture(t,[{id:'qq:10002@group:20001',description:'原笔记'}]);f.api.onebot=async()=>({nickname:'测试者'});
 const before=f.card.contextForCore({chat:{kind:'group',chatId:'group:20001'},speakers:['10002']});const r=await f.card.adjust('qq:10002@group:20001','total',1,{notify:false});assert.equal(r.ok,true);assert.equal(r.newValue,6);assert.equal(f.card.contextCurrent(before.sourceIds,{chatId:'group:20001'}),false);assert.ok(f.invalidations.some(x=>x.exactSources&&x.sourceIds.includes('impression:qq:10002@group:20001')));
});

test('memory correction while impression generation is running cannot save the old draft',async t=>{
 const f=fixture(t,[]);f.api.onebot=async()=>({nickname:'测试者'});let current='memory:m1@11111111111111111111';
 const mem={list:()=>[{id:'m1',contextSourceId:current,text:'喜欢旧游戏',chatId:'group:20001',about:'10002',status:'fact',at:1000}],contextCurrent:ids=>ids.every(id=>id===current)};const use=f.api.use;f.api.use=id=>id==='memory'?mem:use(id);
 const output=()=>JSON.stringify({claims:[{text:'喜欢旧游戏',sourceIds:['memory:m1@11111111111111111111']}]});
 f.api.ask=async()=>output();
 const initial=await f.card.generate('qq:10002@self','private:10002');assert.ok(initial.sourceIds.includes('memory:m1@11111111111111111111'));
 f.api.ask=async()=>{current='memory:m1@22222222222222222222';return output()};
 await assert.rejects(f.card.refresh('qq:10002@self','private:10002'),/来源|授权/);assert.equal(f.card.get('qq:10002@self').description,'喜欢旧游戏');
});

test('model detail tool does not expose an archived composite with unknown provenance',async t=>{
 const f=fixture(t,[{id:'qq:10002@self',description:'来源不明的旧秘密'}]);f.api.onebot=async()=>({nickname:'测试者'});f.api.core.hub.turnSendersAllOwner=()=>true;
 const tool=f.toolFactories[0]({chat:{kind:'private',chatId:'private:10002',userId:'10002'},sessionId:'s'}).find(t=>t.name==='impression_detail');
 const r=await tool.execute({target:'10002'},{sessionId:'s'});assert.equal(r.ok,false);assert.ok(!r.message.includes('旧秘密'));
});

test('manual send rejects revoked old card while management render remains an explicit archive entry',async t=>{
 const f=fixture(t,[{id:'qq:10002@self',description:'来源不明的旧秘密'}]);f.api.onebot=async()=>({nickname:'测试者'});f.api.settings=()=>({...cardModule.defaults,fetchAvatar:false});f.api.sendSegments=async()=>({message_id:'synthetic-only'});
 const r=await f.card.sendCard('private:10002',{personId:'qq:10002@self',userId:'10002',platform:'qq',displayName:'测试者'},{keepScope:true});assert.equal(r.ok,false);assert.match(r.message,/来源|授权/);const archive=await f.card.render('qq:10002@self');assert.equal(archive.ok,true);
});

test('authorized manual card send still works with context injection disabled and no compiler dependency',async t=>{
 const f=fixture(t,[{id:'qq:10002@group:20001',description:'本群原笔记'}]);f.api.settings=()=>({...cardModule.defaults,fetchAvatar:false,contextEnabled:false});f.api.sendSegments=async()=>({message_id:'synthetic-only'});
 const r=await f.card.sendCard('group:20001',{personId:'qq:10002@group:20001',userId:'10002',platform:'qq',displayName:'测试者'},{keepScope:true});assert.equal(r.ok,true);
});

test('vault capability availability does not become a new prerequisite for old non-vault manual cards',async t=>{
 const f=fixture(t,[{id:'qq:10002@group:20001',description:'旧的本群手工印象',sourceScopes:['group:20001'],sourceIds:[]}]);const use=f.api.use;f.api.use=id=>id==='history-vault'?{timelineCurrent:()=>false}:use(id);f.api.settings=()=>({...cardModule.defaults,fetchAvatar:false});f.api.sendSegments=async()=>({message_id:'synthetic-only'});
 const r=await f.card.sendCard('group:20001',{personId:'qq:10002@group:20001',userId:'10002',platform:'qq',displayName:'测试者'},{keepScope:true});assert.equal(r.ok,true);
 f.card.get('qq:10002@group:20001').sourceIds=['vault:33'];const blocked=await f.card.sendCard('group:20001',{personId:'qq:10002@group:20001',userId:'10002',platform:'qq',displayName:'测试者'},{keepScope:true});assert.equal(blocked.ok,false);
});
