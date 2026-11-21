// Additive outcome reporting: callers provide only deliberately bounded summaries.
// Resolve each time so reload/disable cannot retain stale core exports.
export function createOutcomeRecorder(api, module, log = api.log) {
  let warned = false
  return async (meta, result) => {
    try {
      const core = api.use?.('life-core')
      if (typeof core?.recordOutcome !== 'function') {
        if (!warned) { warned = true; log.warn(module + '：life-core 未启用，后台结果未纳入统一经历') }
        return
      }
      await core.recordOutcome({ module, ...meta }, result)
    } catch (error) {
      log.warn(module + '：life-core 后台结果记录失败：' + String(error.message || error))
    }
  }
}
