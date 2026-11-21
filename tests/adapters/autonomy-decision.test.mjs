import test from 'node:test'
import assert from 'node:assert/strict'
import {checkedDecision} from '../../modules/autonomy/lib/context.mjs'
test('each tool decision is validated after model generation',async()=>{
 let actual;const ctx={run:fn=>fn(),check:text=>{actual=text;throw Error('rejected')}};await assert.rejects(checkedDecision(ctx,async()=>'{"action":"search"}'),/rejected/);assert.equal(actual,'{"action":"search"}')
})
