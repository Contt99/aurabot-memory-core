import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {harness} from '../core/harness.mjs'

export const chat = {chatId:'private:10001', kind:'private', userId:'10001'}
const sid = 'session-owner'
export async function installed() {
 const host = process.env.AURABOT_HOST_SRC
 const modules = process.env.DSH_MODULE_ROOT || '/opt/dsh/lib/node_modules/@deepseek-ai/dsh/node_modules'
 const load = (base,file) => import(pathToFileURL(path.resolve(base,file)).href)
 const [{createHub}, capture, {Session}] = await Promise.all([
  load(host,'chat/hub.js'), load(host,'security/leak-guard.js'),
  load(modules,'@deepseek-ai/dsh-session/lib/index.js')
 ])
 return {createHub, capture, Session}
}

// Match the host pre-step/stream ordering. Only the model result and transport are synthetic.
export async function modelRequest(h,session,msgs) {
 const hooks=h.hooks.get('agent/pre-step'), payload={agent:{session},messages:msgs,signal:new AbortController().signal}
 const next=i=>()=>i<hooks.length?hooks[i](payload,next(i+1)):Promise.resolve({kind:'enter',messages:msgs})
 const decision=await next(0)()
 assert.equal(decision.kind,'enter')
 for(const msg of decision.messages) session.append('user/message',msg,{surfaceOp:'append'})
 const request=Object.freeze({sessionId:session.id,messages:Object.freeze(session.deriveMessages())})
 const before=JSON.stringify(request)
 const chunks=await h.stream(request)
 assert.deepEqual(chunks,[{type:'finish',reason:{kind:'stop'}}])
 assert.equal(JSON.stringify(request),before)
 return request
}

export function makeHost(t,{sdk,rows=[],directory,model,items,send,afterSendFilter,now}) {
 const lib=name=>{assert.equal(name,'security/leak-guard.js');return sdk.capture}
 const h=harness(t,{lib,rows,directory,now}), dispatched=[], checks=[]
 Object.assign(h.cfg,{ownerLevel:'social',workspaceDir:path.join(process.env.AURABOT_DATA_DIR,'workspace'),
  voice:{enabled:false},stickers:{enabled:false},files:{enabled:false},memory:{enabled:false},chat:{seedHistory:false},model:{}})
 const mapPath=path.join(process.env.AURABOT_DATA_DIR,'sessions.json')
 if(!fs.existsSync(mapPath)) fs.writeFileSync(mapPath,JSON.stringify({chats:{[chat.chatId]:{sessionId:sid,preset:'aurabot-social',level:'social'}}}))
 const session=sdk.Session.create(sid)
 const agent={session,ctx:{systemPrompt:{context:()=>()=>{}},tools:{register:()=>()=>{}}},
  followup:async msg=>model?.(await modelRequest(h,session,[msg]),hub)}
 const hub=sdk.createHub({
  dsh:{agents:new Map([[sid,agent]]),get:()=>null,workspaceRegistry:{archivedSessionIds:[],archiveSession:async()=>true}},
  getConfig:()=>h.cfg,log:{info(){},warn:(...args)=>h.warnings.push(args.join(' ')),debug(){}},
  onebot:{call:async(action,params)=>{
   if(action==='set_input_status')return {}
   assert.equal(action,'send_private_msg');assert.equal(params.user_id,10001)
   dispatched.push(params.message);return {message_id:String(dispatched.length)}
  }},stickers:{},tts:{},
  hooks:{
   prompt:async(content,info)=>{
    for(const hook of h.events.get('prompt')||[]){
     const value=await hook(content,info)
     if(value===null)return null
     if(value!==undefined)content=value
    }
    return content
   },
   sent:(segments,info)=>h.emit('sent',segments,info),
   send:async(segments,info)=>{
    const decision=h.emit('send',segments,info)
    checks.push({decision,source:sdk.capture.currentPromptSources()})
    send?.(decision)
    await afterSendFilter?.(h,decision)
    return decision
   },items:items?async list=>{await items(h);return list}:undefined
  }
 })
 h.api.core.hub=hub;t.after(()=>hub.dispose())
 return {h,hub,session,checks,dispatched}
}
