import { createLifeAdapter } from './life.mjs'
// RSS owns fetching, backoff and scoring. Life-core owns the scoped read
// receipt and material pool. Selecting a summary is not an outbound action.

import { parseFeed, extractFeeds, fetchFeed, stripHtml } from './lib/feed.mjs'
import { createStateStore } from './lib/state.mjs'
import { classifyPolicyResult } from './lib/handoff.mjs'
import { createHmac,randomBytes } from 'node:crypto'

const FETCH_TIMEOUT_MS = 15000

export default {
  id: 'rss-reader',
  name: '自主上网',
  version: '1.0.0-life.4',
  api: 1,
  description: '定时读取 RSS，把挑中的订阅摘要保存为主人私聊可用的素材',
  defaults: {
    enabled: false,
    feeds: '',
    fetchMinutes: 120,
    dailyMax: 5,
    minScore: 3,
    perFeed: 2,
    /** carrier：'policy' 交给 api.proactive.submit（推荐）；'pool' 只进素材池等引擎来取。 */
    carrier: 'policy',
  },
  settings: [
    { key: 'enabled', label: '定时自主上网', type: 'switch', hint: '默认关；打开后按间隔读订阅源' },
    { key: 'feeds', label: '订阅源', type: 'textarea', hint: '每行一个 RSS/Atom 地址（http/https），# 开头是注释' },
    { key: 'fetchMinutes', label: '多久看一次（分钟）', type: 'number', min: 15, max: 1440, hint: '默认 120；每轮会加 0~20% 抖动，别让所有源整点撞车' },
    { key: 'dailyMax', label: '每天最多保存几条素材', type: 'number', min: 0, max: 30, hint: '0 = 只读取，不留主动话题素材' },
    { key: 'minScore', label: '兴趣门槛', type: 'number', min: 0, max: 20, hint: '关键词+新鲜度打分低于它的条目直接跳过' },
    { key: 'perFeed', label: '每个源每轮最多挑几条', type: 'number', min: 1, max: 10 },
    { key: 'carrier', label: '原出站方式（兼容）', type: 'select', options: [{ value: 'policy', label: '原决策接口' }, { value: 'pool', label: '只进素材池' }], hint: 'Aurabot 1.2.1 未提供该出站接口；两种设置都只保存素材，不新增 QQ 自动转发。' },
  ],

  setup(api) {
    const life = createLifeAdapter(api)
    const hooks = api.__rssTestHooks || {}
    const store = createStateStore(api.dataDir('rss-state.json'))
    // 拉取实现：测试注入 fake；生产为 null → fetchFeed 内部用全局 fetch（网络能力的唯一出口）。
    const fetchImpl = hooks.fetch || null
    const now = hooks.now || (() => Date.now())
    // 最近一轮挑出来的条目（pool 模式给引擎/面板取用，也是面板「最近看到」的数据源）
    let legacyLatest=[],legacyOwner='',running=false,disposed=false
    api.onDispose?.(()=>{disposed=true})
    const scope=()=>'private:'+String(api.config().ownerQQ||'')
    const identity=(type,value)=>{
      const seed=store.get().identitySeed
      return typeof seed==='string'&&seed.length===64?createHmac('sha256',seed).update(type+'\0'+value).digest('base64url'):''
    }
    function seed(){
      const state=store.get()
      if(typeof state.identitySeed==='string'&&state.identitySeed.length===64)return true
      state.identitySeed=randomBytes(32).toString('hex')
      if(store.save())return true
      delete state.identitySeed
      return false
    }

    const cfgOf = () => {
      const s = api.settings() || {}
      const feeds = extractFeeds(s.feeds)
      return {
        enabled: s.enabled === true,
        feeds,
        fetchMinutes: clampInt(s.fetchMinutes, 120, 15, 1440),
        dailyMax: clampInt(s.dailyMax, 5, 0, 30),
        minScore: clampInt(s.minScore, 3, 0, 20),
        perFeed: clampInt(s.perFeed, 2, 1, 10),
        carrier: s.carrier === 'pool' ? 'pool' : 'policy',
      }
    }
    const poolTickets=new WeakSet()
    let feedSpec,sourceIds=new Set()
    function sourceCurrent(feedId,chatId){
      if(disposed||chatId!==scope())return false
      const s=api.settings()?.feeds
      const spec=String(s||'')+'\0'+String(store.get().identitySeed||'')
      if(spec!==feedSpec){feedSpec=spec;sourceIds=new Set(extractFeeds(s).map(u=>identity('feed',u)).filter(Boolean))}
      return sourceIds.has(feedId)
    }
    const remaining=(already)=>Math.max(0,store.remainingToday(cfgOf().dailyMax,now())-already)
    const latest=()=>life.managed()?life.latest(scope()):legacyOwner===scope()?
      legacyLatest.filter(r=>sourceCurrent(r.feedId,scope())).map(({feedId,...r})=>r):[]

    /** 拉一遍所有源 → 新条目（已去重）。单源失败不影响其他源。 */
    async function fetchAll(cfg,{managed,target}) {
      const st = store.get()
      const at = now()
      const seen = store.seenSet()
      const fresh = []
      const report = { feeds: cfg.feeds.length, ok: 0, failed: [], newItems: 0 }
      for (const url of cfg.feeds) {
        const feedId=identity('feed',url),label=sourceLabel(url)
        if(disposed||target!==scope()||!sourceCurrent(feedId,target))continue
        // 失败退避：没到重试时间就跳过，别把挂掉的源每轮都撞一遍。
        const retryAt = Number(st.nextRetryAt?.[feedId]??st.nextRetryAt?.[url])||0
        if (retryAt > at) {
          report.failed.push({ source:label, reason:'退避中' })
          continue
        }
        const oldKeys=new Map()
        const read=async () => {
          const response = await fetchFeed(url, { fetchImpl, timeoutMs: FETCH_TIMEOUT_MS })
          if (!response.ok) return {ok:false,error:safeFetchFailure(response.error)}
          if(!sourceCurrent(feedId,target))return {ok:false,status:'interrupted',error:'订阅已撤销'}
          const parsed = parseFeed(response.xml)
          if(!parsed.ok)return parsed
          const items=parsed.items.map(({key,source,link,...content})=>{
            const id=identity('item',feedId+key)
            oldKeys.set(id,url+key)
            return{...content,key:id,link:safeArticleLink(link)}
          })
          return {ok:true,title:parsed.title,source:label,items}
        }
        const meta={public:false,chatId:target,sourceScopes:[target],arguments:{feedId},evidenceType:'rss-summary'}
        const observed=managed?await life.observe(read,meta):{value:await life.perform('feed-read',read,meta)}
        const got=observed?.value
        if (!got?.ok) {
          const reason=got?.error||'未取得读取结果'
          if(got?.status!=='interrupted')store.recordFailure(feedId,at)
          report.failed.push({ source:label, reason })
          api.log.warn(`自主上网：${label} 取不到：${reason}`)
          continue
        }
        if(!sourceCurrent(feedId,target)||managed&&!observed.experienceId)continue
        store.recordSuccess(feedId)
        report.ok += 1
        let taken = 0
        for (const item of got.items) {
          if (taken >= cfg.perFeed) break
          if (seen.has(item.key)||seen.has(oldKeys.get(item.key))) continue
          seen.add(item.key)
          fresh.push({ ...item, feedTitle:got.title||item.feedTitle||label,sourceId:observed.experienceId,feedId })
          taken += 1
        }
      }
      st.lastFetchAt = at
      report.newItems = fresh.length
      return { items: fresh, report }
    }

    /** 打分排序 + 限额挑选。 */
    function pick(items, cfg, at, managed) {
      const remain = Math.max(0,store.remainingToday(cfg.dailyMax, at)-(managed?life.count():0))
      if (!(remain > 0) || !items.length) return []
      const scored = items
        .map((it) => ({ item: it, ...store.scoreEntry(it, at) }))
        .filter((x) => x.score >= cfg.minScore)
        .sort((a, b) => b.score - a.score || (b.item.at || 0) - (a.item.at || 0))
      return scored.slice(0, Math.min(remain, 10))
    }

    /** 组装交给决策层的文本：标题 + 摘要 + 链接，明确标注是外部内容。 */
    function feedText(hit) {
      const it = hit.item
      const bits = [`在「${clip(it.feedTitle, 40)}」看到《${clip(it.title || '（无标题）', 80)}》`]
      if (it.summary) bits.push(clip(it.summary, 200))
      if (it.link) bits.push(`（链接：${clip(it.link, 200)}）`)
      return bits.join('。')
    }

    /** 把一条挑中的条目交给主动发言层。返回 { ok, state, via }。 */
    async function handOff(hit, cfg) {
      const text = feedText(hit)
      if (cfg.carrier === 'pool') return { ok: true, state: 'pooled', via: 'pool', text }
      // 优先走主动发言决策面（broker/feed）：模块只递素材，发不发由引擎决定。
      let proactive = null
      try { proactive = api.proactive || null } catch { proactive = null }
      if (proactive && proactive.available && typeof proactive.submit === 'function') {
        try {
          const r = await life.propose('qq', `private:${api.config().ownerQQ}`, () => proactive.submit({
            itemId: hit.item.key,
            text,
            link: hit.item.link || null,
            channel: 'qq',
            cause: { kind: 'background', source: 'rss-reader' },
          }))
          const result = classifyPolicyResult(r, hit.item.key)
          return { ok: result.accepted, ...result, via: 'policy', text }
        } catch (error) {
          api.log.warn(`自主上网：交给决策层失败，退化为素材池：${error?.message}`)
        }
      }
      // 宿主没装出站策略 / 决策面不可用：退化成素材池，由调用方（目的引擎）自取。
      return { ok: true, state: 'pooled', via: 'pool', text }
    }

    /** 跑一轮：拉取 → 挑选 → 交付。可被定时器或面板手动触发。 */
    function runOnce(options = {}) { return life.propose('background', undefined, () => runAttempt(options)) }

    async function runAttempt({ fresh = false } = {}) {
      const managed=life.managed(),target=scope()
      if (!fresh && !managed) return {ok:false,reason:'life-core-unavailable',message:'统一读取接口不可用，自动阅读已暂停'}
      if(!/^private:[1-9]\d*$/.test(target))return{ok:false,reason:'owner-unavailable'}
      const cfg = cfgOf()
      if (!cfg.enabled && !fresh) return { ok: false, reason: 'disabled' }
      if (!cfg.feeds.length) return { ok: false, reason: 'no-feeds' }
      if (running) return { ok: false, reason: 'busy' }
      running = true
      try {
        if(!seed())return{ok:false,reason:'storage',message:'订阅来源身份未保存'}
        const at = now()
        const {items,report}=await fetchAll(cfg,{managed,target})
        const picked=pick(items,cfg,at,managed)
        let delivered=[]
        if(managed){
          const spec={items:picked.map(({item,score,hits})=>({key:item.key,sourceId:item.sourceId,score,hits}))}
          poolTickets.add(spec)
          try{delivered=life.pool(spec)}finally{poolTickets.delete(spec)}
        }else{
          for(const hit of picked){
            if(!sourceCurrent(hit.item.feedId,target))continue
            const r=await handOff(hit,cfg)
            delivered.push({key:hit.item.key,title:hit.item.title,link:hit.item.link,feedId:hit.item.feedId,feedTitle:hit.item.feedTitle,at,
             publishedAt:hit.item.at||null,score:hit.score,hits:hit.hits,...r})
          }
          if(delivered.length)store.countFed(delivered.length,at)
          legacyLatest=delivered;legacyOwner=target
        }
        store.markSeen(items.map(i=>i.key))
        if(!store.save())return {ok:false,reason:'storage',message:'已读取，但没有保存本轮订阅状态',report,delivered,at}
        api.log.info(`自主上网：拉了 ${report.ok}/${report.feeds} 个源，新条目 ${report.newItems}，挑了 ${delivered.length} 条`)
        return { ok: true, report, delivered, at }
      }catch{
        return {ok:false,reason:'recording-failed',message:'订阅经历未能完整记录'}
      }finally{
        running = false
      }
    }

    // 定时：每 5 分钟看一次到点没（拉取间隔自己判断，不空转网络）。
    const rssTick=() => {
      const cfg = cfgOf()
      if (!cfg.enabled || !cfg.feeds.length) return
      const st = store.get()
      const at = now()
      // 抖动：间隔的 ±20%，避免整点集体撞车。
      const jitter = cfg.fetchMinutes * 0.2
      const dueMs = Math.max(15, cfg.fetchMinutes + (Math.random() * 2 - 1) * jitter) * 60_000
      if (at - (Number(st.lastFetchAt) || 0) < dueMs) return
      return runOnce()
    }
    const fetchClock={id:'fetch-tick',label:'RSS 到期检查',intervalMs:5 * 60_000,run:rssTick}
    api.every(fetchClock.intervalMs, () => {
      if(!api.use('life-core')?.ownsSchedule?.('rss-reader',fetchClock.id))return rssTick()
    }, '自主上网（旧核心兼容）')

    // ---------- 面板 ----------
    const status=()=>{
      const s=store.status(),config=cfgOf()
      const failing=config.feeds.filter(u=>s.failing.includes(identity('feed',u))||s.failing.includes(u)).map(sourceLabel)
      return {...s,sentToday:(s.day===store.dayKey(now())?s.sentToday:0)+(life.managed()?life.count():0),failing,
        stats:{...s.stats,fed:(Number(s.stats.fed)||0)+(life.managed()?life.count(true):0)}}
    }
    api.route('/state', async () => {
      const {feeds,...config}=cfgOf()
      return {ok:true,...status(),config,feedsCount:feeds.length,managed:life.managed(),latest:latest()}
    })
    api.route('/run', async () => runOnce({ fresh: true }))
    api.route('/latest', async () => ({ ok: true, items: latest() }))
    api.route('/feeds/test', async (req) => {
      // 试抓一个源（面板「测试」按钮）：只回标题与条数，不写已读。
      let url = ''
      try { url = String(req.method==='POST'?(await api.core.http.body(req))?.url:new URL(req.url, 'http://x').searchParams.get('url')||'').trim() } catch { url = '' }
      if (!/^https?:\/\//i.test(url)) return { ok: false, error: '只支持 http(s)' }
      const got = await fetchFeed(url, { fetchImpl, timeoutMs: FETCH_TIMEOUT_MS })
      if (!got.ok) return { ok: false, error: safeFetchFailure(got.error) }
      const parsed = parseFeed(got.xml)
      if (!parsed.ok) return { ok: false, error: parsed.error }
      return { ok: true, title: parsed.title, count: parsed.items.length, sample: parsed.items.slice(0, 5).map((i) => ({ title: i.title, at: i.at })) }
    })

    // ---------- 给引擎/其他模块的控件面 ----------
    return {
      lifeSchedules:()=>[fetchClock],
      lifeRss:{sourceCurrent,canPool:(spec,target)=>!disposed&&target===scope()&&poolTickets.has(spec),remaining},
      latest,
      /** 手动跑一轮（面板 /run 同款）。 */
      run: (o) => runOnce(o),
      /** 状态摘要。 */
      status,
      materials: ({chatId}={}) => (chatId===scope()?latest():[])
        .filter((d) => d.state === 'pooled' || d.state === 'pending' || d.state === 'sent' || d.state === 'sent-unconfirmed' || d.state === 'deferred')
        .map((d) => ({
          id:d.id||`rss:${d.key}`,
          title: clip(d.title, 90),
          text: clip(d.text, 220),
          url: d.link || '',
          at:d.at,publishedAt:d.publishedAt,sourceId:d.sourceId,sourceScopes:[chatId],
        })),
    }
  },
}

function sourceLabel(raw){
  try{return new URL(raw).hostname||'订阅源'}catch{return '订阅源'}
}
function safeArticleLink(raw){
  try {
    const u=new URL(raw)
    if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return ''
    for(const key of [...u.searchParams.keys()])if(/token|sign|auth|key|pass|secret|cookie|session/i.test(key))u.searchParams.delete(key)
    u.hash=''
    return u.href
  }catch{return ''}
}
function safeFetchFailure(error){
  const s=String(error||'')
  return /^(?:HTTP \d{3}|超时|内容超限|空内容)$/.test(s)?s:'读取失败'
}

function clampInt(v, def, lo, hi) {
  const n = Number(v)
  if (!Number.isFinite(n)) return def
  return Math.min(hi, Math.max(lo, Math.round(n)))
}

function clip(text, max) {
  const s = stripHtml(String(text ?? ''), max)
  return s.length > max ? `${s.slice(0, max)}…` : s
}
