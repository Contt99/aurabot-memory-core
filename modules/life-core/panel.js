const {useState,useEffect}=React
const base='/aurabot/api/ext/life-core'
const labels={succeeded:'已完成',failed:'未完成',interrupted:'已中断',simulated:'试运行',deferred:'已顺延',observed:'观察记录'}
const statusLabel=s=>({eligible:'核心门禁通过',accepted:'已受理',confirmed:'发送已确认',deferred:'已顺延',injected:'已注入',empty:'无相关素材',completed:'已完成',failed:'失败',rest:'休息',waiting:'待执行',pending:'待补入',succeeded:'已执行',running:'运行中',interrupted:'中断',cancelled:'已取消',canceled:'已取消',unknown:'结果未知',prepared:'仅准备',observed:'本轮请求可见',archived:'已归档',corrected:'已纠正',invalidated:'已失效',proposed:'口头意向，尚未启动',background:'背景材料'}[s]||s||'未知')
const purposeLabel=s=>({chat:'普通聊天',proactive:'主动联系',autonomy:'自主探索','private-diary':'私人日记','public-diary':'公开日记','public-share':'公开分享',observation:'观察材料'}[s]||s||'用途未知')
const typeLabel=s=>({message:'收到的消息',utterance:'说过',action:'做过',observation:'观察',reflection:'反思',task:'任务',commitment:'承诺',fact:'精选事实',profile:'人物关系'}[s]||s||'类型未知')
const box={padding:'18px',borderRadius:'12px',background:'var(--bg-card,rgba(128,128,128,.07))',marginBottom:'16px'}
const flow={display:'flex',gap:'12px',flexWrap:'wrap',alignItems:'center'}
const prose={whiteSpace:'pre-wrap',overflowWrap:'anywhere'}
const control={fontSize:'16px',fontFamily:'inherit',lineHeight:1.5,padding:'9px 14px',borderRadius:'8px',border:'1px solid #888',background:'transparent',color:'inherit',maxWidth:'100%',boxSizing:'border-box'}
const button=(text,onClick,extra={})=>h('button',{type:'button',onClick,...extra,style:{...control,cursor:extra.disabled?'default':'pointer',...extra.style}},text)
const bytesLabel=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?(value>=1048576?(value/1048576).toFixed(1)+' MiB':value>=1024?(value/1024).toFixed(1)+' KiB':value+' B'):'未知'
const paragraph=text=>h('p',{style:{margin:'8px 0',overflowWrap:'anywhere'}},text)
function dateLabel(value){
 if(value===null||value===undefined||value===''||value===0)return '时间未知'
 const d=new Date(value)
 return Number.isNaN(d.getTime())?'时间未知':d.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false,year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})
}
async function request(path,options){
 const response=await fetch(base+path,options)
 if(!response.ok)throw Error('HTTP '+response.status)
 const data=await response.json()
 if(data?.ok===false)throw Error(data.message||'接口返回失败')
 return data
}
function useResource(path,tick){
 const [value,setValue]=useState({data:null,error:'',loading:!!path})
 useEffect(()=>{
  let current=true
  setValue({data:null,error:'',loading:!!path})
  if(path)request(path).then(data=>{if(current)setValue({data,error:'',loading:false})}).catch(e=>{if(current)setValue({data:null,error:e.message,loading:false})})
  return()=>{current=false}
 },[path,tick])
 return value
}
function resourceMessage(resource,label){return resource.error?h('p',{role:'alert'},label+'读取失败：'+resource.error):resource.loading?paragraph('正在读取'+label+'…'):null}
function sourceLine(ids,label='来源ID'){return paragraph(label+'：'+((ids||[]).join('、')||'未提供'))}
function eventTimes(r){return h('div',null,paragraph(r.occurredAt?'发生于 '+dateLabel(r.occurredAt):'发生时间未知'),r.observedAt?paragraph('观察于 '+dateLabel(r.observedAt)):null,r.recordedAt?paragraph('记于 '+dateLabel(r.recordedAt)):null)}
function Panel(){
 const [tab,setTab]=useState('events'),[tick,setTick]=useState(0),[chatInput,setChatInput]=useState(''),[chatId,setChatId]=useState(''),[contextId,setContextId]=useState(''),[eventId,setEventId]=useState('')
 const stateResource=useResource('/state',tick),notesResource=useResource('/notes',tick),metricsResource=useResource('/telemetry',tick),memoryResource=useResource('/memory/status',tick)
 const timelineResource=useResource('/memory/timeline'+(chatId?'?chatId='+encodeURIComponent(chatId):''),tick)
 const contextResource=useResource(contextId?'/memory/context?id='+encodeURIComponent(contextId):'',tick)
 const eventResource=useResource(eventId?'/memory/event?id='+encodeURIComponent(eventId):'',tick)
 const [correction,setCorrection]=useState(null),[correctionText,setCorrectionText]=useState(''),[reason,setReason]=useState(''),[writeState,setWriteState]=useState({pending:false,error:'',success:''}),[writeLock]=useState(()=>({pending:false}))
 const state=stateResource.data,notes=notesResource.data?.items||[],metrics=metricsResource.data,memory=memoryResource.data,items=timelineResource.data?.items||[]
 const refresh=()=>setTick(t=>t+1)
 const available=(state?.capabilities||[]).filter(c=>c.available)
 const openCorrection=r=>{setCorrection(r);setCorrectionText('');setReason('');setWriteState({pending:false,error:'',success:''})}
 const closeCorrection=()=>{if(!writeLock.pending){setCorrection(null);setCorrectionText('');setReason('');setWriteState({pending:false,error:'',success:''})}}
 const submitCorrection=async e=>{
  e.preventDefault()
  if(!correction||writeLock.pending)return
  if(!correctionText.trim()){setWriteState({pending:false,error:'请填写纠正后的说法',success:''});return}
  writeLock.pending=true;setWriteState({pending:true,error:'',success:''})
  try{
   await request('/memory/correct',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:correction.id,text:correctionText.trim(),reason:reason.trim(),chatId:correction.chatId||''})})
   setCorrection(null);setCorrectionText('');setReason('');setWriteState({pending:false,error:'',target:correction.id,success:'纠错已保存。旧说法保留供核对；不会自动删除已发布内容或重发消息。'});refresh()
  }catch(e){setWriteState({pending:false,error:'纠错未保存：'+e.message,success:''})}
  finally{writeLock.pending=false}
 }
 const correctionForm=()=>correction?h('form',{onSubmit:submitCorrection,style:box},h('h3',null,'纠正一条记忆'),paragraph('目标：'+correction.id+' · '+(correction.chatId||'未指定聊天')),paragraph('原说法：'+(correction.data?.text||'此条为行动记录，请核对上方实际结果。')),paragraph('提交后记录纠错并使旧派生快照失效；不会自动删除已发布内容或重发消息。'),h('label',{style:{display:'block',marginTop:'12px'}},'纠正后的说法',h('textarea',{'aria-label':'纠正后的说法',value:correctionText,onChange:e=>setCorrectionText(e.target.value),disabled:writeState.pending,maxLength:2400,rows:4,style:{...control,width:'100%',display:'block',marginTop:'6px'}})),h('label',{style:{display:'block',marginTop:'12px'}},'理由或证据（可选）',h('textarea',{'aria-label':'纠错理由或证据',value:reason,onChange:e=>setReason(e.target.value),disabled:writeState.pending,maxLength:300,rows:2,style:{...control,width:'100%',display:'block',marginTop:'6px'}})),writeState.error?h('p',{role:'alert'},writeState.error):null,h('div',{style:{...flow,marginTop:'14px'}},h('button',{type:'submit',disabled:writeState.pending||!correctionText.trim(),style:{...control,cursor:'pointer'}},writeState.pending?'正在保存…':'提交纠错'),button('取消',closeCorrection,{disabled:writeState.pending}))):null
 const renderSource=r=>{
  const source=eventResource.data?.event?.id===r.id?eventResource.data.source:null
  return h('div',null,button(eventId===r.id?'收起原文或结果':'查看原文或结果',()=>setEventId(eventId===r.id?'':r.id),{'aria-expanded':eventId===r.id,'aria-controls':'source-'+encodeURIComponent(r.id),style:{marginTop:'12px'}}),eventId===r.id?h('div',{id:'source-'+encodeURIComponent(r.id),style:{marginTop:'12px',paddingTop:'12px',borderTop:'1px solid #8884'}},resourceMessage(eventResource,'来源正文'),source?h('div',null,h('strong',null,({vault:'聊天原文库（权威原文）',action:'行动账本（实际结果JSON）',index:'仅索引片段，原件不可用'}[source.kind]||'来源类型未知')),paragraph(source.truncated?'来源已截断，仅显示返回片段。':'接口返回未截断。'),paragraph(source.redacted?'已脱敏：敏感字段已处理。':'接口未报告脱敏。'),h('pre',{'aria-label':'来源正文',tabIndex:0,style:{...prose,fontFamily:'inherit',fontSize:'16px',maxHeight:'480px',overflow:'auto',margin:'12px 0'}},source.text||'无正文')):!eventResource.loading&&!eventResource.error?paragraph('来源正文不可用。'):null):null)
 }
 const renderEvent=r=>{
  const d=r.data||{},latest=r.corrections?.[0]
  return h('section',{key:r.id,style:box},h('div',{style:flow},h('strong',null,typeLabel(r.type)+' · '+statusLabel(r.status)),h('span',null,r.chatId||'未指定聊天')),paragraph('事件ID：'+r.id),eventTimes(r),paragraph('人物：'+(d.who||d.speaker||'未知')+(d.who&&d.speaker?'（'+d.speaker+'）':'')),d.text?h('div',{style:{...prose,margin:'12px 0'}},d.text):null,d.truncated?paragraph('此处为索引片段，非完整权威原文。'):null,d.module||d.action?paragraph('行动：'+[d.module,d.action].filter(Boolean).join(' / ')):null,d.startedAt?paragraph('开始于 '+dateLabel(d.startedAt)):null,d.finishedAt?paragraph('结束于 '+dateLabel(d.finishedAt)):null,d.result!==undefined?h('details',null,h('summary',null,'查看实际结果'),h('pre',{style:{...prose,fontFamily:'inherit',fontSize:'16px',maxHeight:'360px',overflow:'auto'}},typeof d.result==='string'?d.result:JSON.stringify(d.result,null,2))):null,paragraph('证据类型：'+(d.evidenceType||'未提供')),sourceLine(d.sourceIds),sourceLine(d.sourceScopes,'来源范围'),latest?h('div',{style:{borderLeft:'3px solid #5b9392',paddingLeft:'14px',margin:'14px 0'}},h('strong',null,'当前纠正说法'),paragraph(latest.data?.text||'正文未提供'),paragraph('理由或证据：'+(latest.data?.reason||'未填写')),sourceLine(latest.data?.sourceIds),paragraph('纠正于 '+dateLabel(latest.at)),r.corrections.length>1?h('details',null,h('summary',null,'更早的 '+(r.corrections.length-1)+' 次纠错'),...r.corrections.slice(1).map(c=>h('div',{key:c.id},paragraph(dateLabel(c.at)),paragraph(c.data?.text||'正文未提供'),paragraph(c.data?.reason||'未填写理由'),sourceLine(c.data?.sourceIds)))):null):null,writeState.success&&writeState.target===r.id?h('p',{role:'status'},writeState.success):null,correction?.id===r.id?correctionForm():button('纠正此条',()=>openCorrection(r),{disabled:writeState.pending}),renderSource(r))
 }
 const filter=h('form',{onSubmit:e=>{e.preventDefault();closeCorrection();setChatId(chatInput.trim())},style:{...flow,marginBottom:'16px'}},h('label',null,'所属聊天 ',h('input',{'aria-label':'聊天筛选',value:chatInput,onChange:e=>setChatInput(e.target.value),placeholder:'留空查看管理端最近记录',style:{...control,width:'320px'}})),h('button',{type:'submit',onClick:e=>{e.preventDefault();closeCorrection();setChatId(chatInput.trim())},style:control,disabled:writeState.pending},'应用筛选'),chatId?paragraph('当前：'+chatId):null)
 function renderContext(){
  const snapshot=contextResource.data?.snapshot,d=snapshot?.data||{}
  return h('div',null,h('section',{style:box},h('h3',null,'上下文快照'),paragraph('仅准备不代表模型已读到。请求可见表示材料进入了观察到的模型请求，不表示模型理解正确。'),paragraph('统一记忆块上限：'+(memory?.budget??'未知')+' 字符；实际 token 用量见“运行与用量”。'),resourceMessage(memoryResource,'快照清单'),...(memory?.snapshots||[]).map(s=>h('div',{key:s.id,style:{padding:'12px 0',borderBottom:'1px solid #8884',overflowWrap:'anywhere'}},h('strong',null,(s.invalidatedAt?'已失效':statusLabel(s.status))+' · '+purposeLabel(s.purpose)),paragraph((s.chatId||'未指定聊天')+' · '+dateLabel(s.createdAt)),paragraph('快照ID：'+s.id),paragraph('会话：'+(s.sessionId||'未关联')),button('查看材料',()=>setContextId(s.id),{'aria-pressed':contextId===s.id}))),memory&&!memory.snapshots?.length?paragraph('尚无上下文快照。'):null),contextId?h('section',{style:box},h('h3',null,'本轮材料详情'),paragraph('快照ID：'+contextId),resourceMessage(contextResource,'快照'),snapshot?h('div',null,paragraph('状态：'+(snapshot.invalidatedAt?'已失效':statusLabel(snapshot.status))),snapshot.status==='prepared'&&!snapshot.invalidatedAt?paragraph('尚无请求可见回执。'):null,paragraph('所属聊天：'+(snapshot.chatId||'未指定')+' · '+purposeLabel(snapshot.purpose)),paragraph('准备于 '+dateLabel(snapshot.createdAt)),snapshot.invalidatedAt?paragraph('失效于 '+dateLabel(snapshot.invalidatedAt)+'，旧正文不再显示。'):h('div',null,paragraph('准备片段：'+String(d.text||'').length+' 字符'),d.requestStatus?paragraph('模型请求结果：'+statusLabel(d.requestStatus)):null,sourceLine(d.sourceIds,'准备来源'),Array.isArray(d.observedSourceIds)?sourceLine(d.observedSourceIds,'实际进入请求'):null,h('div',{style:{...prose,maxHeight:'420px',overflow:'auto'}},d.text||'无注入正文'),h('h4',null,'采用的来源材料'),...(d.items||[]).map((i,n)=>h('div',{key:i.id||n,style:{padding:'12px 0',borderTop:'1px solid #8884'}},paragraph((i.id||'身份未知')+' · '+typeLabel(i.type)+' · '+statusLabel(i.status)),eventTimes(i),paragraph('人物：'+(i.who||i.speaker||'未知')),paragraph('证据类型：'+(i.evidenceType||'未提供')),sourceLine(i.sourceScopes,'来源范围'),h('div',{style:prose},i.text||'未提供正文'),i.reason?paragraph('采用原因：'+i.reason):null)),h('h4',null,'未采用的已授权候选'+(Array.isArray(d.omitted)?'（'+d.omitted.length+'条）':'')),Array.isArray(d.omitted)?d.omitted.length?h('div',null,...d.omitted.map((o,n)=>h('div',{key:o.id||n,style:{padding:'10px 0',borderTop:'1px solid #8884'}},paragraph('候选ID：'+(o.id||'未提供')),paragraph('未采用原因：'+(o.reason||'未提供'))))):paragraph('本快照未记录未采用候选。'):paragraph('接口未提供逐项排除原因；不能据此推断所有候选都已采用。'))):!contextResource.loading&&!contextResource.error?paragraph('快照不存在或已不可用。'):null):null)
 }
 function renderHealth(){
  const tasks=memory?.tasks||[],timelineTasks=items.filter(r=>r.type==='task'||r.type==='commitment')
  return h('div',null,
   h('section',{style:box},h('h3',null,'记忆健康'),resourceMessage(memoryResource,'记忆状态'),memory?h('div',null,
    paragraph('统一编排：'+(memory.managed?'已接管普通聊天':'未接管普通聊天，当前为降级状态')),
    paragraph('模型请求观察器：'+(memory.streamReady?'已接入':'未接入')),
    paragraph('有效事件 '+memory.events+' 条 · 待补入 '+memory.pendingHandoffs+' 条'),
    paragraph('待补入是资料衔接，不是消息重发队列。'),paragraph('每轮记忆块上限：'+memory.budget+' 字符'),
    memory.lastError?h('p',{role:'alert'},'最近记录错误：'+memory.lastError):paragraph('最近记录错误：接口未报告错误'),
    h('h4',null,'来源接口就绪状态'),memory.providers?h('div',null,...[['vault','聊天原文库'],['memory','精选记忆'],['impression','人物关系'],['image','图片理解']].map(([key,label])=>paragraph(label+'：'+(memory.providers[key]?'已就绪':'未就绪')))):paragraph('接口未提供来源就绪状态。'),
    h('h4',null,'存储'),memory.storage?h('div',null,paragraph('行动库：'+bytesLabel(memory.storage.lifeBytes)+' · WAL：'+bytesLabel(memory.storage.walBytes)),paragraph('可用磁盘空间：'+bytesLabel(memory.storage.freeBytes)),memory.storage.lowSpace?h('p',{role:'alert'},'服务器磁盘空间不足，请扩容或清理无关文件；不会自动删除历史原文。'):null):paragraph('存储占用：当前接口未提供。')):null,
    paragraph('入口覆盖清单：当前接口未提供，不能据此判断每个后台入口均已接入。'),paragraph('最近写入成功时间：当前接口未提供。')),
   h('section',{style:box},h('h3',null,'承诺与任务'),paragraph('口头承诺不等于工具已启动；下方按实际持久请求或已确认表达显示状态。'),
    ...tasks.map(t=>h('div',{key:t.id,style:{padding:'12px 0',borderBottom:'1px solid #8884'}},h('strong',null,statusLabel(t.status)),paragraph(t.goal||'未提供任务目标'),t.message?paragraph(t.message):null,paragraph('任务ID：'+t.id+' · '+(t.chatId||'未指定聊天')),paragraph('记于 '+dateLabel(t.at)),t.dueAt?paragraph('计划时间：'+dateLabel(t.dueAt)):null,t.updatedAt?paragraph('更新于 '+dateLabel(t.updatedAt)):null)),
    !tasks.length?paragraph('接口未返回当前任务 / 承诺记录；不代表没有未完成事项。'):null,
    timelineTasks.length?h('div',null,h('h4',null,'时间线中的任务记录'),...timelineTasks.map(renderEvent)):null),
   h('section',{style:box},h('h3',null,'最近纠错'),...(memory?.corrections||[]).map(c=>paragraph(c.targetId+' · '+dateLabel(c.at))),memory&&!memory.corrections?.length?paragraph('尚无纠错记录。'):null))
 }
 function renderMetrics(){return metrics?h('div',null,
  h('section',{style:box},h('h3',null,'模型调用与输入缓存'),paragraph('统计起点：'+dateLabel(metrics.since)+'。包括聊天、主动回合及直接后台调用，不追溯旧记录。'),paragraph(`调用 ${metrics.calls} 次 · 无用量回执 ${metrics.withoutUsage} 次`),paragraph(`非缓存输入 ${metrics.input} · 读取缓存 ${metrics.cachedInput} · 写入缓存 ${metrics.cacheWrite} · 完整输入 ${metrics.fullInput} · 输出 ${metrics.output}`),paragraph('完整输入包含历史，不等于本轮注入量；无用量回执的请求不按零消耗计算。'),!metrics.streamHook?h('p',{role:'alert'},'全局模型观察器未接入'):null,metrics.lastError?h('p',{role:'alert'},metrics.lastError):null),
  h('section',{style:box},h('h3',null,'最近模型请求'),...(metrics.recent||[]).map(r=>h('div',{key:r.id,style:{padding:'8px 0',borderBottom:'1px solid #8884',overflowWrap:'anywhere'}},dateLabel(r.at)+' · '+r.scope+' · '+r.provider+'/'+r.model+' · '+r.status+(r.usage?' · '+JSON.stringify(r.usage):' · 用量未知')))),
  h('section',{style:box},h('h3',null,'资格、尝试与实际结果'),paragraph('核心门禁通过仅表示未被统一规则拦截；模块仍会检查自身时段和到期时间，不代表已调用模型或执行工具。'),...(metrics.decisions||[]).map((r,i)=>h('div',{key:i,style:{padding:'9px 0',borderBottom:'1px solid #8884'}},h('strong',null,({gate:'资格检查',attempt:'主动尝试',execution:'执行结果',sent:'发送确认',recall:'经历召回',task:'探索任务',context:'上下文',validation:'一致性校验'}[r.stage]||r.stage)+' · '+statusLabel(r.status)),paragraph(dateLabel(r.at)+' · '+(r.source||'')+' '+(r.target||'')),r.reason?paragraph(r.reason):null,r.stage==='recall'?paragraph(`经历 ${r.items} 条 · 额外 ${r.chars} 字符`):r.stage==='context'&&r.chars!==undefined?paragraph(`材料 ${r.items??'未知'} 条 · 记忆块 ${r.chars} 字符`):null)))):h('div',{style:box},resourceMessage(metricsResource,'统计')||'统计暂不可用')}
 let content
 if(tab==='events')content=h('div',null,resourceMessage(stateResource,'经历'),state?(state.recent||[]).length?state.recent.map(r=>h('section',{key:r.id,style:box},h('div',{style:{...flow,justifyContent:'space-between'}},h('strong',null,labels[r.status]||r.status),h('time',null,dateLabel(r.at))),h('div',{style:{...prose,marginTop:'9px',maxHeight:'240px',overflow:'auto'}},r.text),paragraph(r.evidenceType+' · '+((r.sourceScopes||[]).join('、')||'自身公开经历')))):h('div',{style:box},'还没有经历。真实工具调用和后台行动会在这里出现。'):null)
 else if(tab==='notes')content=h('div',null,resourceMessage(notesResource,'探索笔记'),notes.length?notes.map(n=>h('section',{key:n.id,style:box},h('h3',{style:{margin:'0 0 10px'}},n.title),h('div',{style:prose},n.text),paragraph(dateLabel(n.at)+' · '+(n.sourceIds||[]).length+' 条来源'))):notesResource.data?h('div',{style:box},'还没有探索笔记。'):null)
 else if(tab==='metrics')content=renderMetrics()
 else if(tab==='timeline')content=h('div',null,filter,paragraph('管理端最近最多100条。可逐条展开原文或实际结果；原件不可用时仅显示索引片段。'),resourceMessage(timelineResource,'记忆时间线'),writeState.success&&!items.some(r=>r.id===writeState.target)?h('p',{role:'status'},writeState.success):null,...items.map(renderEvent),timelineResource.data&&!items.length?h('div',{style:box},'当前筛选下没有记忆事件。'):null)
 else if(tab==='context')content=renderContext()
 else content=renderHealth()
 return h('div',{style:{maxWidth:'1100px',margin:'0 auto',fontSize:'16px',lineHeight:1.65,overflowWrap:'anywhere'}},
  h('div',{style:box},h('h2',{style:{margin:'0 0 8px'}},'行动与记忆'),paragraph('时间均为北京时间（Asia/Shanghai）。'),state?paragraph(available.length+' 项能力可用 · '+(state.observer?'聊天工具记录已接入':'聊天工具记录未接入')):resourceMessage(stateResource,'能力状态'),h('div',{style:flow},...available.map(c=>h('span',{key:c.id,style:{padding:'3px 10px',borderRadius:'18px',background:'rgba(70,130,150,.12)'}},c.id)))),
  h('nav',{'aria-label':'行动与记忆页面',style:{...flow,marginBottom:'18px'}},...[['events','最近经历'],['timeline','记忆时间线'],['context','上下文诊断'],['health','任务与健康'],['notes','探索笔记'],['metrics','运行与用量']].map(([id,label])=>button(label,()=>setTab(id),{'aria-pressed':tab===id,style:{border:tab===id?'2px solid #5b9392':'1px solid #aaa'}})),button('刷新',refresh)),content)
}
return Panel
