import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture} from './legacy-adapters-fixture.mjs'
import social from '../../modules/qzone-social/index.mjs'
test('a rejected space comment is not counted as a successful action',async()=>{
 const f=fixture();try{
  f.cfg.qzoneSocial={enabled:true,commentFriends:true,maxPerDay:10,friendChance:1,ownerChance:1,like:false};f.api.ask=async()=> '星星真好看'
  f.api.core.onebot.call=async action=>action==='get_qzone_feeds'?{feeds:[{appid:311,uin:77777,key:'tid1',time:Date.now()/1000,html:'星空',nickname:'朋友'}]}:action==='get_qzone_msg_detail'?{content:'星空',comments:[]}:{ok:false,message:'blocked'}
  const module=social.setup(f.api);const result=await module.run({force:true});assert.equal(result.comments,0);assert.equal(module.state().count,0)
 }finally{f.close()}
})
