import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import imageModule from '../../modules/image-familiar/index.mjs'

const chatId='private:101',other='private:102'
const chat={chatId,kind:'private',userId:'101'}
const data=name=>Buffer.from(name).toString('base64')
const picture=(name,bytes)=>({type:'image',name,data:data(bytes),mediaType:'image/png'})
const segment=bytes=>({type:'image',data:{file:'base64://'+data(bytes)}})
const ref=(dir,messageId)=>({dir,messageId})

function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aurabot-image-timeline-'))
 const config={enabled:true,ownerQQ:'101',allow:{private:['102'],groups:['302']}}
 const hooks={},dispose=[],observations=[],tools=[],invalidations=[]
 let image,revision=0,forgotAt=0,forgetListener,managed=true,describes=0,boundChatId
 const core={
  mediaTimelineManaged:info=>managed&&(!boundChatId||info?.chat?.chatId!==boundChatId),contextManaged:purpose=>purpose==='chat',
  forgetRevision:scope=>scope===chatId?revision:0,forgetRevisionAt:scope=>scope===chatId?forgotAt:0,
  onForget:fn=>{forgetListener=fn;return()=>{forgetListener=null}},
  recordObservation:(meta,value)=>observations.push({meta,value}),
  forgetPerson:(_qq,_query,opts)=>{invalidations.push(opts);return{ok:true}},
 }
 const api={
  dataDir:()=>dir,settings:()=>({enabled:true}),config:()=>config,use:k=>k==='life-core'?core:null,log:{warn(){}},
  every(){},onDispose:fn=>dispose.push(fn),on:(n,fn)=>hooks[n]=fn,tool:fn=>tools.push(fn),defineTool:x=>x,route(){},
  core:{hub:{chatOfSession:()=>chatId}},
 }
 const deps={
  prepare:async bytes=>{
   await deps.beforePrepare?.(bytes)
   const shape=bytes.toString().split(':')[0]
   if(shape==='invalid')throw Error('invalid image')
   return{identity:'pixels:'+shape,frames:2}
  },
  describe:async prepared=>{
   describes++
   if(prepared.identity==='pixels:model-fail')throw Error('model unavailable')
   return{description:'描述 '+prepared.identity,confidence:prepared.identity==='pixels:unclear'?0.3:0.9,uncertainty:'局部遮挡'}
  },
 }
 const stop=()=>dispose.splice(0).forEach(fn=>fn())
 const restart=()=>{stop();image=imageModule.setup(api,deps)}
 restart()
 t.after(()=>{stop();fs.rmSync(dir,{recursive:true,force:true})})
 return{
  get image(){return image},restart,config,hooks,observations,deps,invalidations,describes:()=>describes,setManaged:v=>managed=v,bind:v=>boundChatId=v,
  prepare:(content,info={})=>image.prepareTimelineImages(content,{chat,queryText:'看看',...info}),
  sent:(messageId,segments,info={})=>hooks.sent?.(segments,{chatId,messageId,at:Date.now(),...info}),
  fog:(notify=true)=>{revision++;forgotAt=Date.now();if(notify)forgetListener?.({chatId})},
  review:(action,question)=>tools.at(-1)({chat,sessionId:'s',level:'owner'})[0].execute({action,question},{sessionId:'s'}),
 }
}

test('trusted native inbox positions are persistent; managed injection occurs only through the timeline',async t=>{
 const f=fixture(t)
 const text={type:'text',text:'look'}
 const blocks=[text,picture('qq--10-2','b'),picture('qq--10-1','a')]
 assert.equal(typeof f.image.prepareTimelineImages,'function')
 assert.deepEqual(await f.hooks.prompt(blocks,{chat}),blocks)
 const first=await f.prepare(blocks)
 assert.deepEqual(first.content,[text])
 assert.deepEqual(first.current.map(x=>[x.dir,x.messageId,x.identity]),[['in','-10','pixels:b'],['in','-10','pixels:a']])
 assert.equal(f.observations[0].meta.mediaIdentity,'pixels:b')
 const ids=f.image.mediaFor(chatId,[ref('in','-10')]).map(x=>x.id)
 assert.equal(ids.length,2)
 assert.notEqual(ids[0],ids[1])
 assert.equal(f.image.mediaFor(chatId,[ref('in','-10')])[0].visual.description,'描述 pixels:a')
 f.restart()
 assert.deepEqual(f.image.mediaFor(chatId,[ref('in','-10')]).map(x=>x.id),ids)
 await f.prepare(blocks)
 assert.deepEqual(f.image.mediaFor(chatId,[ref('in','-10'),ref('in','-10')]).map(x=>x.id),ids)
 assert.deepEqual(f.image.mediaFor(other,[ref('in','-10')]),[])
 assert.equal(f.image.mediaCurrent(ids,{chatId:other}),false)
 assert.equal(f.image.mediaCurrent(ids,{chatId}),true)
 assert.equal(f.describes(),2)
})

test('a chat with a bound core snapshot keeps standalone visual fallback',async t=>{
 const f=fixture(t)
 f.bind(chatId)
 const result=await f.hooks.prompt([picture('qq-15-1','a')],{chat,queryText:'看看'})
 assert.match(result[0].text,/描述 pixels:a/)
})

test('the next prompt waits for already acknowledged images in its chat only',async t=>{
 const f=fixture(t)
 let started,release
 const decoding=new Promise(r=>started=r),gate=new Promise(r=>release=r)
 f.deps.beforePrepare=async ()=>{started();await gate}
 const ack=f.sent(16,[segment('cat')])
 await decoding
 const text={type:'text',text:'刚才你发了什么？'}
 let finished=false
 const turn=f.prepare([text]).then(r=>{finished=true;return r})
 try{
  const separate=await f.prepare([text],{chat:{chatId:other,kind:'private',userId:'102'}})
  assert.deepEqual(separate.content,[text])
  assert.equal(finished,false)
 }finally{release();await ack;await turn}
 assert.deepEqual(f.image.mediaFor(chatId,[ref('out','16')]).map(x=>x.identity),['pixels:cat'])
})

test('a QQ message stays one occurrence of each exact image when group batching changes its attachment slots',async t=>{
 const f=fixture(t),group='group:302',info={chat:{chatId:group,kind:'group',groupId:'302',userId:'101'}}
 await f.prepare([picture('qq-21-2','cat:encoded-one'),picture('qq-21-3','bird')],info)
 const first=f.image.mediaFor(group,[ref('in','21')])
 await f.prepare([picture('qq-21-1','cat:other-lossless-encoding'),picture('qq-21-2','bird'),picture('qq-21-3','cat:encoded-one')],info)
 const second=f.image.mediaFor(group,[ref('in','21')])
 assert.deepEqual(second.map(x=>[x.id,x.identity]),first.map(x=>[x.id,x.identity]))
 assert.deepEqual(second.map(x=>x.identity),['pixels:cat','pixels:bird'])
})

test('only final ACK with native id and inline image bytes adds an outbound occurrence without sight calls',async t=>{
 const f=fixture(t)
 assert.equal(typeof f.hooks.sent,'function')
 const at=Date.now()
 const ack=[{type:'image',data:{file:'file:///tmp/secret'}},{type:'image',data:{file:'https://example.invalid/image'}},segment('cat:one'),{type:'reply',data:{id:'14'}},segment('zap'),segment('invalid')]
 await f.hooks.send?.(ack,{chatId,messageId:'17',at})
 await f.sent(undefined,ack,{at})
 await f.sent('sim-1',ack,{at})
 assert.deepEqual(f.image.mediaFor(chatId,[ref('out','17'),ref('out','sim-1')]),[])
 await f.sent(17,ack,{at})
 await f.sent('17',ack,{at:at+100})
 const out=f.image.mediaFor(chatId,[ref('out',17)])
 assert.deepEqual(out.map(x=>[x.at,x.identity,x.visual]),[[at,'pixels:cat',undefined],[at,'pixels:zap',undefined]])
 assert.equal(f.describes(),0)
 const current=await f.prepare([picture('qq-17-1','cat:lossless-reencode')])
 assert.equal(current.current[0].identity,out[0].identity)
 assert.notEqual(current.current[0].id,out[0].id)
 assert.equal(f.image.mediaFor(chatId,[ref('out',17)])[0].visual.description,'描述 pixels:cat')
})

test('quote and unknown names remain direct visual fallback; low confidence remains current-only',async t=>{
 const f=fixture(t)
 const result=await f.prepare([picture('quote-900-1','q'),picture('qq-0-1','not-native'),picture('qq-22-1','unclear')])
 assert.equal(result.current.length,1)
 assert.equal(result.content.length,2)
 assert.match(result.content[0].text,/描述 pixels:q/)
 assert.deepEqual(result.directSourceIds,f.observations.slice(0,2).map(x=>x.meta.sourceId))
 assert.equal(result.current[0].visual.confidence,0.3)
 assert.equal(result.current[0].visual.frames,2)
 assert.deepEqual(f.image.mediaFor(chatId,[ref('in','900'),ref('in','0')]),[])
 assert.equal(f.image.mediaFor(chatId,[ref('in','22')])[0].visual,undefined)
 f.setManaged(false)
 const standalone=await f.hooks.prompt([picture('qq-23-1','normal')],{chat,queryText:'看看'})
 assert.match(standalone[0].text,/描述 pixels:normal/)
 assert.equal(f.image.mediaFor(chatId,[ref('in','23')]).length,1)
})

test('image decode failure preserves input; model failure can still index confirmed bytes',async t=>{
 const f=fixture(t)
 const bad=picture('qq-24-1','invalid'),unknown=picture('qq-25-1','model-fail')
 const result=await f.prepare([bad,unknown])
 assert.deepEqual(result.content.filter(x=>x.type==='image'),[bad,unknown])
 assert.match(result.content[1].text,/invalid image/)
 assert.match(result.content[3].text,/model unavailable/)
 assert.deepEqual(f.image.mediaFor(chatId,[ref('in','24')]),[])
 const occurrences=f.image.mediaFor(chatId,[ref('in','25')])
 assert.equal(occurrences.length,1)
 assert.equal(occurrences[0].visual,undefined)
})

test('visual correction preserves occurrence identity; exact chat forget and revisions revoke old occurrences',async t=>{
 const f=fixture(t)
 const first=await f.prepare([picture('qq-27-1','a')])
 const previous=first.current[0],visualId=previous.visual.sourceId,oldTime=Date.now()-1000
 await f.prepare([picture('qq-27-1','a')],{chat:{chatId:other,kind:'private',userId:'102'}})
 await f.review('review','重新看图')
 const after=f.image.mediaFor(chatId,[ref('in','27')])[0]
 assert.equal(after.id,previous.id)
 assert.notEqual(after.visual.sourceId,visualId)
 assert.equal(f.image.contextCurrent([visualId],{chatId}),false)
 assert.equal(f.image.mediaCurrent([previous.id],{chatId}),true)
 await f.review('forget')
 f.restart()
 await f.sent(28,[segment('a')],{at:oldTime})
 assert.deepEqual(f.image.mediaFor(chatId,[ref('in','27'),ref('out','28')]),[])
 assert.equal(f.image.mediaCurrent([previous.id],{chatId}),false)
 assert.equal(f.image.mediaFor(other,[ref('in','27')]).length,1)
 const newer=await f.prepare([picture('qq-29-1','b')])
 f.fog(false)
 f.restart()
 assert.equal(f.image.mediaCurrent([newer.current[0].id],{chatId}),false)
 await f.sent(30,[segment('a')],{at:oldTime})
 assert.deepEqual(f.image.mediaFor(chatId,[ref('in','29'),ref('out','30')]),[])
})

test('explicit image forget invalidates exact occurrence sources even when only outbound bytes were seen',async t=>{
 const f=fixture(t)
 await f.sent(40,[segment('a')])
 const [x]=f.image.mediaFor(chatId,[ref('out','40')])
 const result=await f.review('forget')
 assert.deepEqual(result.occurrenceIds,[x.id])
 assert.deepEqual(f.invalidations,[{sourceIds:[x.id],exactSources:true}])
 assert.equal(f.image.mediaCurrent([x.id],{chatId}),false)
})

test('a native ACK or input already decoding when the chat is forgotten does not rebuild an occurrence',async t=>{
 const f=fixture(t)
 let started,release
 const decoding=new Promise(r=>started=r),gate=new Promise(r=>release=r)
 f.deps.beforePrepare=async ()=>{started();await gate}
 const ingress=f.prepare([picture('qq-31-1','a')]),egress=f.sent(32,[segment('b')])
 await decoding
 f.fog()
 release()
 const prepared=await ingress
 await egress
 assert.ok(!prepared.content.some(x=>x.type==='image'))
 assert.deepEqual(f.image.mediaFor(chatId,[ref('in','31'),ref('out','32')]),[])
})
