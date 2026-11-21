// 公开入口以实际目的聊天重新确定作用域，不能靠传来的 personId 借用私聊档案。
export function scopedPersonId(platform, userId, chatId) {
  const base = String(platform || 'qq') + ':' + String(userId)
  const chat = String(chatId || '')
  if (/^group:\d+$/.test(chat)) return base + '@' + chat
  if (/^private:\d+$/.test(chat)) return base + (chat === 'private:' + userId ? '@self' : '@public')
  throw new Error('印象卡片需要明确的群聊或私聊来源。')
}

export function scopeOf(id) {
  const s = String(id || '')
  const m = s.match(/^([^:]+):(\d+)@(group:\d+|self|public)$/)
  return m ? { platform: m[1], userId: m[2], scope: m[3] } : null
}

export function scopeLabel(id) {
  const s = scopeOf(id)?.scope
  return !s ? '旧版共用档案（仅归档）' : s === 'self' ? '本人综合（群聊＋本人私聊）' : s === 'public' ? '群聊综合（不含私聊）' : '群 ' + s.slice(6)
}

export function defaultChat(id) {
  const s = scopeOf(id)
  if (!s) return ''
  if (s.scope.startsWith('group:')) return s.scope
  // 群聊综合不含私聊；管理面板默认只发给对象本人，不能猜测最近群。
  return 'private:' + s.userId
}

export function canSendRecord(id, chatId) {
  const s = scopeOf(id)
  if (!s) return false
  if (s.scope.startsWith('group:')) return chatId === s.scope
  if (s.scope === 'self') return chatId === 'private:' + s.userId
  return /^private:\d+$/.test(String(chatId))
}

export function materialAllowed(ref, chatId, item, { row = false, now = Date.now() } = {}) {
  const s = scopeOf(ref.personId)
  if (!s || !item || item.forgottenAt || item.invalidAt || item.kind === 'gist' || item.kind === 'seen') return false
  const from = Number(item.validFrom ?? item.saidAt ?? item.at ?? 0)
  const until = Number(item.validUntil ?? item.invalidAt ?? 0)
  if (!row && ((from && from > now) || (until && until <= now))) return false
  const source = String(item.chatId || '')
  const target = String(ref.userId)
  // 人物印象只把本人发言当个人素材，不能把同群其他人的经历一起喂给模型。
  if (row && String(item.uid || '') !== target) return false
  if (!row && ['hearsay', 'guess'].includes(item.status)) return false
  if (s.scope.startsWith('group:')) {
    if (source !== s.scope) return false
    return row || String(item.about || '') === target
  }
  if (source.startsWith('group:')) return String(row ? item.uid || '' : item.about || '') === target
  if (s.scope !== 'self' || source !== 'private:' + target) return false
  return row || !item.about || String(item.about) === target
}
