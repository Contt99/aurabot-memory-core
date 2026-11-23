// Providers run with host module privileges. A declaration is a compatibility
// contract, not a sandbox; a market module must still be trusted at installation.
export function registeredTools(api,enabled) {
 const granted=new Set(String(api.settings().autonomyTools||'').split(/[\s,，]+/).filter(Boolean))
 const tools=new Map()
 for(const {id:module,running} of api.core.modules?.status?.()||[]){
  if(!running||typeof module!=='string'||!enabled(module)||!(/^[a-z][a-z0-9-]{0,39}$/.test(module)))continue
  const provider=api.use(module)
  if(typeof provider?.lifeCapabilities!=='function')continue
  let offered
  try{offered=provider.lifeCapabilities()}catch{continue}
  if(!Array.isArray(offered))continue
  for(const item of offered.slice(0,16)){
   if(!item||item.effect!=='read'||typeof item.id!=='string'||!(/^[a-z][a-z0-9_]{0,23}$/.test(item.id))||typeof item.run!=='function')continue
   const id=module+'--'+item.id
   // An ambiguous name never routes to whichever entry happened to load last.
   if(tools.has(id)){tools.set(id,null);continue}
   const args=Object.fromEntries(Object.entries(item.args||{}).filter(([k,v])=>/^[a-z][a-z0-9_]{0,32}$/i.test(k)&&typeof v==='string').slice(0,16).map(([k,v])=>[k,v.slice(0,160)]))
   const required=Array.isArray(item.required)?item.required.filter(k=>Object.hasOwn(args,k)):[]
   const available=item.available!==false&&granted.has(id)
   tools.set(id,{id,module,name:String(item.name||item.id).slice(0,60),args,required,available,
    reason:available?'':item.available===false?'服务当前不可用':'尚未授权自主生活',run:item.run})
  }
 }
 return [...tools.values()].filter(Boolean)
}

export function declaredArguments(tool,value) {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('工具参数必须是对象')
 const args={}
 for(const [key,text] of Object.entries(value)){
  if(!Object.hasOwn(tool.args,key)||typeof text!=='string'||text.length>2500)throw Error('参数未声明或超长：'+key)
  args[key]=text
 }
 if(tool.required.some(k=>!args[k]?.trim()))throw Error('缺少工具必填参数')
 return args
}
