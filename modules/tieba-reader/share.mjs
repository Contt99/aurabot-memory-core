const text=(value,max)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)

// Bound the data before encoding. Slicing serialized JSON can drop closing
// quotes/objects, and can make the model choose an index it never really saw.
export function shareInput(interests,posts) {
 const value={interests:text(interests,300),posts:posts.map(p=>({
  title:text(p.title,220),source:text(p.source,160),posts:[]
 }))}
 for(const [i,p] of posts.entries())for(const block of (p.posts||[]).slice(0,5)) {
  const v={section:text(block.section,80),text:text(block.text||block,850)}
  value.posts[i].posts.push(v)
  if(JSON.stringify(value).length>14000){value.posts[i].posts.pop();break}
 }
 return JSON.stringify(value)
}

const diagnostics={
 MODEL_AUTH:'模型鉴权失败，请检查 Aurabot 模型配置',
 MODEL_RATE_LIMIT:'模型服务限额或限流，等待恢复后再试',
 MODEL_TIMEOUT:'模型请求超时',
 MODEL_NETWORK:'连接模型服务失败',
 MODEL_TARGET:'模型不可用或未配置，请检查 Aurabot 模型设置',
 MODEL_PROVIDER:'模型提供方返回错误',
 MODEL_OUTPUT:'模型未返回有效分享选择',
 CONTEXT_UNAVAILABLE:'统一记忆上下文未能准备或已失效，本轮未生成',
 ACCESS_REQUIRED:'贴吧要求登录或安全验证',
 BROWSER_UNAVAILABLE:'浏览器组件不可用，请检查配置',
 READ_TIMEOUT:'读取贴吧超时',
 READ_FAILED:'贴吧读取失败',
 SEND_BLOCKED:'未取得 QQ 成功回执，本轮不计分享',
 LOCAL_FAILED:'无法完成此步骤',
}

export function shareFailure(stage,error) {
 const details=[error,error?.cause].filter(Boolean).map(e=>String(e?.code||'')+' '+String(e?.status||e?.statusCode||'')+' '+String(e?.message||'')).join(' ')
 const has=re=>re.test(details)
 let category='LOCAL_FAILED'
 if(stage==='准备分享上下文')category='CONTEXT_UNAVAILABLE'
 else if(stage==='解析分享选择')category='MODEL_OUTPUT'
 else if(stage==='发送 QQ 分享')category='SEND_BLOCKED'
 else if(stage==='调用模型挑选分享')category=has(/模型请求含失效|记忆快照已失效|未获授权的记忆|经历来源已失效/)?'CONTEXT_UNAVAILABLE'
  :has(/RATE_LIMIT|quota|\bcredits?\b|\b429\b|余额|限流|频率限制|配额/i)?'MODEL_RATE_LIMIT'
  :has(/AUTHENTICATION|UNAUTHORIZED|invalid[_ -]?api[_ -]?key|\b(?:401|403)\b/i)?'MODEL_AUTH'
  :has(/timeout|timed out|ETIMEDOUT|超时/i)?'MODEL_TIMEOUT'
  :has(/拿不到默认模型|没有 llm 服务|not found|model unavailable|unknown model|MODEL_NOT_FOUND/i)?'MODEL_TARGET'
  :has(/ENOTFOUND|ECONN|EAI_AGAIN|fetch failed|network|DNS/i)?'MODEL_NETWORK':'MODEL_PROVIDER'
 else if(stage.startsWith('读取贴吧')||stage==='读取帖子正文')category=has(/安全验证|登录/)?'ACCESS_REQUIRED'
  :has(/Electron|浏览器组件|程序路径|程序不存在/i)?'BROWSER_UNAVAILABLE'
  :has(/超时|timeout/i)?'READ_TIMEOUT':'READ_FAILED'
 // Only our own fixed vocabulary is persisted/logged, never provider payloads.
 return {stage,category,message:diagnostics[category]}
}
