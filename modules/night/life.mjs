// Lazy module dependency: reload/disable never leaves a stale core instance.
export function createLifeAdapter(api) {
  let warned = false
  const core = () => api.use('life-core')
  const missing = () => {
    if (!warned) { warned = true; api.log.warn('life-core 不可用：保留原有操作，本轮没有共享经历/主动额度覆盖') }
  }
  return {
    queueGreeting: spec => {
      const c=core()
      return c?.supportsContactJob?.(api.id,'wake-greeting') ? c.queueCandidate({...spec,module:api.id,job:'wake-greeting'}) : null
    },
    hasCompiler: () => typeof core()?.contextManaged === 'function',
    contextManaged: purpose => Boolean(core()?.contextManaged?.(purpose)),
    prepareContext(options) {
      const c = core()
      if (!c && !options.allowLegacy) throw Error('life-core 不可用，自动生成已暂停')
      if (typeof c?.contextManaged !== 'function') { missing(); return null }
      if (!c.contextManaged(options.purpose)) { if (options.allowLegacy) { missing(); return null } throw Error('统一记忆编译器不可用，本轮未生成') }
      if (!c.buildContext || !c.runWithContext || !c.assertContextCurrent || !c.validateDraft) throw Error('统一记忆接口不完整，本轮不发送')
      const { allowLegacy, ...scope } = options
      const snapshot = c.buildContext({ ...scope, consumer: api.id })
      if (!snapshot || typeof snapshot.text !== 'string' || !snapshot.id) throw Error('统一记忆上下文不可用，本轮不发送')
      c.assertContextCurrent(snapshot)
      return snapshot
    },
    runContext(snapshot, run) { return snapshot ? core().runWithContext(snapshot, run) : run() },
    checkDraft(text, snapshot) {
      if (!snapshot) return
      const c = core()
      if (!c?.contextManaged?.(snapshot.purpose) || !c.assertContextCurrent || !c.validateDraft) throw Error('统一记忆服务已不可用，本轮不发送')
      c.assertContextCurrent(snapshot)
      const result = c.validateDraft(text, snapshot, {purpose:snapshot.purpose, chatId:snapshot.chatId})
      if (!result?.ok) throw Error(result?.message || '统一记忆草稿校验未通过，本轮不发送')
    },
    available: () => Boolean(core()?.propose),
    proactiveState: () => core()?.proactiveState?.(),
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
