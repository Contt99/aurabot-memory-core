import { AsyncLocalStorage } from 'node:async_hooks'
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
  const delivery = new AsyncLocalStorage()
  api.on('sent', (_message, info) => {
    const active = delivery.getStore()
    if (active && info?.chatId === active.chatId && info.messageId !== undefined && !String(info.messageId).startsWith('sim-')) active.receipts.push(String(info.messageId))
  })
  const askOnce = createSingleFlightAsk(api)
  let warned = false
  const core = () => api.use('life-core')
  const missing = () => {
    if (!warned) { warned = true; api.log.warn('life-core 不可用：保留原有操作，本轮没有共享经历/主动额度覆盖') }
  }
  return {
    askOnce,
    corePresent: () => Boolean(core()),
    dispatchPet(pet, text, purpose, snapshot, beforeSend) {
      return this.runContext(snapshot, () => { this.checkDraft(text, snapshot); beforeSend?.(); return pet.dispatch({text,purpose}) })
    },
    async deliver(chatId, text, options, snapshot, beforeSend) {
      this.checkDraft(text, snapshot)
      beforeSend?.()
      return delivery.run({ chatId, receipts: [] }, async () => {
        // The native ACK is the durable handoff; don't also enqueue the host's truncated copy.
        const result = await this.runContext(snapshot, () => { this.checkDraft(text, snapshot); beforeSend?.(); return api.core.hub.deliver(chatId, text, snapshot ? {...options,own:true} : options) })
        const receipts = delivery.getStore().receipts
        return { ...result, ok: receipts.length > 0, receipts }
      })
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
    recall: options => core()?.recall?.(options) || {items:[],text:''},
    sourcesCurrent: (ids,chatId) => Boolean(core()?.experiencesCurrent?.(ids,chatId)),
    withExperiences(prompt, options={}) {
      const r=core()?.recall?.(options)
      return r?.text ? String(prompt)+'\n\n'+r.text : prompt
    },
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
