export function classifyPolicyResult(result, itemId) {
  const raw=String(result?.state || result?.status || 'unknown')
  const native=result?.message_id ?? result?.messageId
  const messageId=native === undefined || native === null ? '' : String(native)
  const confirmed=raw==='sent' && Boolean(messageId) && !messageId.startsWith('sim-')
  return {state:raw==='sent'&&!confirmed?'sent-unconfirmed':raw,accepted:['sent','pending','deferred'].includes(raw),confirmed,itemId,...(confirmed?{messageId}:{})}
}
