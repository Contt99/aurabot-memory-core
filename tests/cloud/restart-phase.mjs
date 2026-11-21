import assert from 'node:assert/strict'
import path from 'node:path'
import {mock} from 'node:test'
import {chat,installed,makeHost} from './host-fixture.mjs'
import {createLifeAdapter} from '../../modules/purpose/life.mjs'

const stage=process.argv[2],at=Number(process.argv[3]),text='纸风车的尾巴我选了薄荷绿。'
const sdk=await installed(),offs=[]
if(stage==='receive')mock.timers.enable({apis:['Date'],now:Math.trunc(at)+2*86400000})
let observed=false
const {h,hub,dispatched}=makeHost({after:fn=>offs.push(fn)},{
 sdk,directory:path.join(process.env.AURABOT_DATA_DIR,'life-core'),
 model:async request=>{
  const body=request.messages.flatMap(m=>m.content).map(b=>b.text||'').join('\n')
  assert.equal(body.split(text).length,2,'the next request must contain the exact confirmed speech once')
  const line=body.split('\n').find(l=>l.includes(text))
  const original=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(at)
  assert(line.includes(original)&&line.includes('历史记录'),line)
  assert(!body.includes('【你之前在这个聊天里主动说过'))
  const id=body.match(/【记忆快照:([\da-f-]+)】/)[1]
  observed=h.core.contextDetail(id).status==='observed'
 }
})
try {
 if(stage==='send'){
  h.modules['life-core']=h.core
  const adapter=createLifeAdapter({...h.api,id:'purpose'})
  const snapshot=adapter.prepareContext({purpose:'proactive',chatId:chat.chatId})
  const receipt=await adapter.deliver(chat.chatId,text,{own:true},snapshot)
  assert.equal(receipt.ok,true);assert.deepEqual(receipt.receipts,['1'])
  const event=h.core.timeline({chatId:chat.chatId}).find(e=>e.type==='utterance')
  assert.equal(event.data.text,text);assert.equal(event.data.messageId,'1')
  console.log(JSON.stringify({at:event.occurredAt,dispatches:dispatched.length}))
 }else{
  assert.equal(stage,'receive')
  await hub.pushToSession(chat,[{type:'text',text:'怎么挑的？'}],chat.userId)
  console.log(JSON.stringify({observed,dispatches:dispatched.length}))
 }
}finally{
 for(const off of offs.reverse())off()
 if(stage==='receive')mock.timers.reset()
}
