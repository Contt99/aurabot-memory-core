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
import imageDefinition from '../../modules/image-familiar/index.mjs'
import {createRequire} from 'node:module'
import {prepareImage} from '../../modules/image-familiar/lib/frames.mjs'
import {createLifeAdapter as purposeAdapter} from '../../modules/purpose/life.mjs'
import lifeDefinition from '../../modules/life-core/index.mjs'
import tiebaDefinition from '../../modules/tieba-reader/index.mjs'
import {bindApi as bindQzone,createQzone} from '../../modules/diary/lib/features/qzone.js'
import {createLifeAdapter as diaryAdapter} from '../../modules/diary/life.mjs'
import {createPrivateJournal,journalDate} from '../../modules/autonomy/lib/private-journal.mjs'
import purposeDefinition from '../../modules/purpose/index.mjs'
import speakupDefinition from '../../modules/speakup/index.mjs'
import {localDateKey} from '../../modules/purpose/lib/purpose/engine.js'

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

 test('installed hub: legacy scheduler uses an isolated one-shot request and preserves native private speech',async t=>{
  process.env.AURABOT_DATA_DIR=fs.mkdtempSync(path.join(scratch,'speakup-candidate-'))
  const requests=[],turns=[]
  const {h,hub,dispatched}=makeHost(t,{sdk,rows:[message(1,'今天想聊纸风车'),message(2,'OTHER_PRIVATE_STUB','in','private:10003')],model:p=>turns.push(p)})
  h.cfg.speakUp={enabled:true,awakeFrom:0,awakeTo:24,idleMinutes:0,minIntervalMinutes:1}
  h.cfg.ext.purpose={enabled:false}
  h.api.core.mutes={muted:()=>false}
  h.modules['life-core']=h.core
  h.api.core.modules={status:()=>[{id:'speakup',running:'user'}]}
  const {askModel}=await import(pathToFileURL(path.join(source,'core/llm.js')))
  const libs=Object.fromEntries(await Promise.all(['core/store.js','core/llm.js','core/text.js','core/offpeak.js']
   .map(async p=>[p,await import(pathToFileURL(path.join(source,p)))])))
  const entry=h.modules.speakup=speakupDefinition.setup({...h.api,id:'speakup',lib:p=>libs[p],ask:o=>askModel({llm:{
   resolveModelInfo:async()=>({}),
   async *stream(opt){
    requests.push(opt)
    yield* await h.stream(Object.freeze(opt),[{type:'text-delta',text:'纸风车的话题要接着聊吗？'},{type:'finish',reason:{kind:'stop'}}])
   }
  }},{...o,model:{provider:'fixture',model:'fixture'}})})
  assert.equal(h.core.ownsSchedule('speakup','contact-tick'),true)
  await entry.tick();await h.timers.get('统一后台调度')()
  assert.equal(turns.length,0)
  assert.equal(dispatched.length,1)
  assert.match(JSON.stringify(requests[0].messages),/纸风车/)
  assert.doesNotMatch(JSON.stringify(requests[0].messages),/OTHER_PRIVATE_STUB/)
  assert.equal(h.routes.get('/candidates')({headers:{host:'localhost'}}).items[0].receipt,'1')
  await hub.pushToSession(chat,[{type:'text',text:'好啊，接着聊。'}],chat.userId)
  assert.match(JSON.stringify(turns[0].messages),/纸风车的话题要接着聊吗/)
 })

 for(const withdraw of [false,true])test('installed hub: purpose candidate '+(withdraw?'honors a forget after an async outbound filter':'persists a native QQ receipt'),async t=>{
  process.env.AURABOT_DATA_DIR=fs.mkdtempSync(path.join(scratch,'purpose-candidate-'))
  const {h,dispatched}=makeHost(t,{sdk,rows:[message(1,'今天好想一起看看流星雨？')],
   afterSendFilter:withdraw?async instance=>{
    await new Promise(r=>setImmediate(r))
    instance.core.forgetPerson('10001','',{exactSources:true,sourceIds:['vault:1'],chatId:chat.chatId})
   }:undefined})
  Object.assign(h.cfg,{speakUp:{awakeFrom:0,awakeTo:24,idleMinutes:0,minIntervalMinutes:1},ext:{purpose:{enabled:true,minMaterials:0}}})
  h.api.core.mutes={muted:()=>false}
  h.modules['life-core']=h.core
  const {askModel}=await import(pathToFileURL(path.join(source,'core/llm.js')))
  const loaded=await Promise.all(['core/store.js','chat/reply.js'].map(async p=>[p,await import(pathToFileURL(path.join(source,p)))]))
  const library=Object.fromEntries(loaded),store=library['core/store.js']
  store.writeJson(store.dataDir('purpose','purpose-state.json'),{day:localDateKey(),lastRunAt:Date.now()-60_000})
  const purpose=h.modules.purpose=purposeDefinition.setup({...h.api,id:'purpose',settings:()=>h.cfg.ext.purpose,lib:p=>library[p],ask:o=>askModel({llm:{
   resolveModelInfo:async()=>({}),
   async *stream(opt){
    yield* await h.stream(Object.freeze(opt),[{type:'text-delta',text:'要一起看流星雨吗？'},{type:'finish',reason:{kind:'stop'}}])
   }
  }},{...o,model:{provider:'fixture',model:'fixture'}})})
  await purpose.tick();await h.timers.get('统一后台调度')()
  const [candidate]=h.routes.get('/candidates')({headers:{host:'localhost'}}).items
  assert.equal(dispatched.length,withdraw?0:1,JSON.stringify({candidate,warnings:h.warnings}))
  assert.equal(candidate.status,withdraw?'not-sent':'sent')
  assert.equal(candidate.receipt,withdraw?null:'1')
  assert.equal(h.core.proactiveState().count,1)
  if(!withdraw)assert.match(h.core.buildContext({chatId:chat.chatId,purpose:'chat',query:'你刚才说的'}).text,/要一起看流星雨吗/)
 })

 test('installed one-shot model and durable diary queue keep Qzone and the server-local journal separate',async t=>{
  process.env.AURABOT_DATA_DIR=fs.mkdtempSync(path.join(scratch,'diary-candidates-'))
  const clock=new Date().setHours(14,0,0,0)
  const {h}=makeHost(t,{sdk,now:()=>clock})
  h.modules['life-core']=h.core
  h.cfg.diary={enabled:true,timesPerDay:1,windowStart:'09:00',windowEnd:'23:00',minGapMinutes:60,minChars:1,maxChars:120,
   sourceGroups:[],attachImage:false,rich:{enabled:false},visibility:'friends'}
  const {askModel}=await import(pathToFileURL(path.join(source,'core/llm.js')))
  const loaded=await Promise.all(['core/store.js','core/net.js','chat/reply.js'].map(async p=>[p,await import(pathToFileURL(path.join(source,p)))]))
  const library=Object.fromEntries(loaded),requests=[],writes=[]
  const read=await h.core.performEvidence({module:'fixture',action:'read',public:true,evidenceType:'web-body'},async()=>({ok:true,text:'PUBLIC_PAPER_WINDMILL'}))
  const priv=await h.core.performEvidence({module:'fixture',action:'read',chatId:chat.chatId,evidenceType:'web-body'},async()=>({ok:true,text:'OWNER_PRIVATE_PAPER_WINDMILL'}))
  const ask=opts=>askModel({llm:{
   resolveModelInfo:async()=>({}),
   async *stream(opt){
    requests.push(opt)
    const response=opts.system==='fixture:public'?{text:'今天读了一篇纸风车的资料。',imageIds:[]}:
     opts.system.includes('独立核验员')?{approved:true,sourceIds:[priv.experienceId],issues:[]}:
     {text:'读了纸风车资料，先记在私人日记里。',sourceIds:[priv.experienceId],unresolvedQuestions:[],notes:[]}
    yield* await h.stream(Object.freeze(opt),[{type:'text-delta',text:JSON.stringify(response)},{type:'finish',reason:{kind:'stop'}}])
   }
  }},{...opts,model:{provider:'fixture',model:'fixture'}})
  const publicApi={...h.api,id:'diary',lib:p=>library[p],ask:o=>ask({...o,system:'fixture:public'})}
  bindQzone(publicApi)
  const qzone=h.modules.diary=createQzone({getConfig:publicApi.config,life:diaryAdapter(publicApi),hub:h.api.core.hub,log:h.api.log,
   onebot:{call:async(action,params,options)=>{writes.push({action,params,options});return{tid:'space-host-01',time:Math.floor(clock/1000)}}},now:()=>clock,rand:()=>0,composeDiary:createDiaryMedia(publicApi).compose})
  await qzone.tick();await h.timers.get('统一后台调度')()
  assert.equal(writes.length,1)
  assert.equal(writes[0].action,'send_qzone_msg')
  assert.equal(writes[0].params.ugc_right,4)
  assert.equal(writes[0].options.retries,0)
  assert.match(JSON.stringify(requests[0].messages),/PUBLIC_PAPER_WINDMILL/)
  assert.doesNotMatch(JSON.stringify(requests[0].messages),/OWNER_PRIVATE_PAPER_WINDMILL/)
  const journal=createPrivateJournal({...h.api,id:'autonomy'}, {ask,assertActive(){}})
  h.modules.autonomy={lifeJobs:()=>[journal.job]}
  const result=await h.core.runDiaryCandidate({module:'autonomy',job:'journal',key:'wake-host-01',target:'server:private-journal',expiresAt:clock+60000})
  assert.equal(result.status,'saved',result.message)
  const [entry]=journal.day(journalDate())
  assert.deepEqual(entry.sourceIds,[priv.experienceId])
  assert.match(JSON.stringify(requests[1].messages),/OWNER_PRIVATE_PAPER_WINDMILL/)
  assert.equal(writes.length,1)
  const receipts=h.routes.get('/candidates')({headers:{host:'localhost'}}).items
  assert.deepEqual(receipts.map(r=>r.receipt),[entry.id,'space-host-01'])
  assert.ok(receipts.find(r=>r.job==='publish').sourceIds.includes(read.experienceId))
 })

 test('installed hub: a scheduled Tieba candidate receives one QQ ACK and the next model request sees the exact share',async t=>{
  process.env.AURABOT_DATA_DIR=fs.mkdtempSync(path.join(scratch,'tieba-candidate-'))
  const requests=[]
  // The first scheduler check is intentionally one minute after startup.
  let now=Date.now()
  // This is the positive receipt case, not the midnight-expiry case. Keep the
  // synthetic scheduler's two ticks on one Beijing date even near 00:00.
  const sh=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'})
  if(sh.format(now)!==sh.format(now+120_000))now+=120_000
  const {h,hub,dispatched}=makeHost(t,{sdk,model:async req=>requests.push(req),now:()=>now})
  const root=h.dir
  h.modules['life-core']=h.core
  h.cfg.speakUp={awakeFrom:0,awakeTo:24,idleMinutes:0}
  h.cfg.ext['tieba-reader']={autoBrowse:true,bars:'手工',startHour:0,endHour:0}
  Object.assign(h.api.core,{modules:{status:()=>[{id:'tieba-reader',running:'user'}]},personas:{current:()=>''},onebot:{state:'connected'},mutes:{muted:()=>false}})
  const {askModel}=await import(pathToFileURL(path.join(source,'core/llm.js')))
  const llm={
   resolveModelInfo:async()=>({}),
   async *stream(opt){
    requests.push(opt)
    yield* await h.stream(Object.freeze(opt),[{type:'text-delta',text:'{"share":true,"index":0,"text":"这个折纸方法蛮有意思。"}'},{type:'finish',reason:{kind:'stop'}}])
   }
  }
  h.modules['tieba-reader']=tiebaDefinition.setup({...h.api,id:'tieba-reader',lib:()=>({registerSecretField(){}}),
   dataDir:(...p)=>path.join(root,'tieba',...p),settings:()=>({...tiebaDefinition.defaults,...h.cfg.ext['tieba-reader']}),
   ask:o=>askModel({llm},{...o,model:{provider:'fixture',model:'fixture'}})},
   {now:()=>now,renderPage:async url=>url.includes('/p/')?{title:'纸风车折法',hasOpening:true,contents:['合成的真实楼主文字。']}:
    {links:[{title:'纸风车折法',url:'https://tieba.baidu.com/p/123456789'}]}})
  now+=60000;await h.timers.get('统一后台调度')()
  assert.equal(dispatched.length,0)
  now+=60000;await h.timers.get('统一后台调度')()
  assert.equal(dispatched.length,1,JSON.stringify({candidate:h.routes.get('/candidates')({headers:{host:'localhost'}}).items,
   state:h.modules['tieba-reader'].state(),requests:requests.length,warnings:h.warnings}))
  assert.match(JSON.stringify(requests[0].messages),/合成的真实楼主文字/)
  const [receipt]=h.routes.get('/candidates')({headers:{host:'localhost'}}).items
  assert.equal(receipt.status,'sent')
  assert.equal(receipt.receipt,'1')
  await hub.pushToSession(chat,[{type:'text',text:'你刚才分享的叫什么？'}],chat.userId,{queryText:'你刚才分享的叫什么？'})
  assert.match(JSON.stringify(requests.at(-1).messages),/刚逛手工吧看到这个：纸风车折法/)
 })

 test('installed module host discovers a newly installed tool without editing life-core',async t=>{
  const root=fs.mkdtempSync(path.join(scratch,'module-discovery-'))
  process.env.AURABOT_DATA_DIR=root
  const {createModules}=await import(pathToFileURL(path.join(source,'core/modules.js')))
  const cfg={enabled:true,ownerQQ:'10001',allow:{groups:[],private:[]},ext:{},modules:{}}
  const hub={chatOfSession:()=>'',sessions:()=>({}),resetChat:()=>false}
  const core={hub,http:{query:()=>({})}}
  const logger={child(){return this},info(){},warn(){},debug(){},error(){}}
  const modules=createModules({ctx:{on:()=>()=>{}},core,getConfig:()=>cfg,setConfig:()=>{},logger,version:'1.2.1',builtins:[lifeDefinition]})
  core.modules=modules;t.after(()=>modules.dispose())
  await modules.boot()
  const life=modules.use('life-core')
  assert.ok(life)
  const tool='market-weather--current'
  assert.equal(life.capabilities().some(c=>c.id===tool),false)
  const dir=path.join(root,'modules','market-weather')
  fs.mkdirSync(dir,{recursive:true})
  fs.writeFileSync(path.join(dir,'module.json'),JSON.stringify({id:'market-weather',version:'1.0.0',api:1}))
  fs.writeFileSync(path.join(dir,'index.mjs'),`export default {id:'market-weather',version:'1.0.0',setup(){return {
   lifeCapabilities:()=>[{id:'current',effect:'read',args:{city:'城市'},required:['city'],run:({city})=>({ok:true,message:city+' 阴天'})}],
   lifeSchedules:()=>[{id:'poll',intervalMs:60000,run:()=>{}}]
  }}}`)
  await modules.sync()
  assert.equal(modules.status().find(m=>m.id==='market-weather')?.running,'user')
  assert.equal(life.ownsSchedule('market-weather','poll'),true)
  assert.equal(life.capabilities().find(c=>c.id===tool)?.available,false)
  cfg.ext['life-core']={autonomyTools:tool}
  assert.equal(life.capabilities().find(c=>c.id===tool)?.available,true)
  const result=await life.execute(tool,{city:'苏州'},{chatId:chat.chatId})
  assert.match(life.experienceDetail(result.experienceId,chat.chatId).item.text,/苏州 阴天/)
  cfg.modules['market-weather']={enabled:false}
  await modules.sync()
  assert.equal(life.ownsSchedule('market-weather','poll'),false)
  assert.equal((await life.execute(tool,{city:'苏州'})).status,'unavailable')
 })

 test('current QQ attachment identity admits a scoped quote ahead of nearby speech',async t=>{
  process.env.AURABOT_DATA_DIR=fs.mkdtempSync(path.join(scratch,'native-quote-'))
  const clock=Date.now(),ref={...message(1,'较早的明确引用对象','out',chat.chatId,clock-7200000),messageId:'72'}
  const rows=[ref,...Array.from({length:12},(_,i)=>message(i+2,'附近的其他聊天'+i,'out',chat.chatId,clock-20000+i)),
   {...message(14,'我是说这个','in',chat.chatId,clock-1000),messageId:'-73'}]
  const requests=[]
  const {h,hub}=makeHost(t,{sdk,rows,model:async r=>requests.push(r)})
  let lookups=0
  h.modules['history-vault'].timelineQuote=q=>{
   lookups++
   assert.deepEqual(q,{chatId:chat.chatId,messageId:'-73',senderId:chat.userId})
   return{sourceId:'vault:14',target:ref}
  }
  await hub.pushToSession(chat,[{type:'text',text:'文本里的 qq--73-1 不是附件'}],chat.userId,{queryText:'没有真实附件'})
  assert.equal(lookups,0)
  await hub.pushToSession(chat,[{type:'image',data:'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',mediaType:'image/gif',name:'qq--73-1'}],chat.userId,{queryText:'我是说这个'})
  assert.equal(lookups,1)
  const body=JSON.stringify(requests[1].messages)
  assert.match(body,/本轮 QQ 引用对象[^]*较早的明确引用对象[^]*当前聊天连续记录/)
  const summary=h.core.memoryStatus().snapshots[0]
  assert.ok(h.core.contextDetail(summary.id).data.observedSourceIds.includes('vault:1'))
  rows.pop()
  assert.throws(()=>h.core.assertContextCurrent(summary),/QQ 引用来源/)
 })

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

 test('installed hub blocks unsupported QQ attribution after a verified Tieba read',{timeout:10000},async t=>{
  process.env.AURABOT_DATA_DIR=fs.mkdtempSync(path.join(scratch,'provenance-'))
  const inspected=Promise.withResolvers()
  let prompt
  const {h,hub,session,dispatched}=makeHost(t,{
   sdk,rows:[message(1,'刚逛贴吧看到个帖，下面都在数3','out')],
   model:async request=>{
    prompt=JSON.stringify(request.messages)
    hub.onSessionEvent(session,{type:'assistant/message',data:{turn:1,message:{role:'assistant',content:[{type:'text',text:'其实我还没真发过 就是看群里数得整齐 心里有点痒'}]}}})
    hub.onSessionEvent(session,{type:'turn/end',data:{turn:1,reason:{kind:'completed'}}})
   },
   send:decision=>inspected.resolve(decision)
  })
  h.modules['life-core']=h.core
  await h.core.perform({module:'tieba-reader',action:'read',chatId:chat.chatId,evidenceType:'provider'},async()=>({ok:true,title:'没活解散了得了',posts:[{text:'下面都在数3'}]}))
  const purpose=purposeAdapter({...h.api,id:'purpose'})
  const s=purpose.prepareContext({purpose:'proactive',chatId:chat.chatId,query:''})
  assert.match(s.text,/素材渠道：贴吧.*没活解散了得了/)
  assert.throws(()=>purpose.checkDraft('我好像也爱这样 没东西聊的时候就甩个3出去',s),/多次对应/)
  assert.doesNotThrow(()=>purpose.checkDraft('看到他们都在数3，我也想跟着发一个。',s))
  await hub.pushToSession(chat,[{type:'text',text:'你以前这么做过吗？'}],chat.userId)
  assert.match(prompt,/素材渠道：贴吧/)
  assert.equal(await inspected.promise,null)
  assert.equal(dispatched.length,0)
  assert(h.warnings.some(w=>w.includes('不能把外部素材或猜测写成群聊经历')))
 })

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

 test('installed hub associates confirmed image sends with the same real decoded incoming image',async t=>{
  process.env.AURABOT_DATA_DIR=fs.mkdtempSync(path.join(scratch,'image-ack-'))
  const requests=[],rows=[]
  const {h,hub,dispatched}=makeHost(t,{sdk,rows,model:async req=>requests.push(req)})
  const require=createRequire(import.meta.url)
  const sharpPath=process.env.AURABOT_TEST_SHARP
  // Synthetic 1×1 GIF. The optional replay path is only consumed on the host;
  // actual media is never part of the source checkout or test output.
  const raw=process.env.AURABOT_IMAGE_REPLAY_FILE?fs.readFileSync(process.env.AURABOT_IMAGE_REPLAY_FILE):
   Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64')
  const prepare=sharpPath?bytes=>prepareImage(bytes,require(sharpPath)):async()=>({identity:'verified-fixture',frames:1})
  let recognitions=0
  h.modules['life-core']=h.core
  const image=imageDefinition.setup({...h.api,dataDir:(...parts)=>path.join(h.dir,'image-familiar',...parts)},
   {prepare,identify:prepare,describe:async()=>{recognitions++;return{description:'合成视觉描述只出现一次',confidence:.9,uncertainty:'合成不确定性'}}})
  h.modules['image-familiar']=image
  const data=raw.toString('base64')
  const sent=()=>hub.sendSegments(chat.chatId,[{type:'image',data:{file:'base64://'+data}}],'[图片]')
  await sent()
  rows.push({...message(1,'[图片]','out'),messageId:'1'})
  rows.push({...message(2,'[图片]'),messageId:'-123'})
  await hub.pushToSession(chat,[{type:'image',data,mediaType:'image/gif',name:'qq--123-1'}],chat.userId,{queryText:''})
  await sent()
  rows.push({...message(3,'[图片]','out'),messageId:'2'})
  await hub.pushToSession(chat,[{type:'text',text:'这是不是同一张？'}],chat.userId,{queryText:'这是不是同一张？'})
  assert.equal(recognitions,1)
  assert.equal(dispatched.length,2)
  assert.equal(requests.length,2)
  const final=JSON.stringify(requests[1].messages)
  assert.match(final,/3 次（机器人发出 2 次、收到 1 次）/)
  assert.equal(final.split('合成视觉描述只出现一次').length,2)
  assert.doesNotMatch(final,/\[图片\]/)
 })
}
