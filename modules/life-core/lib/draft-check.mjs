import {publicSafe,secretText} from './policy.mjs'
const MINUTE=60000
const day=at=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(at)
// Only attribute a specific quote when a distinctive contiguous phrase matches.
// Paraphrases without reliable lexical evidence remain a model judgment.
function sharedPhrase(a,b) {
 const norm=s=>String(s||'').toLowerCase().replace(/[\s\p{P}]/gu,'').slice(0,1200)
 const x=norm(a).slice(0,300),y=norm(b)
 for(let n=Math.min(18,x.length,y.length);n>=4;n--)for(let i=0;i+n<=x.length;i++)if(y.includes(x.slice(i,i+n)))return n
 return 0
}
// These checks cover attributable chat behavior, not the persona's tastes or feelings.
// A prior sentence saying "I do that" is not a receipt for doing it.
const payloadText=s=>String(s||'').normalize('NFKC').trim().replace(/^[「『“"'‘]+|[」』”"'’。！!？?]+$/g,'').trim()
const imagined=/(?:并非|不是|没(?:有)?|并没|不曾|不可能|想(?:去)?|打算|准备|希望|假如|如果|以后|将来|下次)(?:\s*(?:真|再|也|就|先|亲自|我|会|想去)){0,4}\s*$/
function chatClaims(prose,snapshot,fail) {
 const records=(snapshot.items||[]).filter(i=>i.refKind==='vault'&&i.sourceScopes?.length===1&&i.sourceScopes[0]===snapshot.chatId)
 const receipts=records.filter(i=>i.type==='utterance'&&i.status==='confirmed'&&i.messageId)
 const groupMessages=records.filter(i=>i.type==='message'&&i.status==='archived'&&/^group:\d+$/.test(snapshot.chatId))
 // Leave quoted payloads such as 「3」 intact, but don't validate a sentence being quoted.
 const text=prose.replace(/[「『“]([^」』”\n]*)[」』”]/g,(whole,inside)=>inside.length>4&&/(?:我|群里|群聊)/.test(inside)?'【引文】':whole)
 for(const sentence of text.split(/[。！；;\n]+/)){
  if(/[？?]\s*$/.test(sentence))continue
  for(const clause of sentence.split(/[，,]/)){
   for(const m of clause.matchAll(/(?<!看)(?:看(?:到|见|了)?|读到|听到|瞧见|发现)(?:在|从)?(?:QQ\s*)?群(?:里|聊(?:里)?)|(?:在|从)(?:QQ\s*)?群(?:里|聊(?:里)?)(?:刚刚?|之前|昨天|今天|也|又)?(?:看到|看见|读到|听到|瞧见|发现)/gi)){
    const before=clause.slice(0,m.index),topic=clause.slice(m.index+m[0].length)
    if(imagined.test(before)||/(?:你|他|她|他们|她们|让)[正刚也曾都在说的]{0,4}$/.test(before))continue
    // Authorization of a result for this group is not evidence it came from a group.
    if(!groupMessages.some(i=>sharedPhrase(topic,i.text)>=4))
     return fail('unproven-group-source','没有与所述内容对应的 QQ 群消息，不能把外部素材或猜测写成群聊经历')
   }
   const forms=[
    {pattern:/我(?:也|还|都|可|就|好像|以前|之前|平时|有时|偶尔|经常|常常|总是|常|一直|每次|通常|习惯|爱|喜欢|会|都会|有时候|真的?){0,8}(?:发过|发给过|回过|贴过|丢过|甩过)(.+?)(?=\s{2,}|$)/g,count:1},
    {pattern:/我(?:也|还|都|可|就|好像|会|平时|的确|的确会){0,5}(?:经常|常常|总是|常|每次都|通常|习惯(?:性地)?|动不动就|总爱)(?:会|去|给你|给大家)?(?:发|甩|丢|贴|回)(.+?)(?=\s{2,}|$)/g,count:2},
    {pattern:/的时候\s*(?:我)?(?:也)?就\s*(?:会|爱)?(?:随手)?(?:甩|丢|发|回)\s*(.+?)(?=\s{2,}|$)/g,count:2,implicit:true}
   ]
   for(const form of forms)for(const m of clause.matchAll(form.pattern)){
    const before=clause.slice(0,m.index)
    if(imagined.test(before)||form.implicit&&(!/我(?:[^。；]{0,60})(?:也爱|也会|就是|平时|喜欢|经常|经常会|习惯)/.test(sentence)
      ||/(?:假如|如果|以后|下次|我(?:想要|打算|准备|希望))/.test(sentence.slice(0,sentence.indexOf(m[0])))))continue
    const raw=m.at(-1).replace(/^(?:个|一个|一句|一张)\s*(?=[「『“"\d])/,'').replace(/(?:出去|过去|试试|呀|啊|的|啦)\s*$/,'')
    const quoted=raw.match(/^[「『“"']([^」』”"']+)[」』”"']/)
    const payload=payloadText(quoted?.[1]??raw)
    // Count distinct matching native sends, never repeated snapshots of one receipt.
    const proof=new Set(receipts.filter(i=>payload&&payloadText(i.text)===payload).map(i=>String(i.messageId)))
    if(proof.size<form.count)return fail('unproven-self-action',form.count>1?'没有多次对应的发送记录，不能说成自己的习惯':'没有对应的发送记录，不能把想法写成自己做过')
   }
  }
 }
 return{ok:true}
}
export function beijingTime(at) {return at>0?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(at):'时间未知'}
export function timeMeaning(item,now=Date.now()) {
 const at=Number(item.occurredAt??item.at)||0
 if(!at)return'原事时间未知'
 if(at>now)return'来源时间异常，不是当前事实'
 return`${beijingTime(at)} 北京时间；${now-at<=10*MINUTE?'近期来源':day(at)===day(now)?'今日较早记录':'历史记录，不是当前现场'}`
}
export function checkDraft(text,snapshot,{now=Date.now(),actions=[]}={}) {
 const prose=String(text||''),items=snapshot?.items||[],fail=(code,message)=>({ok:false,code,message})
 if(['public-diary','public-share'].includes(snapshot?.purpose)&&
    (secretText(prose)||!publicSafe(prose.replace(/https?:\/\/[^\s；，。"'<>]+/g,'[来源链接]'))))
  return fail('public-sensitive','公开草稿含疑似账号、联系方式或凭据，本次未发布')
 if(['chat','proactive'].includes(snapshot?.purpose)){
  const grounding=chatClaims(prose,snapshot,fail)
  if(!grounding.ok)return grounding
 }
 const parts=prose.split(/[。！？；\n]/)
 for(const clause of parts) {
  const denial=/我(?:刚才|刚刚|之前|可)?(?:没(?:有)?|从没|从未)(?:让你|叫你|说过|提过|要求你)([^，。！？；]{4,})/.exec(clause)
  if(denial&&items.some(i=>i.type==='utterance'&&i.status==='confirmed'&&sharedPhrase(denial[1],i.text)>=4&&!/(?:别|不用|不要|不必|没让)/.test(i.text)))
   return fail('denied-utterance','这句话否认了同一聊天中自己确实说过的内容')
  const m=/(?:刚(?:刚|才)?(?:在[^，。！？\n]{0,16})?(?:看到|看见|读到|刷到|听到)|(?:群里|群聊|贴吧|B站)[^，。！？\n]{0,6}(?:正在|刚刚|刚才)|群里(?:在|正)(?:聊|讨论|说|比))/.exec(clause)
  if(!m)continue
  const prefix=clause.slice(0,m.index)
  if(/之前|以前|前几天|那天|当时|昨天|上周|想起|回想|回忆/.test(prefix)&&!/现在|此刻|这会儿/.test(prefix))continue
  const group=/群里|群聊/.test(m[0]),media=/读到|刷到|B站|贴吧/.test(m[0])
  const possible=[...items,...actions].filter(i=>group?(i.sourceScopes||[]).some(s=>s.startsWith('group:')):media?!['message','utterance','profile','fact'].includes(i.type):i.type!=='utterance')
  const phrase=clause.slice(m.index+m[0].length)
  const ranked=possible.map(i=>({i,score:sharedPhrase(phrase,i.text)})),best=Math.max(0,...ranked.map(r=>r.score))
  const referenced=best>=4?ranked.filter(r=>r.score===best).map(r=>r.i):possible
  if(!referenced.some(i=>{const at=Number(i.occurredAt??i.at)||0;return at>0&&at<=now&&now-at<=10*MINUTE}))return fail('source-time','来源不支持“刚看到/正在发生”，本次未发送')
 }
 if(/(?:今天在群|今天群里|群里今天|今天发生)/.test(prose)&&!items.some(i=>{const at=Number(i.occurredAt??i.at)||0;return at>0&&at<=now&&day(at)===day(now)&&(i.sourceScopes||[]).some(s=>s.startsWith('group:'))}))return fail('source-day','历史或未知来源不能写成今天发生')
 for(const clause of parts.flatMap(p=>p.split(/[，,]/))) {
  const completion=/(?:我(?:已经|刚刚|刚|也)?|已经)(完成|做好|查明|读完|保存好|启动了|开始探索)/.exec(clause)
  if(!completion||/(?:还没|没有|尚未|不能|不算|想|打算|准备|计划)[^，]{0,8}$/.test(clause.slice(0,completion.index)))continue
  const result=[...items,...actions].some(i=>{
   if(i.status!=='succeeded'||['message','utterance','profile','fact'].includes(i.type)||['search-summary','task-submission','outbound-attempt','qq-ack'].includes(i.evidenceType))return false
   if(completion[1]==='读完')return ['web-body','thread-body','article-body','subtitle','subtitles','platform-read'].includes(i.evidenceType)
   if(completion[1]==='保存好'&&/笔记/.test(clause))return i.evidenceType==='note'
   return true
  })
  if(!result)return fail('unproven-completion','尚无相应真实执行结果，不能把意向或受理写成完成')
 }
 return{ok:true}
}
