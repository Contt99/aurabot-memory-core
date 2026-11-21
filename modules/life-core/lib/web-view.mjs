// Read-only model projection; the action ledger retains the original provider result.
const decode = s => s.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (m, k) => {
 if(k[0]==='#'){const n=k[1].toLowerCase()==='x'?parseInt(k.slice(2),16):Number(k.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):m}
 return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[k.toLowerCase()]||m
})
export function readableWebResult(value) {
 if(!value?.body||typeof value.body.content!=='string')return value
 const {kind,content}=value.body
 if(!['html','text','json','markdown'].includes(kind))return {url:value.url,statusCode:value.statusCode,message:'已取得响应，但没有可读文字正文',contentKind:kind}
 let text=content,title=''
 if(kind==='html'){
  title=decode(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1]?.replace(/<[^>]*>/g,'')||'').trim()
  text=text.replace(/<!--[\s\S]*?-->/g,' ').replace(/<(head|script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ')
  const main=/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(text)||/<article\b[^>]*>([\s\S]*?)<\/article\s*>/i.exec(text)
  text=main?.[1]||text
  text=text.replace(/<(nav|header|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ')
   .replace(/<\/(?:p|div|h[1-6]|li|section|tr|article)>|<br\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,' ')
  text=decode(text).replace(/\r\n?/g,'\n').replace(/[\t \u00a0]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim()
 }
 return {url:value.url,statusCode:value.statusCode,title,text:text.slice(0,4200),contentKind:kind==='html'?'html-text':kind,truncated:text.length>4200,totalChars:text.length,...(value.ok===false?{ok:false,message:value.message}:{})}
}
