import {createHash} from 'node:crypto'
import {imageId} from './memory.mjs'
export async function prepareImage(raw,sharp) {
 if(raw.length>25*1024*1024)throw Error('图片超过25MB识图预算，未缓存')
 if(typeof sharp!=='function')throw Error('sharp不可用，无法安全处理动图')
 const meta=await sharp(raw,{animated:true,limitInputPixels:24000000}).metadata()
 const frames=Number(meta.pages)||1,width=meta.width,height=meta.pageHeight||meta.height
 const sample=[...new Set([0,Math.floor((frames-1)*.25),Math.floor((frames-1)*.5),Math.floor((frames-1)*.75),frames-1])]
 let identity='raw:'+imageId(raw)
 // Exact decoded pixels unify lossless re-encodes. Never identify animation by a sampled first frame.
 if(width*height*frames<=16000000&&frames<=60){
  const pixels=await sharp(raw,{animated:true,limitInputPixels:24000000}).toColourspace('srgb').ensureAlpha().raw().toBuffer()
  identity='pixels:'+createHash('md5').update(JSON.stringify({width,height,frames,delay:meta.delay,loop:meta.loop})).update(pixels).digest('hex')
 }
 const images=[]
 for(const page of sample){const data=await sharp(raw,{page,pages:1,limitInputPixels:24000000}).rotate().resize({width:640,height:640,fit:'inside',withoutEnlargement:true}).png().toBuffer();images.push({data:data.toString('base64'),mediaType:'image/png',page})}
 return{identity,frames,sample,images}
}
