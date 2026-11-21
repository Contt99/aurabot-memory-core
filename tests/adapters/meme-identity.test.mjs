import test from 'node:test'
import assert from 'node:assert/strict'
import {memeSourceId,memeSourcesCurrent} from '../../modules/meme-wiki/source-identity.mjs'
test('meme reference is current only for unchanged entry and authorized chat',()=>{
 const id=memeSourceId({title:'梗',text:'旧解释'},'group:42'),cfg={enabled:true,ownerQQ:'1',allow:{groups:['42'],private:[]}}
 assert.equal(memeSourcesCurrent([id],{chatId:'group:42',cfg,enabled:true,lookup:()=>({title:'梗',text:'旧解释'})}),true)
 assert.equal(memeSourcesCurrent([id],{chatId:'group:42',cfg,enabled:true,lookup:()=>({title:'梗',text:'新解释'})}),false)
 assert.notEqual(id,memeSourceId({title:'梗',text:'旧解释'},'private:1'))
 assert.equal(memeSourcesCurrent([id],{chatId:'private:1',cfg,enabled:true,lookup:()=>({title:'梗',text:'旧解释'})}),false)
 assert.equal(memeSourcesCurrent([id],{chatId:'private:2',cfg,enabled:true,lookup:()=>({title:'梗',text:'旧解释'})}),false)
})
