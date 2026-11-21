import test from 'node:test'
import assert from 'node:assert/strict'
for(const name of ['purpose','bili','tieba-reader','qzone-social','speakup','night']){
 test(`${name}: automatic context stops when life-core is absent; manual path remains`,async()=>{
  const {createLifeAdapter}=await import(`../../modules/${name}/life.mjs`)
  const api={id:name,use:()=>null,on(){},log:{warn(){}},core:{hub:{}}}
  const life=createLifeAdapter(api)
  assert.throws(()=>life.prepareContext({purpose:'proactive',chatId:'private:1'}),/不可用/)
  assert.equal(life.prepareContext({purpose:'proactive',chatId:'private:1',allowLegacy:true}),null)
 })
}
test('autonomy stops automatic model work without core but preserves explicit manual invocation',async()=>{
 const {prepareAutonomyContext}=await import('../../modules/autonomy/lib/context.mjs')
 assert.throws(()=>prepareAutonomyContext(null,{},()=>{}),/不可用/)
 assert.equal(prepareAutonomyContext(null,{allowLegacy:true},()=>{}).run(()=>42),42)
})
