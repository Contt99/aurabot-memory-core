const module='bili',prefix='bili-video:',danmakuPrefix='bili-danmaku:',jobs=new Set(['comment','reply','like','danmaku'])
const native=value=>{
 const id=typeof value==='string'?value:Number.isSafeInteger(value)?String(value):''
 return /^[1-9]\d{0,19}$/.test(id)?id:''
}

// The module owns the Bilibili client. The core owns permission, a stable
// operation identity, the write boundary and the durable result.
export function createBiliPlatform({api,candidates,now,cfg,active,disposed,sleeping,enabled,ledger,actionCurrent,continuity,record}){
 const provider=job=>enabled(module)?api.use(module)?.[job==='danmaku'?'lifeDanmaku':'lifePlatform']:null
 const tally=(job,reserved=false)=>candidates.countSince(module,[job],prefix,new Date(now()).setHours(0,0,0,0),
  reserved?['sent','unknown','sending']:['sent'])
 function source(spec,scope){
  const row=typeof spec.sourceId==='string'&&ledger.get(spec.sourceId)
  if(row?.status!=='succeeded'||row.meta.module!==module||!actionCurrent(row)||row.at>now()||now()-row.at>20*60_000)return null
  if(spec.job==='reply'){
   if(row.meta.action!=='reply-feed'||row.meta.chatId!==scope||row.meta.arguments?.account!==spec.account)return null
   const note=Array.isArray(row.result)&&row.result.find(item=>native(item?.id)===spec.noticeId&&Number(item.type||1)===1)
   const aid=native(note?.oid),root=native(note?.root),parent=native(note?.parent)
   return aid&&root&&parent?{aid,root,parent,key:'reply-'+root+'-'+parent,title:note.title}:null
  }
  if(row.meta.action!=='watch'||row.meta.public!==true||row.meta.sourceScopes?.length!==0)return null
  const v=row.result?.info,aid=native(v?.aid)
  if(!aid||!/^BV[0-9A-Za-z]{10}$/.test(v?.bvid)||v.bvid!==spec.bvid)return null
  if(spec.job==='danmaku'){
   const cid=native(v.cid)
   if(!cid||!Number.isFinite(spec.seconds)||spec.seconds<0||spec.seconds>=86400)return null
   return{aid,cid,bvid:v.bvid,key:'danmaku-'+new Date(now()).setHours(0,0,0,0),title:v.title,seconds:spec.seconds}
  }
  return {aid,bvid:v.bvid,key:spec.job,title:v.title}
 }
 let busy=false
 async function run(spec){
  if(busy||!jobs.has(spec?.job)||!native(spec.account))return{ok:false,status:'unavailable'}
  const adapter=provider(spec.job),owner=String(cfg().ownerQQ||''),scope='private:'+owner
  if(spec.job==='reply'&&!native(owner))return{ok:false,status:'unavailable'}
  const permitted=()=>{
   const c=cfg(),b=c.bili||{},hour=new Date(now()).getHours(),s=c.speakUp||{}
   return active()&&!disposed()&&!c.dryRun&&!sleeping()&&adapter===provider(spec.job)&&b.enabled&&String(c.ownerQQ||'')===owner&&
    hour>=Number(s.awakeFrom??9)&&hour<Number(s.awakeTo??23)&&
    (spec.job==='reply'?b.reply:b.autoBrowse&&(spec.job==='danmaku'?b.danmakuEnabled&&b.autoDanmaku:b[spec.job]))&&adapter?.canWrite?.(spec)===true
  }
  if(!permitted())return{ok:false,status:'unavailable'}
  const anchor=source(spec,scope)
  const text=spec.job==='like'?'':String(spec.text||'').trim()
  const draft=()=>{
   if(spec.job==='like')return {sourceIds:[]}
   const s=continuity.contextDetail(spec.snapshot?.id)?.data
   return text.length>0&&text.length<=200&&s?.purpose==='public-share'&&s.consumer===module&&
    continuity.validateDraft(text,spec.snapshot).ok?s:null
  }
  const snapshot=draft()
  if(!anchor||!snapshot)return{ok:false,status:'unavailable'}
  const target=(spec.job==='danmaku'?danmakuPrefix:prefix)+spec.account+':'+(spec.job==='danmaku'?anchor.cid:anchor.aid)
  const row=candidates.submit({module,job:spec.job,key:anchor.key,target,sourceIds:[spec.sourceId,...(snapshot.sourceIds||[])],expiresAt:now()+60_000})
  if(row.status!=='queued'||!candidates.claim(row.id))return{ok:false,status:row.status,candidateId:row.id}
  busy=true
  let entered=false,answer,denied=false,code
  const beforePost=()=>{
   if(entered||!permitted()||!source(spec,scope)||!draft()||!candidates.sending(row.id))throw Error('B 站写入资格已变化')
   entered=true
  }
  try{answer=await adapter.write(spec,{...anchor,text},beforePost)}
  catch(error){denied=error?.biliRejected===true;code=Number.isInteger(error?.code)?error.code:undefined}
  finally{busy=false}
  if(disposed())return{ok:false,status:'interrupted',candidateId:row.id}
  const dmId=spec.job==='danmaku'?native(answer?.dmid_str):''
  if(spec.job==='danmaku'&&answer?.ok===false&&Number.isInteger(answer.platformResponse?.code)&&answer.platformResponse.code!==0)denied=true
  const receipt=!entered||answer?.simulated||answer?.dryRun||answer?.ok===false?'':
   spec.job==='like'?(answer?.accepted===true?'bili-ok:'+anchor.aid:''):
   spec.job==='danmaku'?(answer?.platformResponse?.code===0?dmId:''):native(answer?.rpid_str??answer?.rpid)
  const ok=Boolean(receipt&&candidates.confirm(row.id,target,'sent',receipt))
  if(!ok)candidates.finish(row.id,!entered||denied?'not-sent':'unknown',
   !entered?'source-or-permission':denied?'provider-rejected':'missing-receipt')
  const current=candidates.get(row.id),result={ok,status:current.status,candidateId:row.id,receipt:current.receipt,code}
  const priv=spec.job==='reply'
  const title=String(anchor.title||'').slice(0,100)
  const verb={comment:'发布评论',reply:'回复评论',like:'点赞',danmaku:'发布弹幕'}[spec.job]
  const summary=`在 B 站《${title||'视频 '+anchor.aid}》${spec.job==='danmaku'?' '+anchor.seconds+' 秒':'下'}${verb}，平台已确认${text?'：'+text:''}`
  record({module,action:spec.job,callId:'candidate:'+row.id,evidenceType:'platform-ack',self:true,public:!priv,
   chatId:priv?scope:'',sourceScopes:priv?[scope]:[],sourceIds:current.sourceIds},
  current.sourceIds.length?{...result,bvid:anchor.bvid,aid:anchor.aid,title,...(ok&&dmId&&{dmid:dmId,cid:anchor.cid,seconds:anchor.seconds}),
   ...(ok&&{text:summary,sentText:text,...(anchor.bvid&&{url:'https://www.bilibili.com/video/'+anchor.bvid})})}:result)
  return result
 }
 function history(){
  const scope='private:'+String(cfg().ownerQQ||'')
  return candidates.recentFor(module).flatMap(row=>{
   if(row.status!=='sent'||!row.sourceIds.length||!(row.target.startsWith(prefix)||row.target.startsWith(danmakuPrefix)))return []
   const r=ledger.byKey(module+':candidate:'+row.id)
   return actionCurrent(r)&&(!r.meta.chatId||r.meta.chatId===scope)?
    [{at:row.updatedAt,kind:row.job,title:r.result?.title,bvid:r.result?.bvid,text:r.result?.sentText||r.result?.text,
      ...(row.job==='danmaku'&&{id:r.result?.dmid})}]:[]
  })
 }
 return {run,tally,history}
}
