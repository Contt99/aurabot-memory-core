import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {harness,message} from '../core/harness.mjs'
import {installed,chat,makeHost,modelRequest} from './host-fixture.mjs'
import {createDiaryMedia} from '../../modules/diary/lib/modules/diary/media.js'

const source=process.env.AURABOT_HOST_SRC
if(!source) {
 test('installed host integration requires AURABOT_HOST_SRC',{skip:true},()=>{})
} else {
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'actual-host-memory-'))
 process.env.AURABOT_DATA_DIR=scratch
 process.env.DSH_HOME=path.join(scratch,'dsh-home')
 test.after(()=>fs.rmSync(scratch,{recursive:true,force:true}))
 const sdk=await installed()
 const user=text=>({id:randomUUID(),role:'user',source:{kind:'aurabot'},content:[{type:'text',text}]})

 test('installed Session replaces only the model surface before observing a frozen request',async t=>{
  const h=harness(t,{rows:[message(1,'ACTUAL_SESSION_SOURCE','out')]})
  const session=sdk.Session.create('owner')
  const options={chatId:chat.chatId,sessionId:session.id}
  const a=h.core.buildContext(options),b=h.core.buildContext(options)
  const original=session.append('user/message',user(a.text),{surfaceOp:'append'})
  const request=await modelRequest(h,session,[user(b.text)])
  assert(!session.surface.nodes.includes(original.seq))
  assert(session.surface.replaceGeneration>0)
  const replacement=session.eventAt(session.surface.nodes[0])
  assert.deepEqual(replacement.sourceEventSeqs,[original.seq])
  assert.equal((JSON.stringify(request.messages).match(/ACTUAL_SESSION_SOURCE/g)||[]).length,1)
  assert.match(JSON.stringify(session.eventAt(original.seq)),/ACTUAL_SESSION_SOURCE/)
  assert.equal(h.core.memoryStatus().snapshots.find(s=>s.id===b.id).status,'observed')
 })

 for(const mode of ['explicit forget','provider access withdrawn']) {
  test('installed hub: '+mode+' between reply splitting and OneBot cannot affect independent manual sends',{timeout:10000},async t=>{
   process.env.AURABOT_DATA_DIR=fs.mkdtempSync(path.join(scratch,'hub-'))
   const inspected=Promise.withResolvers()
   let seenRequest,revocation
   const {h,hub,session,checks,dispatched}=makeHost(t,{
    sdk,rows:[message(1,'PRIVATE_SOURCE_TO_FORGET','out')],
    model:async(request)=>{
     seenRequest=JSON.stringify(request.messages)
     // The real hub dispatches the generated reply from assistant/message + turn/end.
     hub.onSessionEvent(session,{type:'assistant/message',data:{turn:1,message:{role:'assistant',content:[{type:'text',text:'基于刚才的材料，我更偏爱第二个颜色。'}]}}})
     hub.onSessionEvent(session,{type:'turn/end',data:{turn:1,reason:{kind:'completed'}}})
    },
    items:instance=>{
     instance.rows.splice(0)
     revocation=mode==='explicit forget'
      ?instance.core.forgetPerson('10001','PRIVATE_SOURCE_TO_FORGET',{exactSources:true,sourceIds:['vault:1'],chatId:chat.chatId})
      :{ok:true}
    },
    send:decision=>inspected.resolve(decision)
   })
   await hub.pushToSession(chat,[{type:'text',text:'接着说吧'}],chat.userId)
   assert.match(seenRequest,/PRIVATE_SOURCE_TO_FORGET/)
   assert.equal(await inspected.promise,null)
   assert.equal(revocation?.ok,true)
   assert.equal(checks.length,1)
   assert(checks[0].source?.memory.some(text=>text.includes('【记忆快照:')))
   assert.equal(dispatched.length,0)
   assert(h.warnings.some(w=>w.includes('记忆一致性拦截')))
   await hub.sendText(chat.chatId,'已完成你的管理操作')
   assert.equal(checks[1].source,undefined)
   assert.deepEqual(dispatched,[[{type:'text',data:{text:'已完成你的管理操作'}}]])
  })
 }

 test('confirmed proactive QQ speech survives process restart and appears once with its original time in the next request',()=>{
  const root=fs.mkdtempSync(path.join(scratch,'restart-'))
  fs.mkdirSync(path.join(root,'life-core'))
  const worker=fileURLToPath(new URL('./restart-phase.mjs',import.meta.url))
  const run=(phase,...args)=>{
   const output=spawnSync(process.execPath,[worker,phase,...args],{
    encoding:'utf8',timeout:15000,env:{...process.env,AURABOT_DATA_DIR:root,DSH_HOME:path.join(root,'dsh-home')}
   })
   assert.equal(output.status,0,output.error?.message||output.stderr||output.stdout)
   return JSON.parse(output.stdout)
  }
  const sent=run('send')
  assert.equal(sent.dispatches,1)
  const received=run('receive',String(sent.at))
  assert.equal(received.dispatches,0)
  assert.equal(received.observed,true)
 })

 test('installed one-shot ask does not carry previous diary prompt or model prose after group authorization changes',async t=>{
  const h=harness(t),requests=[]
  h.cfg.diary={sourceGroups:['20001'],rich:{enabled:false},attachImage:false,minChars:1,maxChars:150}
  const {askModel}=await import(pathToFileURL(path.join(source,'core/llm.js')))
  await h.core.perform({module:'fixture',action:'read',public:false,chatId:'group:20001',evidenceType:'web-body'},async()=>({ok:true,text:'SYNTHETIC_DIARY_GROUP_MARKER'}))
  let text='第一轮纸风车草稿'
  const dsh={llm:{resolveModelInfo:async()=>({}),async *stream(opt){
   requests.push(opt)
   yield* await h.stream(Object.freeze(opt),[{type:'text-delta',text:JSON.stringify({text,imageIds:[]})},{type:'finish',reason:{kind:'stop'}}])
  }}}
  const api={...h.api,use:id=>id==='life-core'?h.core:null,
   ask:o=>askModel(dsh,{...o,model:{provider:'fixture',model:'fixture'}})}
  const media=createDiaryMedia(api)
  assert.equal((await media.compose()).text,text)
  assert.match(JSON.stringify(requests[0].messages),/SYNTHETIC_DIARY_GROUP_MARKER/)
  h.cfg.diary.sourceGroups=[]
  text='第二轮只写心情'
  assert.equal((await media.compose()).text,text)
  assert.equal(requests[1].messages.length,1)
  assert.doesNotMatch(JSON.stringify(requests[1]),/SYNTHETIC_DIARY_GROUP_MARKER|第一轮纸风车草稿/)
 })

 test('installed hub awaits managed recall and sees one source-bound snapshot in the frozen request',async t=>{
  process.env.AURABOT_DATA_DIR=fs.mkdtempSync(path.join(scratch,'hybrid-'))
  const enter=Promise.withResolvers(),release=Promise.withResolvers(),decoded=[]
  const {h,hub}=makeHost(t,{sdk,model:async request=>decoded.push(request)})
  const id='memory:fixture@0123456789abcd012345'
  let current=true
  h.modules.memory={
   contextForCore:()=>({text:'',sourceIds:[]}),
   contextForCoreRecall:async ({query})=>{
    enter.resolve(query);await release.promise
    return{text:'与字面不同的合成偏好',sourceIds:[id],recall:{mode:'hybrid',reason:'vector-matched'}}
   },
   contextCurrent:ids=>current&&ids.every(s=>s===id)
  }
  const ask=hub.pushToSession(chat,[{type:'text',text:'想喝点什么？'}],chat.userId,{queryText:'想喝点什么？'})
  assert.equal(await enter.promise,'想喝点什么？')
  assert.equal(decoded.length,0)
  release.resolve()
  await ask
  assert.equal(decoded.length,1)
  const body=JSON.stringify(decoded[0].messages)
  assert.equal((body.match(/【记忆快照:/g)||[]).length,1)
  assert.match(body,/与字面不同的合成偏好/)
  const sid=body.match(/【记忆快照:([\da-f-]{36})】/)[1]
  assert.equal(h.core.contextDetail(sid).data.memoryRecall.mode,'hybrid')
  current=false
  await assert.rejects(h.stream(decoded[0]),/失效|来源/)
 })
}
