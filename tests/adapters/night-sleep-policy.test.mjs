import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import night from '../../modules/night/index.mjs'

const host = process.env.AURABOT_HOST_SRC
const loadHost = (file) => import(pathToFileURL(resolve(host, file)).href)
const parseInbound = host ? (await loadHost('chat/inbound.js')).parseMessageEvent : null
const createHostMutes = host ? (await loadHost('chat/commands.js')).createMutes : null
const owner = '10001', guest = '20002', group = '30003'
const ownerChat = `private:${owner}`
const minute = 60_000
const at = (time) => Date.parse(`2026-11-19T${time}:00+08:00`)

function incoming(text, userId = owner, groupId = '') {
  const kind = groupId ? 'group' : 'private'
  const self = '90009'
  if (!parseInbound) return { kind, userId, chatId: `${kind}:${groupId || userId}`, text }
  const event = { message_type: kind, user_id: Number(userId), group_id: Number(groupId),
    self_id: Number(self), message: [{ type: 'text', data: { text } }] }
  return { ...parseInbound(event, self), raw: event }
}

async function fixture(t, time, settings = {}) {
  let now = at(time)
  t.mock.method(Date, 'now', () => now)
  const dir = mkdtempSync(join(tmpdir(), 'night-sleep-policy-'))
  const formerDataDir = process.env.AURABOT_DATA_DIR
  if (createHostMutes) process.env.AURABOT_DATA_DIR = dir
  t.after(() => {
    if (createHostMutes) {
      if (formerDataDir === undefined) delete process.env.AURABOT_DATA_DIR
      else process.env.AURABOT_DATA_DIR = formerDataDir
    }
    rmSync(dir, { recursive: true, force: true })
  })

  const hooks = new Map(), commands = new Map(), routes = new Map(), asks = []
  const ends = new Map()
  // Preserve host semantics even without a source checkout: zero means indefinite mute.
  const mutes = createHostMutes ? createHostMutes() : {
    muted: (chatId) => ends.get(chatId) === 0 || ends.get(chatId) > Date.now(),
    set: (chatId, minutes) => ends.set(chatId, minutes > 0 ? Date.now() + minutes * minute : 0),
    clear: (chatId) => ends.delete(chatId),
    until: (chatId) => ends.get(chatId),
  }
  let heartbeat
  const core = {
    contextManaged: () => true, buildContext: (input) => ({ id: 'synthetic', text: '', ...input }),
    assertContextCurrent() {}, runWithContext: (_snapshot, task) => task(),
    validateDraft: () => ({ ok: true }), recordOutcome() {},
  }
  const api = {
    config: () => ({ ownerQQ: owner }),
    isOwner: (userId) => userId === owner,
    settings: () => ({ wakeJitterMinutes: 0, ...settings }),
    dataDir: (file) => join(dir, file),
    log: { info() {}, warn() {} },
    on: (name, hook) => hooks.set(name, hook),
    command: ({ name, run }) => commands.set(name, run),
    route: (path, handler) => routes.set(path, handler),
    every: (_ms, hook) => { heartbeat = hook },
    tool() {}, rule() {}, onDispose() {}, later() {},
    use: (id) => id === 'life-core' ? core : null,
    ask: async (args) => { asks.push(args); return '{"text":"合成新梦","level":5}' },
    core: { mutes, http: { body: async (req) => req.body } },
  }
  if (settings.dreamAutoEnabled === false) {
    writeFileSync(api.dataDir('dreams.json'), JSON.stringify([{
      id: 'stored-dream', createdAt: now - 3 * 60 * minute, text: '合成旧梦',
      level: 5, strength: 1, decayAt: now, pinned: true,
    }]))
  }
  const { service, snapshot, dream } = await night.setup(api)
  async function conversation(msg) {
    assert.equal(await hooks.get('message')(msg), false)
    const info = { chat: msg, chatId: msg.chatId, userText: msg.text }
    const prompt = await hooks.get('prompt')([], info)
    const reply = await hooks.get('reply')('好的。', info)
    await hooks.get('activity')({ kind: 'out', chatId: msg.chatId })
    return { prompt, reply }
  }
  return { service, snapshot, dream, commands, routes, hooks, asks, mutes, heartbeat, conversation,
    advance: (minutes) => { now += minutes * minute } }
}

for (const [time, text] of [['12:33', '晚安，我睡了'], ['13:30', '晚安'], ['07:00', '晚安']]) {
  test(`${time} owner closing does not produce an overnight sleep or mute the owner`, async (t) => {
    const f = await fixture(t, time)
    const result = await f.conversation(incoming(text))
    assert.equal(f.snapshot().mode, 'awake')
    assert.equal(f.service.pendingSleep, null)
    assert.equal(f.mutes.muted(ownerChat), false)
    assert.deepEqual(result, { prompt: [], reply: undefined })
  })
}

for (const msg of [incoming('晚安', guest), incoming('晚安', guest, group), incoming('晚安', owner, group)]) {
  test(`night closing in ${msg.chatId} from ${msg.userId} only applies a finite local mute`, async (t) => {
    const f = await fixture(t, '23:30', { byeMuteMinutes: 25 })
    const result = await f.conversation(msg)
    assert.equal(f.snapshot().mode, 'awake')
    assert.equal(f.service.pendingSleep, null)
    assert.equal(f.mutes.until(msg.chatId), at('23:30') + 25 * minute)
    assert.equal(f.mutes.muted(ownerChat), false)
    assert.deepEqual(result, { prompt: [], reply: undefined })
    f.advance(25)
    assert.equal(f.mutes.muted(msg.chatId), false)
  })
}

test('medium and weak local closing retain their respective nap mute and no-mute behavior', async (t) => {
  const f = await fixture(t, '13:00', { noonMuteMinutes: 40, closeSleepStrength: 'medium' })
  await f.conversation(incoming('午休了', guest))
  await f.conversation(incoming('收到', owner, group))
  assert.equal(f.snapshot().mode, 'awake')
  assert.equal(f.mutes.until(`private:${guest}`), at('13:00') + 40 * minute)
  assert.equal(f.mutes.muted(`group:${group}`), false)
})

test('a strong guest closing never writes the host’s indefinite mute sentinel', async (t) => {
  const f = await fixture(t, '12:33', { allowSleep: false })
  await f.conversation(incoming('晚安', guest))
  assert.equal(f.mutes.until(`private:${guest}`), at('12:33') + 30 * minute)
  assert.equal(f.mutes.muted(ownerChat), false)
})

test('night closing by the owner in private still sleeps after the outgoing reply', async (t) => {
  const f = await fixture(t, '23:30', { wakeMode: 'never' })
  const msg = incoming('晚安')
  assert.equal(await f.hooks.get('message')(msg), false)
  assert.equal(f.snapshot().mode, 'awake')
  assert.match((await f.hooks.get('prompt')([], { chat: msg }))[0].text, /要去睡了/)
  await f.hooks.get('activity')({ kind: 'out', chatId: `group:${group}` })
  assert.equal(f.snapshot().mode, 'awake')
  assert.match(await f.hooks.get('reply')('好的。', { chatId: ownerChat, userText: msg.text }), /^好的。\n.+/)
  await f.hooks.get('activity')({ kind: 'out', chatId: ownerChat })
  assert.equal(f.snapshot().sleepReason, 'talk')
  assert.equal(f.snapshot().sleepKind, 'night')
  assert.equal(f.snapshot().wakeAt, Date.parse('2026-11-20T08:00:00+08:00'))
  assert.equal(await f.hooks.get('message')(incoming('问一下', guest, group)), true)
})

test('owner nap closing during configured midday fatigue remains a short nap', async (t) => {
  const f = await fixture(t, '13:30', { closeSleepStrength: 'medium' })
  await f.conversation(incoming('午休了'))
  assert.equal(f.snapshot().sleepReason, 'talk')
  assert.equal(f.snapshot().sleepKind, 'noon')
  assert.ok(f.snapshot().remaining >= 45 * minute && f.snapshot().remaining <= 75 * minute)
})

test('true energy exhaustion still sleeps even during a guest conversation', async (t) => {
  const f = await fixture(t, '23:30', { energyPerMessage: 100, minTurnsBeforeSleep: 1 })
  await f.conversation(incoming('正常聊一句', guest))
  assert.equal(f.snapshot().sleepReason, 'energy')
  assert.equal(f.snapshot().sleepKind, 'night')
})

test('hard clock still makes her sleep without a conversation', async (t) => {
  const f = await fixture(t, '02:29')
  f.advance(1)
  await f.heartbeat()
  assert.equal(f.snapshot().sleepReason, 'latest')
  assert.equal(f.snapshot().sleepKind, 'night')
})

test('allowSleep blocks conversational and hard-clock sleep but explicit commands remain usable', async (t) => {
  const f = await fixture(t, '02:29', { allowSleep: false })
  await f.conversation(incoming('晚安'))
  f.advance(1)
  await f.heartbeat()
  assert.equal(f.snapshot().mode, 'awake')
  assert.match(await f.commands.get('睡')('', incoming('/睡')), /去睡了/)
  assert.equal(f.snapshot().sleepReason, 'manual')
  await f.commands.get('醒')('', incoming('/醒'))
  assert.equal(f.snapshot().mode, 'awake')
})

test('automatic dreams can be disabled without losing existing dreams or explicit generation', async (t) => {
  const f = await fixture(t, '00:30', { dreamAutoEnabled: false, dreamInRemOnly: false })
  await f.commands.get('睡')('', incoming('/睡'))
  f.advance(61)
  await f.heartbeat()
  assert.equal(f.asks.length, 0)
  assert.equal(f.service.state.dreamCount, 0)
  assert.match(await f.commands.get('梦')('', incoming('/梦')), /合成旧梦/)
  assert.match(await f.commands.get('做梦')('', incoming('/做梦')), /合成新梦/)
  assert.equal(f.asks.length, 1)
  assert.equal((await f.routes.get('/dream')({ method: 'POST', body: {} })).dream.text, '合成新梦')
  assert.equal((await f.dream()).text, '合成新梦')
})

test('installations without the automatic dream override keep the enabled dream schedule', async (t) => {
  const f = await fixture(t, '00:30', { dreamInRemOnly: false })
  await f.commands.get('睡')('', incoming('/睡'))
  f.advance(61)
  await f.heartbeat()
  assert.equal(f.asks.length, 1)
  assert.equal(f.service.state.dreamCount, 1)
})
