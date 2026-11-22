// Presentation only: occurrences and visual conclusions have separate authorities.
const key=(dir,id)=>dir+'\0'+String(id)
const direction=item=>item.type==='utterance'?'out':'in'
const cleanText=s=>String(s||'').replace(/\s+/g,' ').trim()

export function projectMedia({items,current=[],directSourceIds=[],chatId,provider}) {
 const empty={items,groups:[],includedVisuals:new Set(directSourceIds)}
 if(typeof provider?.mediaFor!=='function'||typeof provider?.mediaCurrent!=='function')return empty
 const sources=new Map(items.filter(i=>i.messageId&&['message','utterance'].includes(i.type)&&i.status!=='corrected').map(i=>[key(direction(i),i.messageId),i]))
 const refs=[...sources.values()].map(i=>({dir:direction(i),messageId:i.messageId}))
 const all=new Map(),slots=new Map()
 for(const x of [...(provider.mediaFor(chatId,refs)||[]),...current]){
  if(!x?.id||!x.messageId||!x.identity||!['in','out'].includes(x.dir))continue
  const row=sources.get(key(x.dir,x.messageId))
  if(row||current.includes(x)&&x.dir==='in')all.set(x.id,{...x,row})
 }
 for(const x of all.values())if(provider.mediaCurrent([x.id],{chatId})){
  if(!slots.has(x.identity))slots.set(x.identity,[])
  slots.get(x.identity).push(x)
 }
 const currentIds=new Set(current.map(x=>x.id))
 const priority=list=>list.some(x=>currentIds.has(x.id))?1:0
 const latest=list=>Math.max(...list.map(x=>x.at||0))
 const recent=[...slots.entries()].sort((a,b)=>priority(b[1])-priority(a[1])||latest(b[1])-latest(a[1])).slice(0,4)
 const includedVisuals=empty.includedVisuals,labels=new Map()
 const groups=recent.map(([identity,list],index)=>{
  const label='图'+(index+1)
  const out=list.filter(x=>x.dir==='out').length, incoming=list.length-out
  const validVisual=v=>v?.sourceId&&cleanText(v.description)&&provider.contextCurrent?.([v.sourceId],{chatId})
  const visual=list.filter(x=>currentIds.has(x.id)).map(x=>x.visual).find(validVisual)||list.map(x=>x.visual).find(validVisual)
  const direct=visual&&includedVisuals.has(visual.sourceId)
  if(visual)includedVisuals.add(visual.sourceId)
  for(const x of list)if(x.row){
   const assigned=labels.get(x.row.eventId)||new Set()
   assigned.add(label);labels.set(x.row.eventId,assigned)
  }
  const title=visual?.frames>1?'同一张动图':'同一份图片素材'
  const summary=visual
   ?direct?'本轮已附视觉描述，不重复。':(visual.confidence<0.6?'低置信度，仅供本轮核对：':'已识图：')+cleanText(visual.description).slice(0,recent.length<=2?180:100)+(visual.uncertainty?'；不确定：'+cleanText(visual.uncertainty).slice(0,recent.length<=2?70:40):'')
   :'无已保存的画面理解；有发送记录不等于看过画面。'
  const occurrenceIds=list.map(x=>x.id)
  const refs=[...new Map(list.filter(x=>x.row).map(({row})=>[row.id,{id:row.id,eventId:row.eventId,refKind:row.refKind}])).values()]
  const mediaSourceIds=[...occurrenceIds,...refs.flatMap(i=>[i.id,i.eventId]),...(visual?[visual.sourceId]:[])]
  return{id:occurrenceIds[0],type:'media',refKind:'media',status:'confirmed',occurredAt:Math.max(...list.map(x=>Number(x.at)||0)),
   text:`${label}：${title}在本段聊天记录出现 ${list.length} 次（机器人发出 ${out} 次、收到 ${incoming} 次）。${summary}`,
   sourceScopes:[chatId],occurrenceIds,mediaSourceIds,refs,visualSourceId:visual?.sourceId}
 })
 return{groups,includedVisuals,items:items.map(i=>{
  const label=labels.get(i.eventId)
  if(!label)return i
  const tag='【'+[...label].join('、')+'】'
  return {...i,text:tag+(/^(?:\[图片\]|\[表情\]|\[image\]|\s)+$/.test(i.text)?'':i.text)}
 })}
}
