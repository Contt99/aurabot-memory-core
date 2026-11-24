import {nativeAck} from './candidate-queue.mjs'

export const isContactJob=(module,id,kind)=>kind==='contact'&&(
 module==='purpose'&&['contact','nudge'].includes(id)||module==='speakup'&&['contact','nudge','autonomy'].includes(id)||module==='night'&&id==='wake-greeting')

// Ordinary manual delivery is unchanged. A scheduled contact gets a durable
// gate at the existing host transport boundary, with native receipts observed
// in the same execution context as its dispatch.
export function createContactDispatch({candidates,now,active,disposed,sleeping,cfg,hub,continuity,jobFor,canTarget,permission,context}){
 return async function run(row,job){
  const parent=context.getStore(),uid=row.target.slice(8),owner=String(cfg().ownerQQ)
  const lastPrivate=()=>Math.max(Number(hub().lastPrivateAt?.(uid))||0,uid===owner?Number(hub().lastOwnerChatAt)||0:0)
  const admittedAt=lastPrivate()
  let transportEntered=false,blocked=false,snapshot,outcome='',receipt=''
  const allowed=(statuses)=>!disposed()&&active()&&!sleeping()&&canTarget(row.target)&&String(cfg().ownerQQ)===owner&&
   continuity.contextManaged('proactive')&&lastPrivate()<=admittedAt&&row.expiresAt>now()&&
   statuses.includes(candidates.get(row.id)?.status)&&jobFor(row.module,row.job)===job&&permission(job,row)===true
  const finish=(status,reason)=>{
   if(!disposed())candidates.finish(row.id,status,reason)
   return {ok:false,status,candidateId:row.id}
  }
  try{
   if(!allowed(['running']))return finish('cancelled','source-or-permission')
   const result=await job.run(row,async({snapshot:compiled,text},effect)=>{
    if(!allowed(['running'])||!compiled?.id||typeof effect!=='function')throw Error('主动联系已失去资格')
    const view=continuity.contextDetail(compiled.id)
    if(view?.data?.chatId!==row.target||view?.data?.purpose!=='proactive'||!continuity.validateDraft(text,compiled).ok)
     throw Error('主动联系草稿或上下文已失效')
    snapshot=compiled
    const sourceIds=view.data.sourceIds||[]
    if(!candidates.bindSources(row.id,sourceIds)||!candidates.sending(row.id))throw Error('主动联系状态已过期')
    parent.sourceIds=sourceIds
    parent.contactGuard=(chatId,body)=>{
     const current=chatId===row.target&&allowed(['sending','sent'])&&continuity.validateDraft(body||text,snapshot).ok
     if(!current)blocked=true
     return current
    }
    const observed=new Map()
    parent.contactAck=(chatId,id,segments)=>{
     if(chatId===row.target)observed.set(id,segments.filter(s=>s.type==='text').map(s=>s.data?.text||'').join('\n'))
    }
    const sendQQ=async()=>{
     const isCurrent=()=>{
      try{if(parent.contactGuard(row.target,text)){transportEntered=true;return true}}catch{}
      blocked=true;return false
     }
     const result=await continuity.runWithContext(snapshot,()=>hub().sendText(row.target,text,undefined,undefined,undefined,{isCurrent}))
     const id=String(result?.message_id??'')
     if(!disposed()&&nativeAck(id)&&candidates.ack(row.id,row.target,id))receipt=id
     return {ok:!!receipt,text:observed.get(receipt)||''}
    }
    return effect({sendQQ})
   })
   outcome=result?.outcome||''
  }catch{/* determine the outcome from the authoritative queue and receipts */}
  if(receipt)return {ok:true,status:'sent',messageId:receipt,candidateId:row.id}
  if(disposed())return {ok:false,status:'interrupted',candidateId:row.id}
  const status=candidates.get(row.id)?.status
  if(status==='sending'){
   if(!transportEntered&&(blocked||outcome==='silent'))return finish('not-sent','source-or-permission')
   return finish('unknown','missing-receipt')
  }
  if(status==='running')return outcome==='silent'||outcome.startsWith('skipped-')
   ?finish('skipped','no-interest'):finish('not-sent','draft-rejected')
  return {ok:false,status:status||'interrupted',candidateId:row.id}
 }
}
