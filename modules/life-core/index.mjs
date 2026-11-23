import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {AsyncLocalStorage} from 'node:async_hooks'
import {createLedger,outcomeStatus} from './lib/ledger.mjs'
import {allowedSource,sourceGroups,publicSafe,safeValue} from './lib/policy.mjs'
import {installObserver} from './lib/observer.mjs'
import {readableWebResult} from './lib/web-view.mjs'
import {assertNarrationSupported} from './lib/narration.mjs'
import {authorizedChat,createRecall} from './lib/recall.mjs'
import {createTelemetry} from './lib/telemetry.mjs'
import {createContinuity} from './lib/continuity.mjs'
import {registeredTools,declaredArguments} from './lib/capabilities.mjs'
import {createScheduleDispatcher} from './lib/schedule-dispatch.mjs'
import {createCandidateQueue,nativeAck} from './lib/candidate-queue.mjs'
import {createDiaryDispatch,diaryKinds,diaryTarget,isDiaryJob} from './lib/diary-dispatch.mjs'

const VERSION='0.2.0-local.9'
const browseIds=['web_search','web_fetch','bili_browse','bili_watch','tieba_search','tieba_browse','tieba_read','save_note']
export default {
 id:'life-core',name:'行动与经历核心',version:VERSION,api:1,panel:'panel.js',
 description:'统一能力、真实执行记录、主动触达门禁和日记来源；独立任务不进入她的经历',
 defaults:{enabled:true,autonomyTools:''},settings:[{key:'enabled',label:'启用行动核心',type:'switch'},{key:'autonomyTools',label:'授权自主生活的扩展只读工具',type:'textarea',hint:'每行一个完整工具 ID。仅授权模块明确声明的只读能力，例：weather--current。留空不会影响已有聊天工具。'}],
 setup(api,deps={}) {
  const now=deps.now||Date.now,log=api.log,ledger=createLedger(api.dataDir('life.sqlite'))
  const context=new AsyncLocalStorage(),forgetListeners=new Set();let disposed=false,qqBusy=false
  api.onDispose(()=>{disposed=true;ledger.close()})
  const cfg=()=>api.config(),active=()=>!disposed&&cfg().enabled!==false&&api.settings().enabled!==false
  const telemetry=createTelemetry(api)
  const candidates=createCandidateQueue(ledger.database,now)
  const service=name=>{try{return api.dsh.get?.(name)}catch{return null}}
  const moduleFor=id=>api.use(id)
  const enabled=(id)=>cfg().modules?.[id]?.enabled!==false
  const dispatcher=createScheduleDispatcher({api,active,enabled,now})
  api.every(60000,()=>Promise.all([dispatcher.tick(),dispatchCandidate()]),'统一后台调度')
  const readMethod=(id,method)=>enabled(id)&&typeof moduleFor(id)?.[method]==='function'
  function capabilities() {
   const builtins=browseIds.map(id=>{
    let available
    if(id==='web_search'||id==='web_fetch') available=typeof service('web')?.[id==='web_search'?'search':'fetch']==='function'
    else if(id==='save_note') available=true
    else if(id.startsWith('bili')) available=cfg().bili?.enabled!==false&&readMethod('bili',id==='bili_browse'?'browseReadOnly':'watchReadOnly')
    else available=cfg().ext?.['tieba-reader']?.enabled!==false&&readMethod('tieba-reader',id.replace('tieba_',''))
    return {id,available:active()&&!!available,...(!available?{reason:'当前服务或模块未启用'}:{})}
   })
   return [...builtins,...registeredTools(api,enabled).map(({run,...tool})=>({...tool,available:active()&&tool.available}))]
  }
  async function perform(meta,run) {
   const parent=context.getStore()
   if(parent) {
    absorb(parent,meta)
    try {const r=await run();parent.steps.push({module:meta.module,action:meta.action,status:outcomeStatus(r),result:safeValue(r)});return r}
    catch(e){parent.steps.push({module:meta.module,action:meta.action,status:'failed',message:e.message});throw e}
   }
   const m={...meta,actor:'bot',sourceScopes:[...new Set([...(meta.sourceScopes||[]),...(/^(group|private):\d+$/.test(meta.chatId||'')?[meta.chatId]:[])])],steps:[]}
   return context.run(m,()=>ledger.perform(m,run))
  }
  function absorb(parent,meta) {
   parent.sourceScopes=[...new Set([...(parent.sourceScopes||[]),...(meta.sourceScopes||[]),...(/^(group|private):\d+$/.test(meta.chatId||'')?[meta.chatId]:[])])]
   parent.sourceIds=[...new Set([...(parent.sourceIds||[]),...(meta.sourceIds||[])])]
   parent.public=parent.public===true&&meta.public===true
   if(meta.kind==='reflection')parent.kind='reflection'
  }
  const boundedValue=(v,limit=6000)=>{const raw=JSON.stringify(safeValue(v??null));return raw.length<=limit?safeValue(v):{excerpt:raw.slice(0,limit),truncated:true,totalChars:raw.length}}
  const ackSource=(chatId,messageId)=>`qq:${cfg().botQQ||''}:${chatId}:out:${messageId}`
  const inputsOf=r=>[...(r.meta.sourceIds||[]),...(r.meta.evidenceType==='qq-ack'&&r.result?.messageId?[ackSource(r.meta.chatId,r.result.messageId)]:[])]
  function actionCurrent(r,seen=new Set()) {
   if(!r||r.deletedAt||!continuity.sourceCurrent(r.id)||r.meta.correctedAt)return false
   if(seen.has(r.id))return true
   seen.add(r.id)
   return inputsOf(r).every(id=>{if(!continuity.sourceCurrent(id))return false;const source=ledger.get(id);return !source||actionCurrent(source,seen)})
  }
  const boundedSources=(rows,limit=40)=>{const out=[];let chars=2;for(const r of rows){const n=JSON.stringify(r).length+1;if(chars+n>24000||out.length>=limit)break;out.push(r);chars+=n}return out}
  const asSource=r=>{const view=r.meta.evidenceType==='web-body'?readableWebResult(r.result):r.result;return {id:r.id,text:(r.meta.evidenceType==='note'?`已保存探索笔记《${String(r.result?.title||'未命名')}》。笔记结论是个人整理，不作为独立事实来源。`:r.meta.evidenceType==='outbound-attempt'?`主动联系决策已运行；这是一次尝试，是否实际发出只以QQ成功回执记录为准。决策状态：${r.result?.outcome||r.status}`:String(view?.text||view?.message||view?.title||JSON.stringify(view||{}))).slice(0,1200),at:r.at,occurredAt:Object.hasOwn(r.meta,'occurredAt')?Number(r.meta.occurredAt)||0:r.at,status:r.status,evidenceType:r.meta.evidenceType||'action-result',sourceScopes:r.meta.sourceScopes||[],evidence:r.meta.evidenceType==='outbound-attempt'?{outcome:r.result?.outcome||r.status}:r.meta.evidenceType==='note'?{title:r.result?.title,sourceIds:r.meta.sourceIds||[]}:boundedValue(view,1200)}}
  function queryExperiences({purpose,chatId='',since=0,limit=40}={}) {
   return boundedSources(ledger.all().filter(r=>r.at>=since&&actionCurrent(r)&&r.status!=='running'&&allowedSource(r,cfg(),purpose,chatId)).map(asSource),Math.min(100,Math.max(1,limit)))
  }
  function diarySources(kind,{since=0,limit=40}={}) {
   if(!['public','private'].includes(kind)) throw Error('日记用途不明确')
   const result=queryExperiences({purpose:kind+'-diary',since,limit}).filter(r=>kind!=='public'||publicSafe(r.text))
   const groups=sourceGroups(cfg(),kind),vault=moduleFor('history-vault')
   for(const row of vault?.diaryMaterial?.({groups,since,limit:Math.min(60,limit)})||[]) {
    if(!continuity.sourceCurrent(row.id)||!groups.includes(row.chatId)||!publicSafe(row.text)) continue
    const recipients=[...(row.atQQs||[]),...(row.replyToQQ?[row.replyToQQ]:[])]
    result.push({id:row.id,text:`群聊观察，不是机器人的亲身行为：[${row.chatId}] 发言者QQ ${row.uid}；接收对象${recipients.length?'线索 '+[...new Set(recipients)].join('、'):'未知'}；本人原文 ${JSON.stringify(String(row.text).slice(0,500))}`,at:row.t,status:'observed',evidenceType:'group-message',sourceScopes:[row.chatId]})
   }
   return boundedSources(result.sort((a,b)=>b.at-a.at),Math.min(100,limit))
  }
  function assertSourcesCurrent(kind,sources) {
   const groups=new Set(sourceGroups(cfg(),kind)),v=moduleFor('history-vault')
   for(const s of sources||[]) {
    if(!continuity.sourceCurrent(s.id))throw Error('日记原始说法已被纠正或忘记')
    if((s.sourceScopes||[]).some(p=>p.startsWith('group:')&&!groups.has(p))) throw Error('日记来源授权已变化')
    if(String(s.id).startsWith('vault:')) {
     if(!v?.diaryMaterialCurrent?.([s.id])) throw Error('日记来源已被忘记或不再可用')
    } else {
     const row=ledger.get(s.id)
     if(!actionCurrent(row)||!allowedSource(row,cfg(),kind+'-diary')) throw Error('日记来源已失效或授权已变化')
    }
   }
   return true
  }
  async function execute(id,args={},ctx={}) {
   if(!active()||ctx.chatId&&!authorizedChat(cfg(),ctx.chatId))return{ok:false,status:'unavailable',message:'当前聊天没有这项执行权限'}
   const tool=browseIds.includes(id)?null:registeredTools(api,enabled).find(c=>c.id===id)
   if(!(tool?tool.available:capabilities().some(c=>c.id===id&&c.available))) return {ok:false,status:'unavailable',message:'能力当前不可用：'+id}
   if(tool)try{args=declaredArguments(tool,args)}catch(error){return{ok:false,status:'failed',message:error.message}}
   if(ctx.signal?.aborted) throw ctx.signal.reason||Error('行动已取消')
   const marker=ctx.callId||randomUUID()
   const home=tool&&/^\d+$/.test(String(cfg().ownerQQ||''))?'private:'+cfg().ownerQQ:''
   const meta={module:'life-core',action:id,...(tool&&{provider:tool.module}),callId:marker,chatId:ctx.chatId||home,self:true,public:!ctx.chatId&&!tool,triggerSource:ctx.source||ctx.module||'module-api',goalId:ctx.goalId,evidenceType:id==='web_search'?'search-summary':id==='web_fetch'?'web-body':id==='save_note'?'note':tool?'tool-result':'platform-read',arguments:args}
   const previous=ledger.byKey('life-core:'+marker)
   if(previous&&(previous.deletedAt||previous.meta.action!==id||(previous.meta.chatId||'')!==meta.chatId))return{ok:false,status:'unavailable',message:'调用身份与当前任务不匹配'}
   let value
   try {
    value=await perform(meta,async()=>{
     const signal=ctx.signal||AbortSignal.timeout(120000)
     if(tool){
      // Discovery doesn't grant public reuse. Task results stay in the invoking
      // chat, or in the autonomous private action scope when no chat supplied.
      const r=await tool.run(args,{signal})
      if(signal.aborted||!registeredTools(api,enabled).some(x=>x.id===id&&x.available))return{ok:false,status:'interrupted',message:'本次读取已中断或授权已撤销'}
      return typeof r?.ok==='boolean'?r:{ok:false,message:'工具未明确返回执行状态'}
     }
     if(id==='web_search') return service('web').search({query:String(args.query||''),maxResults:8},signal)
     if(id==='web_fetch') {
      const u=new URL(String(args.url||''));if(!['http:','https:'].includes(u.protocol)||u.username||u.password) throw Error('只允许普通网页地址')
      const validate=deps.assertPublicUrl||api.lib?.('core/net.js')?.assertPublicUrl
      if(typeof validate!=='function')throw Error('公开网页地址检查不可用，未读取网页')
      await validate(u.href)
      if(signal.aborted)throw signal.reason||Error('行动已取消')
      const r=await service('web').fetch({url:u.href},signal)
      if(r.url)await validate(r.url)
      return r.statusCode>=400?{...r,ok:false,message:'网页未成功读取：HTTP '+r.statusCode}:r
     }
     if(id==='save_note') {
      const sourceIds=Array.isArray(args.sourceIds)?args.sourceIds:[]
      const allowed=queryExperiences({purpose:ctx.chatId?'chat':'autonomy',chatId:ctx.chatId||'',limit:100})
      if(sourceIds.some(i=>!allowed.some(s=>s.id===i))) throw Error('笔记引用了不可用的经历')
      const dir=api.dataDir('notes');fs.mkdirSync(dir,{recursive:true});const name=randomUUID()+'.json'
      const note={id:'note:'+name,title:String(args.title||'探索笔记').slice(0,100),text:String(args.text||''),sourceIds,sourceScopes:[...new Set(allowed.filter(s=>sourceIds.includes(s.id)).flatMap(s=>s.sourceScopes))],at:now()}
      meta.sourceIds=sourceIds;meta.sourceScopes=note.sourceScopes
      const current=context.getStore();if(current){current.sourceIds=sourceIds;current.sourceScopes=note.sourceScopes}
      if(!note.text.trim()) throw Error('笔记内容为空')
      fs.writeFileSync(path.join(dir,name),JSON.stringify(safeValue(note)),{mode:0o600})
      return {ok:true,...note,message:'已保存探索笔记：'+note.title}
     }
     if(id==='bili_browse'||id==='bili_watch'){
      try{return await (id==='bili_browse'?moduleFor('bili').browseReadOnly({query:String(args.query||''),signal}):moduleFor('bili').watchReadOnly(String(args.link||args.url||''),{signal}))}
      catch(e){if(signal.aborted)return{ok:false,status:'interrupted',message:'本次读取已中断'};throw e}
     }
     return moduleFor('tieba-reader')[id.replace('tieba_','')](id==='tieba_search'?String(args.query||''):id==='tieba_read'?String(args.url||''):String(args.bar||''),args.bar)
    })
   }catch(error){return{ok:false,status:'failed',message:error.message}}
   const row=ledger.byKey('life-core:'+marker),status=row?.deletedAt?'interrupted':row?.status||outcomeStatus(value)
   return {ok:status==='succeeded',status,message:row?.deletedAt?'来源已被忘记，本轮结果不再使用':value?.message||'已执行 '+id,value:row?.deletedAt?null:boundedValue(id==='web_fetch'?readableWebResult(value):value),experienceId:row?.id}
  }
  const sleeping=()=>{
   const night=moduleFor('night');const mode=night?.snapshot?.()?.mode||night?.service?.state?.mode
   return mode&&mode!=='awake'&&mode!=='waking'
  }
  async function propose({source,kind,target,run}={},candidate) {
   const defer=message=>{telemetry.record({stage:'gate',source,kind,target,status:'deferred',reason:message});return{ok:false,status:'deferred',message}}
   if(!active()) return defer('总开关或行动核心已关闭')
   if(sleeping()) return defer('正在睡眠，后台行动顺延')
   if(kind!=='qq') {if(typeof run!=='function')return defer('没有执行器');telemetry.record({stage:'gate',source,kind,target,status:'eligible'});return run()}
   const c=cfg(),s=c.speakUp||{},t=now(),hour=new Date(t).getHours(),from=Number(s.awakeFrom??9),to=Number(s.awakeTo??23)
   if(!(from<=to?hour>=from&&hour<to:hour>=from||hour<to)) return defer('主动消息处于安静时段')
   if(c.dryRun) return defer('试运行不执行主动发送')
   const recipient=target||'private:'+c.ownerQQ,uid=recipient.replace(/^private:/,'')
   if(!/^private:\d+$/.test(recipient)||uid!==String(c.ownerQQ)&&(!(s.allow||[]).map(String).includes(uid)||!(c.allow?.private||[]).map(String).includes(uid))) return defer('主动触达目标不在授权名单')
   if(api.core.mutes?.muted?.(recipient)) return defer('目标私聊已静音')
   if(!candidate&&context.getStore()?.proactiveTarget===recipient)return typeof run==='function'?run():defer('没有执行器')
   if(qqBusy) return defer('另一条主动触达正在处理')
   const hub=api.core.hub,last=uid===String(c.ownerQQ)?Math.max(Number(hub.lastOwnerChatAt)||0,Number(hub.lastBotToOwner?.at)||0,Number(hub.lastPrivateAt?.(uid))||0):Number(hub.lastPrivateAt?.(uid))||0
   if(t-last<Number(s.idleMinutes??40)*60000) return defer('主人最近仍在聊天')
   const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(t)
   const st=ledger.kv('proactive',{day,count:0,nextAt:0});if(st.day!==day){st.day=day;st.count=0}
   if(st.count>=Number(s.maxPerDay??10)||t<Number(st.nextAt||0)) return defer('共享主动额度或间隔尚未满足')
   const min=Math.max(1,Number(s.minIntervalMinutes)||60),max=Math.max(min,Number(s.maxIntervalMinutes)||180)
   st.count++;st.nextAt=t+(min+(deps.random||Math.random)()*(max-min))*60000
   if(candidate){
    ledger.database.exec('BEGIN IMMEDIATE')
    try{
     if(!candidates.claim(candidate.id)){ledger.database.exec('ROLLBACK');return defer('候选已处理或过期')}
     ledger.setKv('proactive',st);ledger.database.exec('COMMIT')
    }catch(e){ledger.database.exec('ROLLBACK');throw e}
   }else ledger.setKv('proactive',st)
   telemetry.record({stage:'attempt',source,kind,target:recipient,status:'accepted',count:st.count,nextAt:st.nextAt})
   qqBusy=true
   try{const r=await perform({module:source||'proactive',action:'proactive-qq',chatId:recipient,self:true,public:false,proactiveTarget:recipient,evidenceType:'outbound-attempt',...(candidate&&{callId:'candidate:'+candidate.id,candidateId:candidate.id,sourceIds:candidate.sourceIds})},run);telemetry.record({stage:'execution',source,kind,target:recipient,status:r?.outcome||r?.status||outcomeStatus(r),...(candidate&&{candidateId:candidate.id})});return r}finally{qqBusy=false}
  }
  const candidateJob=(module,id)=>{
   if(!enabled(module))return null
   let jobs
   try{jobs=moduleFor(module)?.lifeJobs?.()}catch{return null}
   const found=Array.isArray(jobs)?jobs.filter(j=>j?.id===id&&typeof j.canRun==='function'&&
    (j.kind==='qq'?typeof j.draft==='function':isDiaryJob(module,id,j.kind)&&typeof j.run==='function')):[]
   return found.length===1?found[0]:null
  }
  const candidatePermission=(job,row)=>{try{return job?.canRun(row)}catch{return false}}
  const evidenceCurrent=c=>c.sourceIds.length>0&&experiencesCurrent(c.sourceIds,c.target,'chat')&&c.sourceIds.every(id=>ledger.get(id)?.status==='succeeded')
  function queueCandidate({module,job,key,target,sourceIds=[],expiresAt}={}){
   if(!active()||typeof target!=='string'||typeof module!=='string'||!(/^[a-z][a-z0-9-]{1,39}$/.test(module))||
     typeof job!=='string'||!/^[a-z][a-z0-9-]{0,31}$/.test(job)||typeof key!=='string'||!/^[A-Za-z0-9_-]{1,180}$/.test(key)||
     !Array.isArray(sourceIds)||sourceIds.length>8||sourceIds.some(id=>typeof id!=='string')||!Number.isSafeInteger(expiresAt)||expiresAt<=now()||expiresAt>now()+86400000)return{ok:false,status:'unavailable',message:'候选任务或证据尚未授权'}
   const provider=candidateJob(module,job)
   if(!provider||(provider.kind==='qq'
     ? !/^private:\d+$/.test(target)||!authorizedChat(cfg(),target)||!evidenceCurrent({sourceIds,target})
     : target!==diaryTarget(provider.kind,cfg(),api.core.hub)||sourceIds.length))
    return{ok:false,status:'unavailable',message:'候选任务或证据尚未授权'}
   const row=candidates.submit({module,job,key,target,sourceIds,expiresAt})
   return{ok:true,id:row.id,status:row.status}
  }
  async function runDiaryCandidate(spec){
   const job=candidateJob(spec?.module,spec?.job)
   if(job?.kind!=='private-diary')return{ok:false,status:'unavailable'}
   const submission=queueCandidate(spec)
   if(!submission.ok)return submission
   if(submission.status!=='queued')return{ok:false,status:submission.status,candidateId:submission.id,message:'该私人日记行动已登记，不重复执行'}
   return diaryDispatch.run(candidates.get(submission.id),job)
  }
  async function performEvidence(meta,run){
   if(!active()||context.getStore())return{value:await run(),experienceId:null}
   const callId=randomUUID(),value=await perform({...meta,callId},run)
   const row=ledger.byKey(meta.module+':'+callId)
   return{value,experienceId:row?.status==='succeeded'&&!row.deletedAt?row.id:null}
  }
  let queueBusy=false
  async function dispatchCandidate(){
   if(queueBusy||!active())return
   queueBusy=true
   try{
    const ready=candidates.ready()
    let qqDeferred=false
    for(const row of ready){
     const job=candidateJob(row.module,row.job)
     if(diaryKinds.has(job?.kind)){
      const result=await diaryDispatch.run(row,job)
      if(result.status==='queued')continue
      return result
     }
     if(qqDeferred||!continuity.contextManaged('proactive'))continue
     const permission=evidenceCurrent(row)&&candidatePermission(job,row)
     if(permission==='defer')continue
     if(permission!==true){candidates.cancel(row.id,'source-or-permission');continue}
     const result=await propose({source:row.module,kind:'qq',target:row.target,run:async()=>{
      const settle=(status,reason)=>{if(!disposed)candidates.finish(row.id,status,reason);return{ok:false,status}}
      let draft,snapshot
      const lastPrivate=()=>Number(api.core.hub.lastPrivateAt?.(row.target.slice(8)))||0
      const lastAt=lastPrivate()
      const allowed=(status='running')=>continuity.contextManaged('proactive')&&!cfg().dryRun&&!sleeping()&&lastPrivate()<=lastAt&&candidates.get(row.id)?.status===status&&row.expiresAt>now()&&evidenceCurrent(row)&&candidatePermission(candidateJob(row.module,row.job),row)===true
      try{
       if(!allowed())return settle('cancelled','source-or-permission')
       const inputs=row.sourceIds.map(id=>ledger.get(id).result)
       snapshot=continuity.buildContext({chatId:row.target,purpose:'proactive',query:inputs.map(r=>r?.title||'').join(' ').slice(0,300),consumer:row.module})
       draft=await continuity.runWithContext(snapshot,()=>job.draft(row,inputs,snapshot))
       if(!allowed())return settle('cancelled','source-or-permission')
       if(draft?.skip===true)return settle('skipped','no-interest')
       if(typeof draft?.text!=='string'||!draft.text.trim()||draft.text.length>1400||!continuity.validateDraft(draft.text,snapshot).ok)return settle('not-sent','draft-rejected')
      }catch{return settle('not-sent','draft-failed')}
      if(!candidates.sending(row.id))return settle('cancelled','expired')
      let ack,withdrawn=false
      const isCurrent=()=>{
       try{if(allowed('sending')&&continuity.validateDraft(draft.text,snapshot).ok)return true}catch{}
       withdrawn=true;return false
      }
      try{ack=await continuity.runWithContext(snapshot,()=>api.core.hub.sendText(row.target,draft.text,undefined,undefined,undefined,{isCurrent}))}
      catch{return settle('unknown','missing-receipt')}
      if(withdrawn)return settle('not-sent','source-or-permission')
      if(disposed||!nativeAck(ack?.message_id)||!candidates.ack(row.id,row.target,ack.message_id))return settle('unknown','missing-receipt')
      try{if(evidenceCurrent(row))await candidateJob(row.module,row.job)?.confirmed?.(row,draft,String(ack.message_id))}catch{log.warn?.('候选回执已记账；原模块面板摘要未更新')}
      return{ok:true,status:'sent',messageId:String(ack.message_id),candidateId:row.id}
     }},row)
     if(result?.status==='deferred'){qqDeferred=true;continue}
     // At most one attempt. Diary work does not use or bypass QQ touch quotas.
     return result
    }
   }finally{queueBusy=false}
  }
  function forgetPerson(qq,query,opts={}) {
   const rows=ledger.all(),ids=new Set(opts.sourceIds||[]),text=String(query||'').trim(),who=String(qq||'')
   for(const r of rows) {
    const own=r.meta.chatId==='private:'+who||r.meta.speaker===who||String(r.meta.about||'')===who
    if(!opts.exactSources&&/^\d+$/.test(who)&&text&&own&&JSON.stringify(r.result).toLowerCase().includes(text.toLowerCase())) ids.add(r.id)
   }
   let changed=true
   while(changed){changed=false;for(const r of rows)if(!ids.has(r.id)&&inputsOf(r).some(id=>ids.has(id))){ids.add(r.id);changed=true}}
   const pendingIds=!opts.exactSources&&who&&text?rows.filter(r=>r.status==='running'&&(r.meta.chatId==='private:'+who||r.meta.speaker===who||r.meta.about===who)).map(r=>r.id):[]
   if(ids.size||pendingIds.length)ledger.setKv('forget-tombstones',[...ledger.kv('forget-tombstones',[]),{qq:who,query:opts.exactSources?'':text,pendingIds,sourceIds:[...ids]}])
   const revisions=ledger.kv('image-forget-scopes',{}),cutoff=ledger.kv('image-forget-at',{})
   const affectedScopes=opts.exactSources?[]:rows.filter(r=>ids.has(r.id)).flatMap(r=>[r.meta.chatId,...(r.meta.sourceScopes||[])])
   const scopes=new Set([opts.chatId||opts.commandChatId||'',/^\d+$/.test(who)?'private:'+who:'',...affectedScopes].filter(s=>/^(private|group):\d+$/.test(s||'')))
   if(scopes.size){
    for(const scope of scopes){revisions[scope]=(Number(revisions[scope])||0)+1;cutoff[scope]=now()}
    ledger.setKv('image-forget-scopes',revisions);ledger.setKv('image-forget-at',cutoff)
   }
   candidates.forget(ids)
   ledger.invalidate([...ids]);const errors=[]
   try{continuity?.invalidate({sourceIds:[...ids],chatId:opts.chatId||opts.commandChatId,qq:who,query:opts.exactSources?'':text})}catch(e){errors.push(e.message)}
   const notes=api.dataDir('notes')
   if(fs.existsSync(notes)) for(const f of fs.readdirSync(notes)){
    const p=path.join(notes,f);try{const n=JSON.parse(fs.readFileSync(p,'utf8'));if((n.sourceIds||[]).some(id=>ids.has(id)))fs.unlinkSync(p)}catch(e){errors.push(e.message)}
   }
   for(const fn of forgetListeners)try{const r=fn({qq:who,query:text,sourceIds:[...ids],chatId:opts.chatId||opts.commandChatId});if(r&&typeof r.then==='function')throw Error('忘记消费者必须同步完成')}catch(e){errors.push(e.message);log.error?.('经历忘记联动失败：'+e.message)}
   return {ok:errors.length===0,forgotten:ids.size,errors}
  }
  const observer=installObserver(api,ledger,(meta,run)=>context.run(meta,run))
  const recordOutcome=(meta,result)=>{
   const parent=context.getStore();if(parent){absorb(parent,meta);parent.steps.push({module:meta.module,action:meta.action,status:outcomeStatus(result),result:safeValue(result)});return{id:parent.observerId||'',status:outcomeStatus(result)}}
   const r=ledger.start({...meta,actor:'bot'});if(r.status!=='running')return r;return ledger.finish(r.id,outcomeStatus(result),result)
  }
  api.on('sent',(segments,info)=>{
   if(!/^(private|group):\d+$/.test(info?.chatId||'')||!info?.messageId||String(info.messageId).startsWith('sim-'))return
   const parent=context.getStore()
   if(parent?.candidateId&&!nativeAck(info.messageId))return
   telemetry.record({stage:'sent',source:'onebot',target:info.chatId,status:'confirmed',messageId:String(info.messageId)})
   const sourceIds=[ackSource(info.chatId,String(info.messageId)),...(parent?.candidateId&&parent.chatId===info.chatId?parent.sourceIds||[]:[])]
   const record=()=>recordOutcome({module:'onebot',action:'send',callId:String(info.chatId)+':'+String(info.messageId),chatId:info.chatId,sourceScopes:[info.chatId],sourceIds,self:true,public:false,evidenceType:'qq-ack'},
    {ok:true,text:segments.map(s=>s.type==='text'?s.data?.text||'':'['+s.type+']').join(''),messageId:String(info.messageId),segments})
   if(parent?.candidateId)context.exit(record);else record()
  })
  const onForget=fn=>{forgetListeners.add(fn);return()=>forgetListeners.delete(fn)}
  const {recall,experienceDetail,experiencesCurrent}=createRecall({api,ledger,cfg,active,telemetry,current:actionCurrent,inject:false})
  const continuity=createContinuity({api,ledger,cfg,active,recall,experiencesCurrent,diarySources,assertSourcesCurrent,telemetry,now,
   candidateSources: chatId=>{const m=context.getStore();return m?.candidateId&&m.chatId===chatId?m.sourceIds||[]:[]}})
  const diaryDispatch=createDiaryDispatch({candidates,now,active,disposed:()=>disposed,sleeping,cfg,hub:()=>api.core.hub,continuity,assertSourcesCurrent,
   jobFor:candidateJob,permission:candidatePermission,record:recordOutcome})
  const managementGuard=req=>{
   try {
    const host=String(req?.headers?.host||''),hostname=new URL('http://'+host).hostname
    if(!['127.0.0.1','localhost','[::1]'].includes(hostname))return{ok:false,message:'管理接口仅允许SSH本机访问'}
    const origin=req.headers.origin
    if(req.headers['sec-fetch-site']==='cross-site'||origin&&new URL(origin).host!==host)return{ok:false,message:'不允许跨站访问'}
   }catch{return{ok:false,message:'管理请求来源不合法'}}
   return null
  }
  api.route('/memory/status',req=>managementGuard(req)||({ok:true,...continuity.memoryStatus()}))
  api.route('/memory/timeline',req=>managementGuard(req)||({ok:true,items:continuity.timeline({chatId:api.core.http.query(req).chatId||'',limit:100})}))
  api.route('/memory/context',req=>managementGuard(req)||({ok:true,snapshot:continuity.contextDetail(api.core.http.query(req).id)}))
  api.route('/memory/event',req=>managementGuard(req)||continuity.eventDetail(api.core.http.query(req).id))
  api.route('/candidates',req=>managementGuard(req)||({ok:true,items:candidates.recent().map(({jobKey,...c})=>c)}))
  api.route('/memory/correct',async req=>{
   if(req.method!=='POST')return{ok:false,message:'POST required'}
   const guard=managementGuard(req);if(guard)return guard
   try{return{ok:true,correction:continuity.correctEvent(await api.core.http.body(req))}}catch(e){return{ok:false,message:e.message}}
  })
  api.route('/telemetry',()=>({ok:true,...telemetry.snapshot()}))
  const proactiveState=()=>{const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(now()),s=ledger.kv('proactive',{day,count:0,nextAt:0});return{...s,day,count:s.day===day?s.count:0,shared:true}}
  api.route('/state',()=>({ok:true,version:VERSION,capabilities:capabilities(),schedules:dispatcher.inventory(),observer:observer.available,proactive:ledger.kv('proactive'),sources:{public:sourceGroups(cfg(),'public'),private:sourceGroups(cfg(),'private')},recent:queryExperiences({purpose:'private-diary',limit:20})}))
  api.route('/experiences',req=>({ok:true,items:queryExperiences({purpose:'private-diary',limit:100,since:Number(api.core.http.query(req).since)||0})}))
  api.route('/notes',()=>({ok:true,items:fs.existsSync(api.dataDir('notes'))?fs.readdirSync(api.dataDir('notes')).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(api.dataDir('notes',n),'utf8'))):[]}))
  return {version:VERSION,capabilities,execute,perform,performEvidence,propose:request=>propose(request),queueCandidate,runDiaryCandidate,candidateSentCount:candidates.count,
   candidateStatus:spec=>!disposed?candidates.byKey(spec)?.status:undefined,ownsSchedule:dispatcher.owns,queryExperiences,diarySources,assertSourcesCurrent,assertNarrationSupported,forgetPerson,onForget,recordOutcome,proactiveState,recall,experienceDetail,experiencesCurrent,...continuity,runDetached:fn=>context.exit(fn),diagnostic:telemetry.record,forgetRevision:scope=>Number(ledger.kv('image-forget-scopes',{})[scope])||0,forgetRevisionAt:scope=>Number(ledger.kv('image-forget-at',{})[scope])||0}
 }
}
