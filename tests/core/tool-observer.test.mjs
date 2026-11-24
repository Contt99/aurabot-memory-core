import test from 'node:test'
import assert from 'node:assert/strict'
import {createLedger} from '../../modules/life-core/lib/ledger.mjs'
import {installObserver} from '../../modules/life-core/lib/observer.mjs'
import {allowedSource} from '../../modules/life-core/lib/policy.mjs'

function fixture(t){
 const ledger=createLedger(':memory:'),hooks=new Map(),offs=[]
 const owner={id:'owner'},child={id:'child',header:{parentSession:'owner'}},plain={id:'desktop'}
 const api={core:{hub:{chatOfSession:id=>id==='owner'?'private:10001':''}},
  dsh:{on:(event,fn)=>{hooks.set(event,fn);return()=>hooks.delete(event)}},onDispose:fn=>offs.push(fn),
  log:{error:(...args)=>assert.fail(args.join(' ')),warn:(...args)=>assert.fail(args.join(' '))}}
 installObserver(api,ledger)
 t.after(()=>{offs.reverse().forEach(fn=>fn());ledger.close()})
 const session=(s,event)=>hooks.get('session/event')(s,event)
 const call=(s,id,name,args={})=>session(s,{type:'tool/call',data:{callId:id,name,arguments:args}})
 const report=(s,id,name,result)=>hooks.get('tools/result')?.({agent:{session:s},callId:id,name},result)
 const append=(s,id,body)=>session(s,{type:'tool/result',surfaceOp:'append',data:{message:{source:{callId:id},content:[{type:'text',text:body}]}}})
 const row=(s,id)=>ledger.byKey('dsh-tools:'+s.id+':'+id)
 return {owner,child,plain,call,report,append,row,ledger}
}

test('the DSH final result, not the body return or a rewritten message, settles the actual bot tool',t=>{
 const f=fixture(t),id='look'
 f.call(f.owner,id,'web_search')
 f.report(f.owner,id,'web_search',{isError:true,content:[{type:'text',text:'结果被宿主拦下'}]})
 f.append(f.owner,id,'伪造的成功')
 const row=f.row(f.owner,id)
 assert.equal(row.status,'failed')
 assert.match(JSON.stringify(row.result),/结果被宿主拦下/)
 assert.doesNotMatch(JSON.stringify(row.result),/伪造的成功/)
 assert.equal(f.ledger.list().length,1)
})

test('bot descendants capture only authorized WorkBuddy structured outcomes, not independent desktop use',t=>{
 const f=fixture(t),video='workbuddy_draw_video',code='codebuddy_ask'
 f.report(f.plain,'manual',video,{value:{videos:['file:///C:/synthetic/manual.mp4']}})
 assert.equal(f.ledger.list().length,0)
 f.call(f.child,'vid',video,{image:'https://example.test/x?temporary=synthetic'})
 f.report(f.child,'vid',video,{value:{videos:['file:///C:/synthetic/private.mp4']}})
 f.append(f.child,'vid','旧的渲染文字')
 const row=f.row(f.child,'vid')
 assert.equal(row.status,'succeeded')
 assert.equal(row.meta.evidenceType,'workbuddy-artifact')
 assert.equal(row.meta.chatId,'private:10001')
 assert.equal(row.result.count,1)
 assert.doesNotMatch(JSON.stringify(row),/private\.mp4|temporary=synthetic|旧的渲染文字/)
 const cfg={ownerQQ:'10001',allow:{private:['10003'],groups:[]}}
 assert.equal(allowedSource(row,cfg,'chat','private:10001'),true)
 assert.equal(allowedSource(row,cfg,'chat','private:10003'),false)
 assert.equal(allowedSource(row,cfg,'private-diary'),false)
 // A descendant can use the tool registry without adding a visible tool message.
 f.report(f.child,'code',code,{value:{ok:true,reply:'整理出三项结论。',denied_tools:['Edit'],working_dir:'C:/synthetic/private'}})
 const codeRow=f.row(f.child,'code')
 assert.equal(codeRow.status,'observed')
 assert.match(codeRow.result.text,/受限/)
 assert.doesNotMatch(JSON.stringify(codeRow),/C:\/synthetic\/private/)
})

test('a submitted Aurabot job and a WorkBuddy response without files cannot be completed receipts',t=>{
 const f=fixture(t),video='qq_generate_video',wb='workbuddy_draw_video',img='workbuddy_draw_image'
 f.call(f.owner,'accepted',video)
 f.report(f.owner,'accepted',video,{value:{ok:true,message:'已开始生成'}})
 assert.equal(f.row(f.owner,'accepted').status,'deferred')
 assert.equal(f.row(f.owner,'accepted').meta.evidenceType,'task-submission')
 f.call(f.owner,'no-file',wb)
 f.report(f.owner,'no-file',wb,{value:{videos:[]}})
 assert.equal(f.row(f.owner,'no-file').status,'observed')
 f.call(f.owner,'old-host',img)
 f.append(f.owner,'old-host','图片似乎生成好了')
 assert.equal(f.row(f.owner,'old-host').status,'observed')
 f.report(f.owner,'generated',img,{value:{url:'https://example.test/asset.png?signature=synthetic'}})
 assert.equal(f.row(f.owner,'generated').status,'succeeded')
 assert.doesNotMatch(JSON.stringify(f.row(f.owner,'generated')),/signature|asset\.png/)
})
