const {useState,useEffect}=React
const base='/aurabot/api/ext/life-core'
const labels={succeeded:'已完成',failed:'未完成',interrupted:'已中断',simulated:'试运行',deferred:'已顺延',observed:'观察记录'}
const recallLabel=mode=>({hybrid:'语义与关键词混合检索',lexical:'关键词检索'}[mode]||mode)
const recallReason=reason=>({'no-query':'本轮没有可检索的文字','forget-command':'忘记请求不做语义查询','vector-disabled':'未开启向量检索','trigger-required':'未匹配回忆触发词','no-index':'没有符合范围的已索引事实','embedding-unavailable':'向量服务失败或超时','source-changed':'检索时来源或授权已变化','no-eligible-hit':'没有采用语义候选','provider-failed':'精选记忆接口调用失败','provider-unavailable':'精选记忆未提供语义接口'}[reason]||reason)
const statusLabel=s=>({eligible:'核心门禁通过',accepted:'已受理',confirmed:'发送已确认',deferred:'已顺延',injected:'已注入',empty:'无相关素材',completed:'已完成',failed:'失败',rest:'休息',waiting:'待执行',pending:'待补入',succeeded:'已执行',running:'运行中',interrupted:'中断',cancelled:'已取消',canceled:'已取消',unknown:'结果未知',prepared:'仅准备',observed:'本轮请求可见',archived:'已归档',corrected:'已纠正',invalidated:'已失效',proposed:'口头意向，尚未启动',background:'背景材料'}[s]||s||'未知')
const purposeLabel=s=>({chat:'普通聊天',proactive:'主动联系',autonomy:'自主探索','private-diary':'私人日记','public-diary':'公开日记','public-share':'公开分享',observation:'观察材料'}[s]||s||'用途未知')
const typeLabel=s=>({message:'收到的消息',utterance:'说过',action:'行动',observation:'观察',reflection:'反思',task:'任务',commitment:'承诺',fact:'精选事实',profile:'人物关系',media:'图片身份'}[s]||s||'类型未知')
const capabilityLabel=id=>({web_search:'搜索网页',web_fetch:'读取网页',bili_browse:'逛 B 站',bili_watch:'读取 B 站视频',tieba_search:'搜索贴吧',tieba_browse:'浏览贴吧',tieba_read:'阅读贴吧正文',save_note:'保存笔记'}[id]||id)
const evidenceLabel=id=>({'platform-read':'平台读取','thread-body':'帖子正文','video-metadata':'视频资料','web-body':'网页正文','search-summary':'搜索摘要','confirmed-speech':'已发送原话','qq-ack':'QQ 回执',provider:'模块结果',note:'笔记',tool:'工具结果','tool-result':'工具结果'}[id]||id)
const candidateTarget=c=>c.target?.startsWith('qzone-post:')?'space-social':c.target?.startsWith('qzone:')?'space':c.target==='server:private-journal'?'journal':'qq'
const candidateName=c=>({space:'空间日记',journal:'私人日记','space-social':({'like':'空间点赞',comment:'空间评论',reply:'空间回复'}[c.job]||'空间互动')}[candidateTarget(c)]||
 ({'tieba-reader/share':'贴吧分享','purpose/contact':'主动搭话','purpose/nudge':'主动追问',
  'speakup/contact':'旧主动搭话','speakup/nudge':'旧主动搭话 · 追问','speakup/autonomy':'自主生活 · 想聊几句',
  'night/wake-greeting':'自然醒后问候'}[c.module+'/'+c.job]||c.module+' / '+c.job))
const candidateLabel=c=>{
 const d=candidateTarget(c)
 if(c.status==='saved')return c.reason==='forgotten'?'日记已忘记':'已保存到服务器'
 if(c.status==='sent')return d==='space'?'发布已确认':d==='space-social'?'平台已确认':'发送已确认'
 if(c.status==='sending')return ({space:'等待说说编号','space-social':'等待空间网关',journal:'保存中',qq:'等待 QQ 回执'})[d]
 if(c.status==='not-sent')return ({space:'未发布','space-social':'未提交成功',journal:'未保存',qq:'未发送'})[d]
 return ({queued:'等待调度',expired:'已过期',skipped:'主动跳过'}[c.status]||statusLabel(c.status))
}
const candidateDetail=c=>{
 const d=candidateTarget(c),r=c.reason
 if(d==='space-social'){
  if(c.receipt)return c.job==='like'?'网关确认（点赞没有单独编号）':'评论编号 '+c.receipt
  if(r==='missing-receipt')return '未取得可核对的空间结果，不自动重发'
  if(r==='provider-rejected')return '平台明确拒绝'
 }
 if(c.receipt)return ({space:'说说编号 ',journal:'本地记录 ',qq:'QQ 回执 '})[d]+c.receipt
 if(r==='missing-receipt')return ({space:'没有说说编号，不自动重发',journal:'未确认文件写入，不自动重试',qq:'没有 QQ 成功回执，不自动重发'})[d]
 return ({restarted:'处理时服务重启，不自动重试','source-or-permission':'来源或执行资格已变化','draft-rejected':'未取得通过检查的正文','draft-failed':'未取得可用草稿','write-failed':'文件未保存','no-interest':'本次没有选择分享',expired:'超过候选有效期',forgotten:'来源已忘记'}[r]||r)
}
const box={padding:'clamp(14px, 2.6vw, 24px)',border:'1px solid var(--lc-line)',borderRadius:'12px',background:'var(--lc-surface)',marginBottom:'14px',minWidth:0}
const flow={display:'flex',gap:'12px',flexWrap:'wrap',alignItems:'center'}
const prose={whiteSpace:'pre-wrap',overflowWrap:'anywhere'}
const control={fontSize:'inherit',fontFamily:'inherit',lineHeight:1.5,minHeight:'42px',padding:'8px 13px',borderRadius:'8px',border:'1px solid var(--lc-line)',background:'transparent',color:'inherit',maxWidth:'100%',boxSizing:'border-box'}
const button=(text,onClick,extra={})=>h('button',{type:'button',onClick,...extra,style:{...control,cursor:extra.disabled?'default':'pointer',...extra.style}},text)
const bytesLabel=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?(value>=1048576?(value/1048576).toFixed(1)+' MiB':value>=1024?(value/1024).toFixed(1)+' KiB':value+' B'):'未知'
const paragraph=text=>h('p',{style:{margin:'8px 0',overflowWrap:'anywhere'}},text)
const panelCss=`
.lc-panel{--lc-accent:var(--accent,#0b766d);--lc-line:color-mix(in srgb,currentColor 18%,transparent);--lc-surface:var(--bg-card,color-mix(in srgb,currentColor 3%,transparent));--lc-soft:color-mix(in srgb,currentColor 5%,transparent);--lc-brand:color-mix(in srgb,var(--lc-accent) 15%,transparent);max-width:1100px;margin:0 auto;font-size:15px;line-height:1.6;overflow-wrap:anywhere;color:inherit}
.lc-panel h2,.lc-panel h3,.lc-panel h4,.lc-panel p{margin:0}
.lc-panel h2{font-size:clamp(26px,4vw,40px);line-height:1.16;letter-spacing:-.035em;font-weight:720}
.lc-panel h3{font-size:19px;line-height:1.4}.lc-panel h4{font-size:15px}
.lc-panel button:hover:not(:disabled){background:var(--lc-soft)!important}
.lc-panel :is(button,input,textarea,summary):focus-visible{outline:2px solid currentColor;outline-offset:3px}
.lc-panel :is(button,input,textarea,summary){scroll-margin:16px}
.lc-panel button:disabled{opacity:.55;cursor:default!important}
.lc-panel summary{cursor:pointer;min-height:34px;padding:4px 0;font-weight:600}
.lc-panel .lc-hero{padding:clamp(16px,3vw,27px) 0 18px;border-bottom:1px solid var(--lc-line)}
.lc-panel .lc-hero-meta{margin-top:9px;font-size:14px;opacity:.80}
.lc-panel .lc-nav{display:flex;gap:5px;flex-wrap:wrap;margin:14px 0 22px;align-items:center}
.lc-panel .lc-nav button{border-color:transparent!important}
.lc-panel .lc-nav button[aria-current=page]{background:var(--lc-brand)!important;font-weight:700;border-color:var(--lc-line)!important}
.lc-panel .lc-grid{display:grid;grid-template-columns:minmax(0, .84fr) minmax(0,1.16fr);gap:14px;align-items:start}
.lc-panel .lc-list{list-style:none;margin:10px 0 0;padding:0}
.lc-panel .lc-list>li{padding:12px 0;border-top:1px solid var(--lc-line)}
.lc-panel .lc-list>li:first-child{border-top:0}
.lc-panel .lc-meta{font-size:13px;opacity:.82}
.lc-panel .lc-meta,.lc-panel time{font-variant-numeric:tabular-nums}
.lc-panel .lc-pill{padding:2px 8px;border:1px solid var(--lc-line);background:var(--lc-soft);border-radius:8px;font-size:13px;font-weight:650}
.lc-panel .lc-pill[data-tone=live]{background:var(--lc-brand)}
.lc-panel .lc-alert{border:1px solid var(--lc-line);border-inline-start:4px solid #c77b25;padding:10px 13px;border-radius:7px;margin:0 0 14px;background:var(--lc-soft)}
.lc-panel .lc-inset{border-inline-start:2px solid var(--lc-line);padding:10px 0 6px clamp(10px,2vw,18px);margin-top:10px}
.lc-panel .lc-fine{margin:10px 0;border-top:1px solid var(--lc-line);padding-top:4px}
.lc-panel .lc-clip{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;white-space:pre-wrap}
.lc-panel .lc-empty{color:inherit;opacity:.79;padding:13px 0}
.lc-panel .lc-toolbar{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
@media(max-width:720px){.lc-panel .lc-grid{grid-template-columns:minmax(0,1fr)}.lc-panel .lc-nav button{padding-inline:9px}.lc-panel .lc-hero-meta{display:block;width:100%}}
`
const pill=(value,tone)=>h('span',{className:'lc-pill','data-tone':tone},value)
const meta=text=>h('p',{className:'lc-meta'},text)
const empty=text=>h('p',{className:'lc-empty'},text)
const fine=(label,...children)=>h('details',{className:'lc-fine'},h('summary',null,label),...children)
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
 const [value,setValue]=useState(null)
 useEffect(()=>{
  let current=true
  if(path)request(path).then(data=>{if(current)setValue({path,tick,data,error:'',loading:false})}).catch(e=>{if(current)setValue({path,tick,data:null,error:e.message,loading:false})})
  return()=>{current=false}
 },[path,tick])
 return path&&value?.path===path&&value.tick===tick ? value : {data:null,error:'',loading:!!path}
}
function resourceMessage(resource,label){return resource.error?h('p',{role:'alert'},label+'读取失败：'+resource.error):resource.loading?paragraph('正在读取'+label+'…'):null}
function sourceLine(ids,label='来源ID'){return paragraph(label+'：'+((ids||[]).join('、')||'未提供'))}
function eventTimes(r){return h('div',null,paragraph(r.occurredAt?'发生于 '+dateLabel(r.occurredAt):'发生时间未知'),r.observedAt?paragraph('观察于 '+dateLabel(r.observedAt)):null,r.recordedAt?paragraph('记于 '+dateLabel(r.recordedAt)):null)}
function Panel(){
 const [tab,setTab]=useState('events'),[tick,setTick]=useState(0),[chatInput,setChatInput]=useState(''),[chatId,setChatId]=useState(''),[contextId,setContextId]=useState(''),[eventId,setEventId]=useState('')
 const stateResource=useResource('/state',tick),notesResource=useResource(tab==='notes'?'/notes':'',tick),metricsResource=useResource(tab==='metrics'?'/telemetry':'',tick),memoryResource=useResource('/memory/status',tick)
 const timelineResource=useResource(['timeline','health'].includes(tab)?'/memory/timeline'+(chatId?'?chatId='+encodeURIComponent(chatId):''):'',tick)
 const contextResource=useResource(tab==='context'&&contextId?'/memory/context?id='+encodeURIComponent(contextId):'',tick)
 const candidateResource=useResource(tab==='health'?'/candidates':'',tick)
 const eventResource=useResource(['timeline','health'].includes(tab)&&eventId?'/memory/event?id='+encodeURIComponent(eventId):'',tick)
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
  const when=r.occurredAt||r.observedAt||r.recordedAt
  return h('section',{key:r.id,'data-event-id':r.id,style:box},
   h('div',{className:'lc-toolbar'},h('div',{style:flow},h('strong',null,typeLabel(r.type)),pill(statusLabel(r.status),r.status==='running'?'live':undefined)),h('time',{className:'lc-meta'},dateLabel(when))),
   meta([r.chatId||'未指定聊天',d.who||d.speaker,[d.module,d.action].filter(Boolean).join(' / ')].filter(Boolean).join(' · ')),
   d.text?h('div',{className:'lc-clip',style:{margin:'10px 0'}},d.text):null,
   latest?h('div',{className:'lc-inset'},h('strong',null,'当前纠正说法'),paragraph(latest.data?.text||'正文未提供')):null,
   fine('来源与记录详情',paragraph('事件ID：'+r.id),eventTimes(r),paragraph('人物：'+(d.who||d.speaker||'未知')+(d.who&&d.speaker?'（'+d.speaker+'）':'')),
    d.truncated?paragraph('此处为索引片段，非完整权威原文。'):null,
    d.startedAt?paragraph('开始于 '+dateLabel(d.startedAt)):null,d.finishedAt?paragraph('结束于 '+dateLabel(d.finishedAt)):null,
    paragraph('证据类型：'+(d.evidenceType||'未提供')),sourceLine(d.sourceIds),sourceLine(d.sourceScopes,'来源范围'),
    d.result!==undefined?fine('查看实际结果',h('pre',{style:{...prose,maxHeight:'360px',overflow:'auto'}},typeof d.result==='string'?d.result:JSON.stringify(d.result,null,2))):null,
    latest?h('div',null,paragraph('理由或证据：'+(latest.data?.reason||'未填写')),sourceLine(latest.data?.sourceIds),paragraph('纠正于 '+dateLabel(latest.at)),
     r.corrections.length>1?fine('更早的 '+(r.corrections.length-1)+' 次纠错',...r.corrections.slice(1).map(c=>h('div',{key:c.id},paragraph(dateLabel(c.at)),paragraph(c.data?.text||'正文未提供'),paragraph(c.data?.reason||'未填写理由'),sourceLine(c.data?.sourceIds)))):null):null),
   writeState.success&&writeState.target===r.id?h('p',{role:'status'},writeState.success):null,
   correction?.id===r.id?correctionForm():button('纠正此条',()=>openCorrection(r),{disabled:writeState.pending}),renderSource(r))
 }
 const applyFilter=e=>{e.preventDefault();if(writeLock.pending)return;closeCorrection();setEventId('');setChatId(chatInput.trim())}
 const filter=h('form',{onSubmit:applyFilter,style:{...flow,marginBottom:'14px'}},h('label',null,'所属聊天 ',h('input',{'aria-label':'聊天筛选',value:chatInput,onChange:e=>setChatInput(e.target.value),placeholder:'例如 private:123 或 group:456',style:{...control,width:'min(320px, 72vw)'}})),h('button',{type:'submit',onClick:applyFilter,style:control,disabled:writeState.pending},'应用筛选'),chatId?button('清除筛选',()=>{closeCorrection();setEventId('');setChatInput('');setChatId('')},{disabled:writeState.pending}):null)
 function renderContext(){
  const snapshot=contextResource.data?.snapshot,d=snapshot?.data||{}
  const entered=Array.isArray(d.observedSourceIds)?new Set(d.observedSourceIds):null
  const included=d.items||[],observed=entered?included.filter(i=>entered.has(i.id)):[],remaining=entered?included.filter(i=>!entered.has(i.id)):included
  const rows=material=>material.map((i,n)=>h('li',{key:i.id||n},h('strong',null,typeLabel(i.type)+' · '+statusLabel(i.status)),h('div',{style:prose},i.text||'未提供正文'),
   meta([i.who||i.speaker||'人物未知',i.evidenceType||'证据类型未提供'].join(' · ')),
   fine('时间与来源',sourceLine(i.id?[i.id]:[]),eventTimes(i),sourceLine(i.sourceScopes,'来源范围'),i.reason?paragraph('采用原因：'+i.reason):null)))
  const detail=s=>h('section',{id:'context-'+encodeURIComponent(s.id),className:'lc-inset'},
   resourceMessage(contextResource,'本轮材料'),
   snapshot?.id===s.id?h('div',null,
    h('h4',null,'本轮材料详情'),
    paragraph('状态：'+(snapshot.invalidatedAt||snapshot.status==='invalidated'?'已失效':statusLabel(snapshot.status))),
    snapshot.invalidatedAt||snapshot.status==='invalidated'?paragraph('旧正文不再显示。'):h('div',null,
     snapshot.status==='prepared'?paragraph('尚无请求可见回执。'):null,
     d.requestStatus?paragraph('模型请求结果：'+statusLabel(d.requestStatus)):null,
     d.memoryRecall?paragraph('精选事实回忆：'+recallLabel(d.memoryRecall.mode)+(d.memoryRecall.reason?' · '+recallReason(d.memoryRecall.reason):'')):null,
     entered?sourceLine(d.observedSourceIds,'实际进入请求'):null,
     observed.length?h('ul',{className:'lc-list'},...rows(observed)):null,
     remaining.length?fine(entered?'仅准备、未进入请求':snapshot.status==='prepared'?'仅准备的材料':'已准备材料 · 无逐项请求回执',h('ul',{className:'lc-list'},...rows(remaining))):null,
     fine('查看准备的上下文原文',sourceLine(d.sourceIds,'准备来源'),h('div',{style:{...prose,maxHeight:'420px',overflow:'auto'},tabIndex:0},d.text||'无注入正文')),
     fine('未采用的已授权候选'+(Array.isArray(d.omitted)?'（'+d.omitted.length+'条）':''),
      Array.isArray(d.omitted)?d.omitted.length?h('ul',{className:'lc-list'},...d.omitted.map((o,n)=>h('li',{key:(o.id||'')+':'+n},meta(o.id||'候选ID未提供'),paragraph(o.reason||'未采用原因未提供')))):paragraph('本快照未记录未采用候选。'):paragraph('接口未提供逐项排除原因。')),
     fine('快照与会话信息',paragraph('快照ID：'+s.id),paragraph('会话：'+(s.sessionId||'未关联')),paragraph('准备于 '+dateLabel(snapshot.createdAt)),
      paragraph('准备片段：'+String(d.text||'').length+' 字符')))):
   !contextResource.loading&&!contextResource.error?empty('快照不存在或已不可用。'):null)
  return h('section',{style:box},h('h3',null,'上下文快照'),
   paragraph('区分模型请求实际带上的材料与仅准备的材料。统一记忆块上限：'+(memory?.budget??'未知')+' 字符。'),
   resourceMessage(memoryResource,'快照清单'),
   h('ul',{className:'lc-list'},...(memory?.snapshots||[]).map(s=>h('li',{key:s.id},
    h('div',{className:'lc-toolbar'},h('div',null,h('div',{style:flow},h('strong',null,purposeLabel(s.purpose)),pill(s.invalidatedAt?'已失效':statusLabel(s.status))),
     meta((s.chatId||'未指定聊天')+' · '+dateLabel(s.createdAt))),
     button(contextId===s.id?'收起材料':'查看材料',()=>setContextId(contextId===s.id?'':s.id),{'aria-expanded':contextId===s.id,'aria-controls':'context-'+encodeURIComponent(s.id)})),
    contextId===s.id?detail(s):null))),
   memory&&!memory.snapshots?.length?empty('尚无上下文快照。'):null)
 }


 function renderHealth(){
  const tasks=memory?.tasks||[],timelineTasks=items.filter(r=>r.type==='task'||r.type==='commitment')
  const candidates=candidateResource.data?.items
  const coverage=state?.coverage
  const coverageLabels={managed:'统一调度与回执','clock-only':'只接管到期检查',observed:'只观测结果',outside:'仍走原入口','not-loaded':'未加载'}
  const coverageRows=rows=>h('ul',{className:'lc-list'},...rows.map(r=>h('li',{key:r.id},
   h('div',{style:flow},h('strong',null,r.label),pill(coverageLabels[r.mode]||'未识别')),
   meta([r.switchState==='off'?'设置关闭':'',r.window,r.checkMinutes?'每 '+r.checkMinutes+' 分钟检查':'',r.lastCheckAt?'上次检查 '+dateLabel(r.lastCheckAt):''].filter(Boolean).join(' · ')),
   r.note?paragraph(r.note):null)))
  return h('div',null,
   h('section',{style:box},h('h3',null,'后台行动回执'),paragraph('这里只显示经持久队列处理的行动。看回执可确认实际发布、发送或服务器保存。'),
    resourceMessage(candidateResource,'后台回执'),
    candidates?.length?h('ul',{className:'lc-list'},...candidates.map(c=>h('li',{key:c.id},
     h('div',{style:flow},h('strong',null,candidateName(c)),pill(candidateLabel(c),c.status==='sent'||c.status==='saved'&&c.receipt?'live':undefined)),
     meta([dateLabel(c.updatedAt),candidateDetail(c)||(c.status==='queued'?'有效至 '+dateLabel(c.expiresAt):'')].filter(Boolean).join(' · ')),
     fine('查看行动来源',paragraph('目标：'+c.target),paragraph('候选ID：'+c.id),sourceLine(c.sourceIds,'关联经历'))))):candidates?empty('还没有通过核心排队的后台行动。'):null),
   coverage?h('section',{style:box},h('h3',null,'入口覆盖与时段'),
    paragraph('按当前宿主加载的接口判断；开关、时段及检查频率不代表动作会执行。时段：'+coverage.timezone+'（贴吧使用北京时间）。'),
    coverage.coreEnabled===false?h('p',{role:'alert'},'行动核心当前关闭；已接入的入口不执行。'):null,
    coverage.conflicts?.length?h('ul',{className:'lc-list'},...coverage.conflicts.map(s=>h('li',{key:s},s))):null,
    ...['managed','clock-only','observed','outside','not-loaded'].flatMap(mode=>{
     const rows=coverage.entries.filter(r=>r.mode===mode)
     return rows.length?[fine(coverageLabels[mode]+'（'+rows.length+'）',coverageRows(rows))]:[]
    })):null,
   h('section',{style:box},h('h3',null,'记忆健康'),resourceMessage(memoryResource,'记忆状态'),memory?h('div',null,
    paragraph('统一编排：'+(memory.managed?'已接管普通聊天':'未接管普通聊天，当前为降级状态')),
    paragraph('模型请求观察器：'+(memory.streamReady?'已接入':'未接入')),
    paragraph('有效事件 '+memory.events+' 条 · 待补入 '+memory.pendingHandoffs+' 条'),
    paragraph('待补入是资料衔接，不是消息重发队列。'),paragraph('每轮记忆块上限：'+memory.budget+' 字符'),
    memory.lastError?h('p',{role:'alert'},'最近记录错误：'+memory.lastError):paragraph('最近记录错误：接口未报告错误'),
    h('h4',null,'来源接口就绪状态'),memory.providers?h('div',null,...[['vault','聊天原文库'],['memory','精选记忆'],['impression','人物关系'],['image','图片理解']].map(([key,label])=>paragraph(label+'：'+(memory.providers[key]?'已就绪':'未就绪')))):paragraph('接口未提供来源就绪状态。'),
    h('h4',null,'存储'),memory.storage?h('div',null,paragraph('行动库：'+bytesLabel(memory.storage.lifeBytes)+' · WAL：'+bytesLabel(memory.storage.walBytes)),paragraph('可用磁盘空间：'+bytesLabel(memory.storage.freeBytes)),memory.storage.lowSpace?h('p',{role:'alert'},'服务器磁盘空间不足，请扩容或清理无关文件；不会自动删除历史原文。'):null):paragraph('存储占用：当前接口未提供。')):null,
    state?.schedules?.length?fine('统一调度已登记的到期检查（'+state.schedules.length+'项）',
     paragraph('到期检查不等于工具已执行；实际结果见最近经历。'),
     h('ul',{className:'lc-list'},...state.schedules.map(s=>h('li',{key:s.module+':'+s.id},h('strong',null,s.label),meta(({waiting:'待首次检查',checking:'检查中',checked:'已检查','check-failed':'检查失败'}[s.status]||'状态未知')+(s.checkedAt?' · '+dateLabel(s.checkedAt):'')))))):null,
    !coverage?paragraph('入口覆盖清单：当前接口未提供，不能据此判断每个后台入口均已接入。'):null),
   h('section',{style:box},h('h3',null,'承诺与任务'),paragraph('口头承诺不等于工具已启动；下方按实际持久请求或已确认表达显示状态。'),
    ...tasks.map(t=>h('div',{key:t.id,style:{padding:'12px 0',borderBottom:'1px solid #8884'}},h('strong',null,statusLabel(t.status)),paragraph(t.goal||'未提供任务目标'),t.message?paragraph(t.message):null,paragraph('任务ID：'+t.id+' · '+(t.chatId||'未指定聊天')),paragraph('记于 '+dateLabel(t.at)),t.dueAt?paragraph('计划时间：'+dateLabel(t.dueAt)):null,t.updatedAt?paragraph('更新于 '+dateLabel(t.updatedAt)):null)),
    !tasks.length?paragraph('接口未返回当前任务 / 承诺记录；不代表没有未完成事项。'):null,
    timelineTasks.length?h('div',null,h('h4',null,'时间线中的任务记录'),...timelineTasks.map(renderEvent)):null),
   h('section',{style:box},h('h3',null,'最近纠错'),...(memory?.corrections||[]).map(c=>paragraph(c.targetId+' · '+dateLabel(c.at))),memory&&!memory.corrections?.length?paragraph('尚无纠错记录。'):null))
 }
 function renderMetrics(){return metrics?h('div',null,
  h('section',{style:box},h('h3',null,'模型调用与输入缓存'),paragraph('统计起点：'+dateLabel(metrics.since)+'。包括聊天、主动回合及直接后台调用，不追溯旧记录。'),paragraph(`调用 ${metrics.calls} 次 · 无用量回执 ${metrics.withoutUsage} 次`),paragraph(`非缓存输入 ${metrics.input} · 读取缓存 ${metrics.cachedInput} · 写入缓存 ${metrics.cacheWrite} · 完整输入 ${metrics.fullInput} · 输出 ${metrics.output}`),paragraph('完整输入包含历史，不等于本轮注入量；无用量回执的请求不按零消耗计算。'),!metrics.streamHook?h('p',{role:'alert'},'全局模型观察器未接入'):null,metrics.lastError?h('p',{role:'alert'},metrics.lastError):null),
  h('section',{style:box},h('h3',null,'最近模型请求'),...(metrics.recent||[]).map(r=>h('div',{key:r.id,style:{padding:'8px 0',borderBottom:'1px solid #8884',overflowWrap:'anywhere'}},dateLabel(r.at)+' · '+r.scope+' · '+r.provider+'/'+r.model+' · '+r.status+(r.usage?' · '+JSON.stringify(r.usage):' · 用量未知')))),
  h('section',{style:box},h('h3',null,'资格、尝试与实际结果'),paragraph('核心门禁通过仅表示未被统一规则拦截；模块仍会检查自身时段和到期时间，不代表已调用模型或执行工具。'),...(metrics.decisions||[]).map((r,i)=>h('div',{key:i,style:{padding:'9px 0',borderBottom:'1px solid #8884'}},h('strong',null,({gate:'资格检查',attempt:'主动尝试',execution:'执行结果',sent:'发送确认',recall:'经历召回','memory-recall':'精选事实回忆',task:'探索任务',context:'上下文',validation:'一致性校验'}[r.stage]||r.stage)+' · '+(r.stage==='memory-recall'?recallLabel(r.status):statusLabel(r.status))),paragraph(dateLabel(r.at)+' · '+(r.source||'')+' '+(r.target||'')),r.reason?paragraph(r.stage==='memory-recall'?recallReason(r.reason):r.reason):null,r.stage==='recall'?paragraph(`经历 ${r.items} 条 · 额外 ${r.chars} 字符`):r.stage==='context'&&r.chars!==undefined?paragraph(`材料 ${r.items??'未知'} 条 · 记忆块 ${r.chars} 字符`):null)))):h('div',{style:box},resourceMessage(metricsResource,'统计')||'统计暂不可用')}
 const navigate=next=>{if(next!==tab){setTab(next);setEventId('');setContextId('')}}
 const overview=()=>{
  const recent=state?.recent||[]
  const current=(memory?.tasks||[]).filter(r=>['running','accepted','waiting','planned','queued','pending','proposed','starting'].includes(r.status||r.state)).slice(0,4)
  const warnings=[state?.observer===false?'聊天工具记录未接入':'',memory?.managed===false?'统一记忆未接管普通聊天':'',memory?.streamReady===false?'模型请求观察器未就绪':'',memory?.storage?.lowSpace?'服务器磁盘空间不足':'',memory?.lastError].filter(Boolean)
  return h('div',null,warnings.length?h('div',{className:'lc-alert',role:'alert'},h('strong',null,'需要留意'),h('ul',null,...warnings.map(w=>h('li',{key:w},w)))):null,
   h('div',{className:'lc-grid'},
    h('section',{style:box},h('div',{className:'lc-toolbar'},h('h3',null,'当前任务'),button('看任务详情',()=>navigate('health'))),
     resourceMessage(memoryResource,'任务状态'),
     current.length?h('ul',{className:'lc-list'},...current.map(t=>h('li',{key:t.id},pill(statusLabel(t.status||t.state),(t.status||t.state)==='running'?'live':undefined),
      paragraph(t.goal||'未提供任务目标'),t.dueAt?meta('计划 '+dateLabel(t.dueAt)):null))):memory?empty('没有返回正在进行或等待的任务。'):null,
     memory?h('div',{className:'lc-fine'},meta('持久事件 '+(memory.events??'未知')+' 条 · 待补入 '+(memory.pendingHandoffs??'未知')+' 条')):null),
    h('section',{style:box},h('div',{className:'lc-toolbar'},h('h3',null,'最近经历'),button('更多经历',()=>navigate('timeline'))),
     resourceMessage(stateResource,'经历'),
     h('ul',{className:'lc-list'},...recent.slice(0,6).map(r=>h('li',{key:r.id},
      h('div',{className:'lc-toolbar'},pill(labels[r.status]||statusLabel(r.status)),h('time',{className:'lc-meta'},dateLabel(r.at))),
      h('p',{className:'lc-clip',style:{margin:'5px 0'}},r.text||'未返回正文'),
      meta([evidenceLabel(r.evidenceType),...(r.sourceScopes||[])].filter(Boolean).join(' · '))))),
     state&&!recent.length?empty('尚无可展示的经历。'):null,
     recent.length>6?fine('查看其余近期经历',h('ul',{className:'lc-list'},...recent.slice(6).map(r=>h('li',{key:r.id},pill(labels[r.status]||statusLabel(r.status)),paragraph(r.text||'未返回正文'),meta([dateLabel(r.at),r.evidenceType,...(r.sourceScopes||[])].filter(Boolean).join(' · ')))))):null)),
   state?fine('可用能力（'+available.length+'）',h('div',{style:flow},...available.map(c=>h('span',{key:c.id,className:'lc-pill'},c.name||capabilityLabel(c.id)))),
    state.capabilities?.some(c=>!c.available)?h('ul',{className:'lc-list'},...state.capabilities.filter(c=>!c.available).map(c=>h('li',{key:c.id},h('strong',null,c.name||capabilityLabel(c.id)),meta([c.id,c.reason||'当前不可用'].join(' · '))))):null):null)
 }
 const tabs=[['events','概览'],['timeline','记忆时间线'],['context','上下文诊断'],['health','任务与健康'],['notes','探索笔记'],['metrics','运行与用量']]
 let content
 if(tab==='events')content=overview()
 else if(tab==='notes')content=h('div',null,resourceMessage(notesResource,'探索笔记'),notes.length?notes.map(n=>h('section',{key:n.id,style:box},h('h3',null,n.title),meta(dateLabel(n.at)+' · '+(n.sourceIds||[]).length+' 条来源'),h('div',{style:{...prose,marginTop:'10px'}},n.text))):notesResource.data?empty('还没有探索笔记。'):null)
 else if(tab==='metrics')content=renderMetrics()
 else if(tab==='timeline')content=h('div',null,filter,meta('管理端最近最多 100 条 · 正文和结果按需读取'),resourceMessage(timelineResource,'记忆时间线'),writeState.success&&!items.some(r=>r.id===writeState.target)?h('p',{role:'status'},writeState.success):null,...items.map(renderEvent),timelineResource.data&&!items.length?empty('当前筛选下没有记忆事件。'):null)
 else if(tab==='context')content=renderContext()
 else content=renderHealth()
 return h('div',{className:'lc-panel'},
  h('style',null,panelCss),
  h('header',{className:'lc-hero'},h('div',{className:'lc-toolbar'},h('h2',null,'行动与记忆'),button('刷新',refresh,{'aria-label':'刷新当前页面'})),
   h('div',{className:'lc-hero-meta',style:flow},h('span',null,'北京时间（Asia/Shanghai）'),
    memory?.managed?pill('统一记忆运行中','live'):null,
    state?pill(available.length+' 项能力可用'):null)),
  h('nav',{'aria-label':'行动与记忆页面',className:'lc-nav'},...tabs.map(([id,label])=>button(label,()=>navigate(id),{key:id,'aria-current':tab===id?'page':undefined}))),
  h('div',{'aria-label':tabs.find(([id])=>id===tab)?.[1]},content))
}
return Panel
