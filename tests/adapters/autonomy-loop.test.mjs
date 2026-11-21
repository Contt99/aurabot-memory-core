import test from 'node:test'
import assert from 'node:assert/strict'
import {runToolLoop} from '../../modules/autonomy/lib/tool-loop.mjs'
test('revoked context stops execution after decision but before a real tool',async()=>{
 let live=true,calls=0
 const result=await runToolLoop({core:{capabilities:async()=>[{id:'search',available:true}],execute:async()=>{calls++;return {ok:true}}},assertActive(){if(!live)throw Error('revoked')},decide:async()=>{live=false;return {action:'search'}}})
 assert.equal(calls,0);assert.equal(result.status,'error');assert.match(result.message,/revoked/)
})
