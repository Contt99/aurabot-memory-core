import {createRequire} from 'node:module'
import path from 'node:path'
export async function loadSharp(api){
 const hosted=await api.lib('core/img.js').findSharp();if(hosted)return hosted
 // Reuse the already installed native dependency; no downloading or installing on chat input.
 try {return createRequire(path.join(api.dir,'..','impression-card','package.json'))('sharp')}
 catch {throw Error('sharp不可用，请恢复印象卡片已安装的sharp依赖或宿主sharp')}
}
