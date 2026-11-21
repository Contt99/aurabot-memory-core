import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'

export function installExplorationRequest(api,{wake,isBusy,assertActive,snapshot}) {
 const file=api.dataDir('exploration-request.json');let live=true,turn=null
 const read=()=>{try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}}
 const save=r=>{const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(r),{mode:0o600});fs.renameSync(temp,file);return r}
 const old=read();if(old&&['accepted','running'].includes(old.status))save({...old,status:'interrupted',message:'模块重载或重启中断，未自动重放',updatedAt:Date.now()})
 api.onDispose(()=>{live=false})
 api.on('prompt',(content,info)=>{
  const owner=String(api.config().ownerQQ),chatId=info?.chat?.chatId
  if(chatId!=='private:'+owner||String(info.senderId)!==owner)return content
  turn={id:randomUUID(),chatId,at:Date.now()}
  const s=snapshot(),night=api.use('night')?.snapshot?.()||{}
  return [...content,{type:'text',text:'【自主探索状态】'+JSON.stringify({used:s.used,nextWakeAt:s.nextWakeAt,mood:s.mood,sleep:night.mode,energy:night.energy,request:read()})+'。主人允许你自由玩玩时，可以根据状态自行选择休息、稍后再做或调用 start_autonomy；不用再次确认。只有工具受理才能说启动，只有真实结果才能说完成。'}]
 })
 async function run(r) {
  if(!live||read()?.id!==r.id||!['accepted','waiting'].includes(read()?.status))return
  save({...r,status:'running',updatedAt:Date.now()})
  let result
  try {assertActive();result=await wake(r)}catch(e){result={ok:false,status:live?'failed':'interrupted',message:e.message}}
  const current=read();if(!live||current?.id!==r.id||current.status!=='running')return
  const status=result.action==='rest'?'rest':result.action==='think'?'thought':result.ok?'completed':result.status==='deferred'?'deferred':result.status==='busy'?'deferred':'failed'
  const row=save({...current,status,result,updatedAt:Date.now(),message:result.message||result.note||status})
  api.use('life-core')?.diagnostic?.({stage:'task',source:'autonomy',target:r.chatId,status,actionId:r.id,reason:row.message})
  api.log.info('聊天自主探索 '+r.id+'：'+row.status+' '+row.message)
  return row
 }
 api.tool(({chat,sessionId,level})=>{
  if(level==='none'||chat?.chatId!=='private:'+api.config().ownerQQ)return[]
  return [api.defineTool({name:'start_autonomy',description:'主人私聊允许你自由探索时，自行结合心情、疲劳、想法决定是否启动一轮。不需二次确认；只在你决定去做时调用。now真实启动；later保存待办。仅有现有阅读/搜索/笔记能力，5工具/120秒；不能改设置或新增权限。收到accepted只是受理，不是完成。',
   properties:{goal:{type:'string',description:'想探索的目标'},when:{type:'string',enum:['now','later']},delayMinutes:{type:'number',description:'later延迟5到360分钟'}},required:['goal','when'],
   execute:async({goal,when='now',delayMinutes=30},exec)=>{
    const sid=exec?.agent?.session?.id||exec?.session?.id||sessionId,hub=api.core.hub,chatId=hub.chatOfSession(sid)
    if(chatId!=='private:'+api.config().ownerQQ||!hub.turnSendersAllOwner(sid)||turn?.chatId!==chatId||Date.now()-turn.at>10*60000)return{ok:false,message:'只接受主人当前私聊回合的自主探索决定'}
    try {
     assertActive();const prior=read()
     if(prior?.turnId===turn.id)return{ok:true,status:prior.status,actionId:prior.id,message:'本轮已有决定，不重复启动：'+prior.status}
     if(isBusy()||prior&&['accepted','running','waiting'].includes(prior.status))return{ok:false,status:'busy',actionId:prior?.id,message:'已有一轮探索或待办，未另起重复任务'}
     if(!String(goal||'').trim())return{ok:false,message:'探索目标为空'}
     if(!['now','later'].includes(when))return{ok:false,message:'when只允许now或later'}
     if(when==='now'){
      const c=api.settings(),s=snapshot(),hour=new Date().getHours(),from=Number(c.awakeFrom)||0,to=Number(c.awakeTo)||24,mode=api.use('night')?.snapshot?.()?.mode
      const reason=mode&&!['awake','waking'].includes(mode)?'正在睡眠，本轮未启动':!(from<=to?hour>=from&&hour<to:hour>=from||hour<to)?'不在自主生活活跃时段，本轮未启动':Number(s.wakes)>=Math.max(0,Number(c.maxWakesPerDay)||0)?'今天自主生活轮次已用完，本轮未启动':''
      if(reason){api.use('life-core')?.diagnostic?.({stage:'task',source:'autonomy',target:chatId,status:'deferred',reason});return{ok:false,status:'deferred',message:reason}}
     }
     const r=save({id:randomUUID(),turnId:turn.id,chatId,goal:String(goal).slice(0,500),status:when==='later'?'waiting':'accepted',at:Date.now(),dueAt:Date.now()+(when==='later'?Math.max(5,Math.min(360,Number(delayMinutes)||30))*60000:0)})
     api.use('life-core')?.diagnostic?.({stage:'task',source:'autonomy',target:chatId,status:r.status,actionId:r.id})
     if(when==='now')api.later(0,()=>{const core=api.use('life-core');return core?.runDetached?core.runDetached(()=>run(r)):run(r)})
     return{ok:true,status:r.status,actionId:r.id,dueAt:r.dueAt,message:when==='later'?'探索待办已保存，到点再检查作息和额度；尚未执行':'一轮自主决策已受理；可能探索或休息，尚未完成'}
    }catch(e){return{ok:false,status:'failed',message:'未受理探索：'+e.message}}
   }})]
 })
 return {state:read,async tick(){const r=read();if(r?.status==='waiting'&&r.dueAt<=Date.now()){await run(r);return true}return false}}
}
