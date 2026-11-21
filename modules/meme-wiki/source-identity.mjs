import {createHash} from 'node:crypto'
export function memeSourceId(entry, chatId) {
  const title=String(entry.title),version=createHash('sha256').update(String(entry.text)).digest('hex').slice(0,16)
  return 'meme:' + Buffer.from(String(chatId)).toString('base64url') + ':' + Buffer.from(title).toString('base64url') + ':' + version
}
export function memeSourcesCurrent(ids,{chatId='',cfg={},enabled=false,lookup}={}) {
  if (!enabled || cfg.enabled===false) return false
  const groups=(Array.isArray(cfg.allow?.groups)?cfg.allow.groups:String(cfg.allow?.groups||'').split(/[,，\s]+/)).map(x=>'group:'+String(x).trim().replace(/^group:/,''))
  const priv=(cfg.allow?.private||[]).map(String)
  if (!(chatId==='private:'+cfg.ownerQQ || /^private:\d+$/.test(chatId)&&priv.includes(chatId.slice(8)) || /^group:\d+$/.test(chatId)&&groups.includes(chatId))) return false
  try { return ids.every(id=>{const m=/^meme:([A-Za-z0-9_-]+):([A-Za-z0-9_-]+):([a-f0-9]{16})$/.exec(String(id));if(!m)return false;const sourceChat=Buffer.from(m[1],'base64url').toString();const title=Buffer.from(m[2],'base64url').toString();const row=lookup(title);return sourceChat===chatId && !!row && row.title===title && memeSourceId(row,chatId)===id}) } catch {return false}
}
