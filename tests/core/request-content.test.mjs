import test from 'node:test'
import assert from 'node:assert/strict'
import {harness,message} from './harness.mjs'

test('only one representation of the same sourced memory is sent in the request; native conversation is untouched',async t=>{
 const h=harness(t,{rows:[message(1,'SOURCED_ONCE','out')]})
 const a=h.core.buildContext({chatId:'private:10001',sessionId:'owner'}),b=h.core.buildContext({chatId:'private:10001',sessionId:'owner'})
 const original=[{role:'user',content:[{type:'text',text:a.text}]},{role:'assistant',content:[{type:'text',text:'native assistant reply'}]},{role:'user',content:[{type:'text',text:b.text}]}]
 const admitted=await h.enter([original[2]],{history:original.slice(0,2)})
 const options=Object.freeze({sessionId:'owner',messages:Object.freeze(admitted.messages)})
 await h.stream(options)
 const text=JSON.stringify(options.messages)
 assert.equal((text.match(/SOURCED_ONCE/g)||[]).length,1)
 assert.equal((JSON.stringify(original).match(/SOURCED_ONCE/g)||[]).length,2)
 assert.match(text,/native assistant reply/)
 assert(admitted.stored.some(e=>e.surfaceOp?.op==='replace'))
})

test('forgotten historical memory blocks cannot remain in the provider request',async t=>{
 const h=harness(t,{rows:[message(1,'FORGOTTEN_PROVIDER_MARK','out')]})
 const old=h.core.buildContext({chatId:'private:10001',sessionId:'owner'})
 h.rows.splice(0);h.core.forgetPerson('10001','FORGOTTEN_PROVIDER_MARK',{exactSources:true,sourceIds:['vault:1'],chatId:'private:10001'})
 const current=h.core.buildContext({chatId:'private:10001',sessionId:'owner'})
 const admitted=await h.enter([{role:'user',content:[{type:'text',text:current.text}]}],{history:[{role:'user',content:[{type:'text',text:old.text}]}]})
 const options=Object.freeze({sessionId:'owner',messages:Object.freeze(admitted.messages)})
 await h.stream(options)
 assert(!JSON.stringify(options.messages).includes('FORGOTTEN_PROVIDER_MARK'))
})
