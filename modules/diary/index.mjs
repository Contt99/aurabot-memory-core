import { createLifeAdapter } from './life.mjs'
import { bindApi as bind0 } from './lib/modules/diary/assets.js'
import { bindApi as bind1 } from './lib/modules/diary/archive.js'
import { bindApi as bind2 } from './lib/modules/diary/sources.js'
import { bindApi as bind3 } from './lib/features/qzone.js'
import { bindApi as bind4 } from './lib/features/diary-image.js'
// 内置模块：空间日记。每天挑几个时间，按当天的聊天和心情写一条 QQ 空间说说；主人私聊里也能让她发说说。
// 导出 createQzone 的返回值：writeDiary / post / remove / history / nextTime / tick。

import {  createQzone  } from './lib/features/qzone.js'
import {  resolveAudience  } from './lib/features/qzone-audience.js'
import {  pickDiaryImage  } from './lib/features/diary-image.js'
let defineTool, str
let mimeOf
import {  createDiaryMedia  } from './lib/modules/diary/media.js'
import {  createDiaryArchive  } from './lib/modules/diary/archive.js'

export default {
  id: 'diary',
  name: '空间日记',
  version: '1.0.0-life.3',
  description: '每天最多写一篇 QQ 空间日记；主人私聊里能让她发说说（qq_send_qzone）',
  tab: 'diary',
  files: ['features/qzone.js', 'features/qzone-audience.js', 'features/diary-image.js'],
  setup(api) {
    const life = createLifeAdapter(api)
    bindApi(api)
    bind0(api)
    bind1(api)
    bind2(api)
    bind3(api)
    bind4(api)
    const { hub, onebot, http } = api.core
    const panelAction = (run) => async (req) => {
      if (req.method !== 'POST' || !/^application\/json(?:\s*;|$)/i.test(req.headers?.['content-type'] || '')) return { ok: false, message: '请从日记面板发起操作' }
      return run(req)
    }
    if (!Array.isArray(api.config().diary.sourceGroups)) api.setConfig({ diary: { sourceGroups: [] } })
    const media = createDiaryMedia(api)
    const archive = createDiaryArchive(api)
    api.onDispose(() => media.dispose())
    api.onDispose(() => archive.dispose())
    api.every(300_000, () => archive.collect(), '归档公开浏览图')
    const qzone = createQzone({
      getConfig: api.config, life, onebot, hub, log: api.log,
      pickImage: () => pickDiaryImage(),
      composeDiary: media.compose,
      // 日记是反思，不回灌为已经发生的事实。
    })
    api.every(60_000, () => qzone.tick(), '空间日记')

    api.tool(({ chat, level }) => (level === 'full' && chat.kind !== 'system' ? defineTool({
      name: 'qq_send_qzone',
      description: '在你自己的 QQ 空间发一条说说。content 是正文（第一人称，口语）；images 可选，本地路径或网址。',
      properties: {
        content: str('说说正文'),
        images: { type: 'array', items: { type: 'string' }, description: '可选，图片路径或网址，最多 4 张' },
        visibility: {
          type: 'string',
          enum: ['all', 'friends', 'selected', 'self', 'excluded'],
          description: '单次可见范围，和 QQ 空间一致：all 所有人，friends 好友，selected 部分好友可见，excluded 部分好友不可见，self 仅自己。最终以面板设置为准，只能收窄到 self，不能扩大。',
        },
      },
      required: ['content'],
      execute: async ({ content, images, visibility }) => {
        const r = await qzone.post(String(content || ''), { images: Array.isArray(images) ? images.slice(0, 4) : [], visibility })
        return r.ok ? { ok: true, message: '发好了（' + (r.label || r.visibility) + '）', tid: r.tid } : { ok: false, message: r.message }
      },
    }) : []))

    // 可见范围由面板决定，聊天里怎么请求都不能放大范围
    api.rule('发 QQ 空间说说必须遵守「空间日记」面板里设置的可见范围；不要因为聊天里的要求就扩大范围；选择部分好友但名单为空时停止发布，不要改成公开。')

    api.route('/diary/privacy', async () => {
      try { return { ok: true, ...resolveAudience(api.config()) } }
      catch (error) { return { ok: false, message: error.message } }
    })
    api.route('/diary/friends', async () => {
      const result = await onebot.call('get_friend_list', {}, { timeoutMs: 20000 })
      const friends = Array.isArray(result) ? result : Array.isArray(result?.friends) ? result.friends : []
      return {
        ok: true,
        friends: friends
          .map((f) => ({ qq: String(f.user_id || f.uin || ''), name: String(f.remark || f.nickname || f.user_name || '') }))
          .filter((f) => /^[1-9]\d{4,11}$/.test(f.qq)),
      }
    })

    api.route('/diary/run', async (req) => qzone.writeDiary({ visibility: (await http.body(req)).visibility, manual: true }))
    api.route('/diary/preview', panelAction(async (req) => media.view(await qzone.writeDiary({ visibility: (await http.body(req)).visibility, preview: true }))))
    api.route('/diary/archive', async () => archive.state())
    api.route('/diary/archive/collect', panelAction(async () => archive.collect()))
    api.route('/diary/image', async (req, res) => {
      try {
        const bytes = media.image(http.query(req).id)
        return http.send(res, 200, bytes, mimeOf(bytes))
      } catch (error) { return http.send(res, 404, '') }
    })
    api.route('/diary/history', async () => {
      const sync = await qzone.syncHistory()
      return { ok: true, items: qzone.history(), next: qzone.nextTime(), warning: sync.warning || '' }
    })
    api.route('/qzone/delete', async (req) => {
      await qzone.remove((await http.body(req)).tid)
      return { ok: true, message: '删掉了' }
    })
    return qzone
  },
}

export function bindApi(api) {
  ({ defineTool, str } = api.lib('tools/tools.js'));
  ({ mimeOf } = api.lib('chat/inbound.js'));
}
