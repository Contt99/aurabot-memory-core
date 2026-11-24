import {outcomeStatus} from './ledger.mjs'
const receipts=new Map([
 ['workbuddy_draw_image','workbuddy-artifact'],['workbuddy_draw_video','workbuddy-artifact'],['codebuddy_ask','delegated-result'],
])
const submittedTools=new Set(['qq_generate_video','qq_song_cover'])
const chatScope=s=>/^(group|private):\d+$/.test(s)?s:''
const contents=r=>Array.isArray(r?.content)?r.content:[]
const textOf=r=>contents(r).filter(x=>x?.type==='text').map(x=>x.text||'').join('\n')
const endpoint=(url,protocols)=>{
 try{return typeof url==='string'&&protocols.includes(new URL(url).protocol)}catch{return false}
}
function observedReceipt(tool,value,isError){
 const unavailable=text=>({status:'observed',result:{ok:false,text}})
 if(isError||value?.ok===false)return {status:'failed',result:{ok:false,text:'委派工具失败，未确认任务完成。'}}
 if(tool==='codebuddy_ask'){
  if(value?.ok!==true||typeof value.reply!=='string'||!Array.isArray(value.denied_tools))
   return unavailable('未取得 CodeBuddy 的结构化结果，不能确认委派完成。')
  const denied=value.denied_tools.length,truncated=value.truncated===true
  return {status:denied||!value.reply.trim()?'observed':'succeeded',result:{ok:true,denied,truncated,
   text:(denied?'CodeBuddy 已返回，但本轮部分工具请求受限。':value.reply.trim()?'CodeBuddy 已返回一轮结论。':'CodeBuddy 返回空回复，未核实任务目标。')+
    (truncated?'回复已截断。':'')+(value.reply?' '+value.reply:'')}}
 }
 const video=tool==='workbuddy_draw_video'
 const count=video?(Array.isArray(value?.videos)?value.videos.filter(u=>endpoint(u,['file:'])).length:0):
  Number(endpoint(value?.url,['https:','file:']))
 if(!count)return unavailable('WorkBuddy 未返回可核对的产物引用，不能确认生成完成。')
 return {status:'succeeded',result:{ok:true,count,text:video?`WorkBuddy 返回了 ${count} 个已下载的视频产物，未核实 QQ 送达。`:
  'WorkBuddy 返回了图片产物引用，未核实 QQ 送达。'}}
}
// Observe only bot-owned session lineage; independent WorkBuddy/DSH sessions are excluded.
export function installObserver(api, ledger, within = (_meta,run)=>run()) {
  const retrievalOnly=new Set(['recall_experience','review_image'])
  const owned = new Map();let live=true
  const lookup = session => {
    if (!session?.id) return ''
    const id=String(session.id)
    const direct=api.core.hub.chatOfSession?.(id) || owned.get(id)
    if (direct) { owned.set(id,direct);return direct }
    let parent=session.header?.parentSession
    const seen=new Set([id]);let depth=0
    while (parent && !seen.has(String(parent)) && depth++<20) {
      seen.add(String(parent))
      const chat=api.core.hub.chatOfSession?.(parent)||owned.get(String(parent))
      if (chat) {owned.set(id,chat);return chat}
      let service
      try {service=api.dsh.get?.('sessions')} catch {}
      parent=service?.get?.(parent)?.header?.parentSession
    }
    return ''
  }
  const keyOf=(session,id)=>typeof id==='string'&&id?String(session.id)+':'+id:''
  function start(session,chat,id,tool,args) {
    if(!id||!tool||retrievalOnly.has(tool))return null
    const key=keyOf(session,id)
    if(!key)return null
    const scope=chatScope(chat),evidenceType=receipts.get(tool)
    const senders=api.core.hub.turnSenders?.(String(session.id))||[]
    return ledger.start({actor:'bot',module:'dsh-tools',action:tool,callId:key,chatId:scope,
      sourceScopes:scope?[scope]:[],self:true,public:false,evidenceType:evidenceType||'tool-result',
      ...(evidenceType?{chatOnly:true}:args!==undefined?{arguments:args}:{}),
      speaker:senders.length===1?String(senders[0]):''})
  }
  function settle(row,chat,result,structured) {
    if(!row||row.status!=='running'||row.deletedAt)return
    if(row.meta.chatId!==chatScope(chat)){
      ledger.finish(row.id,'interrupted',{ok:false,text:'原工具聊天身份已变化。'})
      return
    }
    if(result.isError&&(result.error?.info?.code??result.error?.code)==='ABORTED'){
      ledger.finish(row.id,'interrupted',{ok:false,text:'宿主已中断工具调用。'})
      return
    }
    const value=structured&&Object.hasOwn(result,'value')?result.value:undefined
    if(receipts.has(row.meta.action)){
      const receipt=observedReceipt(row.meta.action,value,result.isError===true)
      ledger.finish(row.id,receipt.status,receipt.result)
      return
    }
    const text=textOf(result),content=contents(result)
    const final=result.isError?{ok:false,text,content}:value!==undefined?value:{ok:!/^✗|"ok"\s*:\s*false/.test(text),text,content}
    const status=outcomeStatus(final)
    const submitted=submittedTools.has(row.meta.action)&&status==='succeeded'
    ledger.finish(row.id,submitted?'deferred':status,final,submitted?{...row.meta,evidenceType:'task-submission'}:undefined)
  }
  const handler = (session,event) => {
    if (!live||!['tool/call','tool/result'].includes(event?.type) || event.surfaceOp && event.surfaceOp!=='append') return
    const chat=lookup(session);if(!chat) return
    try {
      if(event.type==='tool/call') {
        const m=event.data||{}
        start(session,chat,m.callId,m.name,m.arguments)
      } else {
        const m=event.data?.message||{},key=keyOf(session,m.source?.callId)
        if(key)settle(ledger.byKey('dsh-tools:'+key),chat,m,false)
      }
    } catch(error) {api.log.error?.('经历工具事件未保存：'+error.message)}
  }
  let off
  try {off=api.dsh.on?.('session/event',handler)} catch(error) {api.log.warn('工具观察器未接入：'+error.message)}
  api.onDispose(()=>{live=false;off?.()})
  let offResult
  try {offResult=api.dsh.on?.('tools/result',(exec,result)=>{
    if(!live||!result||retrievalOnly.has(exec?.name))return
    const session=exec?.agent?.session,chat=lookup(session)
    if(!chat)return
    try{settle(start(session,chat,exec.callId,exec.name),chat,result,true)}
    catch(error){api.log.error?.('经历最终工具回执未保存：'+error.message)}
  })}catch(error){api.log.warn('最终工具回执观察器未接入：'+error.message)}
  let offExecute
  try {offExecute=api.dsh.on?.('tools/execute',(exec,next)=>{
    if(!live||retrievalOnly.has(exec?.name))return next()
    const session=exec?.agent?.session,chat=lookup(session)
    if(!chat)return next()
    let row
    try{row=start(session,chat,exec.callId,exec.name,receipts.has(exec.name)?undefined:exec.arguments)}
    catch(e){api.log.error?.('经历工具调用未保存：'+e.message);return next()}
    if(!row||row.deletedAt||row.status!=='running')return next()
    const meta={...row.meta,observerId:row.id,steps:[]}
    return within(meta,async()=>{
      try {return await next()}finally{
        // Keep provider/ACK substeps on this canonical tool invocation, not duplicate actions.
        try{
          const current=live&&ledger.get(row.id)
          if(current&&!current.deletedAt)ledger.updateMeta(row.id,{...current.meta,...meta})
        }catch(e){api.log.error?.('经历工具来源关联未保存：'+e.message)}
      }
    })
  })}catch(e){api.log.warn('工具执行来源关联未接入：'+e.message)}
  api.onDispose(()=>{offExecute?.();offResult?.()})
  return {available:typeof off==='function',finalResults:typeof offResult==='function',handler}
}
