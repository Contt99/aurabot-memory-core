import test from 'node:test'
import assert from 'node:assert/strict'
for(const name of ['purpose','bili','qzone-social']){
 test(`${name} keeps timed-out stateless model work locked until the underlying call settles`,async()=>{
  const {createLifeAdapter}=await import(`../../modules/${name}/life.mjs`);let release,calls=0
  const api={id:name,use:()=>null,on(){},log:{warn(){}},core:{hub:{}},ask:()=>{calls++;return new Promise(resolve=>{release=resolve})}}
  const life=createLifeAdapter(api);await assert.rejects(life.askOnce('test',{text:'prompt'},10),/超时/);await assert.rejects(life.askOnce('test',{text:'again'},10),/仍在|还在/);assert.equal(calls,1)
  release('late');await new Promise(resolve=>setImmediate(resolve));api.ask=async()=>{calls++;return 'new'};assert.equal(await life.askOnce('test',{text:'fresh'},50),'new');assert.equal(calls,2)
 })
}
test('diary stateless request remains locked after timeout until provider finishes',async()=>{
 const {createSingleFlightAsk}=await import('../../modules/diary/life.mjs');let release,calls=0
 const ask=createSingleFlightAsk({ask:()=>{calls++;return new Promise(resolve=>{release=resolve})}})
 await assert.rejects(ask('diary',{text:'一'},10),/超时/);await assert.rejects(ask('diary',{text:'二'},10),/仍在/);assert.equal(calls,1);release('late');await new Promise(resolve=>setImmediate(resolve))
})
