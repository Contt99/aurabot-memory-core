// 全局梦境的 QQ 出口只属于当前配置的主人私聊；模块内部和本机管理面板沿用管理员接口。
export function currentOwner(api) {
  const owner = String(api.config?.()?.ownerQQ || '').trim()
  return /^[1-9]\d*$/.test(owner) ? owner : ''
}

export function ownerPrivateChat(api, chat) {
  const owner = currentOwner(api)
  return Boolean(owner && chat?.kind === 'private' &&
    String(chat.userId || '') === owner && chat.chatId === `private:${owner}`)
}

export function ownerToolCall(api, exec) {
  // execute 的 session 才是本次调用的身份。工厂闭包和参数 chatId 不能证明执行位置。
  const sid = String(exec?.agent?.session?.id || exec?.session?.id || exec?.sessionId || '')
  const owner = currentOwner(api)
  const hub = api.core?.hub
  if (!sid || !owner || typeof hub?.chatOfSession !== 'function' ||
    typeof hub?.turnSendersAllOwner !== 'function') return false
  try {
    return hub.chatOfSession(sid) === `private:${owner}` && hub.turnSendersAllOwner(sid) === true
  } catch {
    return false
  }
}

export function eligibleDreamMaterial(api, item, now = Date.now()) {
  if (!item || !['auto', 'said', 'tool', 'event'].includes(item.source) ||
    ['seen', 'gist'].includes(item.kind) || item.forgottenAt || item.compressedAt) return false
  // 与宿主 memory.isCurrent 相同：invalidAt 无条件失效，nullish 回退保留显式 0 的含义。
  const from = item.validFrom ?? (item.saidAt || item.at)
  const until = item.validUntil ?? item.invalidAt
  if (item.invalidAt || (until && !(until > now)) || (from && !(from <= now))) return false
  if ((item.status || 'fact') !== 'fact') return false
  if (/^group:[1-9]\d*$/.test(String(item.chatId || ''))) {
    // 人物事实会跨会话去重；只有群公共条目在宿主中以群为去重边界。
    return item.scope === 'group' && !item.about
  }
  const owner = currentOwner(api)
  return Boolean(owner && item.chatId === `private:${owner}` && item.scope !== 'group' &&
    String(item.speaker || '') === owner && String(item.about || '') === owner)
}
