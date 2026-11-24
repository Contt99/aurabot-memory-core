const minute=n=>typeof n==='number'&&Number.isInteger(n)&&n>=0&&n<=24?n*60:null
const hm=s=>typeof s==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s)?Number(s.slice(0,2))*60+Number(s.slice(3)):null
const pad=(n)=>String(n).padStart(2,'0')
const label=m=>pad(Math.floor(m/60))+':'+pad(m%60)
const describe=(from,to)=>from===null||to===null?'':label(from)+'–'+label(to)
const covers=(from,to,m)=>from<=to?m>=from&&m<to:m>=from||m<to
const state=value=>typeof value==='boolean'?(value?'on':'off'):'unknown'

/** Report live interfaces and known exits separately from business switches and receipts. */
export function actionCoverage({api,config,schedules,candidateJob,observing,coreEnabled}){
 const modules=api.core.modules?.status?.()
 if(!Array.isArray(modules))return null
 const running=new Set(modules.filter(m=>m.running).map(m=>m.id))
 const ext=config.ext||{},su=config.speakUp||{},diary=config.diary||{},a=ext.autonomy||{},tieba=ext['tieba-reader']||{},rss=ext['rss-reader']||{},night=ext.night||{}
 const qFrom=minute(su.awakeFrom??9),qTo=minute(su.awakeTo??23)
 const shared=describe(qFrom,qTo)
 const sameDayWindow=qFrom!==null&&qTo!==null&&qFrom>=qTo?'现有设置无有效时段':shared
 const wakes=describe(minute(a.awakeFrom??7),minute(a.awakeTo??24))
 const tz=Intl.DateTimeFormat().resolvedOptions().timeZone
 const scheduleOf=(module,id)=>schedules.find(s=>s.module===module&&s.id===id)
 const used=new Set(),entries=[],conflicts=[]
 function add(id,module,name,{clock,jobs=[],platform=false,switchOn,window,note,observed=false,requires=()=>true}={}){
  const timing=clock?scheduleOf(module,clock):null
  if(timing)used.add(module+':'+clock)
  const loaded=running.has(module),ready=loaded&&(platform||jobs.length&&jobs.every(j=>candidateJob(module,j)))&&(!clock||timing)&&requires()
  const mode=!loaded?'not-loaded':ready?'managed':timing?'clock-only':observed?'observed':'outside'
  entries.push({id,module,label:name,mode,switchState:state(config.enabled===false?false:switchOn),window,note,
   ...(timing&&{checkMinutes:timing.intervalMs/60_000,lastCheckAt:timing.checkedAt||null})})
 }
 add('speakup.auto','speakup','旧主动搭话／追问',{clock:'contact-tick',jobs:['contact','nudge'],switchOn:su.enabled===true&&ext.purpose?.enabled!==true,window:shared})
 add('purpose.auto','purpose','目的引擎主动搭话／追问',{clock:'contact-tick',jobs:['contact','nudge'],switchOn:ext.purpose?.enabled===true,window:shared,note:'QQ 出口以原生消息编号确认；桌宠另计。'})
 add('autonomy.wake','autonomy','自主生活醒来与探索',{clock:'wake-tick',switchOn:a.enabled===true,window:wakes,note:'醒来检查由核心调度，探索走授权工具；其他动作各看自己的回执。'})
 add('autonomy.contact','speakup','自主生活选择搭话',{jobs:['autonomy'],
  requires:()=>running.has('autonomy')&&typeof api.use('autonomy')?.canSpeak==='function',
  switchOn:a.enabled===true,window:[wakes,shared].filter(Boolean).join(' 与 '),note:'必须由实际的一轮自主生活选择；与 QQ 触达共用额度。'})
 add('autonomy.journal','autonomy','私人日记',{clock:'wake-tick',jobs:['journal'],switchOn:a.enabled===true,window:wakes,note:'只在自主生活选择写日记时保存到服务器。'})
 add('diary.publish','diary','空间日记',{clock:'publish-tick',jobs:['publish'],switchOn:diary.enabled,window:describe(hm(diary.windowStart),hm(diary.windowEnd)),note:'窗口内按每日计划；空间编号确认发布。'})
 const tbFrom=minute(tieba.startHour??9),tbTo=minute(tieba.endHour??23)
 add('tieba.auto','tieba-reader','贴吧定时浏览／分享',{clock:'browse',jobs:['share'],switchOn:tieba.enabled!==false&&tieba.autoBrowse===true,window:tbFrom===tbTo&&tbFrom!==null?'全天':describe(tbFrom,tbTo),note:'浏览依贴吧窗口；分享还要通过 QQ 触达门禁。'})
 const bili=config.bili
 add('bili.auto','bili','B 站定时浏览、点赞与评论',{clock:'bili-tick',
  platform:typeof api.use('bili')?.lifePlatform?.write==='function',
  switchOn:bili?!!(bili.enabled&&(bili.autoBrowse||bili.reply)):undefined,window:sameDayWindow,
  note:'评论与回评核对原生编号，点赞核对平台成功。QQ 分享和弹幕另列。'})
 add('bili.qq','bili','B 站主动 QQ 分享与截图',{switchOn:bili?!!(bili.enabled&&bili.autoBrowse&&(bili.shareToOwner||Number(bili.shotChance)>0)):undefined,
  observed:true,window:sameDayWindow,note:'仍走原模块出口：经共享主动门禁，但不进入统一持久发送队列。'})
 add('bili.danmaku','bili','B 站自动弹幕',{switchOn:bili?!!(bili.enabled&&bili.autoBrowse&&bili.danmakuEnabled&&bili.autoDanmaku):undefined,
  observed:true,window:sameDayWindow,note:'仍用原模块的弹幕额度和回执，不在统一队列内。'})
 add('rss.auto','rss-reader','RSS 定时阅读／转发',{clock:'fetch-tick',switchOn:rss.enabled===true,note:rss.carrier==='pool'?'当前设为只进素材池。':'提议后由原入口决定是否转发，仍未使用持久发送候选。'})
 const spaceSocial=typeof api.use('qzone-social')?.lifePlatform?.canWrite==='function'
 add('qzone-social.auto','qzone-social','空间定时互动',{clock:'interact-tick',platform:spaceSocial,switchOn:config.qzoneSocial?.enabled,window:sameDayWindow,
  note:spaceSocial?'点赞以网关确认为准，评论和回复核对新编号；占用单独的空间互动配额。':'未发现统一空间出口。'})
 const morning=hm(night.wakeTime??'08:00'),jitter=Math.max(0,Math.min(90,Math.round(Number(night.wakeJitterMinutes??40))))
 const wakeZone=night.timeZone||'Asia/Shanghai',tod=m=>(m+1440)%1440
 const wakeWindow=morning!==null&&Number.isFinite(jitter)?describe(tod(morning-jitter),tod(morning+jitter))+' '+wakeZone:''
 add('night.dream','night','长夜如梦 · 自动梦境',{clock:'night-action-tick',platform:api.use('night')?.recordsDreamOutcome===true,
  switchOn:night.enabled!==false&&night.dreamEnabled!==false&&night.dreamAutoEnabled!==false,
  window:night.dreamInRemOnly===false?'睡眠中':'REM 睡眠阶段',
  note:'仍按夜间模块的生成间隔和上限。只记保存结果，梦境正文不进入共享记忆。'})
 add('night.wake','night','自然醒后问候',{clock:'night-action-tick',jobs:['wake-greeting'],switchOn:night.enabled!==false&&night.morningGreeting===true,
  window:wakeWindow?'夜间起床计划 '+wakeWindow+'；QQ '+shared:shared,
  note:'自然醒后 5 分钟有效（包括午睡醒来）；通过共享私聊门禁才生成，实发用原生消息编号确认。'})
 if(running.has('night')&&night.enabled!==false&&night.morningGreeting===true&&morning!==null&&Number.isFinite(jitter)&&qFrom!==null&&qTo!==null){
  let sameZone=false
  try{sameZone=Intl.DateTimeFormat('en',{timeZone:wakeZone}).resolvedOptions().timeZone===tz}catch{}
  if(sameZone&&!Array.from({length:2*jitter+5},(_,i)=>tod(morning-jitter+i)).some(m=>covers(qFrom,qTo,m)))
   conflicts.push('夜间自然醒的整个计划窗口（含醒后 5 分钟）落在 QQ 安静时段内；在现有配置下，夜间起床问候会过期。')
 }
 add('impression.auto','impression-card','印象卡片的主动微调',{
  switchOn:ext['impression-card']?.enabled!==false&&ext['impression-card']?.proactiveEnabled===true,note:'仍由印象卡模块检查；与被动查卡分开。'})
 add('pet.local','pet','桌宠气泡与内部回落',{switchOn:ext.purpose?.carrier==='pet'?true:undefined,note:'没有本地气泡接收的可追溯回执。'})
 if(su.nudge&&Number(su.idleMinutes??40)>=40)conflicts.push('追问只在最后一句问题发出后 15–40 分钟有效；共享空闲要求 '+Number(su.idleMinutes??40)+' 分钟，没有重叠。')
 if(su.enabled===true&&ext.purpose?.enabled===true&&!running.has('purpose'))conflicts.push('旧主动搭话被设置为让位给目的引擎，但目的引擎当前未加载；这两个定时入口都不会触发。')
 if(tieba.autoBrowse===true&&['Asia/Shanghai','Asia/Chongqing','PRC'].includes(tz)&&[tbFrom,tbTo,qFrom,qTo].every(x=>x!==null)&&
  !Array.from({length:24},(_,h)=>h*60).some(m=>(tbFrom===tbTo||covers(tbFrom,tbTo,m))&&covers(qFrom,qTo,m)))
  conflicts.push('贴吧每轮候选仍受 QQ 触达时段限制。请留意 QQ 触达窗口与贴吧窗口没有重叠。')
 for(const s of schedules)if(!used.has(s.module+':'+s.id))entries.push({
  id:s.module+':'+s.id,module:s.module,label:s.label,mode:'clock-only',switchState:'unknown',checkMinutes:s.intervalMs/60_000,lastCheckAt:s.checkedAt||null,
  note:'模块声明了到期检查；没有已知的持久回执出口。'})
 entries.push({id:'chat.tools',module:'dsh',label:'聊天工具结果',mode:observing?'observed':'outside',switchState:'unknown',
  note:'监听所属聊天的工具调用和返回；异步提交不等于任务完成。'})
 return {timezone:tz,coreEnabled,entries,conflicts}
}
