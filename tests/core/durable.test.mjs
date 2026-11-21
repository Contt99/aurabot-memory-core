import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {harness,message} from './harness.mjs'

const chatId='private:10001'
const request=(h,text,sessionId='owner')=>h.stream({sessionId,messages:[{role:'user',content:[{type:'text',text}]}]})

test('only the exact sourced lines in the actual request are observed and handed off',async t=>{
 const h=harness(t,{rows:[message(1,'INCLUDED','out'),message(2,'NEVER_INCLUDED','out')]})
 for(const row of h.rows)h.emit('sent',[{type:'text',data:{text:row.text}}],{chatId,messageId:row.messageId,at:row.t})
 const s=h.core.buildContext({chatId,sessionId:'owner'})
 await request(h,s.text.replace(/^.*NEVER_INCLUDED.*$/m,''))
 const rows=h.core.timeline({chatId})
 assert(rows.find(e=>e.data.text==='INCLUDED').observedAt)
 assert.equal(rows.find(e=>e.data.text==='NEVER_INCLUDED').observedAt,null)
 assert.equal(h.core.memoryStatus().pendingHandoffs,1)
 assert.deepEqual(h.core.contextDetail(s.id).data.observedSourceIds,['vault:1'])
})
test('only the target chat session consumes its backlog; restore and move beyond the latest 30',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'handoff-')),rows=[message(1,'EARLY SPEECH','out'),...Array.from({length:45},(_,i)=>message(i+2,'new '+i))]
 let h=harness(t,{directory:dir,rows});t.after(()=>{h.close();fs.rmSync(dir,{recursive:true,force:true})})
 h.emit('sent',[{type:'text',data:{text:rows[0].text}}],{chatId,messageId:rows[0].messageId,at:rows[0].t})
 const s=h.core.buildContext({chatId,purpose:'proactive'});await h.core.runWithContext(s,()=>request(h,s.text,'purpose'))
 assert.equal(h.core.memoryStatus().pendingHandoffs,1)
 h.close();h=harness(t,{directory:dir,rows})
 const next=h.core.buildContext({chatId,sessionId:'owner'});assert.match(next.text,/EARLY SPEECH/)
 await request(h,next.text);assert.equal(h.core.memoryStatus().pendingHandoffs,0)
 assert.doesNotMatch(h.core.buildContext({chatId,sessionId:'owner'}).text,/EARLY SPEECH/)
 assert.match(h.core.buildContext({chatId,sessionId:'new-session'}).text,/EARLY SPEECH/)
})

test('history stays indexed without filling the live pending handoff queue',t=>{
 const old=Date.now()-86_400_000
 const rows=Array.from({length:18},(_,i)=>message(i+1,'HISTORICAL_'+i,'out',chatId,old+i))
 const h=harness(t,{rows})
 assert.equal(h.core.timeline({chatId}).length,18)
 assert.equal(h.core.memoryStatus().pendingHandoffs,0)
 assert.match(h.core.buildContext({chatId}).text,/HISTORICAL_17/)
})

test('v2 migration removes only stale queued projections, keeps newer or ACK-pending records and preserves event originals',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'handoff-migration-'))
 let h=harness(t,{directory,rows:[message(1,'OLD_PROJECTION','out',chatId,Date.now()-86_400_000)]})
 t.after(()=>{h.close();fs.rmSync(directory,{recursive:true,force:true})})
 h.core.sync()
 const old=h.core.timeline({chatId})[0]
 h.emit('sent',[{type:'text',data:{text:'NEW_ACK'}}],{chatId,messageId:'new-ack'})
 h.close()
 const db=new DatabaseSync(path.join(directory,'life.sqlite'))
 db.prepare("DELETE FROM kv WHERE key='memory-handoff-live-since'").run()
 db.prepare("INSERT OR IGNORE INTO memory_handoffs(eventId,chatId,status) VALUES(?,?,'pending')").run(old.id,chatId)
 db.close()
 h=harness(t,{directory})
 assert.equal(h.core.memoryStatus().pendingHandoffs,1)
 assert(h.core.timeline({chatId}).some(x=>x.id===old.id))
 assert.match(h.core.buildContext({chatId}).text,/NEW_ACK/)
})
test('exact forget before the first projection survives stale replay, without removing an unrelated identical message',t=>{
 const h=harness(t,{rows:[message(1,'same body','out'),message(2,'same body','out')]})
 h.core.forgetPerson('10001','same body',{exactSources:true,chatId,sourceIds:['vault:1']})
 const s=h.core.buildContext({chatId})
 assert(!s.sourceIds.includes('vault:1'));assert(s.sourceIds.includes('vault:2'))
})
test('corrected promise and selected diary original cannot leak from another view',async t=>{
 const rows=[message(1,'我等会去搜索 WRONG_PROMISE','out','group:20001')],h=harness(t,{rows})
 h.cfg.diary.sourceGroups=['20001']
 h.modules['history-vault'].diaryMaterial=()=>rows
 h.core.buildContext({chatId:'group:20001'})
 const original=h.core.timeline().find(e=>e.type==='utterance')
 h.core.correctEvent({id:original.id,text:'不用搜索 NEW_DECISION'})
 const s=h.core.buildContext({chatId:'group:20001'})
 assert.match(s.text,/NEW_DECISION/);assert.doesNotMatch(s.text,/WRONG_PROMISE/)
 assert(!JSON.stringify(h.core.diarySources('public')).includes('WRONG_PROMISE'))
})
test('forgetting correction evidence retires its revised claim without reviving the original',t=>{
 const h=harness(t,{rows:[message(1,'BAD_OLD','out'),message(2,'explanation')]})
 const e=h.core.timeline().find(e=>e.type==='utterance')
 h.core.correctEvent({id:e.id,text:'GOOD_NEW',sourceIds:['vault:2']})
 const s=h.core.buildContext({chatId});assert.match(s.text,/GOOD_NEW/)
 h.rows.pop();h.core.forgetPerson('10001','',{exactSources:true,chatId,sourceIds:['vault:2']})
 assert.throws(()=>h.core.assertContextCurrent(s))
 assert.doesNotMatch(h.core.buildContext({chatId}).text,/GOOD_NEW|BAD_OLD/)
})
test('expired snapshots are bounded and cannot send old text via a surviving session surface',async t=>{
 const h=harness(t,{rows:[message(1,'EXPIRED_SOURCE')]})
 const old=h.core.buildContext({chatId})
 const stat=h.core.memoryStatus()
 assert(stat.snapshotLimit>0&&stat.snapshotLimit<=1000)
 h.rows.splice(0)
 for(let i=0;i<stat.snapshotLimit;i++)h.core.buildContext({chatId})
 assert(!h.core.contextDetail(old.id));assert.throws(()=>h.core.assertContextCurrent(old))
 const r=await h.enter([],{history:[{role:'user',content:[{type:'text',text:old.text}]}]})
 assert(!JSON.stringify(r.messages).includes('EXPIRED_SOURCE'))
})
test('write failure degrades continuity with an actionable storage error until a successful retry',t=>{
 const h=harness(t),db=new DatabaseSync(path.join(h.dir,'life.sqlite'))
 db.exec("CREATE TRIGGER stop_write BEFORE INSERT ON memory_snapshots BEGIN SELECT RAISE(FAIL,'disk is full'); END;")
 assert.throws(()=>h.core.buildContext({chatId}),/disk is full/)
 assert.equal(h.core.contextManaged('chat'),false);assert.match(h.core.memoryStatus().lastError,/disk is full/)
 db.exec('DROP TRIGGER stop_write');db.close()
 h.core.buildContext({chatId});assert.equal(h.core.contextManaged('chat'),true)
})
test('an unrelated manual send is not bound to the preceding observed chat turn',async t=>{
 const h=harness(t),s=h.core.buildContext({chatId})
 await request(h,s.text)
 const segments=[{type:'text',data:{text:'我已经完成管理操作'}}]
 assert.deepEqual(h.emit('send',segments,{chatId}),segments)
})

test('corrections propagate through old and subsequently recorded notes in every recall entrypoint', async t=>{
 const h=harness(t,{rows:[message(1,'WRONG_EVENT','out')]})
 const e=h.core.timeline()[0];await h.core.perform({module:'test',action:'note',evidenceType:'note',sourceIds:[e.id],chatId},async()=>({ok:true,text:'BAD_DERIVED_BEFORE'}))
 h.core.timeline();h.core.correctEvent({id:e.id,text:'NOW_CORRECT'})
 await h.core.perform({module:'test',action:'note',evidenceType:'note',sourceIds:[e.id],chatId},async()=>({ok:true,text:'BAD_DERIVED_AFTER'}))
 assert(!JSON.stringify(h.core.recall({chatId})).includes('BAD_DERIVED'))
 assert(!JSON.stringify(h.core.diarySources('private')).includes('BAD_DERIVED'))
})
test('explicit forget removes the corresponding receipt from diary authority and raw action details',t=>{
 const h=harness(t),id='forget-ack';h.emit('sent',[{type:'text',data:{text:'SECRET_RECEIPT'}}],{chatId,messageId:id})
 const event=h.core.timeline().find(e=>e.type==='utterance')
 h.core.forgetPerson('10001','',{exactSources:true,chatId,sourceIds:[event.id]})
 const db=new DatabaseSync(path.join(h.dir,'life.sqlite'))
 try{assert(!JSON.stringify(db.prepare('SELECT meta,result FROM actions').all()).includes('SECRET_RECEIPT'))}finally{db.close()}
 assert(!JSON.stringify(h.core.diarySources('private')).includes('SECRET_RECEIPT'))
})
test('a current compilation replaces older unique history blocks as well as duplicate lines',async t=>{
 const h=harness(t,{rows:[message(1,'OLDER_MATERIAL')]})
 const old=h.core.buildContext({chatId})
 h.rows.push(...Array.from({length:12},(_,i)=>message(i+2,'NEW MATERIAL '+i)))
 const s=h.core.buildContext({chatId});assert.doesNotMatch(s.text,/OLDER_MATERIAL/)
 const r=await h.enter([{role:'user',content:[{type:'text',text:s.text}]}],{history:[{role:'user',content:[{type:'text',text:old.text}]}]})
 assert.doesNotMatch(JSON.stringify(r.messages),/OLDER_MATERIAL/)
})

test('new but mixed-scope actions cannot authorize a completion claim in a different audience',async t=>{
 const h=harness(t),s=h.core.buildContext({chatId:'private:10003'})
 await h.core.perform({module:'test',action:'read',public:true,sourceScopes:[chatId],evidenceType:'web-body'},async()=>({ok:true,text:'private body'}))
 assert.equal(h.core.validateDraft('我已经读完这篇文章。',s).ok,false)
 await h.core.perform({module:'test',action:'read',chatId:'private:10003',evidenceType:'web-body'},async()=>({ok:true,text:'available body'}))
 assert.equal(h.core.validateDraft('我已经读完这篇文章。',s).ok,true)
})
test('material explicitly dated before retrieval keeps its original date in recall and diaries',async t=>{
 const h=harness(t),old=Date.parse('2022-05-06T01:00:00Z')
 await h.core.perform({module:'test',action:'read',public:true,occurredAt:old,evidenceType:'web-body'},async()=>({ok:true,text:'ARCHIVED_SOURCE'}))
 const s=h.core.buildContext({chatId})
 assert.equal(s.items.find(i=>i.type==='action').occurredAt,old)
 const diary=h.core.buildContext({purpose:'public-diary'})
 assert.equal(diary.items.find(i=>i.type==='action').occurredAt,old)
})
test('revoked hint blocks are removed from historical user surfaces without changing the native message',async t=>{
 const h=harness(t),sourceId='meme:sample',meta={module:'meme-wiki',chatId,sessionId:'owner',sourceId,evidenceType:'meme-reference'}
 h.modules['meme-wiki']={contextCurrent:()=>false}
 const stage=h.core.prepareObservation(meta,{text:'MATERIAL_REVOKED'})
 const msg={role:'user',content:[{type:'text',text:'Native question?'},{type:'text',text:'（可能是这些梗，MATERIAL_REVOKED）\n'+stage.marker}]}
 const r=await h.enter([],{history:[msg]})
 assert.doesNotMatch(JSON.stringify(r.messages),/MATERIAL_REVOKED/)
 assert.match(JSON.stringify(r.messages),/Native question/)
})
test('resetting the owning hub mapping cannot admit its revoked in-flight model request as independent',async t=>{
 const h=harness(t,{rows:[message(1,'RETIRED_SESSION')]})
 const s=h.core.buildContext({chatId,sessionId:'owner'})
 h.core.forgetPerson('', '', {exactSources:true,chatId,sourceIds:['vault:1']})
 h.api.core.hub.chatOfSession=()=>''
 await assert.rejects(request(h,s.text),/失效|授权|归档/)
 await request(h,'unrelated material','independent')
})
test('a provider failure is recorded separately from material visible in the request',async t=>{
 const h=harness(t,{rows:[message(1,'VISIBLE_ON_FAILED_REQUEST')]})
 const s=h.core.buildContext({chatId,sessionId:'owner'})
 await h.stream({sessionId:'owner',messages:[{role:'user',content:[{type:'text',text:s.text}]}]},[{type:'finish',reason:{kind:'error'}}])
 const row=h.core.contextDetail(s.id)
 assert.equal(row.status,'observed');assert.equal(row.data.requestStatus,'failed')
})
test('late vault linkage does not restore corrected speech to the diary selector',t=>{
 const h=harness(t),chatId='group:20001';h.cfg.diary.sourceGroups=['20001']
 const row=message(1,'REPLACED_WORDS','out',chatId)
 h.emit('sent',[{type:'text',data:{text:row.text}}],{chatId,messageId:row.messageId})
 const e=h.core.timeline().find(r=>r.type==='utterance');h.core.correctEvent({id:e.id,text:'new'})
 h.rows.push(row);h.modules['history-vault'].diaryMaterial=()=>h.rows;h.core.sync()
 assert(!JSON.stringify(h.core.diarySources('public')).includes('REPLACED_WORDS'))
})
