export function groupList(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[,，\s]+/)
  return [...new Set(values.map(v => String(v).trim().replace(/^group:/, '')).filter(v => /^\d+$/.test(v)).map(v => 'group:' + v))]
}
export function sourceGroups(cfg, kind) {
  const actual = new Set(groupList(cfg.allow?.groups || []))
  return groupList(kind === 'public' ? cfg.diary?.sourceGroups : cfg.ext?.autonomy?.diarySourceGroups).filter(id => actual.has(id))
}
export function allowedSource(row, cfg, purpose, chatId = '') {
  const m = row.meta || {}
  if (m.actor && m.actor !== 'bot') return false
  if (row.deletedAt || m.correctedAt || m.kind === 'reflection' || m.action === 'private-diary') return false
  if (m.module === 'rss-reader' && m.action === 'feed-read') return false
  const scopes = [...new Set([...(m.sourceScopes || []), ...(m.chatId ? [m.chatId] : [])])]
  if (scopes.some(s => !/^(group|private):\d+$/.test(s))) return false
  if (purpose === 'chat') return scopes.every(s => s === chatId) && (m.public === true || scopes.length > 0)
  const pub = purpose === 'public-diary', priv = purpose === 'private-diary'
  if (!pub && !priv && purpose !== 'autonomy') return false
  const groups = new Set(sourceGroups(cfg, pub ? 'public' : 'private'))
  if (scopes.some(s => s.startsWith('group:') && (!priv && !pub || !groups.has(s)))) return false
  if (scopes.some(s => s.startsWith('private:') && (pub || purpose==='autonomy' || s !== 'private:' + cfg.ownerQQ))) return false
  if (pub && row.status !== 'succeeded') return false
  if (!scopes.length && m.public !== true && !(priv && m.self === true)) return false
  return true
}
export const secretText = text => /(?:sk-[a-z\d_-]{12,}|(?:api.?key|password|token|cookie|密码|密钥|验证码)\s*[:：=]\s*\S+)/i.test(String(text || ''))
export function publicSafe(text) {
  return !secretText(text) && !/\b\d{7,}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|身份证|银行卡|手机号|家庭住址|私聊原文/i.test(String(text || ''))
}
export function safeValue(value, key = '') {
  if (/cookie|password|secret|authorization|api.?key|access.?token|phoneLock/i.test(key)) return '[已隐藏凭据]'
  if (typeof value === 'string') return value.replace(/\bsk-[a-z\d_-]{12,}\b/gi, '[凭据]').replace(/((?:api.?key|password|token|cookie|密码|密钥)\s*[:：=]\s*)[^\s,;，；]+/gi, '$1[凭据]')
  if (Array.isArray(value)) return value.map(v => safeValue(v))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([,v]) => typeof v !== 'function').map(([k,v]) => [k, safeValue(v,k)]))
  return value
}
