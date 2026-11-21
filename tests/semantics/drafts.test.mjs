import {test} from 'node:test'
import assert from 'node:assert/strict'
import {checkDraft} from '../../modules/life-core/lib/draft-check.mjs'
const now=Date.parse('2026-01-12T12:00:00+08:00')
const msg=(text,age=0,type='message')=>({text,occurredAt:now-age,type,status:type==='utterance'?'confirmed':'archived',sourceScopes:['group:20001']})
const audit=(text,...items)=>checkDraft(text,{items},{now})
test('recent unrelated chatter cannot make a dated quote recent',()=>{
 const old=msg('这家店的桃子做成果酱很好吃',3*86400000),fresh=msg('午饭在哪里吃？')
 assert.equal(audit('刚在群里看到有人说桃子做成果酱很好吃。',old,fresh).ok,false)
 assert.equal(audit('刚想起那天有人说桃子做成果酱很好吃。',old,fresh).ok,true)
 assert.equal(audit('刚在群里看到有人问午饭在哪里吃。',old,fresh).ok,true)
})
test('self-denial of a specific confirmed utterance is not a change of mind',()=>{
 const self=msg('蓝色水杯放在窗台上。',60000,'utterance')
 assert.equal(audit('我没让你把水杯放在窗台上。',self).ok,false)
 assert.equal(audit('我现在不想让你把水杯放在窗台上啦。',self).ok,true)
 assert.equal(audit('我没让你把水杯放在窗台上。',msg(self.text)).ok,true)
})
test('a successful save or search is not evidence of having read an article',()=>{
 const action=evidenceType=>({type:'action',status:'succeeded',evidenceType,occurredAt:now})
 assert.equal(audit('我读完这篇文章了。',action('note')).ok,false)
 assert.equal(audit('我读完这篇文章了。',action('search-summary')).ok,false)
 assert.equal(audit('我读完这篇文章了。',action('web-body')).ok,true)
 assert.equal(audit('我还没完成整理。我已经读完这篇文章了。',action('note')).ok,false)
})
test('sensitive public drafts are blocked without applying the same rule to a private chat',()=>{
 const publicDraft={purpose:'public-diary',items:[]}
 for(const text of ['联系这个号 5550012345678','邮箱 test@example.invalid','密码：synthetic-secret'])
  assert.equal(checkDraft(text,publicDraft,{now}).ok,false)
 assert.equal(checkDraft('来源：https://www.bilibili.com/video/1234567890',publicDraft,{now}).ok,true)
 assert.equal(checkDraft('编号 5550012345678',{purpose:'chat',items:[]},{now}).ok,true)
})
