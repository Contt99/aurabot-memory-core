// Existing privacy regressions, rebound only to this candidate module.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
const defineTool = definition => definition

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const moduleDir = resolve(root, 'candidate/night')
import night from '../../modules/night/index.mjs'
import { Dreamer } from '../../modules/night/dream.mjs'
const tmpRoot = join(root, 'tests', '.coverage-night-tmp')
mkdirSync(tmpRoot, { recursive: true })
const SECRET = 'SYNTHETIC_GLOBAL_DREAM_BODY'
const ownerChat = { kind: 'private', userId: '10001', chatId: 'private:10001' }
const otherChat = { kind: 'private', userId: '20002', chatId: 'private:20002' }
const groupChat = { kind: 'group', userId: '10001', chatId: 'group:30003' }
const execFor = (id) => ({ agent: { session: { id } } })

async function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpRoot, 'case-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const config = { ownerQQ: '10001', memory: { eventExpireDays: 90 } }
  const hooks = new Map(), commands = new Map(), routes = new Map(), builders = [], heartbeats = [], asks = [], sends = []
  const mappings = new Map([['owner-session', 'private:10001'], ['other-session', 'private:20002'], ['group-session', 'group:30003']])
  const senders = new Map([['owner-session', true], ['other-session', false], ['group-session', true]])
  const key = (id) => String(id).replace(/^session-/, '')
  const api = {
    settings: () => ({ ...night.defaults, latestSleepTime: 'invalid', nightFatigue: '', noonFatigue: '', ...options.settings }),
    config: () => config,
    isOwner: (uid) => String(uid) === String(config.ownerQQ),
    dataDir: (file) => join(dir, file),
    log: { info() {}, warn() {} },
    on: (name, fn) => hooks.set(name, fn),
    command: (cmd) => commands.set(cmd.name, cmd),
    route: (path, fn) => routes.set(path, fn),
    tool: (fn) => builders.push(fn), defineTool,
    rule() {}, onDispose() {}, later() {},
    every: (_ms, fn) => heartbeats.push(fn),
    use: (name) => name === 'life-core' ? (options.core || null) : name === 'memory' ? { list: () => options.items || [], addEvent() {} } : null,
    ask: async (args) => { asks.push(args); return options.ask ? options.ask(args, config) : JSON.stringify({ text: SECRET, level: 3, tags: ['synthetic'] }) },
    send: async (chatId, text) => sends.push({ chatId, text }),
    core: { hub: {
      chatOfSession: (sid) => mappings.get(key(sid)) || '',
      turnSendersAllOwner: (sid) => senders.get(key(sid)) === true,
    }, http: { body: async (req) => req.body || {}, query: (req) => req.query || {} } },
  }
  writeFileSync(join(dir, 'dreams.json'), JSON.stringify([{ id: 'dream-fixture', text: SECRET, tags: ['synthetic'], createdAt: Date.now(), decayAt: Date.now(), strength: 1, level: 5, decayPerDay: 0.03 }]))
  const exported = await night.setup(api)
  return { api, config, hooks, commands, routes, builders, heartbeats, asks, sends, mappings, senders, dir, ...exported }
}
const toolsFor = (f, chat, sessionId = 'owner-session') => f.builders.flatMap((builder) => builder({ chat, sessionId }))
const recallTool = (f) => toolsFor(f, ownerChat).find((tool) => tool.name === 'recall_dream')

// Removing any execution-time identity/mapping gate must disclose SECRET and fail these tests.
for (const [name, exec, mutate] of [
  ['a non-owner executing a retained owner tool', execFor('other-session')],
  ['a group executing a retained owner tool even with owner-only senders', execFor('group-session')],
  ['missing execution session (no factory-closure fallback)', {}],
  ['a spoofed owner chatId without an execution session', { chatId: 'private:10001' }],
  ['a revoked owner after factory creation', execFor('owner-session'), (f) => { f.config.ownerQQ = '90009' }],
  ['a remapped owner session', execFor('owner-session'), (f) => f.mappings.set('owner-session', 'private:20002')],
  ['a mixed/non-owner current turn in owner private mapping', execFor('owner-session'), (f) => f.senders.set('owner-session', false)],
  ['an unavailable mapping authority', execFor('owner-session'), (f) => { delete f.api.core.hub.chatOfSession }],
  ['an unavailable current-turn authority', execFor('owner-session'), (f) => { delete f.api.core.hub.turnSendersAllOwner }],
]) {
  test(`recall_dream denies ${name}`, async (t) => {
    const f = await fixture(t), tool = recallTool(f)
    assert.ok(tool, 'owner retains the entry point')
    mutate?.(f)
    const result = await tool.execute({}, exec)
    assert.equal(result.ok, false)
    assert.ok(!JSON.stringify(result).includes(SECRET))
  })
}
for (const chat of [otherChat, groupChat, { kind: 'private', userId: '20002', chatId: 'private:10001' }, { kind: 'private', chatId: 'private:10001' }]) {
  test(`factory hides dream tools for ${JSON.stringify(chat)}`, async (t) => {
    const f = await fixture(t)
    assert.equal(toolsFor(f, chat).some((x) => x.name === 'recall_dream'), false)
    assert.ok(toolsFor(f, chat).some((x) => x.name === 'night_status'))
  })
}
test('owner private recall supports actual execute session variants and prefixed IDs', async (t) => {
  const f = await fixture(t), tool = recallTool(f)
  for (const exec of [execFor('owner-session'), { session: { id: 'owner-session' } }, { sessionId: 'session-owner-session' }]) {
    const result = await tool.execute({}, exec)
    assert.equal(result.ok, true)
    assert.match(result.message, /SYNTHETIC_GLOBAL_DREAM_BODY/)
  }
})
for (const name of ['梦', '做梦']) {
  for (const chat of [otherChat, groupChat, { ...ownerChat, chatId: 'private:20002' }, undefined]) {
    test(`/${name} denies ${JSON.stringify(chat)} before reading/generating a dream`, async (t) => {
      const f = await fixture(t)
      f.service.state.mode = 'asleep'
      const out = await f.commands.get(name).run('', chat)
      assert.ok(!out.includes(SECRET))
      assert.equal(f.asks.length, 0)
      assert.match(out, /私|主人/)
    })
  }
}
test('owner private commands keep listing and generating dream bodies', async (t) => {
  const f = await fixture(t)
  assert.match(await f.commands.get('梦').run('', ownerChat), /SYNTHETIC_GLOBAL_DREAM_BODY/)
  f.service.state.mode = 'asleep'
  assert.match(await f.commands.get('做梦').run('', ownerChat), /SYNTHETIC_GLOBAL_DREAM_BODY/)
  assert.equal(f.asks.length, 1)
})
test('generation does not return a body if owner changes while awaiting model', async (t) => {
  const f = await fixture(t, { ask: (_args, cfg) => { cfg.ownerQQ = '90009'; return JSON.stringify({ text: SECRET }) } })
  f.service.state.mode = 'asleep'
  const out = await f.commands.get('做梦').run('', ownerChat)
  assert.ok(!out.includes(SECRET))
})
for (const chat of [otherChat, groupChat, { kind: 'system', chatId: 'system:background' }, { ...ownerChat, userId: '20002' }]) {
  test(`morning prompt denies body for ${JSON.stringify(chat)} without consuming owner hint`, async (t) => {
    const f = await fixture(t)
    f.service.state.morningDreamId = 'dream-fixture'
    const content = await f.hooks.get('prompt')([], { chat })
    assert.ok(!JSON.stringify(content).includes(SECRET))
    assert.equal(f.service.state.dreamHintUses, 0)
    const ownerContent = await f.hooks.get('prompt')([], { chat: ownerChat })
    assert.doesNotMatch(JSON.stringify(ownerContent), /SYNTHETIC_GLOBAL_DREAM_BODY/)
  })
}
test('owner replacement immediately changes prompt authorization', async (t) => {
  const f = await fixture(t)
  f.service.state.morningDreamId = 'dream-fixture'
  f.config.ownerQQ = '20002'
  assert.ok(!f.service.promptHint(ownerChat).includes(SECRET))
  assert.doesNotMatch(f.service.promptHint(otherChat), /SYNTHETIC_GLOBAL_DREAM_BODY/)
})
test('natural morning greeting uses current owner scope without automatically injecting a dream', async (t) => {
  const core={contextManaged:()=>true,buildContext:o=>({id:'s',text:'SAFE',...o}),assertContextCurrent:()=>true,validateDraft:()=>({ok:true}),runWithContext:(_s,fn)=>fn()}
  const f = await fixture(t, { settings: { morningGreeting: true }, core, ask: () => '早上好' })
  f.service.tick = async () => ['wake_natural']
  f.service.state.morningDreamId = 'dream-fixture'
  await f.heartbeats[0]()
  assert.deepEqual(f.sends, [{ chatId: 'private:10001', text: '早上好' }])
  assert.doesNotMatch(f.asks[0].text, /SYNTHETIC_GLOBAL_DREAM_BODY/)
})
test('morning greeting cancels in-flight send after owner changes', async (t) => {
  const core={contextManaged:()=>true,buildContext:o=>({id:'s',text:'SAFE',...o}),assertContextCurrent:()=>true,validateDraft:()=>({ok:true}),runWithContext:(_s,fn)=>fn()}
  const f = await fixture(t, { settings: { morningGreeting: true }, core, ask: (_args, cfg) => { cfg.ownerQQ = '90009'; return SECRET } })
  f.service.tick = async () => ['wake_natural']
  f.service.state.morningDreamId = 'dream-fixture'
  await f.heartbeats[0]()
  assert.equal(f.sends.length, 0)
  assert.equal(f.asks.length, 1)
})
test('malformed owner cannot create a dream-bearing destination', async (t) => {
  const f = await fixture(t, { settings: { morningGreeting: true } })
  f.config.ownerQQ = 'group:30003'
  f.service.tick = async () => ['wake_natural']
  f.service.state.morningDreamId = 'dream-fixture'
  await f.heartbeats[0]()
  assert.equal(f.sends.length, 0)
  assert.equal(f.asks.length, 0)
})
test('administrator panel listing, continuation and existing module API remain usable', async (t) => {
  const f = await fixture(t)
  const req = { method: 'POST', headers: { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' }, body: { force: true } }
  const listed = await f.routes.get('/dreams')(req)
  assert.equal(listed.items[0].text, SECRET)
  const made = await f.routes.get('/dream')(req)
  assert.equal(made.dream.text, SECRET)
  assert.equal((await f.dreamer.make({ continuation: 'SYNTHETIC_CONTINUATION', persist: false })).text, SECRET)
  assert.match(f.asks.at(-1).text, /SYNTHETIC_CONTINUATION/)
  assert.equal(typeof f.dream, 'function')
  const saved = JSON.parse(readFileSync(join(f.dir, 'dreams.json'), 'utf8'))
  assert.ok(saved.some((x) => x.id === 'dream-fixture'))
})
test('panel cross-site body export remains denied', async (t) => {
  const f = await fixture(t)
  const result = await f.routes.get('/dreams')({ method: 'GET', headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } })
  assert.equal(result.denied, true)
  assert.ok(!JSON.stringify(result).includes(SECRET))
})

// Removing source, currentness, or privacy filtering must bring an excluded literal into the model prompt.
const now = Date.now()
const baseMemory = { id: 'memory-fixture', source: 'auto', scope: 'group', chatId: 'group:30003', at: now - 1000, saidAt: now - 1000, text: 'SYNTHETIC_MEMORY_FRAGMENT', importance: 0.8 }
for (const [name, patch, allowed] of [
  ['explicit group public fact', {}, true],
  ['owner explicit private remembered fact', { source: 'said', scope: '', chatId: 'private:10001', speaker: '10001', about: '10001' }, true],
  ['group personal fact with potentially polluted provenance', { scope: '', about: '20002', speaker: '20002' }, false],
  ['owner private fact without speaker', { scope: '', chatId: 'private:10001', about: '10001' }, false],
  ['owner private fact without about', { scope: '', chatId: 'private:10001', speaker: '10001' }, false],
  ['owner private hearsay', { scope: '', chatId: 'private:10001', speaker: '10001', about: '10001', status: 'hearsay' }, false],
  ['seen media entry', { kind: 'seen', source: 'event' }, false],
  ['unknown source even carrying group chatId', { source: 'unknown' }, false],
  ['profile summary even carrying group chatId', { source: 'profile' }, false],
  ['another private chat even about owner', { scope: '', chatId: 'private:20002', about: '10001' }, false],
  ['no chat provenance', { chatId: '', about: '10001' }, false],
  ['malformed group provenance', { chatId: 'group:' }, false],
  ['opaque person abstract even carrying group chatId', { source: 'abstract', abstractOf: ['unknown'], about: '20002', scope: '' }, false],
  ['opaque gist', { source: 'gist', kind: 'gist' }, false],
  ['forgotten fact', { forgottenAt: now - 100 }, false],
  ['invalidated fact even with future expiry', { invalidAt: now - 100, validUntil: now + 100000 }, false],
  ['fact expired exactly now', { validUntil: now - 1 }, false],
  ['fact not valid yet', { validFrom: now + 100000 }, false],
  ['future implicit validFrom from saidAt', { saidAt: now + 100000 }, false],
  ['current explicit range', { validFrom: now - 1000, validUntil: now + 100000 }, true],
  ['explicit zero validFrom overrides future saidAt (host semantics)', { validFrom: 0, saidAt: now + 100000 }, true],
  ['validUntil zero means open-ended (host semantics)', { validUntil: 0 }, true],
]) {
  test(`dream material ${allowed ? 'keeps' : 'excludes'} ${name}`, async (t) => {
    const f = await fixture(t, { items: [{ ...baseMemory, ...patch }] })
    const fragments = f.dreamer.fragments()
    assert.deepEqual(fragments, allowed ? ['SYNTHETIC_MEMORY_FRAGMENT'] : [])
    await f.dreamer.make({ persist: false })
    assert.equal(f.asks[0].text.includes('SYNTHETIC_MEMORY_FRAGMENT'), allowed)
  })
}



test('natural morning greeting stops without core and does not invoke the model',async t=>{
 const f=await fixture(t,{settings:{morningGreeting:true},ask:()=>{throw Error('must not run')}});f.service.tick=async()=>['wake_natural'];await f.heartbeats[0]();assert.equal(f.asks.length,0);assert.equal(f.sends.length,0)
})
test('missing core does not consume the due automatic dream slot',async t=>{
 const f=await fixture(t);f.service.state.mode='asleep';f.service.state.dreamCount=0;f.service.state.sleepAt=Date.now()-7200000;f.service.tick=async()=>[];f.service.stage=()=>({key:'rem'});f.dreamer.due=()=>true;await f.heartbeats[0]();assert.equal(f.service.state.dreamCount,0);assert.equal(f.asks.length,0)
})
