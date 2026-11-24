// 自主上网（rss-reader）面板：简介卡 + 状态 + 手动跑一轮 + 订阅源试抓 + 最近看到。
// 契约（见插件 client.js ExtPanel）：整份源码交给面板的受限作用域执行（React/h/ui/call 四个入参），
// 最后 return 一个组件函数；call('/path') 自动 GET/POST 模块路由 /ext/rss-reader< path >。
// 设置表单（订阅源、间隔、额度等）走模块 settings 声明自动生成（index.mjs），这里只负责状态与「最近看到」。

return function RssReaderPanel({ toast }) {
  const [state, setState] = React.useState(null)
  const [latest, setLatest] = React.useState([])
  const [busy, setBusy] = React.useState('')
  const [testUrl, setTestUrl] = React.useState('')
  const [testResult, setTestResult] = React.useState(null)

  const load = () => {
    call('/state').then((s) => { setState(s); setLatest(s.latest || []) }).catch((e) => toast(e.message, 'err'))
  }
  React.useEffect(() => { load() }, [])

  const fmt = (ts) => (ts ? new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

  const runNow = async () => {
    setBusy('run')
    try {
      const r = await call('/run')
      if (r.ok) {
        const n = (r.delivered || []).length
        toast(`读取 ${r.report?.ok || 0}/${r.report?.feeds || 0} 个源，保存 ${n} 条订阅摘要`,
          'ok')
      } else {
        toast('这轮没跑成：' + (r.message || (r.reason === 'no-feeds' ? '还没填订阅源' : r.reason === 'disabled' ? '模块开关没开' : r.reason || '未知原因')), 'err')
      }
      load()
    } catch (e) { toast(e.message, 'err') }
    setBusy('')
  }

  const testFeed = async () => {
    const url = String(testUrl || '').trim()
    if (!url) { toast('先填一个订阅源地址', 'err'); return }
    setBusy('test')
    setTestResult(null)
    try {
      const r = await call('/feeds/test', {url})
      setTestResult(r)
      toast(r.ok ? `能读：${r.title || '（无标题）'}，${r.count} 条` : '读不了：' + (r.error || '未知原因'), r.ok ? 'ok' : 'err')
    } catch (e) { toast(e.message, 'err') }
    setBusy('')
  }

  const cfg = state && state.config
  const feedsCount = state?.feedsCount ?? cfg?.feeds?.length ?? 0

  return h('div', { className: 'ab-grid' },
    // ---- 简介 ----
    h(ui.Card, {
      title: 'RSS 订阅阅读',
      desc: '按设置读取订阅摘要。挑中的内容只供主人私聊和私人日记取材，不独立发 QQ，也不进入公开空间说说。',
    },
      h('div', { className: 'ab-small ab-muted', style: { lineHeight: 1.8 } },
        '只读标题和摘要，不代表打开了原文。每天上限设为 0 时，只读，不保存新素材。',
        state?.managed===false?h('div',null,'统一素材池暂不可用；手工读取仍可用。'):null),
      h('div', { className: 'ab-flex', style: { marginTop: 8 } },
        h(ui.Btn, { small: true, onClick: runNow, disabled: busy === 'run' }, busy === 'run' ? '正在看…' : '现在看一轮'),
        h('span', { className: 'ab-small ab-muted' },
          cfg ? `订阅源 ${feedsCount} 个 · 上次拉取 ${fmt(state.lastFetchAt)} · 今天已保存 ${state.sentToday || 0} 条` : '加载中…'))),

    // ---- 订阅源试抓 ----
    h(ui.Card, { title: '试试订阅源', desc: '先粘一个地址测一下能不能读，再写进上面的「订阅源」里（每行一个）。' },
      h('div', { className: 'ab-flex' },
        h('input', {
          value: testUrl,
          onChange: (e) => setTestUrl(e.target.value),
          placeholder: 'https://example.com/feed.xml',
          style: { flex: 1, minWidth: 260 },
        }),
        h(ui.Btn, { small: true, onClick: testFeed, disabled: busy === 'test' }, busy === 'test' ? '测试中…' : '测试')),
      testResult ? h('div', { className: 'ab-small', style: { marginTop: 8 } },
        testResult.ok
          ? h('div', null,
            `✓ 能读：${testResult.title || '（无标题）'}，共 ${testResult.count} 条`,
            (testResult.sample || []).length
              ? h('div', { className: 'ab-muted', style: { marginTop: 4 } },
                '最近几条：', ...(testResult.sample || []).map((s, i) => h('div', { key: 's' + i }, '· ' + (s.title || '（无标题）'))))
              : null)
          : h('div', { style: { color: 'var(--ab-danger, #c0392b)' } }, '✗ 读不了：' + (testResult.error || '未知原因'))) : null),

    // ---- 最近看到 ----
    h(ui.Card, { title: '最近保存的订阅摘要', desc: '保留实际读取时间。移除订阅后，相关摘要不再取材。' },
      latest === null || !latest.length
        ? h(ui.Empty, { icon: '📰', text: '还没有记录——点上面的「现在看一轮」试试' })
        : h('div', null, ...latest.map((d, i) => h('div', {
          key: d.key || i,
          className: 'ab-small',
          style: { padding: '6px 0', borderBottom: '1px solid var(--ab-border, rgba(128,128,128,.2))' },
        },
        h('div', null, d.title || '（无标题）'),
        h('div', { className: 'ab-muted' },
          `${d.feedTitle || '订阅源'} · 读取 ${fmt(d.at)} · 发布 ${fmt(d.publishedAt)} · `,
          d.via === 'policy' ? `原出站接口（${d.state}）` : '已保存 · 未转发'),
        d.link ? h('div', { className: 'ab-muted', style: { wordBreak: 'break-all' } }, d.link) : null)))),

    // ---- 运行状态 ----
    h(ui.Card, { title: '运行状态', desc: '排查用：已读账本、抓取统计、打不开的源。' },
      state ? h('div', { className: 'ab-small ab-muted', style: { lineHeight: 1.9 } },
        `去重记录 ${state.seenCount || 0} 条 · 累计读源成功 ${state.stats?.fetched || 0} 次 · 累计保存 ${state.stats?.fed || 0} 条`,
        h('br'),
        state.failing && state.failing.length
          ? `打不开（已退避）：${state.failing.join('、')}`
          : '所有订阅源目前都正常') : h(ui.Empty, { icon: '⏳', text: '加载中…' })),
  )
}
