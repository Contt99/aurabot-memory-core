import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createBubbleDelivery} from '../../modules/pet/bubble-delivery.mjs'
import pet from '../../modules/pet/index.mjs'

const id='8f4b8647-ad71-4cf2-827b-51c37f89ab27'
const base={id,client:'screen-a',bootId:'current'}
const issued={id,message:{text:'桌面上的一句话'},expiresAt:20000}
function fixture(){
 let at=10000,valid=true
 const offers=[]
 const service=createBubbleDelivery({bootId:'current',now:()=>at,capable:client=>['screen-a','screen-b'].includes(client),
  announce:offer=>offers.push(offer)})
 return{service,offers,advance:ms=>{at+=ms},request:()=>service.offer({...issued,isCurrent:()=>valid}),
  withdraw:()=>{valid=false}}
}

test('an authenticated capable client claims the text once and only that claim can acknowledge display',async()=>{
 const f=fixture(),receipt=f.request()
 assert.deepEqual(f.offers,[{deliveryId:id}])
 assert.equal(f.service.claim({...base,bootId:'old'}).ok,false)
 assert.equal(f.service.claim({...base,client:'legacy'}).ok,false)
 const accepted=f.service.claim(base)
 assert.equal(accepted.message.text,issued.message.text)
 assert.equal(f.service.claim({...base,client:'screen-b'}).ok,false)
 assert.equal(f.service.shown({...base,client:'screen-b',claim:accepted.claim}).ok,false)
 assert.equal(f.service.shown({...base,claim:'wrong'}).ok,false)
 assert.equal(f.service.shown({...base,claim:accepted.claim}).ok,true)
 assert.equal(f.service.shown({...base,claim:accepted.claim}).ok,false)
 assert.deepEqual(await receipt,{ok:true,status:'shown',deliveryId:id,text:issued.message.text,shownAt:10000})
})

test('withdrawn and expired offers expose no text; interruption after claim stays uncertain',async()=>{
 const f=fixture(),receipt=f.request()
 f.withdraw()
 assert.equal(f.service.claim(base).ok,false)
 assert.equal((await receipt).reason,'withdrawn')
 const g=fixture(),second=g.request()
 g.advance(10001)
 assert.equal(g.service.claim(base).ok,false)
 assert.equal((await second).reason,'unconfirmed')
 const claimed=fixture(),running=claimed.request()
 assert.equal(claimed.service.claim(base).ok,true)
 claimed.service.dispose()
 assert.equal((await running).reason,'unconfirmed')
})

test('the pet routes reuse native auth, never put content in /events and recheck focus at claim',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'pet-receipt-')),routes=new Map()
 let dispose
 t.after(()=>{dispose?.();rmSync(dir,{recursive:true,force:true})})
 const p=pet.setup({version:pet.version,__petTestHooks:{},settings:()=>pet.defaults,config:()=>({ownerQQ:'10001'}),
  dataDir:(...p)=>join(dir,...p),use:()=>null,route:(name,f)=>routes.set(name,f),every:()=>()=>{},
  onDispose:f=>{dispose=f},log:{info(){},warn(){},debug(){},error(){}},
  core:{http:{query:r=>r.query,body:async r=>r.body,send:(r,status,data)=>Object.assign(r,{status,data})}}})
 const token=readFileSync(join(dir,'host-token'),'utf8').trim()
 const call=async(route,{query={},body,auth=true}={})=>{
  const req={method:body?'POST':'GET',body,query,socket:{remoteAddress:'127.0.0.1'},
   headers:{host:'127.0.0.1:9494','x-pet-token':auth?token:'incorrect','content-type':'application/json'}}
  const res={headers:{},setHeader(k,v){this.headers[k]=v}}
  await routes.get(route)(req,res)
  return res
 }
 const legacy=await call('/events',{query:{client:'legacy'}})
 assert.equal(p.dispatchWithReceipt({...issued,text:issued.message.text}).reason,'legacy-client')
 const {data:hello}=await call('/events',{query:{client:'desktop',bubbleReceipt:'1'}})
 const request={deliveryId:id,client:'desktop',bootId:hello.bootId}
 const offer=p.dispatchWithReceipt({id,text:issued.message.text,isCurrent:()=>true,expiresAt:Date.now()+5000})
 const {data:poll}=await call('/events',{query:{client:'desktop',since:hello.cursor,bubbleReceipt:'1'}})
 assert.deepEqual(poll.events.map(({type,deliveryId})=>({type,deliveryId})),[{type:'bubble-delivery',deliveryId:id}])
 assert.doesNotMatch(JSON.stringify(poll),/桌面上的一句话/)
 assert.equal((await call('/delivery/claim',{body:request,auth:false})).status,401)
 const claimed=await call('/delivery/claim',{body:request})
 assert.equal(claimed.headers['Cache-Control'],'no-store')
 assert.equal(claimed.data.message.text,issued.message.text)
 assert.equal((await call('/delivery/shown',{body:{...request,client:'legacy',claim:claimed.data.claim}})).status,409)
 assert.equal((await call('/delivery/shown',{body:{...request,claim:claimed.data.claim}})).status,200)
 assert.equal((await offer).status,'shown')
 const next=p.dispatchWithReceipt({id:'next',text:'不该交付',isCurrent:()=>true,expiresAt:Date.now()+5000})
 p.setFocus(true)
 assert.equal((await call('/delivery/claim',{body:{...request,deliveryId:'next'}})).status,409)
 assert.equal((await next).reason,'withdrawn')
 assert.equal(legacy.status,200)
})
