import { createLifeAdapter } from './life.mjs'
import { bindApi as bind0 } from './lib/features/companion.js'
// 内置模块：主动搭话。主人一阵子没找她时，她会在私聊里主动找主人聊几句（群里不会）。

import {  createSpeakUp  } from './lib/features/companion.js'

export default {
  id: 'speakup',
  name: '主动搭话',
  version: '1.0.0-life.2',
  description: '主人一阵子没理她时，在私聊里主动找主人说话',
  tab: 'speakup',
  files: ['features/companion.js'],
  setup(api) {
    const life = createLifeAdapter(api)
    bind0(api)
    const { hub, mutes } = api.core
    const speakUp = createSpeakUp({ getConfig: api.config, life, hub, log: api.log, isMuted: (chatId) => mutes.muted(chatId), memory: () => api.use('memory') })
    api.every(60_000, () => speakUp.tick(), '主动搭话')
    api.route('/speakup/fire', async () => {
      if (!api.config().enabled) return { ok: false, message: '先打开总开关' }
      const result = await speakUp.fire('手动')
      if (result?.status === 'deferred' || result?.ok === false) return result
      return { ok: true, message: '已提交主动搭话尝试；实际发送以网关回执为准' }
    })
    return speakUp
  },
}
