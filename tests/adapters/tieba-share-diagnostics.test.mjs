import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture} from './legacy-adapters-fixture.mjs'
import tieba from '../../modules/tieba-reader/index.mjs'

function setup(t, ask) {
 const f=fixture();t.after(f.close)
 const lib=f.api.lib
 Object.assign(f.api,{id:'tieba-reader',lib:k=>k==='core/config.js'?{registerSecretField(){}}:lib(k),
  settings:()=>({enabled:true,autoBrowse:true,bars:'手工',interests:'纸风车',maxSharesPerDay:3}),ask})
 f.api.core.personas={current:()=>''}
 const body=('"\\ 纸风车转动。').repeat(1000)
 const browser=async url=>url.includes('/p/')
  ?{title:'折纸',hasOpening:true,contents:Array(8).fill(body)}
  :{links:[{title:'折纸',url:'https://tieba.baidu.com/p/123456789'}]}
 browser.available=()=>true;browser.status=()=>({})
 let sends=0
 f.hub.sendText=async()=>{sends++;return{message_id:42}}
 return {instance:tieba.setup(f.api,{renderPage:browser}),warnings:f.warnings,sends:()=>sends}
}

test('successful read remains a memory and rate limits produce safe, actionable stage diagnostics',async t=>{
 const failure=new Error('opaque provider: password=never-record-this')
 failure.code='RATE_LIMITED'
 const {instance,sends,warnings}=setup(t,async()=>{throw failure})
 const result=await instance.run({manual:true})
 assert.equal(result.ok,false)
 assert.equal(sends(),0)
 assert.equal(instance.state().history[0].kind,'read')
 assert.equal(instance.state().lastFailure.category,'MODEL_RATE_LIMIT')
 assert.match(warnings.join(' '),/调用模型/)
 assert.doesNotMatch(JSON.stringify(instance.state())+warnings.join(' '),/never-record-this/)
})

test('a long thread reaches the model as a bounded valid JSON body and a receipt is required',async t=>{
 const {instance,sends}=setup(t,async opt=>{
  const input=JSON.parse(opt.text)
  assert.equal(input.posts[0].title,'折纸')
  assert(input.posts[0].posts[0].text.length>0)
  assert(opt.text.length<=14000)
  return '{"share":true,"index":0,"text":"这个折纸思路有意思。"}'
 })
 const result=await instance.run({manual:true})
 assert.equal(result.shared,1,JSON.stringify(result))
 assert.equal(sends(),1)
 assert.equal(instance.state().lastFailure,null)
})
