const JOBS=new Set(['like','comment','reply'])
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,96}$/.test(value)
const account=value=>/^\d{4,13}$/.test(String(value??''))
const sticky=(parent,last)=>'r'+parent.length+'-'+parent+'-'+last
const list=value=>Array.isArray(value)?value:[]

// Own the provider mutation, not a caller-supplied closure. Only an installed
// qzone-social adapter can provide the permission check and source observation.
export function createQzonePlatform({api,candidates,now,cfg,active,disposed,sleeping,enabled,ledger,actionCurrent,continuity,record}){
 const module='qzone-social'
 const service=()=>enabled(module)?api.use(module)?.lifePlatform:null
 const currentAccount=()=>String(api.core.hub.selfId||cfg().botQQ||'')
 let isDefiniteFailure
 try{isDefiniteFailure=api.lib?.('onebot/client.js')?.isDefiniteFailure}catch{/* Without a native classifier, thrown writes are uncertain. */}
 let dispatching=false
 function admitted(spec,provider){
  const c=cfg(),social=c.qzoneSocial||{},hour=new Date(now()).getHours(),su=c.speakUp||{}
  if(!active()||c.dryRun||sleeping()||!social.enabled||dispatching||!provider||provider!==service()||
     !(hour>=Number(su.awakeFrom??9)&&hour<Number(su.awakeTo??23)))return false
  return provider.canWrite?.(spec)===true
 }
 function sourceOf(spec,scope,targetUin,own){
  const readSource=id=>{
   if(typeof id!=='string')return null
   const row=ledger.get(id)
   return row?.status==='succeeded'&&row.meta.module===module&&row.meta.arguments?.selfId===own&&row.meta.sourceScopes?.length===1&&
    row.meta.sourceScopes[0]===scope&&actionCurrent(row)?row:null
  }
  const source=readSource(spec.sourceId)
  if(!source)return null
  if(spec.job==='reply'){
   if(source.meta.action!=='post-read'||source.meta.arguments?.tid!==spec.postId||source.meta.arguments?.targetUin)return null
   const parent=list(source.result?.comments).find(c=>String(c?.comment_id??'')===spec.parentId)
   if(!parent)return null
   const replied=spec.parentId===spec.replyId?parent:list(parent.replies).find(r=>String(r?.comment_id??'')===spec.replyId)
   if(!replied)return null
   const posts=readSource(spec.detailSourceId)
   if(posts?.meta.action!=='own-posts-read')return null
   const post=list(posts.result?.msglist).find(p=>p?.tid===spec.postId)
   if(!post)return null
   return {key:sticky(spec.parentId,spec.replyId),detailId:posts.id,who:replied.name,post:post.content}
  }
  if(source.meta.action!=='feed-read')return null
  const post=list(source.result?.feeds).find(f=>f?.appid===311&&String(f.uin)===targetUin&&f.key===spec.postId)
  if(!post||!Number.isFinite(Number(post.time))||Number(post.time)*1000<now()-86400_000)return null
  let detail=null
  if(spec.detailSourceId){
   detail=readSource(spec.detailSourceId)
   if(!detail||detail.meta.action!=='post-read'||detail.meta.arguments?.tid!==spec.postId||detail.meta.arguments?.targetUin!==targetUin)return null
  }
  return {key:spec.job,at:Math.floor(Number(post.time)),detailId:detail?.id,who:post.nickname,post:detail?.result?.content||post.content}
 }
 async function run(spec={}){
  const notSent=(message,status='unavailable')=>({ok:false,status,message})
  if(!JOBS.has(spec.job)||!id(spec.postId)||spec.job==='reply'&&(!id(spec.parentId)||!id(spec.replyId)||spec.parentId.length+spec.replyId.length>165))
   return notSent('空间互动缺少可核对的原生目标')
  const own=currentAccount(),scopedOwner=String(cfg().ownerQQ||''),scope='private:'+scopedOwner
  const targetUin=spec.job==='reply'?own:String(spec.targetUin??'')
  if(!account(own)||!account(scopedOwner)||!account(targetUin)||spec.job!=='reply'&&targetUin===own)
   return notSent('空间互动缺少有效的账户范围')
  const provider=service()
  if(!admitted(spec,provider))return notSent('空间互动当前未获执行资格')
  const anchor=sourceOf(spec,scope,targetUin,own)
  if(!anchor)return notSent('空间互动的实际观察已失效')
  const text=spec.job==='like'?'':typeof spec.text==='string'?spec.text.trim():''
  let sourceIds=[spec.sourceId,...(anchor.detailId?[anchor.detailId]:[])]
  if(spec.job!=='like'){
   const snap=continuity.contextDetail(spec.snapshot?.id)
   if(!text||text.length>180||snap?.data?.purpose!=='public-share'||snap.data.consumer!==module||!continuity.validateDraft(text,spec.snapshot).ok)
    return notSent('空间评论草稿或记忆范围已失效')
   sourceIds=[...new Set([...sourceIds,...snap.data.sourceIds||[]])]
  }
  const at=now(),target='qzone-post:'+own+':'+targetUin+':'+spec.postId
  const row=candidates.submit({module,job:spec.job,key:anchor.key,target,sourceIds,expiresAt:at+60_000})
  if(row.status!=='queued'||!candidates.claim(row.id))return{ok:false,status:row.status,candidateId:row.id,message:'同一平台动作已登记，不重复执行'}
  if(!candidates.sending(row.id)){candidates.cancel(row.id,'expired');return notSent('空间动作有效期已过')}
  dispatching=true
  let response,rejected=false
  const like=spec.job==='like'
  try{
   response=await api.core.onebot.call(like?'like_qzone':'comment_qzone',{
    tid:spec.postId,...(spec.job!=='reply'&&{target_uin:Number(targetUin)}),...(like?{abstime:anchor.at}:{content:text})
   },{timeoutMs:like?20000:30000,retries:0})
  }catch(error){rejected=isDefiniteFailure?.(error)===true}
  finally{dispatching=false}
  if(disposed())return{ok:false,status:'interrupted',candidateId:row.id}
  const acknowledged=like?response===null:!response?.simulated&&!response?.dryRun&&response?.ok!==false&&id(response?.comment_id)
  const receipt=acknowledged?(like?'gateway-ok:'+spec.postId:response.comment_id):null
  const ok=!!receipt&&candidates.confirm(row.id,target,'sent',receipt)
  rejected ||= response?.ok===false
  if(!ok)candidates.finish(row.id,rejected?'not-sent':'unknown',rejected?'provider-rejected':'missing-receipt')
  const current=candidates.get(row.id),outcome={ok,status:current.status,candidateId:row.id,receipt:current.receipt}
  record({module,action:spec.job,callId:'candidate:'+row.id,chatId:scope,sourceScopes:[scope],sourceIds:current.sourceIds,evidenceType:'platform-ack',public:false,self:true},
   ok?{...outcome,postId:spec.postId,...(current.sourceIds.length&&{text,who:String(anchor.who??'').slice(0,80),post:String(anchor.post??'').slice(0,80)})}:outcome)
  return outcome
 }
 const countToday=(at,includeUncertain=false)=>{
  const start=new Date(at).setHours(0,0,0,0)
  return candidates.countSince(module,['comment','reply'],'qzone-post:'+currentAccount()+':',start,
   includeUncertain?['sent','sending','unknown']:['sent'])
 }
 function history(){
  const scope='private:'+String(cfg().ownerQQ||'')
  return candidates.recentFor(module).flatMap(row=>{
   if(row.status!=='sent'||row.sourceIds.length===0||!row.target.startsWith('qzone-post:'+currentAccount()+':'))return []
   const r=ledger.byKey(module+':candidate:'+row.id)
   return actionCurrent(r)&&r.meta.chatId===scope?[{at:row.updatedAt,kind:row.job,who:r.result?.who||'',post:r.result?.post||'',text:r.result?.text||''}]:[]
  })
 }
 return {run,countToday,history}
}
