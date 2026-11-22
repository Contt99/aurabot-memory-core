import { coerceFloat, sanitizeDescription } from './llm.mjs'

const dimension = /^[a-z][a-z0-9_-]{0,31}$/
const sourceId = /^(?:vault:[1-9]\d*|memory:[^\s]+@[a-f0-9]{20})$/
const isObject = value => value && typeof value === 'object' && !Array.isArray(value)

function exactIds(raw, allowed) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 8 || !raw.every(id => typeof id === 'string' && allowed(id))) return []
  return [...new Set(raw)]
}

export function modelEvidence(parsed, { scores, allowedKeys, sources, noteLimit, allowClaim = () => true }) {
  if (!isObject(parsed)) return null
  const claims = []
  let room = noteLimit
  for (const claim of (Array.isArray(parsed.claims) ? parsed.claims.slice(0,12) : [])) {
    if (typeof claim?.text !== 'string') continue
    const sourceIds = exactIds(claim.sourceIds, id => sources.has(id))
    const text = sanitizeDescription(claim.text, noteLimit)
    const length = Array.from(text).length
    if (!sourceIds.length || !length || length > room || !allowClaim(text, sourceIds)) continue
    claims.push({ text, sourceIds })
    room -= length + 1
  }
  const values = Object.create(null), scoreSources = Object.create(null)
  for (const key of allowedKeys) {
    const value = coerceFloat(scores?.[key], null)
    const sourceIds = exactIds(parsed.scoreSources?.[key], id => sources.has(id))
    if (value === null || !sourceIds.length) continue
    values[key] = value
    scoreSources[key] = sourceIds
  }
  return { claims, values, scoreSources, description: claims.map(c => c.text).join('\n') }
}

// Keep the distinction between machine-cited values and operator edits or an
// older baseline. In particular, a cited delta does not validate the total.
export function normalizeEvidence(raw) {
  if (!isObject(raw)) return undefined
  const claims = []
  for (const claim of (Array.isArray(raw.claims) ? raw.claims : [])) {
    if (typeof claim?.text !== 'string' || !claim.text.trim()) continue
    const sourceIds = exactIds(claim.sourceIds, id => sourceId.test(id))
    if (sourceIds.length) claims.push({ text: claim.text, sourceIds })
  }
  const scores = Object.create(null)
  for (const [key, entry] of Object.entries(raw.scores || {})) {
    if (!dimension.test(key) || !['score', 'delta', 'manual'].includes(entry?.kind)) continue
    const sourceIds = exactIds(entry.sourceIds, id => sourceId.test(id))
    if (sourceIds.length || entry.kind === 'manual') scores[key] = { kind: entry.kind, sourceIds, ...(entry.kind === 'delta' && Number.isFinite(entry.delta) ? { delta: entry.delta } : {}) }
  }
  return { claims, scores, noteUnverified: raw.noteUnverified === true }
}

export function normalizeInputs(raw) {
  if (!Array.isArray(raw)) return undefined
  const byId = new Map()
  for (const entry of raw) {
    if (!sourceId.test(String(entry?.id || '')) || !/^(?:private|group):[1-9]\d*$/.test(String(entry?.chatId || ''))) continue
    const replySourceId = /^vault:[1-9]\d*$/.test(String(entry.replySourceId || '')) ? entry.replySourceId : ''
    const replyToQQ = replySourceId && /^[1-9]\d*$/.test(String(entry.replyToQQ || '')) ? entry.replyToQQ : ''
    byId.set(entry.id, { id: entry.id, chatId: entry.chatId, ...(replyToQQ ? { replySourceId, replyToQQ } : {}) })
  }
  return [...byId.values()]
}

export const exactMemoryId = id => typeof id === 'string' && sourceId.test(id) && id.startsWith('memory:')
