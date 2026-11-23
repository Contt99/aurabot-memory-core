// This clock dispatches a module's existing due checks. A checked clock is
// not an action receipt; actual operations are still recorded at execution.
export function createScheduleDispatcher({api,active,enabled,now}){
 const states=new Map(),running=new Set()
 const startedAt=now()
 function jobs(){
  const list=[]
  for(const {id:module,running:loaded} of api.core.modules?.status?.()||[]){
   if(!loaded||!enabled(module))continue
   const provider=api.use(module)
   if(typeof provider?.lifeSchedules!=='function')continue
   let declared
   try{declared=provider.lifeSchedules()}catch{continue}
   if(!Array.isArray(declared))continue
   const seen=new Set()
   for(const j of declared.slice(0,12)){
    if(!j||typeof j.id!=='string'||!/^[a-z0-9-]{1,32}$/.test(j.id)||seen.has(j.id)||typeof j.run!=='function'||!Number.isFinite(j.intervalMs)||j.intervalMs<60000)continue
    seen.add(j.id)
    list.push({module,id:j.id,key:module+':'+j.id,intervalMs:j.intervalMs,run:j.run,label:String(j.label||j.id).slice(0,80)})
   }
  }
  return list
 }
 async function tick(){
  if(!active())return
  const at=now(),known=jobs(),keep=new Set(known.map(j=>j.key))
  for(const key of states.keys())if(!keep.has(key)&&!running.has(key))states.delete(key)
  await Promise.all(known.map(async j=>{
   const before=states.get(j.key)
   if(running.has(j.key)||at-(before?.checkedAt??startedAt)<j.intervalMs)return
   states.set(j.key,{checkedAt:at,status:'checking'})
   running.add(j.key)
   try{await j.run();states.set(j.key,{checkedAt:at,status:'checked'})}
   catch{states.set(j.key,{checkedAt:at,status:'check-failed'});api.log?.warn?.('统一调度检查失败：'+j.module+'/'+j.id)}
   finally{running.delete(j.key)}
  }))
 }
 const owns=(module,id)=>jobs().some(j=>j.module===module&&j.id===id)
 const inventory=()=>jobs().map(({run,key,...j})=>({...j,...(states.get(key)||{status:'waiting'})}))
 return{tick,owns,inventory}
}
