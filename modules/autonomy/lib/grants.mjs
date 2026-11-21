/** Model authorization is stored in ext.autonomy.grants and checked before each request.
 * Executable tools are separately discovered through life-core capabilities.
 */

/** 每一项能力：id、面板上怎么解释、对应 module.json 的哪个 capability */
export const GRANTS = [
  {
    id: 'model',
    title: '调用模型做决策',
    capability: 'plugin-internals',
    risk: '中',
    detail:
      '她每一轮要「自己想做什么」就需要问一次模型。不开这一项，她只会发呆和歇着，不会做任何决定。真实工具探索每轮最多5次、120秒；私人日记另需写作与核验请求。',
  },
]

const IDS = new Set(GRANTS.map((g) => g.id))

/** 当前已授权的集合（永远返回新对象，调用方改了不影响设置） */
export function grantsOf(settings) {
  const raw = settings && settings.grants
  const out = {}
  for (const g of GRANTS) out[g.id] = !!(raw && raw[g.id])
  return out
}

/** 某一项有没有打开 */
export function isGranted(settings, id) {
  if (!IDS.has(id)) return false
  const raw = settings && settings.grants
  return !!(raw && raw[id])
}

/**
 * 用某能力之前调它。没授权就抛——调用方应当接住并降级，而不是继续硬跑。
 * 错误信息是给人看的，直接写进活动流水也没问题。
 */
export function requireGrant(settings, id) {
  const g = GRANTS.find((x) => x.id === id)
  if (!g) throw new Error(`未知能力：${id}`)
  if (!isGranted(settings, id)) {
    throw new Error(`「${g.title}」还没授权（面板 → 自主生活 → 权限，一项一项打开）`)
  }
  return true
}

/** 面板用：把当前授权状态整理成可渲染的列表 */
export function grantRows(settings) {
  const cur = grantsOf(settings)
  return GRANTS.map((g) => ({ ...g, granted: cur[g.id] }))
}
