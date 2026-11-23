// Lazy module dependency: reload/disable never leaves a stale core instance.
// A timed-out request cannot be cancelled by api.ask. Keep its slot occupied
// until the underlying promise settles; late results never reach the caller.
export function createSingleFlightAsk(api) {
  const pending = new Map()
  return (key, options, timeoutMs) => {
    if (pending.has(key)) return Promise.reject(new Error('上一轮模型请求仍在运行，本轮未开始'))
    const operation = Promise.resolve().then(() => api.ask(options))
    pending.set(key, operation)
    operation.finally(() => { if (pending.get(key) === operation) pending.delete(key) }).catch(() => {})
    let timer
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('模型请求超时，底层仍在运行，等待结束前不重复生成')), timeoutMs) })
    return Promise.race([operation, timeout]).finally(() => clearTimeout(timer))
  }
}
export function createLifeAdapter(api) {
  let warned = false
  const core = () => api.use('life-core')
  const missing = () => {
    if (!warned) { warned = true; api.log.warn('life-core 不可用：自动任务暂停，显式手工操作保留原有降级路径') }
  }
  return {
    corePresent: () => { const present = Boolean(core()); if (!present) missing(); return present },
    available: () => Boolean(core()?.propose),
    queueDiary: spec => core()?.queueCandidate?.({module:api.id,...spec}),
    diaryReceipts: (target,from) => core()?.candidateSentCount?.({module:api.id,job:'publish',target,from})||0,
    diaryPending: (target,key) => ['sending','unknown'].includes(core()?.candidateStatus?.({module:api.id,job:'publish',target,key})),
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
