import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import cardModule from '../../modules/impression-card/index.mjs'
import vaultModule from '../../modules/history-vault/index.mjs'

async function fixture(t, records = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurabot-card-evidence-'))
  const config = { enabled: true, botQQ: '99999', ownerQQ: '10001', allow: { private: ['10002','10003'], groups: ['20001','20002','20003'] } }
  const settings = { ...cardModule.defaults, contextEnabled: false, fetchAvatar: false }
  const vaultSettings = { ...vaultModule.defaults }
  const routes = {}, cardHooks = {}, vaultHooks = {}, disposed = [], listeners = []
  const core = {
    onForget: fn => { listeners.push(fn); return () => {} },
    forgetPerson: (_qq, _query, event) => { for (const fn of listeners) fn(event); return { ok: true } },
    recordOutcome() {},
  }
  const modules = { 'life-core': core }
  const host = (hooks, moduleSettings) => ({
    settings: () => moduleSettings, config: () => config, dataDir: (...p) => path.join(dir, ...p),
    log: { info(){}, warn(){}, debug(){}, error(){} },
    lib: () => ({ matchesMemoryKeyword: (a,b) => String(a || '').includes(b), parseMemoryCommand: () => null }),
    use: id => modules[id], on: (n,f) => { hooks[n] = f }, onDispose: f => disposed.push(f),
    every(){}, context(){}, rule(){}, command(){}, tool(){},
    route: (n,f) => { routes[n] = f },
    core: { hub: { chatLogDays: () => [], chatLogOf: () => [] }, http: { body: async req => req.body } },
    ask: () => { throw new Error('Unexpected model call') },
  })
  const vault = modules['history-vault'] = await vaultModule.setup(host(vaultHooks, vaultSettings))
  if (Object.keys(records).length) fs.writeFileSync(path.join(dir,'affinity.json'), JSON.stringify({ records }))
  const api = host(cardHooks, settings)
  api.onebot = async () => ({ nickname: '测试者' })
  api.sendSegments = async () => ({ message_id: 'test-image' })
  const card = cardModule.setup(api, { renderer: { renderCard: async () => ({ ok: true, file: 'test.png', image: testPng }) } })
  t.after(() => { for (const fn of disposed.reverse()) fn(); fs.rmSync(dir, { recursive:true, force:true }) })
  function inbound(chatId, uid, text, messageId, segments = []) {
    const [kind, number] = chatId.split(':')
    vaultHooks.onebot({ post_type:'message', message_type:kind, group_id:kind === 'group' ? Number(number) : undefined,
      self_id:99999, user_id:Number(uid), message_id:messageId, time:Math.floor(Date.now()/1000),
      sender:{ nickname:'测试者' }, message:[{ type:'text', data:{ text } }, ...segments] })
  }
  return { config, settings, vaultSettings, routes, card, vault, api, inbound }
}

const evidence = (id, text = '我觉得他喜欢博物馆', total = 6) => JSON.stringify({
  total, scores:{}, claims:[{ text, sourceIds:[id] }], scoreSources:{ total:[id] },
})
const testPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDhUAAAAASUVORK5CYII=', 'base64')
const groupCard = 'qq:10002@group:20001', selfCard = 'qq:10002@self', publicCard = 'qq:10002@public'

test('ordinary vault dialogue supplies stable evidence without mixing authors or duplicating rows', async t => {
  const f = await fixture(t)
  f.inbound('group:20001','10002','我喜欢博物馆，周末去看展',40)
  f.inbound('group:20001','10002','我想约楼上的朋友去看展',41,[{ type:'at',data:{ qq:'10003' } }])
  f.inbound('group:20001','10003','邻居在群里的秘密',42)
  f.inbound('group:20002','10002','跨群的秘密',43)
  f.api.core.hub.chatLogOf = () => [{ t:Date.now(),chatId:'group:20001',uid:'10002',who:'测试者',text:'没有权威凭据的宿主流水' }]
  f.api.ask = async ({ text }) => {
    assert.equal((text.match(/我喜欢博物馆，周末去看展/g) || []).length, 1)
    assert.match(text,/vault:1[^\n]*接收对象：未知/)
    assert.match(text,/vault:2[^\n]*原始@QQ：10003/)
    assert.doesNotMatch(text,/邻居在群里的秘密|跨群的秘密|没有权威凭据的宿主流水/)
    return evidence('vault:1')
  }
  const r = await f.card.generate(groupCard,'group:20001')
  assert.equal(r.total,6)
  assert.deepEqual(r.sourceIds,['vault:1','vault:2'])
  const readback = await f.routes['/evidence']({ method:'POST',body:{ personId:groupCard } })
  assert.equal(readback.ok,true)
  assert.deepEqual(readback.claims.map(x=>[x.text,x.sourceIds]),[['我觉得他喜欢博物馆',['vault:1']]])
  assert.deepEqual(readback.scores.total.sourceIds,['vault:1'])
  assert.deepEqual(readback.sources.map(x=>[x.id,x.speakerQQ,x.text]),[['vault:1','10002','我喜欢博物馆，周末去看展']])
})

test('self can use only own private dialogue and public can use no private dialogue', async t => {
  const f = await fixture(t)
  f.inbound('group:20001','10002','目标群聊',51)
  f.inbound('private:10002','10002','本人私聊秘密',52)
  f.inbound('private:10003','10003','他人私聊秘密',53)
  const prompts = []
  f.api.ask = async ({text}) => { prompts.push(text); return evidence('vault:1') }
  await f.card.generate(selfCard,'private:10002')
  await f.card.generate(publicCard,'private:10003')
  assert.match(prompts[0],/本人私聊秘密/)
  assert.doesNotMatch(prompts[0],/他人私聊秘密/)
  assert.match(prompts[1],/目标群聊/)
  assert.doesNotMatch(prompts[1],/本人私聊秘密|他人私聊秘密/)
  assert.deepEqual(f.card.get(publicCard).sourceScopes,['group:20001'])
})

test('vault limit ignores newer revoked groups and does not treat panel test injection as dialogue', async t => {
  const f = await fixture(t)
  f.inbound('group:20001','10002','仍获授权',61)
  f.inbound('group:20002','10002','稍后将撤权',62)
  f.config.allow.groups = ['20001']
  await f.routes['/inject']({method:'POST',body:{chatId:'group:20001',uid:'10002',text:'测试注入不是真话',t:Date.now()}})
  assert.deepEqual(f.vault.impressionMaterial({userId:'10002',scope:'public',limit:1}).map(x=>x.text),['仍获授权'])
  assert.deepEqual(f.vault.impressionMaterialByIds(['vault:1','vault:2','vault:3'],{userId:'10002',scope:'public'}).map(x=>x.id),['vault:1'])
})

test('a model cannot cite another speaker or move an unsupported score away from neutral', async t => {
  const f = await fixture(t)
  f.inbound('group:20001','10002','我喜欢博物馆',70)
  f.inbound('group:20001','10003','其他发言者的材料',71)
  f.api.ask = async () => JSON.stringify({
    total:9, scores:{},
    claims:[{text:'这是一条伪造引用的描述',sourceIds:['vault:1','vault:2']},{text:'他喜欢博物馆',sourceIds:['vault:1']},{text:'没有来源的一句'}],
    scoreSources:{ total:['vault:2'] },
  })
  const r = await f.card.generate(groupCard,'group:20001')
  assert.equal(r.description,'他喜欢博物馆')
  assert.equal(r.total,5)
})

test('refresh does not substitute an old unverified note for exact evidence', async t => {
  const f = await fixture(t, { [groupCard]: { userId:'10002',materialVersion:2,description:'旧笔记—没有来源ID',total:50 } })
  f.api.core.hub.chatLogOf = () => [{t:Date.now(),chatId:'group:20001',uid:'10002',who:'测试者',text:'未归档的流水'}]
  await assert.rejects(f.card.refresh(groupCard,'group:20001'),/没有可核验|可用来源/)
  assert.equal(f.card.get(groupCard).description,'旧笔记—没有来源ID')
  assert.equal(f.card.get(groupCard).total,50)
  f.inbound('group:20001','10002','已归档的话',80)
  f.api.ask = async ({text}) => { assert.doesNotMatch(text,/旧笔记—没有来源ID|未归档的流水/); return evidence('vault:1') }
  assert.equal((await f.card.refresh(groupCard,'group:20001')).description,'我觉得他喜欢博物馆')
})

test('ordinary source forget clears a derived card and refuses an in-flight regeneration', async t => {
  const f = await fixture(t)
  f.inbound('group:20001','10002','将来会忘掉的内容',90)
  f.api.ask = async () => evidence('vault:1')
  await f.card.generate(groupCard,'group:20001')
  f.api.ask = async () => {
    assert.equal(f.vault.forgetPerson('10002','将来会忘掉').forgotten,1)
    return evidence('vault:1','不应保存的内容')
  }
  await assert.rejects(f.card.refresh(groupCard,'group:20001'),/来源|授权/)
  assert.equal(f.card.get(groupCard),null)
})

test('forgetting a reply anchor invalidates the exact recipient signal without leaking its text', async t => {
  const f = await fixture(t)
  f.inbound('group:20001','10003','这句话是接收者的秘密',100)
  f.inbound('group:20001','10002','我想看看',101,[{ type:'reply',data:{ id:'100' } }])
  f.api.ask = async ({text}) => {
    assert.doesNotMatch(text,/接收者的秘密/)
    assert.match(text,/vault:2[^\n]*回复对象QQ：10003/)
    return evidence('vault:2','他向一位群友说想看看')
  }
  await f.card.generate(groupCard,'group:20001')
  assert.equal(f.vault.forgetPerson('10003','接收者的秘密').forgotten,1)
  assert.equal(f.card.get(groupCard),null)
})

test('light refresh never mutates the existing record when current recording policy revokes its input', async t => {
  const f = await fixture(t, { [groupCard]: { userId:'10002',materialVersion:2,description:'应保留的原笔记',total:5 } })
  f.settings.lightRefresh = true
  f.inbound('group:20001','10002','正在微调用的聊天',110)
  f.api.ask = async ({ text }) => {
    assert.match(text,/正在微调用/)
    f.vaultSettings.recordGroups = false
    return JSON.stringify({ deltas:{total:4}, claims:[{text:'不应增加的笔记',sourceIds:['vault:1']}], scoreSources:{total:['vault:1']} })
  }
  await f.card.sendCard('group:20001',{ personId:groupCard, userId:'10002',platform:'qq',displayName:'测试者' })
  const r = f.card.get(groupCard)
  assert.equal(r.total,5)
  assert.equal(r.description,'应保留的原笔记')
  f.vaultSettings.recordGroups = true
  f.api.ask = async () => JSON.stringify({ deltas:{total:1}, claims:[{text:'新的可核验笔记',sourceIds:['vault:1']}], scoreSources:{total:['vault:1']} })
  assert.equal((await f.card.sendCard('group:20001',{personId:groupCard,userId:'10002',platform:'qq',displayName:'测试者'})).ok,true)
  assert.equal(f.card.get(groupCard).total,6)
  assert.match(f.card.get(groupCard).description,/应保留的原笔记\n新的可核验笔记/)
})

test('manual card egress sends only its rendered bytes and obeys an unconfirmed receipt', async t => {
  const f = await fixture(t, { [groupCard]: { userId:'10002',materialVersion:2,description:'本群原笔记',total:5 } })
  const payload = testPng
  const sent = []
  f.api.sendImage = async () => { throw new Error('do not send a local path') }
  f.api.sendText = async () => { throw new Error('do not retry with a text fallback after an unconfirmed image') }
  let accepted = true
  f.api.sendSegments = async (chatId, segments) => { sent.push({chatId,segments}); return accepted ? {message_id:'test-image'} : null }
  const ref = {personId:groupCard,userId:'10002',platform:'qq',displayName:'测试者'}
  const r = await f.card.sendCard('group:20001', ref)
  assert.equal(r.ok,true)
  assert.deepEqual(sent,[{ chatId:'group:20001', segments:[{ type:'image', data:{file:'base64://' + payload.toString('base64')} }] }])
  accepted = false
  assert.equal((await f.card.sendCard('group:20001',ref)).ok,false)
  assert.equal(sent.length,2)
})

test('a specific group recipient needs metadata on the exact cited row', async t => {
  const f = await fixture(t)
  f.inbound('group:20001','10002','不带接收对象的发言',121)
  f.inbound('group:20001','10002','明确 @ 了谁',122,[{type:'at',data:{qq:'99999'}}])
  f.api.ask = async () => JSON.stringify({claims:[
    {text:'他向机器人讨要一份地图',sourceIds:['vault:1','vault:2']},
    {text:'他向机器人提了一个问题',sourceIds:['vault:2']},
  ]})
  assert.equal((await f.card.generate(groupCard,'group:20001')).description,'他向机器人提了一个问题')
  f.config.allow.groups = ['20002']
  const view = await f.routes['/evidence']({ method:'POST',body:{ personId:groupCard } })
  assert.equal(view.ok,false)
  assert.doesNotMatch(JSON.stringify(view),/明确 @ 了谁|vault:2/)
})
