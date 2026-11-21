// Host provides React / h / ui / call. All journal data stays on the local server.
const { useState, useEffect, useCallback } = React
const API_BASES = ['/aurabot/api/ext/autonomy', '/aurabot/api/autonomy']
async function api(p, body) {
  const opts = body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  for (const base of API_BASES) {
    try {
      const response = await fetch(base + p, opts)
      const data = await response.json()
      if (data?.moduleOff) continue
      return data
    } catch (_) {}
  }
  return { ok: false, message: '自主生活接口暂不可用' }
}
const LABEL = { idle: '未执行', rest: '休息', think: '想事情', speak: '找主人', bili: '浏览B站', diary: '私人日记', explore: '真实探索' }
function time(at) { return at ? new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '—' }
const muted = { opacity: 0.7, lineHeight: 1.7 }
return function Panel({ settings, save, toast }) {
  const [state, setState] = useState(null)
  const [log, setLog] = useState([])
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [dates, setDates] = useState([])
  const [date, setDate] = useState('')
  const [entries, setEntries] = useState([])
  const [journalError, setJournalError] = useState('')
  const [journalBusy, setJournalBusy] = useState(false)
  const [groups, setGroups] = useState((settings?.diarySourceGroups || []).join('\n'))

  async function loadDay(day) {
    setDate(day)
    if (!day) { setEntries([]); return }
    setJournalBusy(true)
    try {
      const r = await api('/journal/day?date=' + encodeURIComponent(day))
      if (r?.ok) { setEntries(r.items || []); setJournalError('') }
      else { setEntries([]); setJournalError(r?.message || '日记读取失败') }
    } finally { setJournalBusy(false) }
  }
  const refresh = useCallback(async () => {
    const s = await api('/state')
    if (s?.ok) setState(s)
    const a = await api('/activity')
    if (a?.ok) setLog(a.items || [])
    const days = await api('/journal/dates')
    if (days?.ok) {
      setDates(days.dates || [])
      await loadDay(date || days.dates?.[0] || '')
    } else { setJournalError(days?.message || '私人日记读取失败') }
  }, [date])
  useEffect(() => { refresh(); const id = setInterval(refresh, 20000); return () => clearInterval(id) }, [refresh])
  useEffect(() => { setGroups((settings?.diarySourceGroups || []).join('\n')) }, [settings?.diarySourceGroups])
  async function previewDiary() {
    setPreviewBusy(true)
    try { setPreview(await api('/diary/preview', {})) }
    finally { setPreviewBusy(false) }
  }
  async function wakeNow() {
    setBusy(true)
    try {
      const r = await api('/wake', {})
      toast(r?.result?.note || r?.result?.message || r?.message || '本轮已结束')
      await refresh()
    } finally { setBusy(false) }
  }
  const field = (label, key) => h('label', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, label,
    h('input', { type: 'number', className: 'ab-input', style: { width: 72 }, value: settings?.[key] ?? '', onChange: e => save({ [key]: Number(e.target.value) }) }))
  const list = (title, rows) => rows?.length ? h('div', { style: { marginTop: 12 } }, h('strong', null, title), h('ul', { style: { lineHeight: 1.8, marginTop: 4 } }, rows.map((s,i)=>h('li',{key:i},s)))) : null
  const renderedEntry = entry => h('article', { key: entry.id, style: { padding: '16px 0', borderBottom: '1px solid rgba(127,127,127,.16)' } },
    h('div', { style: muted }, time(entry.at)),
    h('div', { style: { whiteSpace: 'pre-wrap', lineHeight: 1.9, marginTop: 8, overflowWrap: 'anywhere' } }, entry.text),
    list('未完成的问题', entry.unresolvedQuestions), list('笔记', entry.notes),
    h('details', { style: { marginTop: 12, ...muted } }, h('summary', null, `来源 ${entry.sourceIds?.length || 0} 条`),
      h('div', { style: { overflowWrap: 'anywhere' } }, (entry.sourceIds || []).join(' · ')),
      entry.sourceScopes?.length ? h('div', null, '来源范围：' + entry.sourceScopes.join(' · ')) : null))
  return h('div', null,
    h(ui.Card, { title: '私人日记 · 本地保存' },
      h('p', { style: muted }, '回顾真实经历、失败与未完成的问题。这里只保存到服务器，不发布空间。'),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 16 } },
        h('label', null, '日期 ', h('input', { type: 'date', className: 'ab-input', 'aria-label': '日记日期', value: date,
          max: dates[0] || undefined, onChange: e => loadDay(e.target.value) })),
        dates.length ? h('select', { className: 'ab-input', 'aria-label': '已有日记日期', value: date, onChange: e => loadDay(e.target.value) },
          dates.map(d => h('option', { key: d, value: d }, d))) : null,
        h(ui.Btn, { onClick: refresh }, '刷新')),
      journalError ? h('p', { role: 'alert' }, journalError) : journalBusy ? h(ui.Empty, {text:'正在读取日记…'}) : entries.length ? entries.map(renderedEntry) : h(ui.Empty, {text:date ? '这一天还没有私人日记' : '还没有私人日记'}),
      h('div', { style: { marginTop: 16 } },
        h(ui.Btn, { onClick: previewDiary, disabled: previewBusy || !settings?.enabled || !settings?.grants?.model }, previewBusy ? '整理中…' : '预览私人日记（不保存）'),
        h('p', { style: muted }, '预览会调用模型写作与核验，不增加自主活动次数。'),
        preview ? h('div', { role: 'status' }, preview.ok ? h('div', null,
          h('div', { style: { whiteSpace: 'pre-wrap', lineHeight: 1.9 } }, preview.text),
          list('未完成的问题', preview.unresolvedQuestions), list('笔记', preview.notes)) : preview.message) : null),
      h('label', { style: { display: 'block', marginTop: 20 } }, '私人日记群来源',
        h('textarea', { className: 'ab-input', 'aria-label': '私人日记群来源', rows: 3, value: groups,
          style: { display: 'block', width: '100%', marginTop: 8 },
          onChange: e => setGroups(e.target.value) })),
      h(ui.Btn, { onClick: () => save({ diarySourceGroups: [...new Set(groups.split(/[\s,，]+/).map(s=>s.trim()).filter(Boolean))] }) }, '保存群来源'),
      h('p', { style: muted }, '每行一个群号。留空不读取群聊，与公开日记白名单独立；仍须在全局群授权范围内。')),
    h(ui.Card, { title: '现在的状态' },
      state ? h('div', { style: { lineHeight: 1.9 } },
        h('div', null, `今天醒了 ${state.used || '0/8'} 次 · 下次 ${state.nextWakeIn == null ? '未安排' : state.nextWakeIn + ' 分钟后'}`),
        h('div', null, `性格 ${state.mbti || '—'} · 心情 ${state.mood || '—'}`),
        h('div', null, '可用工具：' + ((state.capabilities || []).filter(c=>c.available).map(c=>c.id).join(' · ') || '暂无')),
        h('div', null, '每轮工具预算：最多 5 次 / 120 秒')) : h(ui.Empty, {text:'读取中…'}),
      h(ui.Btn, { onClick: wakeNow, disabled: busy }, busy ? '正在执行…' : '现在叫醒她一次')),
    h(ui.Card, { title: '自主节奏' },
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 16 } }, field('最短（分）','minInterval'), field('最长（分）','maxInterval'), field('每天上限','maxWakesPerDay'), field('醒着从','awakeFrom'), field('到','awakeTo')),
      h('label', { style: { display: 'block', marginTop: 16 } }, h('input', { type: 'checkbox', checked: !!settings?.enabled, onChange: e=>save({enabled:e.target.checked}) }), ' 启用自主生活'),
      (state?.grants || []).map(g=>h('label',{key:g.id,style:{display:'block',marginTop:12}},h('input',{type:'checkbox',checked:!!settings?.grants?.[g.id],onChange:e=>save({grants:{...settings?.grants,[g.id]:e.target.checked}})}),' '+g.title)),
      !settings?.grants?.model ? h('p',{style:muted},'模型授权未开启，自主决策与日记不会运行。') : null),
    h(ui.Card, { title: '活动流水' },
      log.length ? log.slice(0,60).map((row,i)=>h('div',{key:i,style:{display:'flex',gap:12,padding:'10px 0',borderBottom:'1px solid rgba(127,127,127,.16)'}},
        h('span',{style:muted},time(row.at)),h('strong',{style:{minWidth:64}},LABEL[row.action]||row.action),
        h('div',{style:{flex:1,overflowWrap:'anywhere'}},row.note||'',h('div',{style:muted},row.ok===true?'已确认完成':row.status==='rest'?'休息':'未确认为完成')))) : h(ui.Empty,{text:'还没有活动记录'})),
  )
}
