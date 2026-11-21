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
