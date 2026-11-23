// QQ 空间：发说说 + 空间日记（每天 N 次，时间窗里随机，结合当天聊天）。

let dataDir, readJson, writeJson
let fetchImage
import {  resolveAudience  } from './qzone-audience.js'
let cleanOutboundText

const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number)
  return h * 60 + m
}
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Decode model-written line breaks in Qzone prose, not arbitrary JSON escapes.
 * Keep code examples, Windows/UNC paths and URLs literal. */
export function normalizeQzoneText(value) {
  return String(value || '').replace(
    /(```[\s\S]*?(?:```|$)|`[^`\n]*(?:`|$)|[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s<>\\]+|(?:[a-zA-Z]:\\|\.{1,2}\\|\\\\)[^<>\r\n，。；！？“”"'`]+)|(\\r\\n|\\n|\\r)/g,
    (match, literal) => literal ?? '\n',
  )
}

/** 给某一天排日记时间：窗口内随机 n 个时刻，两两间隔 ≥ gap 分钟。纯函数（rand 可注入）。 */
export function planDiaryTimes({ timesPerDay, windowStart, windowEnd, minGapMinutes }, rand = Math.random) {
  const a = toMin(windowStart)
  const b = toMin(windowEnd)
  const n = Math.max(0, Math.round(timesPerDay))
  if (n === 0 || b <= a) return []
  const span = b - a
  const gap = Math.min(minGapMinutes, Math.floor(span / Math.max(n, 1)))
  for (let attempt = 0; attempt < 200; attempt++) {
    const pts = Array.from({ length: n }, () => a + Math.floor(rand() * span)).sort((x, y) => x - y)
    if (pts.every((p, i) => i === 0 || p - pts[i - 1] >= gap)) return pts
  }
  // 实在排不开就均分
  return Array.from({ length: n }, (_, i) => a + Math.floor((span / n) * (i + 0.5)))
}

export function createQzone({ getConfig, onebot, hub, log, onDiary, pickImage, composeDiary, life, now = Date.now, rand = Math.random }) {
  const file = () => dataDir('diary.json')
  const state = () => readJson(file(), () => ({ plan: { day: '', times: [], done: [] }, history: [] }))
  const save = (s) => writeJson(file(), s)
  let busy = false
  const minuteOf = at => new Date(at).getHours()*60+new Date(at).getMinutes()
  const todayOf = at => dayKey(new Date(at))
  const target = () => 'qzone:'+String(hub?.selfId||getConfig().botQQ||'current')
  const todayPublished = (history,at=now()) => history.some(r=>r.ok&&!r.dryRun&&todayOf(r.at)===todayOf(at))||
    Boolean(life?.diaryReceipts?.(target(),new Date(at).setHours(0,0,0,0)))

  async function post(content, { images = [], visibility, beforeSend, sourceScopes = ['private:' + getConfig().ownerQQ], sourceRefs=[], commit } = {}) {
    const cfg = getConfig()
    const text = cleanOutboundText(normalizeQzoneText(content), { warn: (message) => log.warn(`空间：${message}`) }).trim()
    if (!text) return { ok: false, message: '说说是空的' }
    // 面板定的范围说了算；单次请求只能收窄成「仅自己」，不能扩大。
    let audience
    try { audience = resolveAudience(cfg, visibility) } catch (error) { return { ok: false, message: error.message } }
    if (!cfg.enabled) return { ok: false, message: '总开关关着' }
    if (cfg.dryRun) {
      if(commit)return {ok:false,message:'已切换到试运行，空间候选未发布'}
      log.info(`试运行：本来要发说说（${audience.label}）：${text.slice(0, 60)}`)
      return { ok: true, tid: '', dryRun: true, visibility: audience.visibility, label: audience.label, target_uins: audience.target_uins || [] }
    }
    const imgs = []
    const imageIndexes = []
    for (const [index, src] of images.entries()) {
      try {
        imgs.push('base64://' + (await fetchImage(src, { maxBytes: 1024 * 1024 * 1024 })).toString('base64'))
        imageIndexes.push(index)
      } catch (error) {
        log.warn('说说配图读不到，跳过：', error.message)
      }
    }
    try {
      // 下载图片可能花几秒，发布前用最新配置再算一次，免得中途改了范围还按旧的发出去。
      await beforeSend?.()
      const send = async () => {
        if(!commit)await beforeSend?.()
        const latest=getConfig()
        audience=resolveAudience(latest,visibility)
        if(!latest.enabled||latest.dryRun)return {ok:false,message:'发布前开关已变化，本次未发布。'}
        const response = await onebot.call('send_qzone_msg', { content: text, ugc_right: audience.ugc_right, ...(audience.target_uins ? { target_uins: audience.target_uins } : {}), ...(imgs.length ? { images: imgs } : {}) }, { timeoutMs: 60000, ...(commit&&{retries:0}) })
        // SnowLuma 2.4.2 returns data {tid: string, time: integer}. Keep
        // older bridge compatibility for explicit/manual posts only.
        const nativeReceipt=typeof response?.tid==='string'&&Number.isInteger(response.time)&&response.time>0
        const raw = commit ? (nativeReceipt?response.tid:'') : response?.tid ?? response?.id ?? response
        const tid = typeof raw==='string'||typeof raw==='number'?String(raw):''
        return response?.ok===false||response?.dryRun||response?.simulated||!/^[A-Za-z0-9_-]{1,128}$/.test(tid)||/^sim-/i.test(tid)
          ?{ok:false,message:!commit&&response?.message||'平台未返回说说编号，结果待确认，不自动重发'}
          :{ok:true,tid}
      }
      const r = commit ? await commit({sources:sourceRefs},send) : life ? await life.perform('publish', send, { evidenceType: 'ack', sourceScopes, kind: 'reflection' }) : await send()
      if (!r?.ok) return r
      const tid = r.tid
      log.info(`发了一条说说（${audience.label}，tid ${tid || '?'}）`)
      return { ok: true, tid, visibility: audience.visibility, label: audience.label, target_uins: audience.target_uins || [], imageCount: imgs.length, imageIndexes }
    } catch (error) {
      const message=commit?'空间候选发布未确认':error.message
      log.warn('发说说失败：', message)
      return { ok: false, message }
    }
  }

  async function remove(tid) {
    tid = String(tid || '').trim()
    if (!tid) throw new Error('缺少说说 ID')
    const result = await onebot.call('delete_qzone_msg', { tid })
    const s = state()
    let changed = false
    for (const entry of s.history) {
      if (String(entry.tid) === tid) {
        entry.deletedAt = Date.now()
        changed = true
      }
    }
    if (changed) save(s)
    return result
  }

  // 空间里的删除不一定经过本插件（手机上删、被系统删），所以定期拿空间列表和本地记录对账。
  // 只有完整读完列表才敢把缺失的记录判成“已删除”，读不全就只返回提示，绝不动数据。
  let syncingHistory = null
  function syncHistory() {
    if (syncingHistory) return syncingHistory
    syncingHistory = (async () => {
      if (!state().history.some((d) => d.tid && d.ok && !d.dryRun && !d.deletedAt)) return { ok: true }
      try {
        const startedAt = Date.now()
        const ids = new Set()
        let total = null
        let complete = false
        let pos = 0
        // #70：SnowLuma 单页上限约 30，请求 num=100 会被网关截断成 10 条（num=200 直接 0 条），
        // 再按 100 步进 pos 会错位、读不全。现在按 30 一页、按实际返回条数推进，
        // 并以「没有新 id / 没有新页」作为停止条件，不假设网关一定按请求页大小给。
        const PAGE = 30
        for (let pages = 0; pages < 200; pages++) {
          const page = await onebot.call('get_qzone_msg_list', { pos, num: PAGE }, { timeoutMs: 12000 })
          if (!Array.isArray(page?.msglist) || !Number.isInteger(page.total) || page.total < 0) throw new Error('空间列表格式不完整')
          if (total !== null && total !== page.total) throw new Error('空间列表正在变化，请稍后刷新')
          total = page.total
          let added = 0
          for (const item of page.msglist) {
            if (!item?.tid) throw new Error('空间列表缺少说说 ID')
            const tid = String(item.tid)
            if (!ids.has(tid)) { ids.add(tid); added++ }
          }
          if (ids.size >= total) { complete = true; break }
          // 空页 / 网关反复返回同一页：没有新内容就停，读不完整也不判删除
          if (!page.msglist.length || added === 0) break
          pos += page.msglist.length
        }
        const s = state()
        const checkedAt = Date.now()
        for (const entry of s.history) {
          if (!entry.tid || !entry.ok || entry.dryRun || entry.deletedAt || entry.at > startedAt) continue
          if (ids.has(String(entry.tid))) entry.remoteCheckedAt = checkedAt
          else if (complete) { entry.deletedAt = checkedAt; entry.deletedSource = 'space-list' }
        }
        save(s)
        return { ok: true, ...(complete ? {} : { warning: '空间列表未完整读取，未将缺失记录判定为已删除。' }) }
      } catch (error) {
        return { ok: false, warning: '未能核对空间状态：' + error.message + '；保留原有记录。' }
      }
    })().finally(() => { syncingHistory = null })
    return syncingHistory
  }

  /** 写一篇并发出去。 */
  async function writeDiary({ visibility, preview = false, manual = true, commit } = {}) {
    if (busy) return { ok: false, message: '上一篇还在写' }
    busy = true
    try {
      const cfg = getConfig().diary
      // 名单/范围不合法就别让模型白写一篇再失败
      try { resolveAudience(getConfig(), visibility) } catch (error) { return { ok: false, message: error.message } }
      if (!preview && todayPublished(state().history)) return { ok: false, message: '今天已经写过一篇空间日记了' }
      if (!preview && manual && life?.diaryPending?.(target(),todayOf(now()))) {
        return {ok:false,status:'unknown',message:'今天的空间日记发布结果待核实。请先打开 QQ 空间查看；不会再生成一篇，以免重复。'}
      }
      if (composeDiary) {
        const composed = await composeDiary({ history: state().history, allowLegacy: manual || preview })
        const draft = { ...composed, images: [...(composed.images || [])], text: normalizeQzoneText(composed.text) }
        if (!cfg.rich?.enabled && cfg.attachImage !== false && !draft.images.length) {
          try { const image = await pickImage?.(); if (image) draft.images.push(image) }
          catch (error) { log.warn('日记配图没挑成：', error.message) }
        }
        const audience = resolveAudience(getConfig(), visibility)
        const details = { text: draft.text, media: draft.media, warnings: draft.warnings, visibility: audience.visibility, label: audience.label }
        if (preview) return { ok: true, preview: true, ...details }
        await draft.beforeSend?.()
        const r = await post(draft.text, { images: draft.images, visibility, beforeSend: draft.beforeSend, sourceScopes: draft.sourceScopes, sourceRefs:draft.sourceRefs,commit })
        const retainDraft=r.ok&&(!commit||!r.dryRun)
        const s = state()
        s.history.unshift({
          at: now(), text: retainDraft?draft.text:'', ok: r.ok, tid: r.tid || '', dryRun: Boolean(r.dryRun),
          visibility: r.visibility || audience.visibility, target_uins: r.target_uins || [],
          error: r.ok ? '' : r.message, media: (r.imageIndexes || []).map((index) => draft.media[index]),
          imageCount: r.imageCount || 0, warnings: draft.warnings, sourceIds: retainDraft?draft.sourceIds||[]:[], sourceScopes: retainDraft?draft.sourceScopes||[]:[],
        })
        s.history = s.history.slice(0, 100)
        save(s)
        if (r.ok && !r.dryRun) {
          try { onDiary?.(draft.text) } catch (error) {}
        }
        return { ...details, ...r, images: r.imageCount || 0 }
      }
      return { ok: false, message: '公开日记来源服务不可用，本次未发布' }
    } catch (error) {
      const message=commit?'空间日记正文未通过准备或权限检查':error.message
      log.warn('写日记失败：', message)
      return { ok: false, message }
    } finally {
      busy = false
    }
  }

  /** 每分钟调一次。 */
  const job = {
    id:'publish',kind:'public-diary',
    canRun(row){
      const cfg=getConfig(),at=now(),minute=minuteOf(at)
      return cfg.enabled&&cfg.diary.enabled&&cfg.diary.timesPerDay>0&&row.target===target()&&todayOf(row.createdAt)===todayOf(at)&&
        minute>=toMin(cfg.diary.windowStart)&&minute<toMin(cfg.diary.windowEnd)&&!todayPublished(state().history,at)
    },
    run:(_row,commit)=>writeDiary({manual:false,commit})
  }
  async function tick() {
    if (life?.corePresent?.() === false) return
    const cfg = getConfig()
    if (!cfg.enabled || !cfg.diary.enabled) return
    const s = state()
    const at=now(),today=todayOf(at)
    if (s.plan.day !== today) {
      s.plan = { day: today, times: planDiaryTimes({ ...cfg.diary, timesPerDay: Math.min(1, cfg.diary.timesPerDay) },rand), done: [] }
      save(s)
      log.info(`今天的日记时间：${s.plan.times.map((m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`).join('、') || '（不写）'}`)
    }
    const nowMin=minuteOf(at)
    const due = s.plan.times.find((m) => m <= nowMin && !s.plan.done.includes(m))
    if (due === undefined) return
    const end=toMin(cfg.diary.windowEnd),start=toMin(cfg.diary.windowStart)
    if(!(end>start)||nowMin<start||nowMin>=end)return
    const stopAt=new Date(at)
    stopAt.setHours(Math.floor(end/60),end%60,0,0)
    const queued=life?.queueDiary?.({job:job.id,key:today,target:target(),expiresAt:stopAt.getTime()})
    if(queued){
      if(queued.ok){s.plan.done.push(due);save(s)}
      return queued
    }
    // Old injected/core contracts retain the previous entry point; the module
    // host's updated adapter never falls through when the registry is present.
    const run = async () => {
      s.plan.done.push(due)
      save(s)
      log.info('到点了，写一篇空间日记')
      return writeDiary({manual:false})
    }
    return life ? life.propose('background', undefined, run) : run()
  }

  function nextTime() {
    const s = state()
    const at=now(),nowMin=minuteOf(at)
    const m = s.plan.day === todayOf(at) ? s.plan.times.find((x) => !s.plan.done.includes(x) && x >= nowMin) : undefined
    return m === undefined ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  }

  return { post, remove, writeDiary, tick, syncHistory, history: () => state().history, nextTime, lifeJobs:()=>[job] }
}

export function bindApi(api) {
  ({ dataDir, readJson, writeJson } = api.lib('core/store.js'));
  ({ fetchImage } = api.lib('core/net.js'));
  ({ cleanOutboundText } = api.lib('chat/reply.js'));
}
