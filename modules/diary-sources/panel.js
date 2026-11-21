// Host protocol: React / h / ui / call; the module has no builtin tab and is visible in Extensions.
return function PublicDiarySources({ toast }) {
  const [state, setState] = React.useState(null)
  const [groups, setGroups] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  async function load() {
    try {
      const result = await call('/state')
      if (!result?.ok) throw new Error(result?.message || '公开日记状态读取失败')
      setState(result); setGroups((result.sourceGroups || []).join('\n')); setError('')
    } catch (e) { setError(e.message) }
  }
  React.useEffect(() => { load() }, [])
  async function save() {
    setBusy(true); setError('')
    try {
      const result = await call('/config', { sourceGroups: groups })
      if (!result?.ok) throw new Error(result?.message || '群来源保存失败')
      setState(result); setGroups((result.sourceGroups || []).join('\n'))
      toast('公开日记来源已保存', 'ok')
    } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }
  return h('div', { className: 'ab-grid' },
    h(ui.Card, { title: '公开日记群来源' },
      h('p', { style: { lineHeight: 1.8 } }, '每行一个群号。只会读取这里与全局群授权名单都允许的群；留空时仍可写真实的公开浏览经历，不读取群聊。'),
      h('label', { style: { display: 'block' } }, '来源群号',
        h('textarea', { className: 'ab-input', 'aria-label': '公开日记群来源', rows: 5, value: groups,
          placeholder: '留空：不读取群聊', disabled: busy,
          style: { display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 8, lineHeight: 1.7 },
          onChange: event => setGroups(event.target.value) })),
      h('div', { style: { display: 'flex', gap: 10, marginTop: 14 } },
        h(ui.Btn, { onClick: save, disabled: busy || !state }, busy ? '保存中…' : '保存公开来源'),
        h(ui.Btn, { onClick: load, disabled: busy }, '刷新')),
      error ? h('p', { role: 'alert', style: { color: 'var(--ab-danger, #b42318)' } }, error) : null),
    h(ui.Card, { title: '公开空间日记' },
      h('p', { style: { lineHeight: 1.8 } }, '发文、好友可见范围、配图和历史记录仍在「空间日记」页管理。私人日记的来源在「自主生活」页单独设置。'),
      state ? h('dl', { style: { lineHeight: 1.9 } },
        h('dt', null, '来源服务'), h('dd', null, state.coreAvailable ? '真实经历来源已接入' : '行动核心不可用，暂停生成公开日记'),
        h('dt', null, '空间日记'), h('dd', null, state.diaryAvailable ? '已加载 · 每日最多一篇' : '模块未加载'),
        h('dt', null, '最近发布'), h('dd', null, state.lastAt ? new Date(state.lastAt).toLocaleString('zh-CN') : '尚无成功发布'),
        h('dt', null, '下一计划'), h('dd', null, state.next || '当前无待发布计划'))
        : h(ui.Empty, { text: '正在读取状态…' })))
}
