import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import rss from '../../modules/rss-reader/index.mjs'
import {harness} from '../core/harness.mjs'

const url='https://feed.example/private?token=SYNTHETIC_SUBSCRIPTION'
const summary='这是一份专用订阅的风车摘要'
const xml=new TextEncoder().encode('<rss><channel><title>风车订阅</title><item><title>风车软件发布</title><description>'+summary+'</description><link>https://example.org/windmill</link><guid>version1</guid><pubDate>Tue, 24 Nov 2026 00:00:00 GMT</pubDate></item></channel></rss>').buffer

function fixture(t,options={},beforeRead=()=>{}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rss-pool-'))
 const instances=[]
 t.after(()=>{for(const h of instances)h.close();fs.rmSync(dir,{recursive:true,force:true})})
 let clock=Date.parse('2026-11-24T08:00:00Z')
 t.mock.method(Date,'now',()=>clock)
 const create=()=>{
  const h=harness(t,{directory:dir,now:()=>clock})
  instances.push(h)
  h.cfg.ext['rss-reader']={enabled:true,feeds:url,minScore:0,fetchMinutes:15,dailyMax:3,...options}
  h.modules['life-core']=h.core
  h.api.core.modules={status:()=>[{id:'rss-reader',running:'user'}]}
  const routes=new Map()
  const reader=h.modules['rss-reader']=rss.setup({...h.api,id:'rss-reader',route:(p,f)=>routes.set(p,f),
   settings:()=>h.cfg.ext['rss-reader'],__rssTestHooks:{now:()=>clock,fetch:async()=>{await beforeRead(h);return {ok:true,arrayBuffer:async()=>xml}}},
   proactive:{available:true,submit:async()=>assert.fail('a subscription may not bypass the core delivery boundary')}})
  return {...h,reader,routes,advance:mins=>{clock+=mins*60_000}}
 }
 return {create,dir}
}

test('RSS material survives restart, keeps the read date, and remains confined to the configured owner',async t=>{
 const f=fixture(t),first=f.create()
 const result=await first.reader.run()
 assert.equal(result.delivered[0]?.state,'pooled')
 assert.equal(result.delivered[0]?.at,Date.now())
 assert.equal(result.delivered[0]?.publishedAt,Date.parse('2026-11-24T00:00:00Z'))
 assert.equal(first.reader.materials({chatId:'private:10003'}).length,0)
 assert.doesNotMatch(JSON.stringify(first.core.queryExperiences({purpose:'public-diary'})),/专用订阅/)
 assert.match(JSON.stringify(first.core.queryExperiences({purpose:'private-diary'})),/专用订阅/)
 assert.equal(first.core.proactiveState().count,0)
 first.close();first.advance(30)
 const reopened=f.create()
 assert.equal(reopened.reader.materials({chatId:'private:10001'})[0]?.at,Date.parse('2026-11-24T08:00:00Z'))
 assert.equal((await reopened.reader.run()).delivered.length,0)
 reopened.cfg.ext['rss-reader'].feeds=''
 assert.equal(reopened.reader.latest().length,0)
 assert.doesNotMatch(JSON.stringify(reopened.core.queryExperiences({purpose:'private-diary'})),/专用订阅/)
})

test('RSS quota of zero records the real read without pooling and excludes the feed token from the action ledger',async t=>{
 const f=fixture(t,{dailyMax:0}),h=f.create()
 const result=await h.reader.run()
 assert.equal(result.report.ok,1)
 assert.equal(result.delivered.length,0)
 assert.equal(h.reader.latest().length,0)
 const db=new DatabaseSync(path.join(f.dir,'life.sqlite'),{readOnly:true})
 try{
  const rows=db.prepare("SELECT meta,result,status FROM actions WHERE json_extract(meta, '$.module')='rss-reader'").all()
  assert.deepEqual(rows.map(r=>r.status),['succeeded'])
  assert.match(rows[0].result,/风车摘要/)
  assert.doesNotMatch(JSON.stringify(rows),/SYNTHETIC_SUBSCRIPTION/)
 }finally{db.close()}
})

test('late subscription withdrawal prevents material admission and old unscoped RSS is never public',async t=>{
 const f=fixture(t,{},h=>{h.cfg.ext['rss-reader'].feeds=''}),h=f.create()
 assert.equal((await h.reader.run()).delivered.length,0)
 assert.equal(h.reader.latest().length,0)
 h.core.recordOutcome({module:'rss-reader',action:'feed-read',public:true,sourceScopes:[]},{ok:true,text:'旧版无来源授权的 RSS'})
 assert.doesNotMatch(JSON.stringify(h.core.queryExperiences({purpose:'public-diary'})),/旧版无来源授权/)
})

test('a forgotten RSS summary stops being reusable without freeing its daily selection slot',async t=>{
 const f=fixture(t),h=f.create()
 const {delivered:[record]}=await h.reader.run()
 assert.equal(h.reader.status().sentToday,1)
 h.core.forgetPerson('10001','',{exactSources:true,sourceIds:[record.sourceId]})
 assert.deepEqual(h.reader.latest(),[])
 assert.doesNotMatch(JSON.stringify(h.core.queryExperiences({purpose:'private-diary'})),/专用订阅/)
 assert.equal(h.reader.status().sentToday,1)
})
