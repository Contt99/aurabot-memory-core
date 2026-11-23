import { createLifeAdapter } from './life.mjs'
import { bindApi as bind0 } from './lib/features/companion.js'
// 内置模块：主动搭话。主人一阵子没找她时，她会在私聊里主动找主人聊几句（群里不会）。

import {  createSpeakUp  } from './lib/features/companion.js'

export default {
  id: 'speakup',
  name: '主动搭话',
  version: '1.0.0-life.3',
  description: '主人一阵子没理她时，在私聊里主动找主人说话',
  tab: 'speakup',
  files: ['features/companion.js'],
  setup(api) {
    const life = createLifeAdapter(api)
    bind0(api)
    const { hub, mutes } = api.core
    const speakUp = createSpeakUp({ getConfig: api.config, life, hub, log: api.log, isMuted: (chatId) => mutes.muted(chatId), memory: () => api.use('memory'),
      ask:options=>api.ask(options),personaText:()=>api.core.personas?.current?.()||'',
      autonomyAllowed:()=>api.use('autonomy')?.canSpeak?.()===true })
    const clock={id:'contact-tick',label:'旧主动搭话到期检查',intervalMs:60_000,run:()=>speakUp.tick()}
    api.every(clock.intervalMs, () => {
      if(!api.use('life-core')?.ownsSchedule?.('speakup',clock.id))return clock.run()
    }, '主动搭话（旧核心兼容）')
    api.route('/speakup/fire', async () => {
      if (!api.config().enabled) return { ok: false, message: '先打开总开关' }
      const result = await speakUp.fire('手动')
      if (result?.status === 'deferred' || result?.ok === false) return result
      return { ok: true, message: '已提交主动搭话尝试；实际发送以网关回执为准' }
    })
    return {...speakUp,lifeSchedules:()=>[clock]}
  },
}
