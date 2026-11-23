import test from 'node:test'
import assert from 'node:assert/strict'
import {harness} from './harness.mjs'

test('coverage distinguishes installed contracts, clock-only modules, legacy exits and missing modules',t=>{
 const h=harness(t)
 let loaded=['speakup','bili','qzone-social','example','autonomy','impression-card']
 h.api.core.modules={status:()=>loaded.map(id=>({id,running:'user'}))}
 h.cfg.speakUp={enabled:true,awakeFrom:18,awakeTo:23,idleMinutes:40,nudge:true}
 h.cfg.ext.purpose={enabled:true}
 h.cfg.bili={enabled:true,autoBrowse:false,reply:false}
 h.cfg.ext['impression-card']={enabled:true}
 const clock=id=>({id,run(){},intervalMs:60000})
 const contact=id=>({id,kind:'contact',canRun:()=>true,run(){}})
 h.modules.speakup={lifeSchedules:()=>[clock('contact-tick')],lifeJobs:()=>['contact','nudge','autonomy'].map(contact)}
 h.modules.bili={lifeSchedules:()=>[clock('bili-tick')]}
 h.modules['qzone-social']={tick(){}}
 h.modules.autonomy={wake(){}}
 h.modules.example={lifeSchedules:()=>[clock('poll')]}
 const state=()=>h.routes.get('/state')().coverage
 const list=()=>Object.fromEntries(state().entries.map(row=>[row.id,row]))
 assert.equal(list()['speakup.auto'].mode,'managed')
 assert.equal(list()['speakup.auto'].switchState,'off')
 assert.equal(list()['speakup.auto'].window,'18:00–23:00')
 assert.equal(list()['bili.auto'].mode,'clock-only')
 assert.equal(list()['bili.auto'].switchState,'off')
 assert.equal(list()['autonomy.contact'].mode,'outside')
 assert.equal(list()['impression.auto'].switchState,'off')
 assert.equal(list()['qzone-social.auto'].mode,'outside')
 assert.equal(list()['diary.publish'].mode,'not-loaded')
 assert.equal(list()['example:poll'].mode,'clock-only')
 assert(state().conflicts.some(x=>/追问.*40/.test(x)))
 h.modules.autonomy.canSpeak=()=>true
 assert.equal(list()['autonomy.contact'].mode,'managed')
 h.cfg.speakUp.awakeFrom=23;h.cfg.speakUp.awakeTo=7
 assert.equal(list()['purpose.auto'].window,'23:00–07:00')
 assert.equal(list()['qzone-social.auto'].window,'现有设置无有效时段')
 loaded=loaded.filter(m=>m!=='speakup')
 assert.equal(list()['speakup.auto'].mode,'not-loaded')
})
