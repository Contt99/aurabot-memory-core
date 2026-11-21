// Pure source-time and delivery-history checks; never rewrite the underlying memories.
const MINUTE=60000
export const sourceTime=item=>Number(Object.hasOwn(item||{},'evidenceAt')?item.evidenceAt:item?.at)||0
export const sourceIds=item=>Array.isArray(item?.evidenceIds)?item.evidenceIds.map(String).filter(Boolean):item?.sourceId?[String(item.sourceId)]:[]
const day=t=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(t)
const dateTime=t=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(t)
export function goalEvidence(goal) {
 const rows=(goal?.evidence||[]).filter(e=>e&&typeof e==='object')
 const latest=[...rows].sort((a,b)=>(Number(b.at)||0)-(Number(a.at)||0))[0]
 return{evidenceAt:Number(latest?.at)||0,evidenceIds:rows.map(e=>String(e.id||'')).filter(Boolean),evidenceSource:latest?.source||'',evidence:latest?.text||''}
}
export function eventTimeLine(item,now=Date.now()) {
 if(item?.evidenceSource==='persona')return'人格背景，不是新发生的事件'
 const at=sourceTime(item)
 if(!at)return'原始来源时间未知，不得说成刚发生'
 if(at>now)return'原始来源时间异常，不能据此声称刚发生'
 const age=now-at,kind=item?.source==='memory'||item?.evidenceSource==='memory'?'记忆记录时间（不保证是原事发生时间）':'原始来源时间'
 return`${kind}：${dateTime(at)}（北京时间；${age<=10*MINUTE?'近期来源':day(at)===day(now)?'今天较早的记录，不是刚发生':'历史旧记录，不是当前群聊'}）`
}
const oneOff=item=>item?.action==='share'&&!item?.fromPending
function related(item,h) {
 if(item.goalId&&h.goalId===item.goalId||item.sourceId&&h.sourceId===item.sourceId)return true
 const used=new Set(sourceIds(h));return sourceIds(item).some(id=>used.has(id))
}
export function hasNewEventEvidence(item,history=[]) {
 if(!oneOff(item))return false
 const sent=history.filter(h=>h?.outcome==='sent'&&related(item,h))
 if(!sent.length)return false
 const at=sourceTime(item),last=Math.max(...sent.map(h=>Number(h.at)||0))
 return at>last&&sourceIds(item).some(id=>!sent.some(h=>sourceIds(h).includes(id)))
}
export function alreadySharedEvent(item,history=[]) {
 return oneOff(item)&&!hasNewEventEvidence(item,history)&&history.some(h=>h?.outcome==='sent'&&related(item,h))
}
export function validateTemporalReply(text,item,now=Date.now()) {
 const at=sourceTime(item),s=String(text||'')
 const immediate=s.split(/[。！？；\n]/).some(clause=>{
  const m=/(?:刚(?:刚|才)?(?:在[^，。！？\n]{0,16})?(?:看到|看见|读到|刷到|听到)|(?:群里|群聊|贴吧|B站)[^，。！？\n]{0,6}(?:正在|刚刚|刚才)|群里(?:在|正)(?:聊|讨论|说|比)|(?:现在|此刻)(?:群里|群聊))/.exec(clause)
  if(!m)return false
  const prefix=clause.slice(0,m.index)
  return !/之前|以前|前几天|那天|当时|那次|昨天|昨晚|上周|上次|想起/.test(prefix)||/现在|此刻|这会儿/.test(prefix)
 })
 const today=/(?:今天(?:在)?(?:这个)?群(?:里|聊)?|群里今天|(?:今天|今早|今晚)(?:看到|看见|读到|刷到|听到))/.test(s)
 if(immediate&&(!at||at>now||now-at>10*MINUTE)||today&&(!at||at>now||day(at)!==day(now)))return{ok:false,message:'主动正文把历史或未知时间的来源写成刚发生，本轮未发送',sourceAt:at}
 return{ok:true}
}
