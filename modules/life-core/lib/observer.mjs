import {outcomeStatus} from './ledger.mjs'
// Observe only bot-owned session lineage; independent WorkBuddy/DSH sessions are excluded.
export function installObserver(api, ledger, within = (_meta,run)=>run()) {
  const retrievalOnly=new Set(['recall_experience','review_image'])
  const owned = new Map(), calls = new Map(), outcomes=new Map();let live=true
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
  const handler = (session,event) => {
    if (!['tool/call','tool/result'].includes(event?.type) || event.surfaceOp && event.surfaceOp!=='append') return
    const chat=lookup(session);if(!chat) return
    const key=String(session.id)+':'+String(event.data?.callId || event.data?.message?.source?.callId || '')
    try {
      if(event.type==='tool/call') {
        if(retrievalOnly.has(event.data?.name))return
        const m=event.data||{},scope=/^(group|private):\d+$/.test(chat)?[chat]:[]
        const senders=api.core.hub.turnSenders?.(String(session.id))||[]
        const row=ledger.start({actor:'bot',module:'dsh-tools',action:m.name,callId:key,chatId:scope[0]||'',sourceScopes:scope,self:true,public:false,evidenceType:'tool-result',speaker:senders.length===1?String(senders[0]):'',arguments:m.arguments})
        calls.set(key,row.id)
      } else {
        const id=calls.get(key)||ledger.byKey('dsh-tools:'+key)?.id
        if(!id) return
        const current=ledger.get(id);if(current.status!=='running') return
        const m=event.data.message||{},content=m.content||[]
        const text=content.filter(x=>x?.type==='text').map(x=>x.text||'').join('\n')
        const actual=outcomes.get(key)
        const value=m.isError?{ok:false,text,content}:actual!==undefined?actual:{ok:!/^✗|"ok"\s*:\s*false/.test(text),text,content}
        const submitted=['qq_generate_video','qq_song_cover'].includes(current.meta.action)&&outcomeStatus(value)==='succeeded'
        ledger.finish(id,submitted?'deferred':outcomeStatus(value),value,submitted?{...current.meta,evidenceType:'task-submission'}:undefined)
        calls.delete(key)
        outcomes.delete(key)
      }
    } catch(error) {api.log.error?.('经历工具事件未保存：'+error.message)}
  }
  let off
  try {off=api.dsh.on?.('session/event',handler)} catch(error) {api.log.warn('工具观察器未接入：'+error.message)}
  api.onDispose(()=>{live=false;off?.()})
  let offExecute
  try {offExecute=api.dsh.on?.('tools/execute',(exec,next)=>{
    if(retrievalOnly.has(exec?.name))return next()
    const session=exec?.agent?.session,chat=lookup(session)
    if(!chat)return next()
    const key=String(session.id)+':'+String(exec.callId||'')
    let row=ledger.byKey('dsh-tools:'+key)
    if(!row)row=ledger.start({actor:'bot',module:'dsh-tools',action:exec.name,callId:key,chatId:/^(group|private):\d+$/.test(chat)?chat:'',sourceScopes:/^(group|private):\d+$/.test(chat)?[chat]:[],self:true,public:false,evidenceType:'tool-result'})
    const meta={...row.meta,observerId:row.id,steps:[]}
    return within(meta,async()=>{
      try {const result=await next();if(result&&Object.hasOwn(result,'value'))outcomes.set(key,result.value);return result}finally{
        // Keep provider/ACK substeps on this canonical tool invocation, not duplicate actions.
        const current=live&&ledger.get(row.id)
        if(current&&!current.deletedAt)ledger.updateMeta(row.id,{...current.meta,...meta})
      }
    })
  })}catch(e){api.log.warn('工具执行来源关联未接入：'+e.message)}
  api.onDispose(()=>offExecute?.())
  return {available:typeof off==='function',handler}
}
