export const diaryKinds=new Set(['public-diary','private-diary'])
export const isDiaryJob=(module,id,kind)=>kind==='public-diary'&&module==='diary'&&id==='publish'||
 kind==='private-diary'&&module==='autonomy'&&id==='journal'
export const diaryTarget=(kind,config,hub)=>kind==='public-diary'
 ?'qzone:'+String(hub.selfId||config.botQQ||'current')
 :'server:private-journal'

// The module owns composition; the core owns the single, last-mile effect.
// No draft content or executable closures are persisted in the queue.
export function createDiaryDispatch({candidates,now,active,disposed,sleeping,cfg,hub,continuity,assertSourcesCurrent,jobFor,permission,record}){
 let busy=false
 function stepAllowed(row,job){
  return active()&&!cfg().dryRun&&!sleeping()&&continuity.contextManaged(job.kind)&&
   row.target===diaryTarget(job.kind,cfg(),hub())&&jobFor(row.module,row.job)===job&&permission(job,row)===true
 }
 async function run(row,job){
  const describe=(status,extra={})=>({ok:status==='sent'||status==='saved',status,candidateId:row.id,...extra})
  if(busy||!active()||sleeping()||!continuity.contextManaged(job.kind)||permission(job,row)==='defer')return describe('queued')
  if(!stepAllowed(row,job)){
   candidates.cancel(row.id,'source-or-permission');return describe(candidates.get(row.id)?.status||'cancelled')
  }
  if(!candidates.claim(row.id))return describe(candidates.get(row.id)?.status||'expired')
  busy=true
  let bound=[]
  try{
   await job.run(row,async({sources},effect)=>{
    if(disposed()||row.expiresAt<=now()||candidates.get(row.id)?.status!=='running'||!stepAllowed(row,job))throw Error('日记任务的权限或时段已变化')
    if(!Array.isArray(sources)||sources.length>60||sources.some(s=>typeof s?.id!=='string')||typeof effect!=='function')throw Error('日记写入缺少来源')
    assertSourcesCurrent(job.kind==='public-diary'?'public':'private',sources)
    bound=sources.map(s=>s.id)
    if(!candidates.bindSources(row.id,bound)||!candidates.sending(row.id))throw Error('日记写入资格已失效')
    const execution=effect()
    const r=execution?.then?await execution:execution
    const privateFile=job.kind==='private-diary',receipt=privateFile?r?.id:r?.tid
    const valid=r?.ok===true&&!r.dryRun&&!r.simulated&&typeof receipt==='string'&&
     (privateFile?r.status==='saved'&&/^journal:[a-f0-9-]{36}$/.test(receipt):/^[A-Za-z0-9_-]{1,128}$/.test(receipt)&&!/^sim-/i.test(receipt))
    if(!disposed()){
     if(valid){
      if(!candidates.confirm(row.id,row.target,privateFile?'saved':'sent',receipt)){
       candidates.finish(row.id,'unknown','missing-receipt')
       return {ok:false,message:'收到重复或失效回执，本轮未确认'}
      }
     }else candidates.finish(row.id,privateFile?'not-sent':'unknown',privateFile?'write-failed':'missing-receipt')
    }
    return r
   })
  }catch{/* the durable state, not an exception from a module, decides whether an effect ran */}
  finally{busy=false}
  if(disposed())return describe('interrupted')
  let current=candidates.get(row.id)
  if(current?.status==='sending')candidates.finish(row.id,'unknown','missing-receipt')
  if(current?.status==='running')candidates.finish(row.id,'not-sent','draft-rejected')
  current=candidates.get(row.id)
  const status=current?.status||'interrupted'
  record({module:row.module,action:row.job,callId:'candidate:'+row.id,kind:'reflection',evidenceType:job.kind,
   sourceIds:current?.sourceIds||[],self:true,public:false},{...describe(status),receipt:current?.receipt||null})
  const hints={'source-or-permission':'来源授权、有效时间或模块状态已变化','draft-rejected':'未取得通过核验的日记','missing-receipt':'未收到有效回执，本轮不自动重试','write-failed':'日记文件未保存'}
  return describe(status,{...(status==='saved'&&{evidenceCount:bound.length}),...(hints[current?.reason]&&{message:hints[current.reason]})})
 }
 return {run}
}
