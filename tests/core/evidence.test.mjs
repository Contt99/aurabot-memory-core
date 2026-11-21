import test from 'node:test'
import assert from 'node:assert/strict'
import {harness,message} from './harness.mjs'

test('source currentness does not depend on unrelated newer records winning retrieval rank',async t=>{
 const h=harness(t)
 await h.core.perform({module:'web',action:'read',public:true,evidenceType:'web-body'},async()=>({ok:true,text:'ORIGINAL_WHALE_EVIDENCE'}))
 const s=h.core.buildContext({chatId:'private:10001',query:'ORIGINAL_WHALE_EVIDENCE'})
 for(let i=0;i<12;i++)await h.core.perform({module:'web',action:'read',public:true,evidenceType:'web-body'},async()=>({ok:true,text:'UNRELATED_'+i}))
 assert.equal(h.core.assertContextCurrent(s),true)
})

test('a corrected utterance remains historical speech but is not reused as the old current fact',t=>{
 const h=harness(t,{rows:[message(1,'ORIGINAL_WRONG_MARK','out')]})
 const s=h.core.buildContext({chatId:'private:10001'}),e=h.core.timeline({chatId:'private:10001'})[0]
 h.core.correctEvent({id:e.id,chatId:'private:10001',text:'CORRECT_CURRENT_MARK',reason:'本人纠正'})
 assert.throws(()=>h.core.assertContextCurrent(s),/失效|忘记/)
 const next=h.core.buildContext({chatId:'private:10001'})
 assert.match(next.text,/CORRECT_CURRENT_MARK/);assert.doesNotMatch(next.text,/ORIGINAL_WRONG_MARK/)
 assert.equal(h.rows[0].text,'ORIGINAL_WRONG_MARK')
 assert.equal(h.core.timeline({chatId:'private:10001'})[0].status,'corrected')
})

test('new input during proactive generation blocks the stale draft but ordinary replies retain their contract',t=>{
 const h=harness(t,{rows:[message(1,'准备周六交换贴纸','out',undefined,Date.now()-10000)]}),at=Date.now()-5000
 const p=h.core.buildContext({chatId:'private:10001',purpose:'proactive',now:at})
 h.rows.push(message(2,'不去了，计划取消',undefined,undefined,Date.now()))
 assert.equal(h.core.validateDraft('今晚照原计划来吧',p).ok,false)
 const normal=h.core.buildContext({chatId:'private:10001',purpose:'chat'})
 assert.equal(h.core.validateDraft('好，那就不去了。',normal).ok,true)
})

test('a prepared bound proactive turn is not compiled again by ordinary prompt handoff',async t=>{
 const h=harness(t,{rows:[message(1,'PERSISTED_SPEECH','out')]})
 const s=h.core.buildContext({chatId:'private:10001',purpose:'proactive'})
 const result=await h.core.runWithContext(s,()=>h.emit('prompt',[{type:'text',text:s.text}],{chat:{chatId:'private:10001'},sessionId:'owner'}))
 assert.equal(result.filter(b=>b.text?.includes('【记忆快照:')).length,1)
})

test('fake completion is blocked while expressions of intent or uncertainty remain possible',t=>{
 const h=harness(t),s=h.core.buildContext({chatId:'private:10001'})
 assert.equal(h.core.validateDraft('我已经完成探索了。',s).ok,false)
 assert.equal(h.core.validateDraft('我还没完成探索。',s).ok,true)
 assert.equal(h.core.validateDraft('我打算去探索一下。',s).ok,true)
})

test('actual observations retain their original observed time, and image revocation invalidates context',t=>{
 const h=harness(t),id='image:private:10001:synthetic@v1';let current=true
 h.modules['image-familiar']={contextCurrent:ids=>current&&ids.every(x=>x===id)}
 h.core.recordObservation({chatId:'private:10001',sourceId:id,occurredAt:null,observedAt:12345678,evidenceType:'visual-interpretation'},{text:'图片动作不确定'})
 const e=h.core.timeline({chatId:'private:10001'})[0];assert.equal(e.observedAt,12345678);assert.equal(e.occurredAt,null)
 const s=h.core.buildContext({chatId:'private:10001'});assert.match(s.text,/动作不确定/)
 current=false;assert.throws(()=>h.core.assertContextCurrent(s),/图片/)
})

test('prepared meme hints do not become observations until their actual owned model request',async t=>{
 const h=harness(t);let enabled=true
 h.modules['meme-wiki']={contextCurrent:()=>enabled}
 const staged=h.core.prepareObservation({module:'meme-wiki',chatId:'private:10001',sessionId:'owner',sourceId:'meme:entry@v1',evidenceType:'meme-reference'},{text:'梗的原始解释'})
 assert(!h.core.timeline().some(e=>e.type==='observation'))
 await h.stream({sessionId:'guest',messages:[{content:[{type:'text',text:staged.marker}]}]})
 assert(!h.core.timeline().some(e=>e.type==='observation'))
 await h.stream({sessionId:'owner',messages:[{content:[{type:'text',text:staged.marker}]}]})
 assert(!h.core.timeline().some(e=>e.type==='observation'),'a marker is not the prepared hint')
 await h.stream({sessionId:'owner',messages:[{content:[{type:'text',text:'梗的原始解释 '+staged.marker}]}]})
 assert.equal(h.core.timeline().filter(e=>e.type==='observation').length,1)
 enabled=false
 const other=h.core.prepareObservation({module:'meme-wiki',chatId:'private:10001',sessionId:'owner',sourceId:'meme:entry@v2',evidenceType:'meme-reference'},{text:'已被撤销的解释'})
 await assert.rejects(h.stream({sessionId:'owner',messages:[{content:[{type:'text',text:other.marker}]}]}),/观察|来源|撤销/)
})

test('old action history outside the latest500 is projected rather than silently omitted',async t=>{
 const h=harness(t)
 await h.core.perform({module:'web',action:'read',chatId:'private:10001',callId:'old'},async()=>({ok:true,text:'OLD_ACTION_BODY'}))
 for(let i=0;i<501;i++)await h.core.perform({module:'web',action:'read',public:true,callId:'new-'+i},async()=>({ok:true,text:'new'}))
 assert(h.core.timeline({chatId:'private:10001'}).some(e=>e.data.action==='read'))
})

test('explicit diary selections, rather than a second default selection, are the snapshot authority',async t=>{
 const h=harness(t)
 await h.core.perform({module:'web',action:'read',public:true},async()=>({ok:true,text:'EXPLICIT_DIARY_SOURCE'}))
 const sources=h.core.diarySources('public'),s=h.core.buildContext({purpose:'public-diary',diarySources:[]})
 assert(!s.sourceIds.includes(sources[0].id))
 const selected=h.core.buildContext({purpose:'public-diary',diarySources:sources})
 assert(selected.sourceIds.includes(sources[0].id))
})
