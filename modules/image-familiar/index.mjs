import {createImageMemory,visualOf} from './lib/memory.mjs'
import {identifyImage,prepareImage} from './lib/frames.mjs'
import {describeImage} from './lib/describe.mjs'
import {loadSharp} from './lib/sharp.mjs'
const messageIdOf=value=>/^-?[1-9]\d*$/.test(String(value??''))?String(value):''
const observedAt=()=>performance.timeOrigin+performance.now()
function inlineImage(encoded){
 if(!encoded?.length||encoded.length>Math.ceil(25*1024*1024/3)*4||!(/^[a-z0-9+/]+={0,2}$/i.test(encoded))||encoded.length%4===1)return null
 const raw=Buffer.from(encoded,'base64')
 return raw.length&&raw
}
const directVisual=r=>({type:'text',text:`【${r.reused?'已见过的同图，复用视觉理解，不必重新介绍画面':'本次图片视觉理解'}；${r.frames||1}帧${r.frames>1?'，已多帧采样':''}】${r.description}${r.uncertain?'；低置信度，仅供核对':''}${r.uncertainty?'；不确定：'+r.uncertainty:''}。结合这次对话回应；不是新事件，不推断谁常发。需要细看或纠错时调用review_image。`})
const invalidatedVisual=()=>({type:'text',text:'【图片来源已撤销或被忘记，本轮不使用其理解】'})
export default {
 id:'image-familiar',name:'图片理解复用',version:'0.1.0-local.3',api:1,panel:'panel.js',defaults:{enabled:true},
 description:'同图复用视觉理解，GIF多帧；按聊天隔离，不记录谁常发',
 settings:[{key:'enabled',label:'同图理解复用',type:'switch'}],
 setup(api,deps={}){
  let live=true,sharp,forgetOff,forgetCore;const last=new Map(),sentPending=new Map(),counts={recognized:0,reused:0,failed:0};let lastError=''
  const authorized=chatId=>{
   const c=api.config();if(!live||c.enabled===false||api.settings().enabled===false)return false
   return chatId==='private:'+c.ownerQQ||/^private:\d+$/.test(chatId)&&(c.allow?.private||[]).map(String).includes(chatId.slice(8))||/^group:\d+$/.test(chatId)&&(c.allow?.groups||[]).map(String).includes(chatId.slice(6))
  }
  let activeChat
  const sharpFor=async()=>sharp||=await loadSharp(api)
  const identify=deps.identify||deps.prepare||(async raw=>identifyImage(raw,await sharpFor()))
  const memory=createImageMemory({dir:api.dataDir(),
   revision:scope=>api.use('life-core')?.forgetRevision?.(scope)??null,
   revisionAt:scope=>api.use('life-core')?.forgetRevisionAt?.(scope)??0,
   prepare:deps.prepare||(async raw=>prepareImage(raw,await sharpFor())),
   describe:async(p,q)=>{const chat=activeChat;const r=await (deps.describe?deps.describe(p,q):describeImage(api,p,chat,q));if(!authorized(chat.chatId))throw Error('图片来源授权已撤销');return r}})
  // serialize distinct first recognitions so model selection cannot cross chat scopes
  let serial=Promise.resolve()
  function invalidate(sourceIds){
   if(!sourceIds.length)return {}
   try{
    const core=api.use('life-core');if(typeof core?.forgetPerson!=='function')throw Error('统一经历来源失效联动不可用')
    const result=core.forgetPerson('','',{sourceIds,exactSources:true})
    if(result&&typeof result.then==='function'){result.catch(e=>api.log.warn('图片来源异步忘记失败：'+e.message));throw Error('统一经历忘记必须同步完成')}
    if(result?.ok!==true)throw Error((result?.errors||[]).map(e=>typeof e==='string'?e:e.message||JSON.stringify(e)).join('；')||'统一经历来源失效联动未完成')
    return {lifeCoreForget:result}
   }catch(e){api.log.warn('图片缓存已清理；经历忘记未完成：'+e.message);return{lifeCoreForgetErrors:[e.message]}}
  }
  const forget=scope=>{
   const {sourceIds,occurrenceIds}=memory.forget(scope),ids=[...sourceIds,...occurrenceIds]
   last.delete(scope);sentPending.delete(scope)
   return{ok:true,sourceIds:ids,occurrenceIds,...invalidate(ids)}
  }
  const resolve=(raw,chat,options)=>{const run=async()=>{activeChat=chat;const r=await memory.resolve(raw,chat.chatId,options);if(r.invalidated)return r;if(r.reused)counts.reused++;else{counts.recognized++;invalidate(r.supersededSourceIds||[]);const core=api.use('life-core');if(typeof core?.recordObservation==='function'&&authorized(chat.chatId)){try{await core.recordObservation({module:'image-familiar',action:'interpret-image',chatId:chat.chatId,sourceScopes:[chat.chatId],sourceId:r.sourceId,sourceIds:[r.sourceId],callId:r.sourceId,occurredAt:null,observedAt:r.at,public:false,evidenceType:'visual-interpretation',mediaIdentity:r.identity},{text:r.description,description:r.description,uncertainty:r.uncertainty||'',confidence:r.confidence,frames:r.frames,uncertain:Boolean(r.uncertain),mediaIdentity:r.identity})}catch(e){api.log.warn('图片理解已保存；统一观察记录失败：'+e.message)}}}return r};const task=serial.then(run,run);serial=task.catch(()=>{});return task}
  const bindForget=()=>{const core=api.use('life-core');if(core===forgetCore)return;forgetOff?.();forgetCore=core;if(core?.onForget)forgetOff=core.onForget(e=>{const scope=e.chatId||(/^\d+$/.test(e.qq||'')?'private:'+e.qq:'');if(scope){const result=forget(scope);if(result.lifeCoreForgetErrors?.length)throw Error(result.lifeCoreForgetErrors.join('；'))}})}
  bindForget();api.every(60000,bindForget,'图片忘记联动')
  api.onDispose(()=>{live=false;forgetOff?.();sentPending.clear();memory.close()})
  async function preparePrompt(content,info,managed){
   const chat=info?.chat,chatId=chat?.chatId||'',current=new Map(),directSourceIds=new Set()
   if(!authorized(chatId))return {content,current:[],directSourceIds:[]}
   bindForget()
   const question=String(info.queryText||''),refresh=/重新看图|重新识别|看错了|识别错了/.test(question),out=[]
   const capture=memory.capture(chatId),at=observedAt()
   // The host broadcasts sent without awaiting listeners; settle existing receipts from this chat before projecting it.
   const receipts=managed&&sentPending.get(chatId)
   if(receipts)await receipts
   for(const block of content){
    if(block.type!=='image'||typeof block.data!=='string'){out.push(block);continue}
    if(!authorized(chatId)||Number.isFinite(capture.rev)&&!memory.valid(capture)){out.push(invalidatedVisual());continue}
    const raw=inlineImage(block.data);if(!raw){out.push(block);continue}
    const name=/^qq-(-?\d+)-(\d+)$/.exec(block.name),messageId=messageIdOf(name?.[1]),position=Number(name?.[2])
    const native=messageId&&Number.isSafeInteger(position)&&position>0
    let occurrence=null
    last.set(chatId,{raw,chat,at:Date.now()})
    try{
     const r=await resolve(raw,chat,{capture,refresh,question,onPrepared:p=>{
      if(!authorized(chatId))return false
      if(native)occurrence=memory.append(capture,{dir:'in',messageId,position,identity:p.identity,at})
     }})
     if(!authorized(chatId)||!memory.valid(capture)||r.invalidated){out.push(invalidatedVisual());continue}
     if(managed&&occurrence&&r.sourceId){current.set(occurrence.id,{...occurrence,visual:visualOf(r)});continue}
     if(occurrence&&!current.has(occurrence.id))current.set(occurrence.id,occurrence)
     if(r.sourceId)directSourceIds.add(r.sourceId)
     out.push(directVisual(r))
    }catch(e){
     if(!authorized(chatId)||Number.isFinite(capture.rev)&&!memory.valid(capture)){out.push(invalidatedVisual());continue}
     if(occurrence&&!current.has(occurrence.id))current.set(occurrence.id,occurrence)
     counts.failed++;lastError=e.message;api.log.warn('图片理解未保存：'+e.message)
     out.push(block,{type:'text',text:'【图片理解复用失败，未保存结论：'+e.message+'。动图可能只显示一帧，不猜未看到的动作。】'})
    }
   }
   // A scope forget may land between two attachments of the same chat turn.
   if(Number.isFinite(capture.rev)&&!memory.valid(capture)||!authorized(chatId))return{
    content:content.some(block=>block.type==='image')?content.filter(block=>block.type!=='image').concat(invalidatedVisual()):content,
    current:[],directSourceIds:[]
   }
   return {content:out,current:[...current.values()],directSourceIds:[...directSourceIds]}
  }
  api.on('prompt',async(content,info)=>{
   const core=api.use('life-core')
   if(core?.mediaTimelineManaged?.(info)&&core?.contextManaged?.('chat'))return content
   return (await preparePrompt(content,info,false)).content
  })
  api.on('sent',(segments,info)=>{
   const chatId=info?.chatId,messageId=messageIdOf(info?.messageId),at=Number(info?.at)
   if(!authorized(chatId)||!messageId||!Array.isArray(segments)||!Number.isFinite(at)||at<=0||!memory.afterForget(chatId,at))return
   if(!segments.some(s=>s?.type==='image'&&typeof s.data?.file==='string'&&s.data.file.startsWith('base64://')))return
   bindForget()
   const capture=memory.capture(chatId)
   if(!memory.valid(capture))return
   const task=Promise.resolve(sentPending.get(chatId)).then(async()=>{
    for(let i=0;i<segments.length;i++){
     if(!authorized(chatId)||!memory.valid(capture))break
     const seg=segments[i],file=seg?.type==='image'&&seg.data?.file
     // The final ACK supplies inline bytes for local sends/stickers. Other locators prove no exact identity.
     if(typeof file!=='string'||!file.startsWith('base64://'))continue
     const raw=inlineImage(file.slice(9));if(!raw)continue
     try{
      const {identity}=await identify(raw)
      if(authorized(chatId))memory.append(capture,{dir:'out',messageId,position:i+1,identity,at})
     }catch(e){api.log.warn('已发送图片未建立同图关联：'+e.message)}
    }
   }).catch(e=>api.log.warn('图片回执登记失败：'+e.message)).finally(()=>{
    if(sentPending.get(chatId)===task)sentPending.delete(chatId)
   })
   sentPending.set(chatId,task)
   return task
  })
  api.tool(({chat,sessionId,level})=>!authorized(chat?.chatId||'')||level==='none'?[]:[api.defineTool({name:'review_image',description:'重新核对当前聊天最近30分钟的图片，修正旧理解或回答细节；forget仅清除该聊天图片理解缓存。',properties:{question:{type:'string'},action:{type:'string',enum:['review','forget']}},execute:async({question,action='review'},exec)=>{
   const sid=exec?.agent?.session?.id||exec?.session?.id||sessionId,chatId=api.core.hub.chatOfSession(sid)
   if(chatId!==chat.chatId||!authorized(chatId))return{ok:false,message:'当前聊天无权读取图片'}
   if(action==='forget'){const result=forget(chatId);return{...result,message:'已清除当前聊天图片理解缓存'+(result.lifeCoreForgetErrors?.length?'；经历忘记联动未完成：'+result.lifeCoreForgetErrors.join('；'):'')}}
   const image=last.get(chatId);if(!image||Date.now()-image.at>30*60000)return{ok:false,message:'当前聊天没有最近图片，请重新发图'}
   try{const r=await resolve(image.raw,image.chat,{refresh:true,question});if(!authorized(chatId)||r.invalidated)return{ok:false,message:'图片来源已失效'};return{ok:true,message:r.description+(r.uncertainty?'；不确定：'+r.uncertainty:'')}}catch(e){return{ok:false,message:e.message}}
  }})])
  api.route('/state',()=>({ok:true,counts,lastError,items:memory.list()}))
  return{
   state:()=>({counts,lastError}),forget,contextCurrent:(ids,{chatId}={})=>authorized(chatId)&&memory.current(ids,chatId),
   prepareTimelineImages:(content,info)=>preparePrompt(content,info,true),
   mediaFor:(chatId,refs)=>authorized(chatId)?memory.mediaFor(chatId,refs):[],
   mediaCurrent:(ids,{chatId}={})=>authorized(chatId)&&memory.mediaCurrent(ids,chatId)
  }
 }
}
