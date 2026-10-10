import { expect, test } from 'claude-code/testing'

import {
  ANSWER_LIMIT,
  BATCH_MS,
  type BriefSubagent,
  type ClockPort,
  HEARTBEAT_MS,
  INACTIVE_AFTER_MS,
  PRUNE_AFTER_MS,
  type StorePort,
  SUBAGENT_LIMIT,
  type Summary,
  createRegistry,
} from '../hooks/monitor/registry'
import type { SessionEntry } from '../types'

type Timer = { at: number; period: number | null; fn: () => void; cancelled: boolean }

type World = {
  data: Map<string, unknown>
  sets: { key: string; value: SessionEntry }[]
  deletes: string[]
  failures: { set: boolean; keys: boolean; get: string | null }
  time: () => number
  timers: () => number
  advance: (ms: number) => Promise<void>
  jump: (ms: number) => void
  summary: Summary
  store: StorePort
  clock: ClockPort
}

const START = 1_000_000
const OWN = 'me'

const drain = async () => {
  for (let tick = 0; tick < 40; tick += 1) {
    await Promise.resolve()
  }
}

const brief = (over: Partial<BriefSubagent> = {}): BriefSubagent => ({
  type: 'Explore',
  task: 'look around',
  status: 'running',
  tool: null,
  tokens: 0,
  endedAt: null,
  ...over,
})

const entry = (over: Partial<SessionEntry> = {}): SessionEntry => ({
  cwd: 'C:/work/other',
  repo: null,
  agent: null,
  model: null,
  state: 'idle',
  turnStartedAt: null,
  subagents: [],
  updatedAt: START,
  ...over,
})

const world = (seed: Record<string, unknown> = {}): World => {
  const data = new Map(Object.entries(seed))
  const timers: Timer[] = []
  const failures: World['failures'] = { set: false, keys: false, get: null }
  let time = START

  const schedule = (ms: number, period: number | null, fn: () => void) => {
    const timer: Timer = { at: time + ms, period, fn, cancelled: false }

    timers.push(timer)

    return {
      cancel: () => {
        timer.cancelled = true
      },
    }
  }

  const live = () => timers.filter(timer => !timer.cancelled)

  const advance = async (ms: number) => {
    const target = time + ms

    for (;;) {
      const next = live()
        .filter(timer => timer.at <= target)
        .sort((a, b) => a.at - b.at)[0]

      if (next === undefined) {
        break
      }

      time = next.at

      if (next.period === null) {
        next.cancelled = true
      } else {
        next.at += next.period
      }

      next.fn()
      await drain()
    }

    time = target
    await drain()
  }

  const w: World = {
    data,
    sets: [],
    deletes: [],
    failures,
    time: () => time,
    timers: () => live().length,
    advance,
    jump: ms => {
      time += ms
    },
    summary: {
      cwd: 'C:/work/me',
      repo: 'app',
      agent: 'architect',
      model: 'claude-opus-5-5',
      state: 'idle',
      turnStartedAt: null,
      subagents: [],
    },
    store: {
      get: async key => {
        if (failures.get === key) {
          throw new Error('unreadable')
        }

        return data.get(key)
      },
      set: async (key, value) => {
        w.sets.push({ key, value: value as SessionEntry })

        if (failures.set) {
          throw new Error('disk full')
        }

        data.set(key, value)
      },
      delete: async key => {
        w.deletes.push(key)
        data.delete(key)
      },
      keys: async () => {
        if (failures.keys) {
          throw new Error('no keys')
        }

        return [...data.keys()]
      },
    },
    clock: {
      now: async () => time,
      after: (ms, fn) => schedule(ms, null, fn),
      every: (ms, fn) => schedule(ms, ms, fn),
    },
  }

  return w
}

const registryOf = (w: World, shareAnswers = true) =>
  createRegistry({ store: w.store, clock: w.clock, snapshot: () => w.summary, shareAnswers })

const startedRegistry = (w: World, shareAnswers = true) => {
  const registry = registryOf(w, shareAnswers)

  registry.start(OWN)

  return registry
}

const keyOwn = `sess:${OWN}`

test('the session publishes only its own key, with the summary fields and the time of the write', async () => {
  const w = world({ 'sess:other': entry(), 'launcher:other': { agent: null, native: null, at: 1 } })

  w.summary = { ...w.summary, state: 'working', turnStartedAt: START - 500, lastAnswer: 'all good' }
  w.summary.subagents = [brief({ type: 'Plan', task: 'plan it', tool: 'Read', tokens: 42 })]
  startedRegistry(w)
  await w.advance(BATCH_MS)

  expect(w.sets.map(({ key }) => key)).toEqual([keyOwn])
  expect(w.sets[0]?.value).toEqual({
    cwd: 'C:/work/me',
    repo: 'app',
    agent: 'architect',
    model: 'claude-opus-5-5',
    state: 'working',
    turnStartedAt: START - 500,
    subagents: [{ type: 'Plan', task: 'plan it', status: 'running', tool: 'Read', tokens: 42 }],
    lastAnswer: 'all good',
    updatedAt: START + BATCH_MS,
  })
  expect(w.deletes).toEqual([])
})

test('a summary with a title publishes it, and one without writes no title key', async () => {
  const titled = world()

  titled.summary.title = 'Fix the login bug'
  startedRegistry(titled)
  await titled.advance(BATCH_MS)

  expect(titled.sets[0]?.value.title).toBe('Fix the login bug')

  const untitled = world()

  startedRegistry(untitled)
  await untitled.advance(BATCH_MS)

  expect('title' in (untitled.sets[0]?.value ?? {})).toBe(false)
})

test('at most 30 subagents are published: the running ones first, then the most recently ended', async () => {
  const w = world()

  w.summary.subagents = [
    ...Array.from({ length: 25 }, (_unused, index) => brief({ task: `done-${index}`, status: 'completed', endedAt: 100 + index })),
    ...Array.from({ length: 10 }, (_unused, index) => brief({ task: `run-${index}` })),
  ]
  startedRegistry(w)
  await w.advance(BATCH_MS)

  const tasks = w.sets[0]?.value.subagents.map(({ task }) => task) ?? []

  expect(tasks.length).toBe(SUBAGENT_LIMIT)
  expect(tasks.slice(0, 10)).toEqual(Array.from({ length: 10 }, (_unused, index) => `run-${index}`))
  expect(tasks[10]).toBe('done-24')
  expect(tasks).toContain('done-5')
  expect(tasks).not.toContain('done-4')
})

test('several changes inside one second are one write', async () => {
  const w = world()
  const registry = startedRegistry(w)

  await w.advance(BATCH_MS)
  w.sets.length = 0

  registry.changed()
  await w.advance(200)
  registry.changed()
  await w.advance(200)
  registry.changed()
  await w.advance(BATCH_MS)

  expect(w.sets.length).toBe(1)

  registry.changed()
  await w.advance(BATCH_MS)

  expect(w.sets.length).toBe(2)
})

test('without any change the session still writes once every 15 seconds', async () => {
  const w = world()

  startedRegistry(w)
  await w.advance(BATCH_MS)

  expect(w.sets.length).toBe(1)

  await w.advance(HEARTBEAT_MS - BATCH_MS - 1)

  expect(w.sets.length).toBe(1)

  await w.advance(1)

  expect(w.sets.length).toBe(2)

  await w.advance(HEARTBEAT_MS)

  expect(w.sets.length).toBe(3)
  expect(w.sets.map(({ value }) => value.updatedAt)).toEqual([START + BATCH_MS, START + HEARTBEAT_MS, START + 2 * HEARTBEAT_MS])
})

test('with shareAnswers off the last answer is not written', async () => {
  const w = world()

  w.summary.lastAnswer = 'a secret answer'
  startedRegistry(w, false)
  await w.advance(BATCH_MS)

  expect(w.sets[0]?.value.lastAnswer).toBe(undefined)
  expect('lastAnswer' in (w.sets[0]?.value ?? {})).toBe(false)
})

test('with shareAnswers on the last answer is cut at 300 characters', async () => {
  const w = world()

  w.summary.lastAnswer = 'x'.repeat(ANSWER_LIMIT + 50)
  startedRegistry(w)
  await w.advance(BATCH_MS)

  expect(w.sets[0]?.value.lastAnswer).toBe('x'.repeat(ANSWER_LIMIT))
})

test('a summary with no answer writes no answer even with shareAnswers on', async () => {
  const w = world()

  startedRegistry(w)
  await w.advance(BATCH_MS)

  expect('lastAnswer' in (w.sets[0]?.value ?? {})).toBe(false)
})

test('an entry 61 seconds without a heartbeat reads as inactive and stays in the store', async () => {
  const w = world({
    'sess:stale': entry({ state: 'working', updatedAt: START - INACTIVE_AFTER_MS - 1000 }),
    'sess:edge': entry({ state: 'working', updatedAt: START - INACTIVE_AFTER_MS }),
  })
  const registry = startedRegistry(w)
  const others = await registry.others()

  expect(others.map(({ sessionId, presence }) => [sessionId, presence]).sort()).toEqual([
    ['edge', 'trabalhando'],
    ['stale', 'inativa'],
  ])
  expect(w.data.has('sess:stale')).toBe(true)
  expect(w.deletes).toEqual([])
})

test('working and idle entries read as trabalhando and ociosa, the newest first, own key left out', async () => {
  const w = world({
    'sess:a': entry({ state: 'working', updatedAt: START - 10_000, agent: 'probe', subagents: [{ type: 'T', task: 'k', status: 'running', tool: null, tokens: 1 }] }),
    'sess:b': entry({ state: 'idle', updatedAt: START - 2000 }),
    [keyOwn]: entry({ state: 'working', updatedAt: START }),
  })
  const others = await startedRegistry(w).others()

  expect(others.map(({ sessionId, presence }) => [sessionId, presence])).toEqual([
    ['b', 'ociosa'],
    ['a', 'trabalhando'],
  ])
  expect(others[1]).toMatchObject({ agent: 'probe', cwd: 'C:/work/other', subagents: [{ type: 'T', task: 'k', status: 'running', tool: null, tokens: 1 }] })
})

test('the prune guard: 24 hours on, only the expired sess: entry goes; a recent one, the own key and every launcher: key stay', async () => {
  const expired = entry({ updatedAt: START })
  const w = world({
    'sess:expired': expired,
    'sess:recent': entry({ updatedAt: START + PRUNE_AFTER_MS - 1000 }),
    [keyOwn]: entry({ updatedAt: START }),
    'launcher:old': entry({ updatedAt: START }),
    'launcher:other': { agent: null, native: 'x', at: 1 },
    unrelated: entry({ updatedAt: START }),
  })
  const registry = startedRegistry(w)

  w.jump(PRUNE_AFTER_MS + 1)
  w.deletes.length = 0

  const others = await registry.others()

  expect(w.deletes).toEqual(['sess:expired'])
  expect(w.data.has('sess:expired')).toBe(false)
  expect(w.data.has('sess:recent')).toBe(true)
  expect(w.data.has(keyOwn)).toBe(true)
  expect(w.data.has('launcher:old')).toBe(true)
  expect(w.data.has('launcher:other')).toBe(true)
  expect(w.data.has('unrelated')).toBe(true)
  expect(others.map(({ sessionId }) => sessionId)).toEqual(['recent'])
})

test('an entry just under 24 hours is not pruned', async () => {
  const w = world({ 'sess:old': entry({ state: 'ended', updatedAt: START }) })
  const registry = startedRegistry(w)

  w.jump(PRUNE_AFTER_MS - BATCH_MS)
  w.deletes.length = 0

  expect((await registry.others()).map(({ presence }) => presence)).toEqual(['encerrada'])
  expect(w.deletes).toEqual([])
})

test('the end of the session writes encerrada and stops every timer', async () => {
  const w = world()
  const registry = startedRegistry(w)

  await w.advance(BATCH_MS)
  w.summary.state = 'working'
  registry.changed()
  await registry.end()

  expect(w.sets.at(-1)?.value.state).toBe('ended')
  expect(w.timers()).toBe(0)

  const writes = w.sets.length

  registry.changed()
  await w.advance(HEARTBEAT_MS * 3)

  expect(w.sets.length).toBe(writes)

  await registry.end()

  expect(w.sets.length).toBe(writes)
})

test('another session reads an ended entry as encerrada even when it is old', async () => {
  const w = world({ 'sess:gone': entry({ state: 'ended', updatedAt: START - 3_600_000 }) })

  expect((await startedRegistry(w).others()).map(({ presence }) => presence)).toEqual(['encerrada'])
})

test('a stored title is carried to the other sessions, and an entry stored without one is still valid', async () => {
  const w = world({
    'sess:titled': entry({ title: 'Fix the login bug', updatedAt: START - 1000 }),
    'sess:old': entry({ updatedAt: START - 2000 }),
    'sess:odd': { ...entry({ updatedAt: START - 3000 }), title: 42 },
  })
  const others = await startedRegistry(w).others()

  expect(others.map(({ sessionId }) => sessionId)).toEqual(['titled', 'old', 'odd'])
  expect(others[0]?.title).toBe('Fix the login bug')
  expect('title' in (others[1] ?? {})).toBe(false)
  expect('title' in (others[2] ?? {})).toBe(false)
})

test('an entry of another shape is ignored, kept in the store, and does not break the read', async () => {
  const w = world({
    'sess:text': 'just text',
    'sess:null': null,
    'sess:no-cwd': { ...entry(), cwd: undefined },
    'sess:bad-state': { ...entry(), state: 'sleeping' },
    'sess:bad-subagent': { ...entry(), subagents: [{ type: 1 }] },
    'sess:bad-list': { ...entry(), subagents: 'many' },
    'sess:bad-time': { ...entry(), updatedAt: 'yesterday' },
    'sess:good': entry({ state: 'idle', updatedAt: START }),
  })
  const others = await startedRegistry(w).others()

  expect(others.map(({ sessionId }) => sessionId)).toEqual(['good'])
  expect(w.deletes).toEqual([])
  expect(w.data.size).toBe(8)
})

test('a store that cannot be read gives an empty list, and one unreadable key only loses that key', async () => {
  const w = world({ 'sess:a': entry(), 'sess:b': entry() })
  const registry = startedRegistry(w)

  w.failures.get = 'sess:a'

  expect((await registry.others()).map(({ sessionId }) => sessionId)).toEqual(['b'])

  w.failures.keys = true

  expect(await registry.others()).toEqual([])
})

test('a store.set that throws does not throw out of the registry and adds no write beyond the window and the beat', async () => {
  const w = world()
  const registry = startedRegistry(w)

  w.failures.set = true
  await w.advance(BATCH_MS)

  expect(w.sets.length).toBe(1)

  registry.changed()
  registry.changed()
  await w.advance(BATCH_MS)

  expect(w.sets.length).toBe(2)

  await w.advance(HEARTBEAT_MS)

  expect(w.sets.length).toBe(3)

  w.failures.set = false
  await w.advance(HEARTBEAT_MS)

  expect(w.sets.length).toBe(4)
  expect(w.data.has(keyOwn)).toBe(true)
  await registry.end()
  expect(w.data.get(keyOwn)).toMatchObject({ state: 'ended' })
})

test('a store.set that throws at the end does not throw either', async () => {
  const w = world()
  const registry = startedRegistry(w)

  w.failures.set = true

  await registry.end()

  expect(w.sets.length).toBe(1)
})

test('a snapshot that throws does not throw out of the registry', async () => {
  const w = world()
  const registry = createRegistry({
    store: w.store,
    clock: w.clock,
    snapshot: () => {
      throw new Error('broken summary')
    },
    shareAnswers: true,
  })

  registry.start(OWN)
  await w.advance(BATCH_MS)
  await registry.end()

  expect(w.sets.length).toBe(0)
})

test('a new session id after /clear publishes under the new key and leaves the ended old one', async () => {
  const w = world()
  const registry = startedRegistry(w)

  await w.advance(BATCH_MS)
  await registry.end()
  registry.moveTo('next')
  await w.advance(BATCH_MS)

  expect(w.sets.map(({ key }) => key)).toEqual([keyOwn, keyOwn, 'sess:next'])
  expect(w.data.get(keyOwn)).toMatchObject({ state: 'ended' })
  expect(w.data.get('sess:next')).toMatchObject({ state: 'idle' })
  expect(w.deletes).toEqual([])

  await w.advance(HEARTBEAT_MS)

  expect(w.sets.at(-1)?.key).toBe('sess:next')
})

test('a move with no end before it removes the old key of this session', async () => {
  const w = world()
  const registry = startedRegistry(w)

  await w.advance(BATCH_MS)
  registry.moveTo('next')
  await w.advance(BATCH_MS)

  expect(w.deletes).toEqual([keyOwn])
  expect(w.data.has(keyOwn)).toBe(false)
  expect(w.data.has('sess:next')).toBe(true)
  expect(w.timers()).toBe(1)
})

test('a move to the same id after the end brings the session back', async () => {
  const w = world()
  const registry = startedRegistry(w)

  await w.advance(BATCH_MS)
  await registry.end()
  registry.moveTo(OWN)
  await w.advance(BATCH_MS)

  expect(w.data.get(keyOwn)).toMatchObject({ state: 'idle' })
  expect(w.timers()).toBe(1)
})

test('moving to the id already in use changes nothing', async () => {
  const w = world()
  const registry = startedRegistry(w)

  await w.advance(BATCH_MS)
  registry.moveTo(OWN)
  await w.advance(BATCH_MS)

  expect(w.sets.length).toBe(1)
  expect(w.deletes).toEqual([])
  expect(w.timers()).toBe(1)
})

test('a change before start or after the end schedules nothing', async () => {
  const w = world()
  const registry = registryOf(w)

  registry.changed()

  expect(w.timers()).toBe(0)

  registry.start(OWN)
  await registry.end()
  registry.changed()

  expect(w.timers()).toBe(0)
})
