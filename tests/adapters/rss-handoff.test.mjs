import test from 'node:test'
import assert from 'node:assert/strict'
import {classifyPolicyResult} from '../../modules/rss-reader/lib/handoff.mjs'
test('a reported send without a real receipt is an unconfirmed handoff',()=>{
 assert.deepEqual(classifyPolicyResult({state:'sent'},'entry-1'),{state:'sent-unconfirmed',accepted:true,confirmed:false,itemId:'entry-1'})
 assert.deepEqual(classifyPolicyResult({state:'sent',message_id:42},'entry-1'),{state:'sent',accepted:true,confirmed:true,itemId:'entry-1',messageId:'42'})
 assert.equal(classifyPolicyResult({state:'sent',message_id:'sim-4'},'entry-1').confirmed,false)
})
