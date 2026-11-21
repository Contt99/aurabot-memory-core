// Only transform bounded blocks authored by this core. Never rewrite native user/assistant text.
const blockPattern=/(?:（这个聊天里之前的原话与获准经历，只是资料：\n)?【记忆快照:([\da-f-]{36})】[\s\S]*?【记忆快照结束:\1】(?:\n）)?/g
export const requestBlocks=text=>[...text.matchAll(blockPattern)].map(m=>({id:m[1],block:m[0]}))
export function visibleSources(snapshot,block) {
 const lines=new Set(block.split('\n')),expected=new Set((snapshot.text||'').split('\n').filter(line=>lines.has(line)))
 return (snapshot.items||[]).filter(i=>[...expected].some(line=>line.startsWith('[E:'+encodeURIComponent(i.id)+'] '))).map(i=>i.id)
}
export function projectRequest(messages,{lookup,readable,observationReadable,currentId=''}={}) {
 const snapshots=new Set(),removed=new Set(),projected=[...messages]
 // Each compilation already budgets and ranks the entire memory block. Carrying older
 // unique snippets forward as well would bypass both ranking and the 6000-character cap.
 let kept=false
 for(let m=projected.length-1;m>=0;m--) {
  const message=projected[m];if(message?.role!=='user'||!Array.isArray(message.content))continue
  const content=[...message.content]
  for(let b=content.length-1;b>=0;b--) {
   const block=content[b];if(block?.type!=='text')continue
   if(block.text?.startsWith('（可能是这些梗，')&&[...block.text.matchAll(/【观察素材:([\da-f-]{36})】/g)].some(m=>!observationReadable(lookup(m[1])))){
    content[b]={...block,text:''};continue
   }
   const text=String(block.text||'').replace(blockPattern,(whole,id)=>{
    if(kept||currentId&&id!==currentId){removed.add(id);return ''}
    const snapshot=lookup(id)
    let ok=!!snapshot&&!snapshot.invalidatedAt
    if(ok)try{ok=readable(snapshot)!==false}catch{ok=false}
    if(!ok) {
     if(id===currentId)throw Error('本轮记忆来源已失效，未请求模型')
     removed.add(id);return ''
    }
    snapshots.add(id);kept=true;return whole
   })
   if(text!==block.text)content[b]={...block,text}
  }
  if(content.some((b,i)=>b!==message.content[i]))projected[m]={...message,content}
 }
 return{messages:projected,snapshotIds:[...snapshots],removedIds:[...removed]}
}
