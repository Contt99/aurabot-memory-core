import test from 'node:test'
import assert from 'node:assert/strict'
import {outcomeStatus} from '../../modules/life-core/lib/ledger.mjs'

test('explicit incomplete or failed outcomes cannot become successful experiences',()=>{
 for(const [status,want] of [['interrupted','interrupted'],['cancelled','interrupted'],['sent-unconfirmed','deferred'],['unknown','deferred'],['failed','failed'],['error','failed'],['blocked','failed']]){
  for(const key of ['status','outcome'])assert.equal(outcomeStatus({ok:true,[key]:status}),want,key+': '+status)
 }
 assert.equal(outcomeStatus({ok:true,status:'preview'}),'simulated')
 assert.equal(outcomeStatus({ok:true,status:'saved'}),'succeeded')
 assert.equal(outcomeStatus({ok:false,status:'failed'}),'failed')
})
