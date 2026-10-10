import type { AgentInfo, On, TurnUsage, UiOpenResult } from 'claude-code'
import { type Engine, type Plugin, expect, mock, test } from 'claude-code/testing'

import type { SessionEntry } from '../types'

type Surface = 'terminal' | 'desktop'

type StopMode = 'ok' | 'deny' | 'error' | 'throw'

type Stage = {
  store: Map<string, unknown>
  keyReads: number
  listed: AgentInfo[]
  listCalls: number
  failList: boolean
  surfaces: Surface[]
  panes: { id: string; title: string }[]
  paneQueries: number
  failPanes: number
  opens: unknown[]
  openResult: UiOpenResult
  failOpen: boolean
  toasts: string[]
  tools: { tool: string; taskId: unknown }[]
  stop: StopMode
  spawnIds: string[]
  clock: ReturnType<typeof mock.clock>
}

const PROJECT = 'C:/work/app'
const SESSION = 'session-1'
const SESSION_MODEL = 'claude-haiku-5-5'
const NOW = 1_000_000_000
const SURFACES: readonly Surface[] = ['terminal', 'desktop']

const PANE_PROPS = {
  title: 'Agentes',
  isFocused: true,
  bodyColumns: 80,
  placement: 'inline',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
} as const

const WORKER_FILE = `${PROJECT}/.claude/agents/worker.md`

const WORKER_TEXT =
  '---\nname: worker\ndescription: worker description\nmodel: claude-opus-5-5[1m]\neffort: high\n---\nYou are worker.\n'

const usage = (input: number, output = 0): TurnUsage => ({
  model: SESSION_MODEL,
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
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

const stage = (on: On, surface: Surface, seed: Readonly<Record<string, unknown>> = {}): Stage => {
  const world: Stage = {
    store: new Map(Object.entries(seed)),
    keyReads: 0,
    listed: [],
    listCalls: 0,
    failList: false,
    surfaces: [surface],
    panes: [],
    paneQueries: 0,
    failPanes: 0,
    opens: [],
    openResult: { isPlaced: true },
    failOpen: false,
    toasts: [],
    tools: [],
    stop: 'ok',
    spawnIds: ['sub-1', 'sub-2', 'sub-3', 'sub-4'],
    clock: mock.clock(on, { now: NOW }),
  }

  mock.session(on)
  mock.env(on, { USERPROFILE: 'C:\\Users\\bruno' })
  on('session.cwd', () => ({ value: PROJECT }))
  on('session.root', () => ({ value: PROJECT }))
  on('session.repo', () => ({ value: null }))
  on('session.id', () => ({ value: SESSION }))
  on('session.model', () => ({ value: SESSION_MODEL }))
  on('session.surfaces', () => ({ value: world.surfaces }))
  on('settings.read', () => ({ value: {} }))
  on('ui.toast', (_$, e) => {
    world.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', (_$, e) => {
    world.opens.push(e)

    if (world.failOpen) {
      throw new Error('refused')
    }

    world.panes = [{ id: e.id, title: e.title ?? e.id }]

    return { value: world.openResult }
  })
  on('ui.close', (_$, e) => {
    world.panes = world.panes.filter(({ id }) => id !== e.id)

    return { value: undefined }
  })
  on('ui.panes', () => {
    world.paneQueries += 1

    if (world.failPanes > 0) {
      world.failPanes -= 1
      throw new Error('panes broke')
    }

    return { value: world.panes.map(({ id, title }) => ({ id, title, isShown: true, isFocused: true, isPlaced: world.openResult.isPlaced })) }
  })
  on('store.get', (_$, e) => ({ value: world.store.get(e.key) }))
  on('store.set', (_$, e) => {
    world.store.set(e.key, e.value)

    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    world.store.delete(e.key)

    return { value: undefined }
  })
  on('store.keys', () => {
    world.keyReads += 1

    return { value: [...world.store.keys()] }
  })
  on('fs.read', (_$, e) =>
    e.path.replaceAll('\\', '/') === WORKER_FILE ? { value: WORKER_TEXT } : { deny: `ENOENT ${e.path}` },
  )
  on('fs.list', (_$, e) =>
    e.path.replaceAll('\\', '/').replace(/\/$/, '') === `${PROJECT}/.claude/agents`
      ? { value: [{ name: 'worker.md', kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false }] }
      : { deny: `ENOENT ${e.path}` },
  )
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.run', () => ({ text: 'bottom answered' }))
  on('classic.SessionStart', () => ({}))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('prompt.compose', () => ({ sections: [] }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: usage(1200, 300) }
  })
  on('tool.call', (_$, e) => {
    world.tools.push({ tool: String(e.tool), taskId: (e as { task_id?: unknown }).task_id })

    if (e.tool !== 'TaskStop' || world.stop === 'ok') {
      return { ref: 1, result: 'ran', text: e.tool === 'TaskStop' ? 'Task stopped' : 'ran' }
    }

    if (world.stop === 'throw') {
      throw new Error('no such task')
    }

    return world.stop === 'deny'
      ? { deny: 'not allowed here' }
      : { ref: 1, result: 'failed', text: 'task already finished', isError: true as const }
  })
  on('agent.spawn', (_$, e) => ({ model: SESSION_MODEL, agentId: world.spawnIds.shift() ?? `extra-${e.subagentType}` }))
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

const agentes = ($: Engine, args = '') => run($, 'agentes', args)

const spawn = (
  $: Engine,
  over: { description?: string; subagentType?: string; parentAgentId?: string; prompt?: string } = {},
) =>
  $.agent.spawn({
    prompt: over.prompt ?? 'Read every log and report.',
    description: over.description ?? 'read the logs',
    subagentType: over.subagentType ?? 'general-purpose',
    background: false,
    ...(over.parentAgentId === undefined ? {} : { parentAgentId: over.parentAgentId }),
  } as never)

const step = async ($: Engine, agentId: string) => {
  for await (const _chunk of $.turn.step({ turnId: 't1', index: 0, model: SESSION_MODEL, messageCount: 1, agentId })) {
    continue
  }
}

const complete = ($: Engine, agentId: string, answer: string, durationMs = 2400) =>
  $.turn.complete({
    turnId: 't1',
    answer,
    durationMs,
    isAborted: false,
    reason: 'answer',
    agentId,
    usage: usage(2000, 500),
  } as never)

const CLOSER: Plugin = {
  name: 'closer',
  register(on) {
    on('command.run', { command: 'close-pane' }, async $ => {
      await $.ui.close({ id: 'agent-studio' })

      return { text: 'closed' }
    })
  },
}

const closePane = ($: Engine) =>
  $.command.run({
    command: 'close-pane',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })

const mountPane = ($: Engine, surface: Surface) =>
  $.ui.mount({ plugin: 'agent-studio', surface, component: 'Pane', requestId: 'agent-studio', props: PANE_PROPS })

const eachSurface = (name: string, body: (surface: Surface, $: Engine, on: On) => Promise<void>) => {
  for (const surface of SURFACES) {
    test(`${name} [${surface}]`, { plugins: [CLOSER] }, ($, on) => body(surface, $, on))
  }
}

const ROW_ONE = '✓ concluído  general-purpose  read the logs  —  0:02  2.5k'

eachSurface('/agentes opens the panel with focus and Esc to close, and answers with one sentence', async (surface, $, on) => {
  const world = stage(on, surface)
  await begin($)

  expect(await agentes($)).toBe('Painel de agentes aberto.')
  expect(world.opens).toEqual([{ id: 'agent-studio', title: 'Agentes', focus: true, closeOnEscape: true }])
  expect(world.panes).toEqual([{ id: 'agent-studio', title: 'Agentes' }])
})

eachSurface('the three tab buttons carry the digits as hotkeys and switch the tab', async (surface, $, on) => {
  stage(on, surface)
  await begin($)
  await agentes($)

  const ui = await mountPane($, surface)

  for (const [tab, label] of [['1', 'Esta sessão'], ['2', 'Outras sessões'], ['3', 'Agentes']] as const) {
    const button = await ui.find({ key: `tab-${tab}` })

    expect(button?.type).toBe('Button')
    expect(button?.props.hotkey).toBe(tab)
    expect(button?.text).toBe(label)
  }

  expect((await ui.find({ type: 'Text', text: 'Nenhum subagente nesta sessão.' }))?.type).toBe('Text')

  await ui.press({ key: 'tab-2' })

  expect((await ui.find({ type: 'Text', text: 'Nenhuma outra sessão registrada.' }))?.type).toBe('Text')
  expect(await ui.find({ type: 'Text', text: 'Nenhum subagente nesta sessão.' })).toBeUndefined()

  await ui.press({ key: 'tab-3' })

  expect((await ui.find({ type: 'Text', text: 'Agentes disponíveis (1)' }))?.type).toBe('Text')
  expect((await ui.find({ key: 'use-worker' }))?.text).toBe('Usar nesta sessão')

  await ui.press({ key: 'tab-1' })

  expect((await ui.find({ type: 'Text', text: 'Nenhum subagente nesta sessão.' }))?.type).toBe('Text')
  await ui.unmount()
})

eachSurface('the tree draws one button per subagent with the status icon and word, and the nested one indented', async (surface, $, on) => {
  stage(on, surface)
  await begin($)
  await spawn($, { description: 'parent', subagentType: 'Explore' })
  await spawn($, { description: 'child', parentAgentId: 'sub-1' })
  await spawn($, { description: 'other root', subagentType: 'Plan' })
  await step($, 'sub-1')
  await complete($, 'sub-3', 'plan ready')
  await agentes($)

  const ui = await mountPane($, surface)
  const rows = (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('sub-'))

  expect(rows.map(row => [row.key, row.text])).toEqual([
    ['sub-sub-1', '● rodando  Explore  parent  —  0:00  1.5k'],
    ['sub-sub-2', '● rodando  general-purpose  child  —  0:00  0'],
    ['sub-sub-3', '✓ concluído  Plan  other root  —  0:02  2.5k'],
  ])

  const paddings = (await ui.findAll({ type: 'Box' })).map(box => box.props.paddingLeft)

  expect(paddings.filter(padding => padding !== undefined)).toEqual([0, 2, 0])
  await ui.unmount()
})

eachSurface('the header names the agent in force or says there is none', async (surface, $, on) => {
  stage(on, surface)
  await begin($)
  await agentes($)

  const ui = await mountPane($, surface)

  expect((await ui.find({ type: 'Text', text: 'Sessão sem agente' }))?.type).toBe('Text')
  await ui.unmount()
})

eachSurface('the header names the agent in force with its model and effort', async (surface, $, on) => {
  stage(on, surface)
  await begin($)
  await run($, 'as', 'worker')
  await agentes($)

  const ui = await mountPane($, surface)

  expect((await ui.find({ type: 'Text', text: 'Sessão como @worker · claude-opus-5-5[1m] · high' }))?.type).toBe('Text')
  await ui.unmount()
})

eachSurface('pressing a row opens the detail with the prompt and the full answer, and back returns to the list', async (surface, $, on) => {
  stage(on, surface)
  await begin($)
  await spawn($, { prompt: 'Read every log and report.' })
  await complete($, 'sub-1', 'Found **3** errors.\n\n- one\n- two')
  await agentes($)

  const ui = await mountPane($, surface)

  await ui.press({ key: 'sub-sub-1' })

  expect(await ui.find({ key: 'sub-sub-1' })).toBeUndefined()
  expect((await ui.find({ type: 'Markdown', key: 'answer' }))?.props.text).toBe('Found **3** errors.\n\n- one\n- two')

  for (const field of [
    'Tipo: general-purpose',
    'Tarefa: read the logs',
    'Status: ✓ concluído',
    `Modelo: ${SESSION_MODEL}`,
    'Read every log and report.',
  ]) {
    expect((await ui.find({ type: 'Text', text: field }))?.type).toBe('Text')
  }

  expect((await ui.find({ key: 'back' }))?.text).toBe('Voltar')

  await ui.press({ key: 'back' })

  expect((await ui.find({ key: 'sub-sub-1' }))?.text).toBe(ROW_ONE)
  expect(await ui.find({ key: 'back' })).toBeUndefined()
  await ui.unmount()
})

eachSurface('a subagent that left the collector with its detail open sends the panel back to the list and keeps it there', async (surface, $, on) => {
  const world = stage(on, surface)
  await begin($)
  await spawn($)
  await agentes($)

  const ui = await mountPane($, surface)

  await ui.press({ key: 'sub-sub-1' })

  expect((await ui.find({ key: 'back' }))?.text).toBe('Voltar')

  await $.classic.SessionStart({ source: 'clear' })
  await ui.redraw()

  expect(await ui.find({ key: 'back' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: 'Nenhum subagente nesta sessão.' }))?.type).toBe('Text')

  world.listed = [{ id: 'sub-1', description: 'read the logs', type: 'general-purpose', status: 'running' }]
  await world.clock.advance(2000)

  expect((await ui.find({ key: 'sub-sub-1' }))?.type).toBe('Button')
  expect(await ui.find({ key: 'back' })).toBeUndefined()
  await ui.unmount()
})

eachSurface('switching tabs drops the open detail', async (surface, $, on) => {
  stage(on, surface, peerStore())
  await begin($)
  await spawn($)
  await agentes($)

  const ui = await mountPane($, surface)

  await ui.press({ key: 'sub-sub-1' })
  await ui.press({ key: 'tab-2' })
  await ui.press({ key: 'sess-working-1' })
  await ui.press({ key: 'tab-1' })

  expect((await ui.find({ key: 'sub-sub-1' }))?.type).toBe('Button')
  expect(await ui.find({ key: 'back' })).toBeUndefined()

  await ui.press({ key: 'tab-2' })

  expect((await sessionRows(ui)).length).toBe(3)
  expect(await ui.find({ key: 'back' })).toBeUndefined()
  await ui.unmount()
})

eachSurface('Stop shows only on a running subagent, calls TaskStop with its id and toasts the result', async (surface, $, on) => {
  const world = stage(on, surface)
  await begin($)
  await spawn($, { description: 'running one' })
  await spawn($, { description: 'done one' })
  await complete($, 'sub-2', 'finished')
  await agentes($)

  const ui = await mountPane($, surface)

  await ui.press({ key: 'sub-sub-2' })

  expect(await ui.find({ key: 'stop' })).toBeUndefined()

  await ui.press({ key: 'back' })
  await ui.press({ key: 'sub-sub-1' })

  expect((await ui.find({ key: 'stop' }))?.text).toBe('Parar')

  await ui.press({ key: 'stop' })

  expect(world.tools).toEqual([{ tool: 'TaskStop', taskId: 'sub-1' }])
  expect(world.toasts).toEqual(['Pedido de parada enviado a general-purpose: Task stopped'])
  await ui.unmount()
})

for (const mode of ['deny', 'error', 'throw'] as const) {
  eachSurface(`a Stop that fails (${mode}) toasts the reason`, async (surface, $, on) => {
    const world = stage(on, surface)
    world.stop = mode
    await begin($)
    await spawn($)
    await agentes($)

    const ui = await mountPane($, surface)

    await ui.press({ key: 'sub-sub-1' })
    await ui.press({ key: 'stop' })

    const reason = { deny: 'not allowed here', error: 'task already finished', throw: '' }[mode]

    expect(world.toasts).toHaveLength(1)
    expect(world.toasts[0]?.startsWith('Não foi possível parar general-purpose: ')).toBe(true)
    expect(world.toasts[0]).toContain(reason)
    await ui.unmount()
  })
}

eachSurface('while open the list is checked against the engine every 2 s, and the panel redraws with what it found', async (surface, $, on) => {
  const world = stage(on, surface)
  await begin($)
  await agentes($)

  const ui = await mountPane($, surface)
  const before = world.listCalls

  await world.clock.advance(1999)

  expect(world.listCalls).toBe(before)

  world.listed = [{ id: 'early-1', description: 'born before', type: 'Explore', status: 'running' }]
  await world.clock.advance(1)

  expect(world.listCalls).toBe(before + 1)
  expect((await ui.find({ key: 'sub-early-1' }))?.text).toBe('● rodando  Explore  born before  —  0:00  0')

  await world.clock.advance(4000)

  expect(world.listCalls).toBe(before + 3)
  await ui.unmount()
})

eachSurface('opening the panel twice does not start a second timer', async (surface, $, on) => {
  const world = stage(on, surface)
  await begin($)
  await agentes($)
  await agentes($)
  await agentes($, 'sessoes')
  await agentes($)

  const before = world.listCalls

  await world.clock.advance(2000)

  expect(world.listCalls).toBe(before + 1)
})

eachSurface('a closed panel leaves no timer: no engine list, no pane query, and the registry read only by its own 15 s beat', async (surface, $, on) => {
  const world = stage(on, surface)
  await begin($)
  await agentes($)
  await closePane($)

  const queries = world.paneQueries
  const lists = world.listCalls
  const reads = world.keyReads

  await world.clock.advance(ONE_MINUTE)

  expect(world.paneQueries).toBe(queries)
  expect(world.listCalls).toBe(lists)
  expect(world.keyReads).toBe(reads + ONE_MINUTE / HEARTBEAT_MS)
})

eachSurface('a pane the engine dropped without ui.close is noticed by the next beat, which cancels the timer', async (surface, $, on) => {
  const world = stage(on, surface)
  await begin($)
  await agentes($)

  world.panes = []

  const lists = world.listCalls

  await world.clock.advance(2000)

  expect(world.listCalls).toBe(lists)

  const queries = world.paneQueries

  await world.clock.advance(60_000)

  expect(world.paneQueries).toBe(queries)
  expect(world.listCalls).toBe(lists)
})

eachSurface('a beat that throws is swallowed and the next beat still runs', async (surface, $, on) => {
  const world = stage(on, surface)
  await begin($)
  await agentes($)

  const lists = world.listCalls

  world.failPanes = 1
  await world.clock.advance(2000)

  expect(world.listCalls).toBe(lists)

  await world.clock.advance(2000)

  expect(world.listCalls).toBe(lists + 1)
})

eachSurface('a surface list that is empty answers the tree as text and opens no pane', async (surface, $, on) => {
  const world = stage(on, surface)
  world.surfaces = []
  await begin($)
  await spawn($)
  await complete($, 'sub-1', 'done')

  expect(await agentes($)).toBe(ROW_ONE)
  expect(world.opens).toEqual([])
  expect(await agentes($, 'sessoes')).toBe('Nenhuma outra sessão registrada.')
  expect(world.opens).toEqual([])
})

eachSurface('a pane that is not placed answers as text, is closed and leaves no timer', async (surface, $, on) => {
  const world = stage(on, surface)
  world.openResult = { isPlaced: false, reason: 'no pane here' }
  await begin($)
  await spawn($)
  await complete($, 'sub-1', 'done')

  expect(await agentes($)).toBe(ROW_ONE)
  expect(world.panes).toEqual([])

  const lists = world.listCalls
  const queries = world.paneQueries

  await world.clock.advance(60_000)

  expect(world.listCalls).toBe(lists)
  expect(world.paneQueries).toBe(queries)
})

eachSurface('an ui.open that throws answers as text', async (surface, $, on) => {
  const world = stage(on, surface)
  world.failOpen = true
  await begin($)

  expect(await agentes($)).toBe('Nenhum subagente nesta sessão.')
})

eachSurface('an argument the command does not know answers the usage and opens no pane', async (surface, $, on) => {
  const world = stage(on, surface)
  await begin($)

  expect(await agentes($, 'whatever')).toContain('Uso: /agentes')
  expect(world.opens).toEqual([])
})

const ONE_MINUTE = 60_000

const HEARTBEAT_MS = 15_000

const peerStore = (): Record<string, unknown> => ({
  'sess:working-1': entry({
    cwd: 'C:/work/api',
    agent: 'architect',
    state: 'working',
    updatedAt: NOW - 5000,
    lastAnswer: 'Mapped the payment module and found two call sites that skip validation.',
    subagents: [
      { type: 'Explore', task: 'map the module', status: 'running', tool: 'Grep', tokens: 18_000 },
      { type: 'Plan', task: 'sketch the migration', status: 'completed', tool: null, tokens: 31_000 },
    ],
  }),
  'sess:stale-2': entry({ cwd: 'C:/work/web', state: 'working', updatedAt: NOW - 61_000 }),
  'sess:ended-3': entry({ cwd: 'C:/work/docs', agent: 'writer', state: 'ended', updatedAt: NOW - 120_000 }),
  [`sess:${SESSION}`]: entry({ cwd: 'C:/work/app', state: 'working', updatedAt: NOW }),
})

const sessionRows = async (ui: Awaited<ReturnType<typeof mountPane>>) =>
  (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('sess-'))

eachSurface('tab 2 lists the other sessions with their four states in words and never the current session', async (surface, $, on) => {
  stage(on, surface, {
    ...peerStore(),
    'sess:idle-4': entry({ cwd: 'C:/work/lib', state: 'idle', updatedAt: NOW - 1000 }),
  })
  await begin($)
  await agentes($)

  const ui = await mountPane($, surface)

  await ui.press({ key: 'tab-2' })

  const rows = await sessionRows(ui)

  expect(rows.map(row => row.key).sort()).toEqual(['sess-ended-3', 'sess-idle-4', 'sess-stale-2', 'sess-working-1'])
  expect(await ui.find({ key: `sess-${SESSION}` })).toBeUndefined()

  const text = Object.fromEntries(rows.map(row => [row.key, row.text]))

  expect(text['sess-working-1']).toBe(
    'C:/work/api  @architect  trabalhando  2 subagentes  há 5 s  Mapped the payment module and found two call sites that ski…',
  )
  expect(text['sess-idle-4']).toBe('C:/work/lib  sem agente  ociosa  0 subagentes  há 1 s')
  expect(text['sess-stale-2']).toBe('C:/work/web  sem agente  inativa  0 subagentes  há 1 min')
  expect(text['sess-ended-3']).toBe('C:/work/docs  @writer  encerrada  0 subagentes  há 2 min')
  await ui.unmount()
})

eachSurface('three other sessions draw three rows with three states, and the first one opens with two subagents', async (surface, $, on) => {
  stage(on, surface, peerStore())
  await begin($)
  await agentes($, 'sessoes')

  const ui = await mountPane($, surface)
  const rows = await sessionRows(ui)

  expect(rows.map(row => row.key)).toEqual(['sess-working-1', 'sess-stale-2', 'sess-ended-3'])
  expect(rows.map(row => /trabalhando|ociosa|inativa|encerrada/.exec(row.text)?.[0])).toEqual([
    'trabalhando',
    'inativa',
    'encerrada',
  ])

  await ui.press({ key: 'sess-working-1' })

  expect((await ui.find({ type: 'Text', text: 'Pasta: C:/work/api' }))?.type).toBe('Text')
  expect((await ui.find({ type: 'Text', text: 'Agente: @architect' }))?.type).toBe('Text')
  expect((await ui.find({ type: 'Text', text: 'Estado: trabalhando' }))?.type).toBe('Text')
  expect((await ui.find({ type: 'Text', text: /^Subagentes: 2$/ }))?.type).toBe('Text')
  expect((await ui.find({ type: 'Markdown', key: 'last-answer' }))?.props.text).toBe(
    'Mapped the payment module and found two call sites that skip validation.',
  )
  expect((await ui.find({ type: 'Text', text: 'Subagentes desta sessão (2)' }))?.type).toBe('Text')
  expect((await ui.find({ type: 'Text', text: '● rodando  Explore  map the module  Grep  18k' }))?.type).toBe('Text')
  expect((await ui.find({ type: 'Text', text: '✓ concluído  Plan  sketch the migration  —  31k' }))?.type).toBe('Text')
  expect(await ui.find({ key: 'stop' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Button' })).map(button => button.key)).toEqual(['tab-1', 'tab-2', 'tab-3', 'back', 'status'])

  await ui.press({ key: 'back' })

  expect((await sessionRows(ui)).length).toBe(3)
  await ui.unmount()
})

eachSurface('the subagents of another session never reach tab 1', async (surface, $, on) => {
  stage(on, surface, peerStore())
  await begin($)
  await agentes($, 'sessoes')

  const ui = await mountPane($, surface)

  await ui.press({ key: 'sess-working-1' })
  await ui.press({ key: 'tab-1' })

  const buttons = (await ui.findAll({ type: 'Button' })).map(button => button.key)

  expect(buttons).toEqual(['tab-1', 'tab-2', 'tab-3'])
  expect((await ui.find({ type: 'Text', text: 'Nenhum subagente nesta sessão.' }))?.type).toBe('Text')
  expect(await ui.find({ type: 'Text', text: /map the module/ })).toBeUndefined()
  await ui.unmount()
})

eachSurface('a session with no shared answer says so, and one that vanished from the registry sends the panel back to the list', async (surface, $, on) => {
  const world = stage(on, surface, {
    'sess:quiet-1': entry({ cwd: 'C:/work/quiet', updatedAt: NOW }),
  })
  await begin($)
  await agentes($, 'sessoes')

  const ui = await mountPane($, surface)

  await ui.press({ key: 'sess-quiet-1' })

  expect((await ui.find({ type: 'Text', text: 'Nenhuma resposta publicada.' }))?.type).toBe('Text')
  expect((await ui.find({ type: 'Text', text: 'Nenhum subagente publicado.' }))?.type).toBe('Text')

  world.store.delete('sess:quiet-1')
  await world.clock.advance(2000)

  expect(await ui.find({ key: 'back' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: 'Nenhuma outra sessão registrada.' }))?.type).toBe('Text')

  world.store.set('sess:quiet-1', entry({ cwd: 'C:/work/quiet', updatedAt: NOW }))
  await world.clock.advance(2000)

  expect((await ui.find({ key: 'sess-quiet-1' }))?.type).toBe('Button')
  expect(await ui.find({ key: 'back' })).toBeUndefined()
  await ui.unmount()
})

eachSurface('the registry is read on entering tab 2 and on each 2 s beat there, and otherwise only by its own 15 s beat', async (surface, $, on) => {
  const world = stage(on, surface, peerStore())
  let elapsed = 0
  const pass = async (ms: number) => {
    await world.clock.advance(ms)
    elapsed += ms
  }
  const reads = (fromPanel: number) => fromPanel + Math.floor(elapsed / HEARTBEAT_MS)

  await begin($)
  await agentes($)

  const ui = await mountPane($, surface)

  await pass(10_000)

  expect(world.keyReads).toBe(reads(0))

  await ui.press({ key: 'tab-2' })

  expect(world.keyReads).toBe(reads(1))

  await pass(2000)

  expect(world.keyReads).toBe(reads(2))

  await ui.press({ key: 'tab-3' })
  await pass(10_000)

  expect(world.keyReads).toBe(reads(2))

  await ui.press({ key: 'tab-1' })
  await pass(10_000)

  expect(world.keyReads).toBe(reads(2))

  await ui.press({ key: 'tab-2' })

  expect(world.keyReads).toBe(reads(3))

  await closePane($)
  await pass(ONE_MINUTE)

  expect(world.keyReads).toBe(reads(3))
  await ui.unmount()
})

eachSurface('on tab 2 the engine list is not asked, and on tab 3 nothing is read', async (surface, $, on) => {
  const world = stage(on, surface, peerStore())
  await begin($)
  await agentes($, 'sessoes')

  const ui = await mountPane($, surface)
  const lists = world.listCalls

  await world.clock.advance(6000)

  expect(world.listCalls).toBe(lists)

  await ui.press({ key: 'tab-3' })

  const reads = world.keyReads

  await world.clock.advance(6000)

  expect(world.listCalls).toBe(lists)
  expect(world.keyReads).toBe(reads)
  await ui.unmount()
})

eachSurface('/agentes sessoes opens the panel on tab 2 and says so', async (surface, $, on) => {
  stage(on, surface, peerStore())
  await begin($)

  expect(await agentes($, 'sessoes')).toBe('Painel de agentes aberto na aba Outras sessões.')

  const ui = await mountPane($, surface)

  expect((await sessionRows(ui)).length).toBe(3)
  await ui.unmount()
})

eachSurface('a clear empties the last reading of the other sessions on tab 2, and the next beat there reads them again', async (surface, $, on) => {
  const world = stage(on, surface, peerStore())
  await begin($)
  await agentes($, 'sessoes')

  const ui = await mountPane($, surface)

  expect((await sessionRows(ui)).length).toBe(3)

  await $.classic.SessionStart({ source: 'clear' })
  await ui.redraw()

  expect((await sessionRows(ui)).length).toBe(0)
  expect((await ui.find({ type: 'Text', text: 'Nenhuma outra sessão registrada.' }))?.type).toBe('Text')

  await world.clock.advance(2000)

  expect((await sessionRows(ui)).length).toBe(3)
  await ui.unmount()
})
