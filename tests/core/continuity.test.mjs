import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {harness,message} from './harness.mjs'

test('recent actual speech is supplied without keyword matching and survives restart',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'continuity-restart-'));let h;t.after(()=>{h?.close();fs.rmSync(dir,{recursive:true,force:true})})
 const rows=[message(1,'蓝色信封放进纪念册了吗？','out'),message(2,'你说哪一本？')]
 h=harness(t,{directory:dir,rows});let s=h.core.buildContext({chatId:'private:10001',purpose:'chat',sessionId:'owner',query:'嗯？'})
 assert.match(s.text,/蓝色信封放进纪念册了吗/);assert(s.sourceIds.includes('vault:1'))
 assert.equal(h.core.memoryStatus().snapshots.find(x=>x.id===s.id).status,'prepared')
 h.close();h=harness(t,{directory:dir,rows});s=h.core.buildContext({chatId:'private:10001',purpose:'chat',sessionId:'owner',query:'嗯？'})
 assert.match(s.text,/蓝色信封放进纪念册了吗/)
 await h.stream({sessionId:'owner',messages:[{role:'user',source:{kind:'aurabot'},content:[{type:'text',text:s.text}]}]})
 assert.equal(h.core.memoryStatus().snapshots.find(x=>x.id===s.id).status,'observed')
})

test('context compiler never mixes private targets or brings private continuity into public diaries',t=>{
 const h=harness(t,{rows:[message(1,'OWNER_PRIVATE_MARK','out'),message(2,'GUEST_PRIVATE_MARK','out','private:10003'),message(3,'GROUP_MARK','in','group:20001')]})
 const guest=h.core.buildContext({chatId:'private:10003',purpose:'chat'})
 assert.match(guest.text,/GUEST_PRIVATE_MARK/);assert.doesNotMatch(guest.text,/OWNER_PRIVATE_MARK|GROUP_MARK/)
 const diary=h.core.buildContext({purpose:'public-diary',chatId:'private:10001'})
 assert.doesNotMatch(diary.text,/OWNER_PRIVATE_MARK|GUEST_PRIVATE_MARK|GROUP_MARK/)
 h.cfg.allow.private=[];assert.throws(()=>h.core.assertContextCurrent(guest),/授权|来源|权限/)
})

test('confirmed send receipts are idempotent and different native messages with identical text remain distinct',t=>{
 const h=harness(t);const segments=[{type:'text',data:{text:'我说过的原话'}}]
 for(const messageId of ['one','one','two'])h.emit('sent',segments,{chatId:'private:10001',messageId,at:Date.now()})
 const events=h.core.timeline({chatId:'private:10001'}).filter(e=>e.type==='utterance')
 assert.equal(events.length,2)
 assert.match(h.core.buildContext({chatId:'private:10001'}).text,/我说过的原话/)
})

test('forget invalidates prepared snapshots and purges their stored excerpts, also after restart',t=>{
 const h=harness(t,{rows:[message(1,'FORGET_EXACT_MARK','out')]})
 const s=h.core.buildContext({chatId:'private:10001',sessionId:'owner'})
 h.rows.splice(0);h.core.forgetPerson('10001','FORGET_EXACT_MARK',{exactSources:true,sourceIds:['vault:1'],chatId:'private:10001'})
 assert.throws(()=>h.core.assertContextCurrent(s),/忘记|来源|失效/)
 assert(!JSON.stringify(h.core.memoryStatus()).includes('FORGET_EXACT_MARK'))
 assert.doesNotMatch(h.core.buildContext({chatId:'private:10001'}).text,/FORGET_EXACT_MARK/)
})

test('prepared source dates remain historical; present recollection is allowed but fake immediate observation is blocked',t=>{
 const h=harness(t,{rows:[message(1,'纸风车展示会','in','group:20001',Date.parse('2024-04-06T09:17:01+08:00'))]})
 const s=h.core.buildContext({chatId:'group:20001',now:Date.parse('2024-04-12T12:22:53+08:00')})
 assert.match(s.text,/2024-04-06.*09:17/)
 assert.equal(h.core.validateDraft('刚在群里看到纸风车展示会',s).ok,false)
 assert.equal(h.core.validateDraft('刚想起前几天的纸风车展',s).ok,true)
})

test('a request that never starts does not consume handoff; independent model calls cannot observe another scope',async t=>{
 const h=harness(t,{rows:[message(1,'PENDING_SPEECH','out')]});const s=h.core.buildContext({chatId:'private:10001',sessionId:'owner'})
 await assert.rejects(h.stream({sessionId:'guest',messages:[{role:'user',content:[{type:'text',text:s.text}]}]}),/授权|范围/)
 assert.equal(h.core.memoryStatus().snapshots.find(x=>x.id===s.id).status,'prepared')
 assert.match(h.core.buildContext({chatId:'private:10001',sessionId:'owner'}).text,/PENDING_SPEECH/)
})

test('context budget is bounded without truncating original stored chat messages',t=>{
 const body='长正文'.repeat(5000),h=harness(t,{rows:[message(1,body),...Array.from({length:20},(_,i)=>message(i+2,'发言'+i+'。'.repeat(300),'out'))]})
 const s=h.core.buildContext({chatId:'private:10001'})
 assert(s.text.length<=6000);assert.equal(h.rows[0].text,body);assert(s.text.includes('发言19'))
})
