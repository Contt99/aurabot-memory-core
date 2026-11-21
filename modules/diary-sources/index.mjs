export function parseSourceGroups(value) {
  if (!Array.isArray(value) && typeof value !== 'string') throw new Error('群来源必须为群号列表')
  const values = (Array.isArray(value) ? value : value.split(/[\s,，;；]+/)).map(v => String(v).trim().replace(/^group:/, '')).filter(Boolean)
  if (values.some(v => !/^[1-9]\d{4,11}$/.test(v))) throw new Error('每行填写一个合法群号；留空表示不读取群聊')
  const groups = [...new Set(values)]
  if (groups.length > 100) throw new Error('公开日记最多配置 100 个来源群')
  return groups
}
export default {
  id: 'diary-sources', name: '公开日记来源', version: '1.0.0-life.1', api: 1, panel: 'panel.js',
  description: '单独设置公开空间日记的群来源；发文、好友范围和历史仍在空间日记页管理。',
  setup(api) {
    if (!Array.isArray(api.config().diary?.sourceGroups)) api.setConfig({ diary: { sourceGroups: [] } })
    const state = () => {
      const cfg = api.config(), diary = api.use('diary')
      const history = diary?.history?.() || []
      const latest = history.find(row => row.ok && !row.dryRun)
      return { ok: true, sourceGroups: cfg.diary?.sourceGroups || [], visibility: cfg.diary?.visibility || 'all',
        diaryAvailable: Boolean(diary), coreAvailable: Boolean(api.use('life-core')?.diarySources),
        next: diary?.nextTime?.() || '', lastAt: latest?.at || 0 }
    }
    api.route('/state', state)
    api.route('/config', async req => {
      if (req.method !== 'POST' || !/^application\/json(?:\s*;|$)/i.test(req.headers?.['content-type'] || '')) return { ok: false, message: '请从公开日记来源面板保存设置' }
      try {
        const body = await api.core.http.body(req)
        const sourceGroups = parseSourceGroups(body.sourceGroups)
        api.setConfig({ diary: { sourceGroups } })
        return state()
      } catch (error) { return { ok: false, message: error.message } }
    })
    return { state }
  },
}
