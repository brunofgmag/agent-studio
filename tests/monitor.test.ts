import type { AgentInfo, On, TurnUsage } from 'claude-code'
import { type Engine, expect, mock } from 'claude-code/testing'

import { register } from '../hooks/register'
import type { SessionEntry } from '../types'
import { test } from './in-portuguese'

type Setup = {
  store?: Readonly<Record<string, unknown>>
  repoName?: string
  brokenClock?: true
}

type Stage = {
  sessionId: string
  store: Map<string, unknown>
  sets: { key: string; value: unknown }[]
  deletes: string[]
  statuses: (string | undefined)[]
  failSet: boolean
  failList: boolean
  listed: AgentInfo[]
  listCalls: number
  registered: string[]
  spawnIds: string[]
  spawned: string[]
  prompts: { prompt: string; title: string | undefined }[]
  usage: TurnUsage | null
  denySpawn: boolean
  toolGate: Promise<void> | null
  clock: ReturnType<typeof mock.clock>
}

const PROJECT = 'C:/work/app'
const SESSION = 'session-1'
const SESSION_MODEL = 'claude-haiku-5-5'
const NOW = 1_000_000_000

const AGENTS = [
  { file: `${PROJECT}/.claude/agents/worker.md`, text: '---\nname: worker\ndescription: worker description\nmodel: claude-opus-5-5[1m]\neffort: high\n---\nYou are worker.\n' },
  { file: `${PROJECT}/.claude/agents/dispatcher.md`, text: '---\nname: dispatcher\ndescription: dispatcher description\ntools: Agent(researcher), Read\n---\nYou are dispatcher.\n' },
  { file: `${PROJECT}/.claude/agents/restricted.md`, text: '---\nname: restricted\ndescription: restricted description\ntools: Read\n---\nYou are restricted.\n' },
]

const usage = (input: number, output = 0, read = 0, created = 0): TurnUsage => ({
  model: SESSION_MODEL,
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: created,
})

const entry = (over: Partial<SessionEntry> = {}): SessionEntry => ({
  cwd: 'C:/work/other',
  repo: null,
  agent: null,
  model: null,
  state: 'idle',
  turnStartedAt: null,
  subagents: [],
  updatedAt: NOW,
  ...over,
})

const stage = (on: On, setup: Setup = {}): Stage => {
  const world: Stage = {
    sessionId: SESSION,
    store: new Map(Object.entries(setup.store ?? {})),
    sets: [],
    deletes: [],
    statuses: [],
    failSet: false,
    failList: false,
    listed: [],
    listCalls: 0,
    registered: [],
    spawnIds: ['sub-1', 'sub-2', 'sub-3', 'sub-4', 'sub-5'],
    spawned: [],
    prompts: [],
    usage: null,
    denySpawn: false,
    toolGate: null,
    clock: setup.brokenClock === undefined ? mock.clock(on, { now: NOW }) : (undefined as never),
  }
  const files = new Map(AGENTS.map(({ file, text }) => [file, text]))

  if (setup.brokenClock !== undefined) {
    on('clock.now', () => {
      throw new Error('clock broke')
    })
  }

  mock.session(on)
  mock.env(on, { USERPROFILE: 'C:\\Users\\dev' })
  on('session.cwd', () => ({ value: PROJECT }))
  on('session.root', () => ({ value: PROJECT }))
  on('session.repo', () => ({
    value:
      setup.repoName === undefined ? null : { root: PROJECT, remote: null, internal: false, name: setup.repoName },
  }))
  on('session.id', () => ({ value: world.sessionId }))
  on('session.model', () => ({ value: SESSION_MODEL }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', (_$, e) => {
    world.statuses.push(e.text)

    return { value: undefined }
  })
  on('settings.read', () => ({ value: {} }))
  on('session.surfaces', () => ({ value: [] }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('store.get', (_$, e) => ({ value: world.store.get(e.key) }))
  on('store.set', (_$, e) => {
    world.sets.push({ key: e.key, value: e.value })

    if (world.failSet && e.key.startsWith('sess:')) {
      throw new Error('disk full')
    }

    world.store.set(e.key, e.value)

    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    world.deletes.push(e.key)
    world.store.delete(e.key)

    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...world.store.keys()] }))
  on('fs.read', (_$, e) => {
    const text = files.get(e.path.replaceAll('\\', '/'))

    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })
  on('fs.list', (_$, e) => {
    const dir = e.path.replaceAll('\\', '/').replace(/\/$/, '')
    const names = [...files.keys()].filter(file => file.startsWith(`${dir}/`)).map(file => file.slice(dir.length + 1))

    return names.length === 0
      ? { deny: `ENOENT ${e.path}` }
      : { value: names.map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })) }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => {
    world.registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('command.run', () => ({ text: 'bottom answered' }))
  on('classic.SessionStart', () => ({}))
  on('classic.UserPromptSubmit', (_$, e) => {
    world.prompts.push({ prompt: e.prompt, title: e.session_title })

    return {}
  })
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('prompt.compose', () => ({ sections: [] }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: world.usage }
  })
  on('tool.call', async (_$, e) => {
    await world.toolGate

    return { ref: 1, result: `ran ${String(e.tool)}`, text: `ran ${String(e.tool)}` }
  })
  on('agent.spawn', (_$, e) => {
    if (world.denySpawn) {
      return { deny: 'no' }
    }

    world.spawned.push(e.subagentType)

    return { model: SESSION_MODEL, agentId: world.spawnIds.shift() ?? 'sub-x' }
  })
  on('agent.list', () => {
    world.listCalls += 1

    if (world.failList) {
      throw new Error('no list')
    }

    return { value: world.listed }
  })

  return world
}

const begin = ($: Engine) => $.session.start({ cwd: PROJECT, surface: null, isInteractive: true })

const run = async ($: Engine, command: string, args = '') =>
  (
    await $.command.run({
      command,
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })
  ).text ?? ''

const agentPanel = ($: Engine, args = '') => run($, 'agent-panel', args)

const spawn = async ($: Engine, over: { description?: string; subagentType?: string; parentAgentId?: string } = {}) =>
  $.agent.spawn({
    prompt: 'Read every log and report.',
    description: over.description ?? 'read the logs',
    subagentType: over.subagentType ?? 'general-purpose',
    background: false,
    ...(over.parentAgentId === undefined ? {} : { parentAgentId: over.parentAgentId }),
  } as never)

const step = async ($: Engine, agentId?: string) => {
  const stream = $.turn.step({
    turnId: 't1',
    index: 0,
    model: SESSION_MODEL,
    messageCount: 1,
    ...(agentId === undefined ? {} : { agentId }),
  })

  for await (const _chunk of stream) {
    continue
  }
}

const complete = ($: Engine, over: Record<string, unknown> = {}) =>
  $.turn.complete({
    turnId: 't1',
    answer: 'done',
    durationMs: 500,
    isAborted: false,
    reason: 'answer',
    ...over,
  } as never)

const useTool = ($: Engine, tool: string, agentId?: string) =>
  $.tool.call({ tool, ...(agentId === undefined ? {} : { agentId }) } as never)

const NONE = 'Nenhum subagente nesta sessão.'

const ownKey = `sess:${SESSION}`

test('spawn, tool, step and turn.complete become one line of the /agent-panel tree', async ($, on) => {
  const world = stage(on)
  await begin($)

  await spawn($)
  world.usage = usage(1200, 300)
  await step($, 'sub-1')

  expect(await agentPanel($)).toBe('● rodando  general-purpose  read the logs  —  0:00  1.5k')

  await world.clock.advance(3000)

  expect(await agentPanel($)).toBe('● rodando  general-purpose  read the logs  —  0:03  1.5k')

  world.usage = null
  await complete($, { agentId: 'sub-1', durationMs: 2400, usage: usage(2000, 500) })

  expect(await agentPanel($)).toBe('✓ concluído  general-purpose  read the logs  —  0:02  2.5k')
})

test('the text line and the published entry count input, output and creation, and leave the cache reads out', async ($, on) => {
  const world = stage(on)
  await begin($)

  await spawn($)
  world.usage = usage(1000, 200, 40_000, 300)
  await step($, 'sub-1')
  await world.clock.advance(1000)

  expect(await agentPanel($)).toBe('● rodando  general-purpose  read the logs  —  0:01  1.5k')

  const published = (world.store.get(ownKey) as SessionEntry).subagents

  expect(published).toEqual([{ type: 'general-purpose', task: 'read the logs', status: 'running', tool: null, tokens: 1500 }])
  expect('cachedTokens' in (published[0] ?? {})).toBe(false)
})

test('a tool in flight shows on the line and is cleared when the call ends', async ($, on) => {
  const world = stage(on)
  let release: () => void = () => undefined

  world.toolGate = new Promise<void>(resolve => {
    release = resolve
  })
  await begin($)
  await spawn($)

  const pending = useTool($, 'Read', 'sub-1')

  await world.clock.settle()

  expect(await agentPanel($)).toBe('● rodando  general-purpose  read the logs  Read  0:00  0')

  release()
  await pending

  expect(await agentPanel($)).toBe('● rodando  general-purpose  read the logs  —  0:00  0')
})

test('the tokens of three subagents add up from their steps and then from the turn.complete totals', async ($, on) => {
  const world = stage(on)
  await begin($)

  for (const description of ['one', 'two', 'three']) {
    await spawn($, { description })
  }

  world.usage = usage(1000)
  await step($, 'sub-1')
  await step($, 'sub-2')
  await step($, 'sub-3')
  await step($, 'sub-3')

  expect((await agentPanel($)).split('\n').map(line => line.split('  ').at(-1))).toEqual(['1.0k', '1.0k', '2.0k'])

  await complete($, { agentId: 'sub-1', usage: usage(1200) })
  await complete($, { agentId: 'sub-2', usage: usage(900, 100) })
  await complete($, { agentId: 'sub-3', usage: usage(10_000, 8000) })

  expect((await agentPanel($)).split('\n').map(line => line.split('  ').at(-1))).toEqual(['1.2k', '1.0k', '18k'])
})

test('a token count under a thousand is shown as it is', async ($, on) => {
  const world = stage(on)
  await begin($)

  await spawn($)
  world.usage = usage(400, 99)
  await step($, 'sub-1')

  expect((await agentPanel($)).split('  ').at(-1)).toBe('499')
})

test('a nested subagent is listed under its parent with two spaces of indent', async ($, on) => {
  const world = stage(on)
  await begin($)

  await spawn($, { description: 'parent' })
  await spawn($, { description: 'other root' })
  await spawn($, { description: 'child', parentAgentId: 'sub-1' })
  world.usage = null

  expect((await agentPanel($)).split('\n')).toEqual([
    '● rodando  general-purpose  parent  —  0:00  0',
    '  ● rodando  general-purpose  child  —  0:00  0',
    '● rodando  general-purpose  other root  —  0:00  0',
  ])
})

test('the main loop makes no line: its tools, steps and turn.complete', async ($, on) => {
  const world = stage(on)
  await begin($)

  world.usage = usage(500)
  await useTool($, 'Bash')
  await step($)
  await complete($)

  expect(await agentPanel($)).toBe(NONE)
})

test('a spawn the engine denied makes no line', async ($, on) => {
  const world = stage(on)
  await begin($)

  world.denySpawn = true
  await spawn($)

  expect(await agentPanel($)).toBe(NONE)
})

test('interrupted, failed and refused ends show parado, falhou and concluído', async ($, on) => {
  stage(on)
  await begin($)

  for (const description of ['a', 'b', 'c']) {
    await spawn($, { description })
  }

  await complete($, { agentId: 'sub-1', isAborted: true, reason: 'aborted' })
  await complete($, { agentId: 'sub-2', reason: 'error' })
  await complete($, { agentId: 'sub-3', reason: 'refusal', refusal: { category: null, explanation: null } })

  expect((await agentPanel($)).split('\n').map(line => line.split('  ').slice(0, 1).join())).toEqual([
    '■ parado',
    '✗ falhou',
    '✓ concluído',
  ])
})

test('a subagent only the official list knows shows up, and the list status decides the word', async ($, on) => {
  const world = stage(on)
  await begin($)

  world.listed = [
    { id: 'early-1', description: 'born before', type: 'Explore', status: 'running' },
    { id: 'early-2', description: 'was stopped', type: 'Explore', status: 'killed', parentId: 'early-1' },
  ]

  expect((await agentPanel($)).split('\n')).toEqual([
    '● rodando  Explore  born before  —  0:00  0',
    '  ■ parado  Explore  was stopped  —  0:00  0',
  ])
})

test('the list wins over an end the events gave', async ($, on) => {
  const world = stage(on)
  await begin($)

  await spawn($)
  world.listed = [{ id: 'sub-1', description: 'read the logs', type: 'general-purpose', status: 'failed' }]

  expect(await agentPanel($)).toBe('✗ falhou  general-purpose  read the logs  —  0:00  0')
})

test('a list that cannot be read leaves the tree the events built', async ($, on) => {
  const world = stage(on)
  await begin($)

  await spawn($)
  world.failList = true

  expect(await agentPanel($)).toBe('● rodando  general-purpose  read the logs  —  0:00  0')
  expect(world.listCalls).toBe(1)
})

test('the active agent heads the tree, and the line names its model and effort', async ($, on) => {
  stage(on)
  await begin($)
  await run($, 'as', 'worker')
  await spawn($)

  expect((await agentPanel($)).split('\n')[0]).toBe('Agente em vigor: @worker · claude-opus-5-5[1m] · high')
})

test('a session that turns out to be native shows no agent in the header and publishes none', async ($, on) => {
  const world = stage(on)
  await begin($)
  await run($, 'as', 'worker')
  await $.classic.SessionStart({ source: 'startup', agent_type: 'architect' })
  await spawn($)
  await world.clock.advance(1000)

  expect(await agentPanel($)).toBe('● rodando  general-purpose  read the logs  —  0:01  0')
  expect(world.store.get(ownKey)).toMatchObject({ agent: null, model: SESSION_MODEL })
})

test('a native session restored beside a saved /as agent shows and publishes no agent', async ($, on) => {
  const world = stage(on, {
    store: {
      [`launcher:${SESSION}`]: {
        agent: { name: 'worker', path: `${PROJECT}/.claude/agents/worker.md`, source: 'project' },
        native: 'architect',
        at: 1,
      },
    },
  })

  await begin($)
  await spawn($)
  await world.clock.advance(1000)

  expect(await agentPanel($)).toBe('● rodando  general-purpose  read the logs  —  0:01  0')
  expect(world.store.get(ownKey)).toMatchObject({ agent: null, model: SESSION_MODEL })
})

test('a spawn the Launcher denies makes no line, and one it lets through does', async ($, on) => {
  const world = stage(on)
  await begin($)
  await run($, 'as', 'dispatcher')

  await spawn($, { subagentType: 'implementer' })

  expect(world.spawned).toEqual([])
  expect(await agentPanel($)).toBe(NONE)

  await spawn($, { subagentType: 'researcher' })

  expect(world.spawned).toEqual(['researcher'])
  expect((await agentPanel($)).split('\n')[1]).toContain('researcher')
})

test('a subagent tool the Launcher guard would refuse for the main loop passes and shows on the tree', async ($, on) => {
  stage(on)
  await begin($)
  await run($, 'as', 'restricted')
  await spawn($)

  const result = await useTool($, 'Bash', 'sub-1')

  expect(JSON.stringify(result)).toContain('ran Bash')
})

test('a tool the Launcher denies on the main loop is still denied', async ($, on) => {
  stage(on)
  await begin($)
  await run($, 'as', 'restricted')

  expect(JSON.stringify(await useTool($, 'Bash'))).toContain('restricted')
})

test('a clear forgets the subagents of the old conversation', async ($, on) => {
  const world = stage(on)
  await begin($)
  await spawn($)

  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: { id: SESSION } } as never)
  world.sessionId = 'session-2'
  await $.classic.SessionStart({ source: 'clear' })

  expect(await agentPanel($)).toBe(NONE)
})

test('a compaction keeps the subagents', async ($, on) => {
  stage(on)
  await begin($)
  await spawn($)
  await $.classic.SessionStart({ source: 'compact' })

  expect(await agentPanel($)).not.toBe(NONE)
})

test('a resume and a fork also change the key and forget the subagents', async ($, on) => {
  const world = stage(on)
  await begin($)
  await spawn($)

  world.sessionId = 'resumed'
  await $.classic.SessionStart({ source: 'resume' })
  await world.clock.advance(1000)

  expect(await agentPanel($)).toBe(NONE)
  expect(world.store.has('sess:resumed')).toBe(true)
  expect(world.store.has(ownKey)).toBe(false)

  world.sessionId = 'forked'
  await $.classic.SessionStart({ source: 'fork' })
  await world.clock.advance(1000)

  expect(world.store.has('sess:forked')).toBe(true)
  expect(world.store.has('sess:resumed')).toBe(false)
})

test('/agent-panel with an argument it does not know says how to use it', async ($, on) => {
  stage(on)
  await begin($)

  expect(await agentPanel($, 'foo')).toBe(
    'Uso: /agent-panel para os subagentes desta sessão, /agent-panel sessions para as outras sessões.',
  )
})

test('/agent-panel sessions lists the other sessions from the store and leaves this one out', async ($, on) => {
  const world = stage(on, {
    store: {
      'sess:busy': entry({
        cwd: 'C:/work/api',
        agent: 'architect',
        state: 'working',
        turnStartedAt: NOW - 83_000,
        updatedAt: NOW - 5000,
        subagents: [
          { type: 'Explore', task: 'a', status: 'running', tool: null, tokens: 1 },
          { type: 'Explore', task: 'b', status: 'completed', tool: null, tokens: 2 },
        ],
      }),
      'sess:silent': entry({ cwd: 'C:/work/old', state: 'working', updatedAt: NOW - 61_000 }),
      'sess:done': entry({
        cwd: 'C:/work/done',
        state: 'ended',
        updatedAt: NOW - 120_000,
        subagents: [{ type: 'Plan', task: 'p', status: 'failed', tool: null, tokens: 3 }],
      }),
      [ownKey]: entry({ cwd: 'C:/work/me', updatedAt: NOW }),
      'launcher:busy': { agent: null, native: null, at: 1 },
    },
  })

  await begin($)

  expect((await agentPanel($, 'sessions')).split('\n')).toEqual([
    'Outras sessões (3):',
    '  C:/work/api  @architect  trabalhando  2 subagentes  1:23',
    '  C:/work/old  sem agente  inativa  0 subagentes  há 1 min',
    '  C:/work/done  sem agente  encerrada  1 subagente  há 2 min',
  ])
  expect(world.deletes).toEqual([])
})

test('/agent-panel sessions with nothing else in the store says so', async ($, on) => {
  stage(on)
  await begin($)

  expect(await agentPanel($, 'sessions')).toBe('Nenhuma outra sessão registrada.')
})

const DAY_MS = 24 * 60 * 60 * 1000

test('/agent-panel sessions prunes an entry 24 hours old and leaves launcher keys alone', async ($, on) => {
  const world = stage(on, {
    store: {
      'sess:ancient': entry({ updatedAt: NOW - DAY_MS - 1 }),
      'launcher:ancient': entry({ updatedAt: NOW - DAY_MS - 1 }),
    },
  })

  await begin($)

  expect(await agentPanel($, 'sessions')).toBe('Nenhuma outra sessão registrada.')
  expect(world.deletes).toEqual(['sess:ancient'])
  expect(world.store.has('launcher:ancient')).toBe(true)
})

test('the session publishes its own key one second after start, with the session facts', async ($, on) => {
  const world = stage(on, { repoName: 'app' })

  await begin($)

  expect(world.sets.filter(({ key }) => key.startsWith('sess:'))).toEqual([])

  await world.clock.advance(1000)

  expect(world.store.get(ownKey)).toEqual({
    cwd: PROJECT,
    repo: 'app',
    agent: null,
    model: SESSION_MODEL,
    state: 'idle',
    turnStartedAt: null,
    idleSince: NOW,
    subagents: [],
    updatedAt: NOW + 1000,
  })
})

test('after /as x the registry publishes the agent and its model', async ($, on) => {
  const world = stage(on)

  await begin($)
  await world.clock.advance(1000)
  await run($, 'as', 'worker')
  await world.clock.advance(1000)

  expect(world.store.get(ownKey)).toMatchObject({ agent: 'worker', model: 'claude-opus-5-5[1m]' })

  await run($, 'as', 'off')
  await world.clock.advance(1000)

  expect(world.store.get(ownKey)).toMatchObject({ agent: null, model: SESSION_MODEL })
})

test('turn.start and turn.complete of the main loop publish working, the turn start, idle and the last answer', async ($, on) => {
  const world = stage(on)

  await begin($)
  await world.clock.advance(2000)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await world.clock.advance(1000)

  expect(world.store.get(ownKey)).toMatchObject({ state: 'working', turnStartedAt: NOW + 2000 })

  await complete($, { answer: 'the final answer' })
  await world.clock.advance(1000)

  expect(world.store.get(ownKey)).toMatchObject({
    state: 'idle',
    turnStartedAt: null,
    lastAnswer: 'the final answer',
  })
})

test('idleSince is the start of the session, is absent while a turn runs and is the instant the main loop stopped', async ($, on) => {
  const world = stage(on)

  await begin($)
  await world.clock.advance(1000)

  expect((world.store.get(ownKey) as SessionEntry).idleSince).toBe(NOW)

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await world.clock.advance(1000)

  expect('idleSince' in (world.store.get(ownKey) as SessionEntry)).toBe(false)

  await world.clock.advance(4000)
  await complete($, { answer: 'done' })
  await world.clock.advance(1000)

  expect(world.store.get(ownKey)).toMatchObject({ state: 'idle', idleSince: NOW + 6000 })
})

test('a subagent turn.complete leaves idleSince where the main loop put it', async ($, on) => {
  const world = stage(on)

  await begin($)
  await spawn($)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await world.clock.advance(1000)
  await complete($, { answer: 'done' })
  await world.clock.advance(5000)
  await complete($, { agentId: 'sub-1', answer: 'sub answer' })
  await world.clock.advance(1000)

  expect(world.store.get(ownKey)).toMatchObject({ state: 'idle', idleSince: NOW + 1000 })
})

for (const source of ['clear', 'resume', 'fork'] as const) {
  test(`a ${source} restarts idleSince at the instant the session moved, even from a running turn`, async ($, on) => {
    const world = stage(on)

    await begin($)
    await $.turn.start({ text: 'hi', turnId: 't1' })
    await world.clock.advance(7000)
    await $.session.end({ reason: source, sessionId: SESSION, resume: { id: SESSION } } as never)
    world.sessionId = 'session-2'
    await $.classic.SessionStart({ source })
    await world.clock.advance(1000)

    expect(world.store.get('sess:session-2')).toMatchObject({ state: 'idle', idleSince: NOW + 7000 })
  })
}

test('a subagent turn.complete does not mark the session idle or set its last answer', async ($, on) => {
  const world = stage(on)

  await begin($)
  await spawn($)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await complete($, { agentId: 'sub-1', answer: 'sub answer' })
  await world.clock.advance(1000)

  const published = world.store.get(ownKey) as SessionEntry

  expect(published.state).toBe('working')
  expect('lastAnswer' in published).toBe(false)
  expect(published.subagents).toEqual([
    { type: 'general-purpose', task: 'read the logs', status: 'completed', tool: null, tokens: 0 },
  ])
})

test('the last answer is cut at 300 characters with shareAnswers on', async ($, on) => {
  const world = stage(on)

  await begin($)
  await complete($, { answer: 'y'.repeat(500) })
  await world.clock.advance(1000)

  expect((world.store.get(ownKey) as SessionEntry).lastAnswer).toBe('y'.repeat(300))
})

test('shareAnswers false keeps every answer out of the store', { options: { shareAnswers: false } }, async ($, on) => {
  const world = stage(on)

  await begin($)
  await complete($, { answer: 'private' })
  await world.clock.advance(1000)

  expect(JSON.stringify([...world.store.values()])).not.toContain('private')
  expect('lastAnswer' in (world.store.get(ownKey) as SessionEntry)).toBe(false)
})

test('the beat writes every 15 seconds with nothing changing', async ($, on) => {
  const world = stage(on)

  await begin($)
  await world.clock.advance(1000)

  const before = world.sets.length

  await world.clock.advance(15_000 - 1000)

  expect(world.sets.length).toBe(before + 1)
})

test('session.end writes encerrada and no write follows', async ($, on) => {
  const world = stage(on)

  await begin($)
  await world.clock.advance(1000)
  await $.session.end({ reason: 'other', sessionId: SESSION, resume: { id: SESSION } } as never)

  expect(world.store.get(ownKey)).toMatchObject({ state: 'ended' })

  const writes = world.sets.length

  await world.clock.advance(60_000)

  expect(world.sets.length).toBe(writes)
})

test('a /clear marks the old key encerrada and publishes the new key', async ($, on) => {
  const world = stage(on)

  await begin($)
  await world.clock.advance(1000)
  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: { id: SESSION } } as never)
  world.sessionId = 'session-2'
  await $.classic.SessionStart({ source: 'clear' })
  await world.clock.advance(1000)

  expect(world.store.get(ownKey)).toMatchObject({ state: 'ended' })
  expect(world.store.get('sess:session-2')).toMatchObject({ state: 'idle' })

  await world.clock.advance(15_000)

  expect(world.sets.at(-1)?.key).toBe('sess:session-2')
})

test('the title from SessionStart reaches the published entry', async ($, on) => {
  const world = stage(on)

  await begin($)
  await $.classic.SessionStart({ source: 'startup', session_title: 'Fix the login bug' })
  await world.clock.advance(1000)

  expect(world.store.get(ownKey)).toMatchObject({ title: 'Fix the login bug' })
})

test('the title from UserPromptSubmit reaches the published entry and the prompt goes down the chain unchanged', async ($, on) => {
  const world = stage(on)

  await begin($)
  await world.clock.advance(1000)
  await $.classic.UserPromptSubmit({ prompt: 'fix the bug', session_title: 'Fix the login bug' })
  await world.clock.advance(1000)

  expect(world.store.get(ownKey)).toMatchObject({ title: 'Fix the login bug' })
  expect(world.prompts).toEqual([{ prompt: 'fix the bug', title: 'Fix the login bug' }])
})

test('a later title replaces the earlier one', async ($, on) => {
  const world = stage(on)

  await begin($)
  await $.classic.SessionStart({ source: 'startup', session_title: 'First' })
  await $.classic.UserPromptSubmit({ prompt: 'go', session_title: 'Second' })
  await world.clock.advance(1000)

  expect(world.store.get(ownKey)).toMatchObject({ title: 'Second' })
})

test('a missing or empty title changes nothing and the prompt still passes', async ($, on) => {
  const world = stage(on)

  await begin($)
  await $.classic.SessionStart({ source: 'startup', session_title: 'Kept' })
  await $.classic.UserPromptSubmit({ prompt: 'no title here' })
  await $.classic.UserPromptSubmit({ prompt: 'empty title', session_title: '' })
  await world.clock.advance(1000)

  expect(world.store.get(ownKey)).toMatchObject({ title: 'Kept' })
  expect(world.prompts.map(({ prompt }) => prompt)).toEqual(['no title here', 'empty title'])
})

test('a clear drops the title of the old conversation', async ($, on) => {
  const world = stage(on)

  await begin($)
  await $.classic.SessionStart({ source: 'startup', session_title: 'Old title' })
  await world.clock.advance(1000)
  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: { id: SESSION } } as never)
  world.sessionId = 'session-2'
  await $.classic.SessionStart({ source: 'clear' })
  await world.clock.advance(1000)

  expect(world.store.get('sess:session-2')).toBeDefined()
  expect('title' in (world.store.get('sess:session-2') as object)).toBe(false)
})

test('a Monitor that cannot read the time breaks no hook', { options: { enableLauncher: false } }, async ($, on) => {
  stage(on, { brokenClock: true })

  await begin($)

  expect(((await spawn($)) as { agentId?: string }).agentId).toBe('sub-1')
  expect((await $.turn.start({ text: 'hi', turnId: 't1' })).turnId).toBe('t1')
  expect((await complete($, { agentId: 'sub-1' })).text).toBe('done')
  expect(JSON.stringify(await useTool($, 'Read', 'sub-1'))).toContain('ran Read')
})

test('a store.set that throws breaks no hook and adds no write beyond the window and the beat', async ($, on) => {
  const world = stage(on)

  world.failSet = true
  await begin($)
  await world.clock.advance(1000)

  const own = () => world.sets.filter(({ key }) => key === ownKey).length

  expect(own()).toBe(1)

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await spawn($)
  await step($, 'sub-1')
  await useTool($, 'Read', 'sub-1')
  await complete($, { agentId: 'sub-1' })
  await complete($)
  await world.clock.advance(1000)

  expect(own()).toBe(2)
  expect(await agentPanel($)).toContain('concluído')

  await world.clock.advance(15_000)

  expect(own()).toBe(3)
})

test('with enableMonitor false /agent-panel is not registered and nothing is written to the store', { options: { enableMonitor: false } }, async ($, on) => {
  const world = stage(on)

  await begin($)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await spawn($)
  await step($, 'sub-1')
  await complete($, { agentId: 'sub-1' })
  await world.clock.advance(120_000)
  await $.session.end({ reason: 'other', sessionId: SESSION, resume: { id: SESSION } } as never)

  expect(world.registered).toEqual(['as'])
  expect(await agentPanel($)).toBe('bottom answered')
  expect(await agentPanel($, 'sessions')).toBe('bottom answered')
  expect(world.listCalls).toBe(0)
  expect([...world.store.keys()].filter(key => key.startsWith('sess:'))).toEqual([])
})

test('with enableMonitor false the Launcher still works whole', { options: { enableMonitor: false } }, async ($, on) => {
  const world = stage(on)

  await begin($)

  expect(await run($, 'as', 'restricted')).toContain('restricted')
  expect(JSON.stringify(await useTool($, 'Bash'))).toContain('restricted')
  expect(await run($, 'as', '?')).toContain('Agente ativo: restricted')
  expect(world.registered).toEqual(['as'])
})

test('with enableLauncher false the Monitor still works whole and /as is left to the layers below', { options: { enableLauncher: false } }, async ($, on) => {
  const world = stage(on)

  await begin($)

  expect(world.registered).toEqual(['agent-panel'])
  expect(await run($, 'as', 'restricted')).toBe('bottom answered')

  await spawn($)
  await useTool($, 'Bash', 'sub-1')
  await useTool($, 'Bash')

  expect(await agentPanel($)).toBe('● rodando  general-purpose  read the logs  —  0:00  0')

  await world.clock.advance(1000)

  expect(world.store.get(ownKey)).toMatchObject({ agent: null, subagents: [{ task: 'read the logs' }] })
})

test('with both options off no command is registered and no hook answers', { options: { enableLauncher: false, enableMonitor: false } }, async ($, on) => {
  const world = stage(on)

  await begin($)
  await spawn($)
  await world.clock.advance(120_000)

  expect(world.registered).toEqual([])
  expect(await run($, 'as', 'worker')).toBe('bottom answered')
  expect(await agentPanel($)).toBe('bottom answered')
  expect(world.sets).toEqual([])
  expect(world.listCalls).toBe(0)
})

test('with both options on both commands are registered', async ($, on) => {
  const world = stage(on)

  await begin($)

  expect(world.registered).toEqual(['as', 'agent-panel'])
})

const hooksRegisteredWith = (options: Record<string, boolean>) => {
  const events: string[] = []
  const on = ((event: string) => {
    events.push(event)

    return { catch: () => undefined }
  }) as never

  register(on, options)

  return events
}

test('with both options off register adds no hook at all', () => {
  expect(hooksRegisteredWith({ enableLauncher: false, enableMonitor: false })).toEqual([])
})

test('the UserPromptSubmit hook exists only when the Monitor is on', () => {
  expect(hooksRegisteredWith({ enableLauncher: false, enableMonitor: true })).toContain('classic.UserPromptSubmit')
  expect(hooksRegisteredWith({ enableLauncher: true, enableMonitor: true })).toContain('classic.UserPromptSubmit')
  expect(hooksRegisteredWith({ enableLauncher: true, enableMonitor: false })).not.toContain('classic.UserPromptSubmit')
})

test('with only the Monitor on there is no prompt hook, and with only the Launcher on there is no turn.complete', () => {
  expect(hooksRegisteredWith({ enableLauncher: false, enableMonitor: true })).not.toContain('prompt.compose')
  expect(hooksRegisteredWith({ enableLauncher: false, enableMonitor: true })).toContain('turn.complete')
  expect(hooksRegisteredWith({ enableLauncher: true, enableMonitor: false })).toContain('prompt.compose')
  expect(hooksRegisteredWith({ enableLauncher: true, enableMonitor: false })).not.toContain('turn.complete')
  expect(hooksRegisteredWith({ enableLauncher: true, enableMonitor: false })).not.toContain('session.end')
})

const FOOTER_PROPS = { modes: [] } as const

test('a clear forgets the last reading of the other sessions: the status line counts none until the next reading', async ($, on) => {
  const world = stage(on, {
    store: {
      'sess:peer-1': entry({ state: 'working', updatedAt: NOW }),
      'sess:peer-2': entry({ state: 'working', updatedAt: NOW }),
    },
  })

  on('ui.render', { component: 'SessionMode' }, ($, e) => $.ui.resolve(e).Text({ children: 'below' }))
  await begin($)
  await world.clock.advance(15_000)

  const ui = await $.ui.mount({ plugin: 'agent-studio', surface: 'terminal', component: 'SessionMode', props: FOOTER_PROPS })
  const texts = async () => [(await ui.find({ type: 'Text' }))?.text, world.statuses.at(-1)]

  expect(await texts()).toEqual(['below', '2 sessões trabalhando'])

  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: { id: SESSION } } as never)
  world.sessionId = 'session-2'
  await $.classic.SessionStart({ source: 'clear' })
  await ui.redraw()

  expect(await texts()).toEqual(['below', undefined])

  await world.clock.advance(15_000)

  expect(await texts()).toEqual(['below', '2 sessões trabalhando'])
  expect(world.statuses).toEqual(['2 sessões trabalhando', undefined, '2 sessões trabalhando'])
  await ui.unmount()
})

test('a compaction keeps the last reading of the other sessions', async ($, on) => {
  const world = stage(on, { store: { 'sess:peer-1': entry({ state: 'working', updatedAt: NOW }) } })

  on('ui.render', { component: 'SessionMode' }, ($, e) => $.ui.resolve(e).Text({ children: 'below' }))
  await begin($)
  await world.clock.advance(15_000)

  const ui = await $.ui.mount({ plugin: 'agent-studio', surface: 'terminal', component: 'SessionMode', props: FOOTER_PROPS })

  await $.classic.SessionStart({ source: 'compact' })
  await ui.redraw()

  expect(world.statuses).toEqual(['1 sessão trabalhando'])
  await ui.unmount()
})
