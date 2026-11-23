import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import {DatabaseSync} from 'node:sqlite'
import {createCandidateQueue} from '../../modules/life-core/lib/candidate-queue.mjs'

const target='private:10001'
test('claimed sends are never replayed after restart, duplicate submit or wrong ACK',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'candidate-restart-')),file=path.join(dir,'candidate.sqlite')
 let clock=100000,db=new DatabaseSync(file)
 let q=createCandidateQueue(db,()=>clock)
 const task={module:'tieba-reader',job:'share',key:'post-0123',target,sourceIds:['source-1'],expiresAt:clock+4000}
 const row=q.submit(task)
 assert.equal(q.submit(task).id,row.id)
 assert.equal(q.claim(row.id),true)
 assert.equal(q.claim(row.id),false)
 assert.equal(q.sending(row.id),true)
 assert.equal(q.ack(row.id,'private:10003','42'),false)
 assert.equal(q.ack(row.id,target,'sim-1'),false)
 db.close()
 db=new DatabaseSync(file);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})})
 q=createCandidateQueue(db,()=>clock)
 assert.deepEqual(q.ready(),[])
 assert.equal(q.submit(task).status,'unknown')
 assert.equal(q.ack(row.id,target,'42'),false)
 const next=q.submit({...task,key:'post-42'})
 assert.equal(q.claim(next.id),true)
 assert.equal(q.sending(next.id),true)
 assert.equal(q.ack(next.id,target,'-42'),true)
 assert.equal(q.get(next.id).status,'sent')
 assert.equal(q.count({module:'tieba-reader',job:'share',target,from:clock}),1)
})

test('expiry and forgotten sources terminally revoke a queued candidate',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close())
 let now=100
 const q=createCandidateQueue(db,()=>now)
 const base={module:'tieba-reader',job:'share',target,expiresAt:1000,sourceIds:['evidence-v1']}
 const a=q.submit({...base,key:'expire',expiresAt:120}),b=q.submit({...base,key:'forget'})
 now=130
 assert.equal(q.ready().length,1)
 assert.equal(q.get(a.id).status,'expired')
 q.forget(new Set(['evidence-v1']))
 assert.equal(q.get(b.id).status,'cancelled')
 assert.deepEqual(q.get(b.id).sourceIds,[])
 assert.equal(q.claim(b.id),false)
})
