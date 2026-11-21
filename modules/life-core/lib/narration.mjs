// High-risk acquisition upgrades are rejected independently of the prose model/auditor.
export function assertNarrationSupported(text,sources=[]) {
 const prose=String(text||'')
 const frames=sources.some(s=>s.evidenceType==='video-frames')
 const paper=sources.some(s=>['paper-abstract','paper-full-text'].includes(s.evidenceType))
 const full=sources.some(s=>s.evidenceType==='paper-full-text')
 const affirmative=pattern=>[...prose.matchAll(new RegExp(pattern.source,pattern.flags.replace('g','')+'g'))].some(m=>{
  const verb=m[0].search(/看(?:了|过|完)|观看|听(?:了|过|完)|翻|读/)
  const prefix=prose.slice(Math.max(0,m.index+verb-12),m.index+verb)
  return !/(?:没(?:有)?|尚未|未|不曾|不能|不算|不是|不等于|想|打算|准备|计划|希望|下次|以后)[^。！？\n，,；;]{0,4}$/.test(prefix)
 })
 const media=/(?:看(?:了|过|完)|观看(?:了|过)?|听(?:了|过|完))[^。！？\n]{0,32}(?:BBC|视频|纪录片|画面)|(?:BBC|视频|纪录片|画面)[^。！？\n]{0,32}(?:我|自己|亲自|也)(?:看(?:了|过|完)|观看(?:了|过)?)/i
 if(!frames&&affirmative(media))throw Error('尚未取得视频画面证据，不能把网页转述写成亲自观看视频')
 if(!paper&&affirmative(/论文[^。！？\n]{0,20}(?:翻|读|看)[^。！？\n]{0,10}(?:摘要|全文)/))throw Error('尚未取得论文摘要或正文证据，不能把目录页写成已读论文')
 if(!full&&affirmative(/(?:我|自己|亲自)[^。！？\n]{0,10}(?:读完|看完)[^。！？\n]{0,10}论文/))throw Error('尚未取得论文全文证据，不能声称读完论文')
 return true
}
