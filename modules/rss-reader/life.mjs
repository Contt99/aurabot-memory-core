// Lazy module dependency: reload/disable never leaves a stale core instance.
export function createLifeAdapter(api) {
  let warned = false
  const core = () => api.use('life-core')
  const missing = () => {
    if (!warned) { warned = true; api.log.warn('life-core 不可用：保留原有操作，本轮没有共享经历/主动额度覆盖') }
  }
  return {
    available: () => Boolean(core()?.propose),
    managed:()=>typeof core()?.performEvidence==='function'&&typeof core()?.poolRssMaterials==='function',
    observe:(run,meta)=>core()?.performEvidence?.({module:api.id,action:'feed-read',evidenceType:'rss-summary',public:false,...meta},run),
    pool:spec=>core()?.poolRssMaterials?.(spec)??[],
    latest:chatId=>core()?.latestRssMaterials?.(chatId)??[],
    count:(all=false)=>core()?.countRssMaterials?.(all)??0,
    perform(action, run, meta = {}) {
      const c = core()
      if (c?.perform) return c.perform({ module: api.id, action, evidenceType: 'provider', public: false, ...meta }, run)
      missing(); return run()
    },
    propose(kind, target, run) {
      const c = core()
      if (c?.propose) return c.propose({ source: api.id, kind, target, run })
      missing(); return run()
    },
  }
}
