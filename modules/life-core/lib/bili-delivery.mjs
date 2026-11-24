import {nativeAck} from './candidate-queue.mjs'

const shots=/^[a-f0-9]{12}\.jpg$/
const videos=/^BV[0-9A-Za-z]{10}$/
const module='bili',duration=8*60_000
export const isBiliQQJob=job=>job==='share'||job==='shot'

export function createBiliDelivery({api,cfg,active,disposed,now,enabled,sleeping,ledger,actionCurrent,continuity,candidates,context,canTarget}){
 const provider=()=>enabled(module)?api.use(module)?.lifeDelivery:null
 const latest=target=>Math.max(Number(api.core.hub.lastPrivateAt?.(target.slice(8)))||0,Number(api.core.hub.lastOwnerChatAt)||0)
 function permit(job,target){
  const c=cfg(),b=c.bili,s=c.speakUp||{},h=new Date(now()).getHours()
  return active()&&!c.dryRun&&target==='private:'+c.ownerQQ&&/^private:[1-9]\d*$/.test(target)&&provider()?.jobs?.includes(job)&&b?.enabled&&b.autoBrowse&&
   h>=Number(s.awakeFrom??9)&&h<Number(s.awakeTo??23)&&(job==='share'?b.shareToOwner:b.vision&&Number(b.shotChance)>0)
 }
 function getView({sourceId,bvid},file){
  const row=typeof sourceId==='string'&&ledger.get(sourceId)
  if(row?.status!=='succeeded'||row.meta.module!==module||row.meta.action!=='watch'||row.meta.public!==true||
     row.meta.sourceScopes?.length!==0||!actionCurrent(row)||row.result?.info?.bvid!==bvid||!videos.test(bvid)||row.at>now()||row.at+duration<=now())return null
  if(file&&(!shots.test(file)||!row.result.shotIds?.includes(file)))return null
  return row
 }
 function checkText(job,text,id){
  const s=continuity.contextDetail(id)
  return (job==='shot'||!!text)&&text.length<=800&&s?.data?.purpose==='public-share'&&
   s.data.consumer===module&&continuity.validateDraft(text,id).ok?s.data:null
 }
 function queue(spec){
  if(!spec||!isBiliQQJob(spec.job)||!permit(spec.job,spec.target)||provider()?.canQueue?.(spec)!==true)return{ok:false,status:'unavailable'}
  const file=spec.job==='shot'?spec.file:''
  if(spec.job==='shot'&&!shots.test(file))return{ok:false,status:'unavailable'}
  const view=getView(spec,file),text=String(spec.text||'').trim(),snapshotId=spec.snapshot?.id
  const snap=checkText(spec.job,text,snapshotId)
  if(!view||!snap||latest(spec.target)>snap.createdAt)return{ok:false,status:'unavailable'}
  const row=candidates.submit({module,job:spec.job,key:spec.bvid+(file?'-'+file:''),target:spec.target,
   sourceIds:[spec.sourceId,...snap.sourceIds||[]],expiresAt:Math.min(view.at+duration,snap.createdAt+duration)},
  {sourceId:spec.sourceId,bvid:spec.bvid,snapshotId,text,file})
  return{ok:true,status:row.status,candidateId:row.id}
 }
 function current(row,draft){
  const p=provider()
  if(disposed()||!draft||row.expiresAt<=now()||!permit(row.job,row.target)||
   !p||!getView(draft,draft.file)||draft.file&&!p.frameCurrent?.(draft.file))return false
  const snap=checkText(row.job,draft.text,draft.snapshotId)
  return !!snap&&latest(row.target)<=snap.createdAt
 }
 function eligible(row){
  return current(row,candidates.draft(row.id))
 }
 async function run(row){
  const draft=candidates.draft(row.id),p=provider(),parent=context.getStore()
  const finish=(status,reason)=>{if(!disposed())candidates.finish(row.id,status,reason);return{ok:false,status}}
  if(!parent||!current(row,draft)||sleeping()||!canTarget(row.target))return finish('cancelled','source-or-permission')
  const url='https://www.bilibili.com/video/'+draft.bvid
  const text=draft.file?draft.text:draft.text+'\n'+url
  let segments,expectedImage
  if(draft.file){
   let frame
   try{frame=p.readFrame(draft.file)}catch{}
   if(!Buffer.isBuffer(frame)||frame.length<4||frame.length>4*1024*1024||frame[0]!==0xff||frame[1]!==0xd8)return finish('not-sent','frame-unavailable')
   expectedImage='base64://'+frame.toString('base64')
   segments=[{type:'image',data:{file:expectedImage}},...(text?[{type:'text',data:{text}}]:[])]
  }
  if(!candidates.sending(row.id))return finish('cancelled','expired')
  let entered=false
  const allowed=(target,filteredText=text)=>target===row.target&&!sleeping()&&canTarget(row.target)&&p===provider()&&
   (draft.file||filteredText.split(/\s+/).includes(url))&&current(row,draft)&&candidates.get(row.id)?.status==='sending'&&
   continuity.validateDraft(filteredText,draft.snapshotId).ok
  parent.contactGuard=allowed
  const observed=new Set()
  parent.contactAck=(chatId,id,actual)=>{
   if(chatId!==row.target)return
   if(expectedImage?actual.some(s=>s.type==='image'&&s.data?.file===expectedImage):
    actual.filter(s=>s.type==='text').some(s=>s.data?.text?.split(/\s+/).includes(url)))observed.add(id)
  }
  const isCurrent=()=>{try{entered=allowed(row.target);return entered}catch{return false}}
  let ack
  try{ack=await continuity.runWithContext(draft.snapshotId,()=>segments?
   api.core.hub.sendSegments(row.target,segments,'B 站截图',{isCurrent}):
   api.core.hub.sendText(row.target,text,undefined,undefined,undefined,{isCurrent}))}catch{}
  if(disposed())return{ok:false,status:'interrupted'}
  const gotAck=nativeAck(ack?.message_id)
  if(entered&&gotAck&&observed.has(String(ack.message_id))&&candidates.ack(row.id,row.target,ack.message_id))
   return{ok:true,status:'sent',messageId:String(ack.message_id),bvid:draft.bvid,title:getView(draft,draft.file)?.result?.info?.title}
  return entered?finish('unknown',gotAck?'content-unconfirmed':'missing-receipt'):finish('not-sent','source-or-permission')
 }
 function history(){
  const target='private:'+cfg().ownerQQ
  return candidates.recentFor(module).flatMap(row=>{
   if(row.status!=='sent'||row.target!==target||!isBiliQQJob(row.job)||!row.sourceIds.length)return []
   const action=ledger.byKey(module+':candidate:'+row.id)
   return actionCurrent(action)&&action?.result?.status==='sent'?[{at:row.updatedAt,kind:row.job,title:action.result.title,bvid:action.result.bvid}]:[]
  })
 }
 return{queue,eligible,run,history}
}
