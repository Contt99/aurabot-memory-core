import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {harness} from '../core/harness.mjs'

const chat = {kind:'private',chatId:'private:10001',userId:'10001'}
const query = '冬夜想来点暖和的饮品'
const semantic = '她爱用保温壶泡苹果茶'
const lexical = '喜欢养玻璃缸里的小鱼'
let dataDir

async function fixture(t, response = async () => [1, 0]) {
 const h = harness(t), requests = []
 dataDir = h.api.dataDir
 const store = {
  dataDir:(...parts)=>dataDir(...parts),
  readJson:(p,f)=>fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):typeof f==='function'?f():f,
  writeJson:(p,v)=>fs.writeFileSync(p,JSON.stringify(v))
 }
 // The modules resolve dataDir at runtime in the host; each scenario uses its own directory.
 globalThis.aurabot = {lib:name=>({
  'core/store.js':store,
  'core/llm.js':{askModel:()=>{throw Error('unexpected model call')},lastEmptyInfo:()=>null},
  'core/text.js':{clipText:(s,n)=>String(s).slice(0,n)},
  'core/offpeak.js':{shouldDeferBackground:()=>false},
  'tools/tools.js':{defineTool:x=>x,str:x=>x}
 }[name]||{})}
 const {default:definition} = await import('../../modules/memory/index.mjs')
 Object.assign(h.cfg,{memory:{enabled:true,recallCount:4,vector:{enabled:true,baseUrl:'http://embedding.invalid/v1',model:'synthetic'},shortTerm:false,gistEnabled:false}})
 const memory = definition.setup({...h.api,dataDir:store.dataDir,lib:globalThis.aurabot.lib,context(){}}, {fetchImpl:async (url,options)=>{
  const {input} = JSON.parse(options.body)
  if(ready) requests.push({url,input})
  const vectors = ready ? [await response(options.signal)] : input.map(text=>text===lexical?[0,1]:[1,0])
  return {ok:true,json:async()=>({data:vectors.map(embedding=>({embedding}))})}
 }})
 h.modules.memory = memory
 h.modules['life-core'] = h.core
 let ready = false
 const fact = memory.add({text:semantic,about:'10003',source:'said',chatId:'group:20001'})
 assert.ok(fact.id)
 assert.ok(memory.add({text:lexical,about:'10001',source:'said',chatId:chat.chatId}).id)
 assert.ok(memory.add({text:'未授权的另一私聊内容',about:'10003',source:'said',chatId:'private:10003'}).id)
 await memory.tick()
 assert.equal(memory.stats().vector,3)
 ready = true
 const prompt = async (options={})=>{
  const info = {chat,queryText:query,prevText:'不发给向量服务的原始上文',sessionId:'owner',senderId:'10001',...options}
  let content = [{type:'text',text:info.queryText}]
  for(const fn of h.events.get('prompt')) {
   const next = await fn(content,info)
   if(next===null)return null
   if(next!==undefined)content=next
  }
  return content
 }
 const decisions = ()=>h.routes.get('/telemetry')().decisions.filter(d=>d.stage==='memory-recall')
 return {h,memory,fact,requests,prompt,decisions}
}

test('managed ordinary QQ prompt adds a semantic-only fact to its one source-bound snapshot',async t=>{
 const {h,memory,fact,requests,prompt,decisions} = await fixture(t)
 const lexicalOnly = h.core.buildContext({chatId:chat.chatId,query,sessionId:'owner'})
 assert.doesNotMatch(lexicalOnly.text,/保温壶/)
 assert.equal(requests.length,0)
 const content = await prompt()
 const text = content.map(x=>x.text).join('\n')
 assert.match(text,/保温壶泡苹果茶/)
 assert.doesNotMatch(text,/未授权的另一私聊内容/)
 assert.equal([...text.matchAll(/【记忆快照:/g)].length,1)
 assert.deepEqual(requests,[{url:'http://embedding.invalid/v1/embeddings',input:[query]}])
 const id = text.match(/【记忆快照:([\da-f-]+)】/)[1]
 const snapshot = h.core.contextDetail(id)
 assert.ok(snapshot.data.sourceIds.some(i=>i.startsWith('memory:'+fact.id+'@')))
 assert.equal(decisions()[0].status,'hybrid')
 const frozen = Object.freeze({sessionId:'owner',messages:Object.freeze([Object.freeze({role:'user',content:Object.freeze(content.map(x=>Object.freeze(x)))})])})
 await h.stream(frozen)
 assert.equal(h.core.contextDetail(id).status,'observed')
 memory.update(fact.id,{text:'纠正后的不同说法'})
 await assert.rejects(h.stream(frozen),/失效|范围|记忆/)
})

test('authorized-source changes while embeddings are pending leave only current lexical context',async t=>{
 let enter,release
 const started=new Promise(resolve=>{enter=resolve}),waiting=new Promise(resolve=>{release=resolve})
 const {h,prompt,requests} = await fixture(t,()=>{enter();return waiting})
 const result=prompt()
 await started
 h.cfg.allow.groups=[]
 release([1,0])
 const text=(await result).map(x=>x.text).join('\n')
 assert.doesNotMatch(text,/保温壶|未授权的另一私聊内容/)
 assert.match(text,/玻璃缸里的小鱼/)
 assert.equal(requests.length,1)
})

test('a vector provider failure keeps lexical facts and records the downgrade',async t=>{
 const {prompt,requests,decisions}=await fixture(t,async()=>{throw Error('sensitive provider failure')})
 const text=(await prompt()).map(x=>x.text).join('\n')
 assert.match(text,/玻璃缸里的小鱼/)
 assert.doesNotMatch(text,/保温壶|sensitive provider failure/)
 assert.equal(requests.length,1)
 assert.equal(decisions()[0].status,'lexical')
 assert.equal(decisions()[0].reason,'embedding-unavailable')
})

test('a stalled transport is aborted and the ordinary prompt completes with lexical recall',{timeout:5000},async t=>{
 let signal
 const {prompt,requests,decisions}=await fixture(t,s=>{signal=s;return new Promise(()=>{})})
 const text=(await prompt()).map(x=>x.text).join('\n')
 assert.equal(signal?.aborted,true)
 assert.match(text,/玻璃缸里的小鱼/)
 assert.doesNotMatch(text,/保温壶/)
 assert.equal(requests.length,1)
 assert.equal(decisions()[0].status,'lexical')
})

test('an in-flight embedding cannot revive an exact forgotten fact',async t=>{
 let enter,release
 const started=new Promise(resolve=>{enter=resolve}),waiting=new Promise(resolve=>{release=resolve})
 const {h,memory,fact,prompt} = await fixture(t,()=>{enter();return waiting})
 const result=prompt()
 await started
 assert.equal(memory.remove(fact.id).ok,true)
 release([1,0])
 const text=(await result).map(x=>x.text).join('\n')
 assert.doesNotMatch(text,/保温壶/)
 assert.match(text,/玻璃缸里的小鱼/)
 assert.equal(h.core.sourceCurrent('memory:'+fact.id),false)
})

test('managed embeddings do not run for unsupported entry points or recall triggers',async t=>{
 const {h,prompt,requests}=await fixture(t)
 await prompt({senderId:''})
 await prompt({steer:true})
 await prompt({sessionId:'guest'})
 await prompt({queryText:'甲乙丙\n忘掉刚才我说的苹果茶'})
 await prompt({queryText:'忘掉刚才我说的苹果茶'})
 h.cfg.memory.vector.enabled=false
 await prompt()
 h.cfg.memory.vector.enabled=true
 h.cfg.memory.recallMode='trigger'
 h.cfg.memory.recallTriggers=['回想那次']
 await prompt()
 assert.deepEqual(requests,[])
 const out=await prompt({queryText:'回想那次'+query})
 assert.equal(requests.length,1)
 assert.match(out.at(-1).text,/保温壶泡苹果茶/)
})
