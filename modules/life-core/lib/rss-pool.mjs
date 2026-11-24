const module='rss-reader',prefix='rss-reader:pool:',limitKey='rss-reader:pool;'
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{32,64}$/.test(id)

export function createRssPool({api,active,enabled,now,cfg,ledger,actionCurrent,record}){
 const provider=()=>enabled(module)?api.use(module)?.lifeRss:null
 const scope=()=>'private:'+String(cfg().ownerQQ||'')
 const count=(all=false)=>ledger.database.prepare(
  "SELECT COUNT(*) n FROM actions WHERE callKey>=? AND callKey<? AND at>=? AND status='succeeded'"
 ).get(prefix,limitKey,all?0:new Date(now()).setHours(0,0,0,0)).n
 function current(row){
  const m=row?.meta,target=scope(),feed=m?.arguments?.feedId
  return /^private:[1-9]\d*$/.test(target)&&m?.chatId===target&&validId(feed)&&provider()?.sourceCurrent?.(feed,target)===true
 }
 function material(r){
  return {id:r.id,...r.result,sourceId:r.meta.sourceIds[0],sourceScopes:[r.meta.chatId]}
 }
 function latest(target){
  if(!active()||target!==scope()||!provider())return []
  const rows=ledger.database.prepare(
   "SELECT id FROM actions WHERE callKey>=? AND callKey<? AND status='succeeded' AND deletedAt=0 ORDER BY at DESC,rowid DESC LIMIT 50"
  ).all(prefix,limitKey)
  return rows.map(x=>ledger.get(x.id)).filter(r=>actionCurrent(r)).slice(0,10).map(material)
 }
 function pool(spec){
  const p=provider(),target=scope()
  if(!active()||!p||p.canPool?.(spec,target)!==true||!Array.isArray(spec.items)||spec.items.length>10)return []
  const made=[]
  for(const item of spec.items){
   const bound=Number(p.remaining?.(count()))
   if(!(bound>0))break
   if(!validId(item?.key)||typeof item?.sourceId!=='string')continue
   const src=ledger.get(item.sourceId),m=src?.meta
   if(src?.status!=='succeeded'||m?.module!==module||m.action!=='feed-read'||!actionCurrent(src))continue
   const observed=src.result?.items?.find?.(v=>v.key===item.key)
   if(!observed)continue
   const feedId=m.arguments.feedId,callId='pool:'+feedId+':'+item.key
   if(ledger.byKey(module+':'+callId))continue
   const title=String(observed.title||'（无标题）').slice(0,120),feedTitle=String(src.result.title||'RSS 订阅').slice(0,120),link=observed.link||''
   const text='在 RSS「'+feedTitle+'」读到《'+title+'》的订阅摘要（未读取全文）：'+String(observed.summary||'').slice(0,420)
   const saved=record({module,action:'rss-material',callId,chatId:target,sourceScopes:[target],sourceIds:[src.id],public:false,
    self:true,evidenceType:'rss-summary',arguments:{feedId},occurredAt:src.at},
   {ok:true,key:item.key,text,title,feedTitle,link,at:src.at,publishedAt:observed.at||null,
    score:Number(item.score)||0,hits:Array.isArray(item.hits)?item.hits.slice(0,6):[],state:'pooled',via:'pool'})
   if(saved?.status==='succeeded'&&Array.isArray(saved?.meta?.sourceIds))made.push(material(saved))
  }
  return made
 }
 return{pool,latest,current,count}
}
