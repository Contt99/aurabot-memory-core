import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import vaultModule from '../../modules/history-vault/index.mjs';

export async function vaultFixture(t) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aurabot-vault-')); const hooks={},routes={},disposed=[];
 const settings={...vaultModule.defaults},config={enabled:true,botQQ:'99999',ownerQQ:'10001',allow:{private:['10002'],groups:['20001','20002']}};
 const notifications=[];const api={settings:()=>settings,config:()=>config,dataDir:()=>dir,log:{info(){},warn(){},error(){},debug(){}},
  lib:()=>({matchesMemoryKeyword:(a,b)=>String(a||'').includes(b),parseMemoryCommand:()=>null}),
  on:(n,f)=>{hooks[n]=f},onDispose:f=>disposed.push(f),every:()=>()=>{},rule(){},tool(){},command(){},route:(n,f)=>routes[n]=f,
  use:()=>({forgetPerson:(q,t,o)=>{notifications.push(o);return{ok:true}}}),core:{http:{body:async r=>r.body,query:r=>r.query||{}}},ask:()=>{throw Error('unexpected model call')}};
 const vault=await vaultModule.setup(api); const db=new DatabaseSync(path.join(dir,'vault.sqlite'));
 t.after(()=>{db.close(); for(const f of disposed.reverse())f();fs.rmSync(dir,{recursive:true,force:true})});
 function inbound(chatId,text,messageId,time=Date.now(),segments=[]) {const [kind,id]=chatId.split(':');hooks.onebot({post_type:'message',message_type:kind,self_id:99999,user_id:kind==='private'?Number(id):10002,group_id:kind==='group'?Number(id):undefined,message_id:messageId,time:time/1000,sender:{nickname:'测试者'},message:[{type:'text',data:{text}},...segments]})}
 return{vault,db,hooks,routes,settings,config,inbound,notifications};
}
test('timeline preserves exact metadata and full raw text, confirmed egress only',async t=>{
 const f=await vaultFixture(t);const long='完整原文\n'+ '长'.repeat(2500);f.inbound('group:20001',long,1,1000,[{type:'at',data:{qq:'10001'}}]);
 f.hooks.sent([{type:'text',data:{text:'已发'}}],{chatId:'group:20001',messageId:2,at:2000});
 f.inbound('group:20001','回复',3,3000,[{type:'reply',data:{id:'2'}}]); f.hooks.activity({kind:'out',chatId:'group:20001',reply:'草稿'});
 assert.equal(typeof f.vault.timelinePage,'function'); const page=f.vault.timelinePage();assert.equal(page.rows.length,3);
 assert.equal(page.rows[0].text,long);assert.deepEqual(page.rows[0].atQQs,['10001']);assert.equal(page.rows[2].replyToQQ,'99999');assert.equal(page.rows[1].dir,'out');assert.equal(page.rows[2].sequence,3);assert.equal('rawJson' in page.rows[0],false);
});
test('pagination advances over revoked rows without skipping a later eligible row',async t=>{
 const f=await vaultFixture(t);for(let i=1;i<=5;i++)f.inbound(i<4?'group:20002':'private:10001','行'+i,i,i*1000);
 f.settings.groupList='20001';const a=f.vault.timelinePage({limit:1});assert.deepEqual(a.rows.map(r=>r.id),['vault:4']);assert.equal(a.nextId,4);assert.equal(a.hasMore,true);
 const b=f.vault.timelinePage({afterId:a.nextId,limit:1});assert.deepEqual(b.rows.map(r=>r.id),['vault:5']);assert.equal(b.hasMore,false);
 assert.equal(f.vault.timelineCurrent(['vault:1']),false);assert.equal(f.vault.timelineCurrent(['vault:4'],{chatId:'private:10002'}),false);
});
test('recent uses exact authorized chat, orders by time and excludes future records',async t=>{
 const f=await vaultFixture(t);f.inbound('private:10001','较新',1,2000);f.inbound('private:10001','较旧',2,1000);f.inbound('private:10001','未来',3,Date.now()+999999);f.inbound('private:10002','他人',4,1500);
 assert.deepEqual(f.vault.timelineRecent({chatId:'private:10001'}).map(r=>r.text),['较旧','较新']);assert.deepEqual(f.vault.timelineRecent(),[]);
 assert.equal(f.vault.timelineCurrent(['vault:1'],{chatId:'private:10001'}),true);f.config.allow.private=[];assert.deepEqual(f.vault.timelineRecent({chatId:'private:10002'}),[]);
 f.settings.enabled=false;assert.equal(f.vault.timelineCurrent(['vault:1']),false);
});
test('legacy memo and recall tool cannot bypass a newly revoked recording scope',async t=>{
 const f=await vaultFixture(t);f.db.prepare('INSERT INTO vault_days VALUES(?,?,?,?,?)').run('group:20002','2026-11-13','旧秘密','old',1);f.settings.recordGroups=false;
 const content=[{type:'text',text:'现在'}];assert.deepEqual(f.hooks.prompt(content,{chat:{kind:'group',chatId:'group:20002'}}),content);
});

test('whole-chat delete invalidates exact native acknowledgement identities and scoped old summaries',async t=>{
 const f=await vaultFixture(t);f.hooks.sent([{type:'text',data:{text:'原生回执'}}],{chatId:'private:10001',messageId:77,at:1000});
 await f.routes['/forget']({method:'POST',body:{chatId:'private:10001'}});assert.equal(f.vault.timelineCurrent(['vault:1']),false);assert.ok(f.notifications[0].sourceIds.includes('qq:99999:private:10001:out:77'));assert.equal(f.notifications[0].chatId,'private:10001');assert.equal(f.notifications[0].exactSources,true);
});

test('native messages with unknown original time do not acquire a fabricated occurrence date',async t=>{
 const f=await vaultFixture(t);f.hooks.onebot({post_type:'message',message_type:'private',self_id:99999,user_id:10001,message_id:15,message:[{type:'text',data:{text:'原时间未知'}}]});
 assert.equal(f.vault.timelinePage().rows[0].t,0);
});

test('exact inbound QQ identity resolves a quoted row only within the same chat',async t=>{
 const f=await vaultFixture(t)
 f.hooks.sent([{type:'text',data:{text:'这个群的原话'}}],{chatId:'group:20001',messageId:92,at:1000})
 f.hooks.sent([{type:'text',data:{text:'另一个群的原话'}}],{chatId:'group:20002',messageId:92,at:1000})
 f.inbound('group:20001','我是指这个',93,2000,[{type:'reply',data:{id:'92'}}])
 assert.deepEqual(f.vault.timelineQuote({chatId:'group:20001',messageId:'93',senderId:'10002'}).target.text,'这个群的原话')
 assert.equal(f.vault.timelineQuote({chatId:'group:20001',messageId:'93',senderId:'10004'}),null)
 assert.equal(f.vault.timelineQuote({chatId:'group:20002',messageId:'93',senderId:'10002'}),null)
 f.db.prepare('DELETE FROM vault_lines WHERE chatId=? AND messageKey=?').run('group:20001','92')
 assert.equal(f.vault.timelineQuote({chatId:'group:20001',messageId:'93',senderId:'10002'}).target,null)
})
