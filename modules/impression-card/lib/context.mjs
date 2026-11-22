import {createHash} from 'node:crypto'
import {scopedPersonId,scopeOf,scopeCanRead} from './scope.mjs'

// Content versioning is provenance, not a release-integrity check. Exclude aliases
// and display-only caches: unrelated writes must not revoke a prepared reply.
export const cardSourceId = r => 'impression:' + r.id + '@' + createHash('sha256').update(JSON.stringify([
 r.description,r.total,r.scores,r.materialVersion,r.updatedAt,r.sourceScopes,r.sourceIds,r.userId,r.displayName,
 ...(r.inputs || r.evidence ? [r.inputs, r.evidence] : []),
])).digest('hex').slice(0,20)
const baseId = id => String(id).replace(/@[a-f0-9]{20}$/, '')
export function createCardContext({api,store,conf,lastSpeaker,isDisposed}) {
 function scopeAllowed(chatId) {
  const c=api.config(),m=/^(private|group):([1-9]\d*)$/.exec(String(chatId||''))
  if(isDisposed()||c.enabled===false||!conf().enabled||!m)return false
  const allowed=m[1]==='group'?(c.allow?.groups||[]).map(String).includes(m[2]):m[2]===String(c.ownerQQ||'')||(c.allow?.private||[]).map(String).includes(m[2])
  return allowed
 }
 function recordCurrent(record,seen=new Set()) {
  if(!record||record.materialVersion!==2||seen.has(record.id))return false
  const info=scopeOf(record.id)
  if(!info||info.userId!==String(record.userId))return false
  const scope=info.scope
  // Old group cards have an exact source scope; old composites do not. Keep
  // unknown composites in the management archive instead of washing them public.
  const scopes=Array.isArray(record.sourceScopes)?record.sourceScopes:scope?.startsWith('group:')?[scope]:null
  if(!scopes||!scopes.every(chatId=>scopeCanRead(scope,record.userId,chatId)&&scopeAllowed(chatId)))return false
  const inputs=record.inputs||[], vault=api.use('history-vault'), memory=api.use('memory')
  const inputIds=new Set(inputs.map(i=>i.id)), replyIds=new Set(inputs.map(i=>i.replySourceId).filter(Boolean))
  if(inputs.some(i=>!scopes.includes(i.chatId)||!(record.sourceIds||[]).includes(i.id)||(i.replySourceId&&!(record.sourceIds||[]).includes(i.replySourceId))))return false
  const raw=inputs.filter(i=>i.id.startsWith('vault:'))
  if(raw.length) {
   const rows=vault?.impressionMaterialByIds?.(raw.map(i=>i.id),{userId:record.userId,scope})
   const byId=new Map((rows||[]).map(row=>[row.id,row]))
   if(!raw.every(i=>{const row=byId.get(i.id);return row?.chatId===i.chatId&&(!i.replySourceId||(i.replySourceId===row.replySourceId&&i.replyToQQ===row.replyToQQ))}))return false
  }
  if(inputs.some(i=>i.id.startsWith('memory:')&&memory?.contextCurrent?.([i.id],{chatId:i.chatId})!==true))return false
  seen.add(record.id)
  for(const id of record.sourceIds||[]) {
   if(inputIds.has(id)||replyIds.has(id))continue
   if(String(id).startsWith('vault:')) {if(vault?.timelineCurrent?.([id],scope.startsWith('group:')?{chatId:scope}:{})!==true)return false}
   else if(String(id).startsWith('memory:')) {const chatId=scope?.startsWith('group:')?scope:'private:'+record.userId;if(memory?.contextCurrent?.([id],{chatId})!==true)return false}
   else if(String(id).startsWith('impression:')) {const other=store.get(baseId(id).slice('impression:'.length));if(!other||cardSourceId(other)!==id||!recordCurrent(other,new Set(seen)))return false}
   else return false
  }
  return true
 }
 function contextCurrent(ids,{chatId=''}={}) {
  if(!Array.isArray(ids)||!scopeAllowed(chatId)||!conf().contextEnabled)return false
  return ids.every(id=>{const r=store.get(baseId(id).slice('impression:'.length));return Boolean(String(id).startsWith('impression:')&&r&&(id==='impression:'+r.id||id===cardSourceId(r))&&r.id===scopedPersonId('qq',r.userId,chatId)&&recordCurrent(r))})
 }
 function contextForCore({chat,speakers=[],maxChars=900}={}) {
  const empty={text:'',sourceIds:[]},chatId=String(chat?.chatId||'')
  if(!scopeAllowed(chatId)||!conf().contextEnabled||!['private','group'].includes(chat?.kind))return empty
  const uids=chat.kind==='private'?[String(chat.userId||chatId.slice(8))]:[...new Set([...speakers.map(String),String(lastSpeaker(chatId)?.uid||'')].filter(Boolean))]
  const cap=Math.min(900,Math.max(0,Math.floor(Number(maxChars)||0))),lines=[],sourceIds=[]
  for(const uid of uids.slice(0,3)) {
   const r=store.get(scopedPersonId('qq',uid,chatId));if(!recordCurrent(r))continue
   const id=cardSourceId(r),at=Number(r.updatedAt)>0?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',dateStyle:'short'}).format(r.updatedAt):'未知'
   const head=`[${id}；主观印象，非事件证据；对象QQ:${r.userId}；原事时间未知；记于${at}] `
   const room=cap-lines.join('\n').length-(lines.length?1:0);if(room<=head.length)continue
   const c=conf(),text=`${r.displayName||uid}；${c.totalLabel} ${r.total}；${r.description||'暂无笔记'}`
   lines.push(head+text.slice(0,room-head.length));sourceIds.push(id)
  }
  return{text:lines.join('\n'),sourceIds}
 }
 function forget(event) {
  const sources=new Set((event.sourceIds||[]).map(baseId));let changed=false
  for(const r of store.all()) {
   const own=event.qq&&String(r.userId)===String(event.qq)&&Boolean(event.query)
   const linked=(r.sourceIds||[]).some(id=>sources.has(baseId(id)))
   const exactScope=event.chatId&&!event.qq&&!(r.sourceIds||[]).length&&(r.sourceScopes||[scopeOf(r.id)?.scope]).includes(event.chatId)
   if(own||linked||exactScope){store.remove(r.id);changed=true}
  }
  if(changed)store.saveNow()
 }
 return{contextForCore,contextCurrent,scopeAllowed,recordCurrent,forget}
}
