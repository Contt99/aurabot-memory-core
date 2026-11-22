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

const owner='private:10001',group='group:20001'
const tieba={type:'action',refKind:'experience',module:'tieba-reader',action:'read',status:'succeeded',
 evidenceType:'provider',occurredAt:now-1000,sourceScopes:[],text:'贴吧帖子：没活解散了得了，回复都在数3'}
const receipt=(id,text,chatId=owner)=>({id:'vault:'+id,eventId:'qq:'+chatId+':out:'+id,messageId:String(id),
 type:'utterance',refKind:'vault',status:'confirmed',text,sourceScopes:[chatId],occurredAt:now-10000})
const grounded=(purpose,chatId,text,items)=>checkDraft(text,{purpose,chatId,items},{now})

test('a real Tieba read cannot prove the bot already sends 3 as a habit',()=>{
 const oldBoast=receipt(8,'我也爱这样，没东西聊的时候就甩个3出去')
 const others={...oldBoast,id:'vault:2',type:'message',status:'archived',text:'3'}
 for(const text of ['我想了想 我好像也爱这样 没东西聊的时候就甩个3出去','我经常发「3」','我以前发过 3']){
  assert.equal(grounded('proactive',owner,text,[tieba,oldBoast,others]).code,'unproven-self-action')
 }
 const first=receipt(3,'3')
 assert.equal(grounded('proactive',owner,'我以前发过 3',[first]).ok,true)
 assert.equal(grounded('proactive',owner,'我经常发「3」',[first,{...first,id:'vault:33'}]).ok,false)
 assert.equal(grounded('proactive',owner,'我经常发「3」',[first,receipt(4,'13'),receipt(5,'3',group)]).ok,false)
 assert.equal(grounded('chat',owner,'我经常发「3」',[first,receipt(6,'3')]).ok,true)
 for(const text of ['看到他们都在数3，我也有点想跟着发一个','说是爱，其实我还没真发过。','我以后想经常发晚安','你说你经常发「3」呀','我也爱听雨，我经常会想起那天。']){
  assert.equal(grounded('chat',owner,text,[tieba]).ok,true,text)
 }
})

test('real outside posts and group-scoped tool results do not prove a QQ group observation',()=>{
 const line='说是爱 其实我还没真发过 就是看群里数得整齐 心里有点痒'
 for(const purpose of ['chat','proactive']){
  assert.equal(grounded(purpose,owner,line,[tieba,receipt(7,'我刚在群里看他们数得整齐')]).code,'unproven-group-source')
 }
 const real={id:'vault:19',type:'message',status:'archived',refKind:'vault',sourceScopes:[group],text:'蓝鲸要换群头像了'}
 assert.equal(grounded('chat',group,'我在群里看到蓝鲸要换群头像了',[real]).ok,true)
 assert.equal(grounded('chat',group,'我在群里看到蓝鲸要换群头像了',[{...real,text:'下周要放假'}]).code,'unproven-group-source')
 assert.equal(grounded('chat',group,'我在群里看到蓝鲸要换群头像了',[{...tieba,sourceScopes:[group],text:real.text}]).code,'unproven-group-source')
 for(const text of ['我是看贴吧帖子里的人在数，不是看群里数得整齐。','我想去看看群里有没有人聊','你那句「我看群里数得整齐」是引用。','他们在贴吧回复区数 3，我也想跟一个。']){
  assert.equal(grounded('chat',owner,text,[tieba]).ok,true,text)
 }
})
