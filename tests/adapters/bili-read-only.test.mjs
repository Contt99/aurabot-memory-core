import test from 'node:test'
import assert from 'node:assert/strict'
import {bindApi,createBili} from '../../modules/bili/lib/bili/duty.js'
import {fixture} from './legacy-adapters-fixture.mjs'

test('Bili exploration fetches evidence without any model, write or QQ delivery',async()=>{
 const f=fixture()
 try{
  const record=[]
  const denied=kind=>()=>{record.push(kind);throw Error(kind+' should not be called')}
  f.cfg.bili={enabled:true,comment:true,like:true,shareToOwner:true,shotChance:1,danmakuEnabled:true,vision:false}
  bindApi(f.api)
  const id={bvid:'BV1234567890',aid:1,title:'合成鲸类资料',desc:'一段简介',author:'作者'}
  const b=createBili({getConfig:f.api.config,hub:{sendText:denied('qq'),sendImage:denied('image')},
   memory:{addEvent:denied('cached unproven personal memory')},log:f.api.log,ask:denied('model'),afterBrowse:denied('danmaku'),
   api:{search:async q=>{record.push(q);return[id,id]},view:async()=>id,subtitle:async()=>'',comments:async()=>[],
    postComment:denied('comment'),likeVideo:denied('like')}})
  const result=await b.browseReadOnly({query:'座头鲸'})
  assert.deepEqual(record,['座头鲸'])
  assert.equal(result.ok,true)
  assert.deepEqual(result.results.map(x=>x.kinds),[['video-metadata']])
  assert.match(result.text,/https:\/\/www\.bilibili\.com\/video\/BV1234567890/)
  const video=await b.watchReadOnly('BV1234567890')
  assert.equal(video.ok,true)
  assert.deepEqual(video.kinds,['video-metadata'])
  const stop=new AbortController();stop.abort(new Error('discarded'))
  await assert.rejects(()=>b.browseReadOnly({query:'不能再发请求',signal:stop.signal}),/discarded/)
  assert.deepEqual(record,['座头鲸'])
 }finally{f.close()}
})
