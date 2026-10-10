import type { AgentInfo, On, UiOpenResult } from 'claude-code'
import { type Engine, type Plugin, expect, mock, test } from 'claude-code/testing'

import type { SessionEntry } from '../types'

type Surface = 'terminal' | 'desktop'

type Stage = {
  store: Map<string, unknown>
  keyReads: number
  listed: AgentInfo[]
  opens: unknown[]
  openResult: UiOpenResult
  toasts: string[]
  spawnIds: string[]
  clock: ReturnType<typeof mock.clock>
}

const PROJECT = 'C:/work/app'
const SESSION = 'session-1'
const SESSION_MODEL = 'claude-haiku-5-5'
const NOW = 1_000_000_000
const SURFACES: readonly Surface[] = ['terminal', 'desktop']

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
} as const

const WORKER_FILE = `${PROJECT}/.claude/agents/worker.md`

const WORKER_TEXT = '---\nname: worker\ndescription: worker description\n---\nYou are worker.\n'

const peer = (over: Partial<SessionEntry> = {}): SessionEntry => ({
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

const stage = (on: On, seed: Readonly<Record<string, unknown>> = {}): Stage => {
  const world: Stage = {
    store: new Map(Object.entries(seed)),
    keyReads: 0,
    listed: [],
    opens: [],
    openResult: { isPlaced: true },
    toasts: [],
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
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('settings.read', () => ({ value: {} }))
  on('ui.toast', (_$, e) => {
    world.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', (_$, e) => {
    world.opens.push(e)

    return { value: world.openResult }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
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
  on('agent.spawn', (_$, e) => ({ model: SESSION_MODEL, agentId: world.spawnIds.shift() ?? `extra-${e.subagentType}` }))
  on('agent.list', () => ({ value: world.listed }))

  return world
}

const begin = ($: Engine) => $.session.start({ cwd: PROJECT, surface: null, isInteractive: true })

const mountBand = ($: Engine, surface: Surface) =>
  $.ui.mount({ plugin: 'agent-studio', surface, component: 'AbovePrompt', props: BAND_PROPS })

const NEIGHBOR_LINE = 'survey of the neighbor'

const NEIGHBOR_UNDER: Plugin = {
  name: 'neighbor-under',
  tier: 'append',
  register(on) {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)

      return Text({ children: 'survey of the neighbor' })
    })
  },
}

const NEIGHBOR_OVER: Plugin = {
  name: 'neighbor-over',
  tier: 'prepend',
  register(on) {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      const { Box, Text } = $.ui.resolve(e)
      const inner = await next(e)

      return Box({ flexDirection: 'column', children: [Text({ children: 'tip from the neighbor above' }), inner] })
    })
  },
}

const NEIGHBOR_TREE = { type: 'Text', children: [NEIGHBOR_LINE] }

const eachSurface = (name: string, body: (surface: Surface, $: Engine, on: On) => Promise<void>) => {
  for (const surface of SURFACES) {
    test(`${name} [${surface}]`, { plugins: [NEIGHBOR_UNDER] }, ($, on) => body(surface, $, on))
  }
}

const spawn = ($: Engine, description = 'read the logs') =>
  $.agent.spawn({
    prompt: 'Read every log and report.',
    description,
    subagentType: 'general-purpose',
    background: false,
  } as never)

const complete = ($: Engine, agentId: string) =>
  $.turn.complete({
    turnId: 't1',
    answer: 'done',
    durationMs: 1000,
    isAborted: false,
    reason: 'answer',
    agentId,
    usage: { model: SESSION_MODEL, input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as never)

const run = ($: Engine, command: string, args: string) =>
  $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

const bandTexts = async (ui: Awaited<ReturnType<typeof mountBand>>) =>
  (await ui.findAll({ type: 'Text' })).map(text => text.text).filter(text => text !== NEIGHBOR_LINE)

const ACTIVE_PEERS = {
  'sess:working-1': peer({ state: 'working' }),
  'sess:idle-2': peer({ state: 'idle' }),
  'sess:stale-3': peer({ state: 'working', updatedAt: NOW - 61_000 }),
  'sess:ended-4': peer({ state: 'ended' }),
  [`sess:${SESSION}`]: peer({ state: 'working' }),
}

eachSurface('with nothing to show the band is exactly what came from below', async (surface, $, on) => {
  stage(on)
  await begin($)

  const ui = await mountBand($, surface)

  expect(await ui.drawn()).toEqual(NEIGHBOR_TREE)
  expect(await ui.find({ key: 'open-panel' })).toBeUndefined()
  await ui.unmount()
})

eachSurface('the agent in force shows as @name with the open-panel button on hotkey 1', async (surface, $, on) => {
  stage(on)
  await begin($)
  await run($, 'as', 'worker')

  const ui = await mountBand($, surface)

  expect(await bandTexts(ui)).toEqual(['@worker'])

  const button = await ui.find({ key: 'open-panel' })

  expect(button?.type).toBe('Button')
  expect(button?.text).toBe('abrir painel')
  expect(button?.props.hotkey).toBe('1')
  expect(button?.props.plain).toBe(true)
  expect((await ui.find({ type: 'Text', text: NEIGHBOR_LINE }))?.type).toBe('Text')
  await ui.unmount()
})

eachSurface('the band is a column with what came from below first and one row with the text and the button', async (surface, $, on) => {
  stage(on)
  await begin($)
  await run($, 'as', 'worker')

  const ui = await mountBand($, surface)
  const tree = await ui.drawn()

  expect(tree).toMatchObject({ type: 'Box', props: { flexDirection: 'column' } })

  const [below, row] = (tree as { children: Record<string, unknown>[] }).children

  expect(below).toEqual(NEIGHBOR_TREE)
  expect(row).toMatchObject({ type: 'Box', props: { flexDirection: 'row' } })
  expect((row as { children: { type: string }[] }).children.map(child => child.type)).toEqual(['Text', 'Button'])
  await ui.unmount()
})

eachSurface('running subagents are counted in the singular and the plural and the part goes away at zero', async (surface, $, on) => {
  stage(on)
  await begin($)

  const ui = await mountBand($, surface)

  await spawn($)
  await ui.redraw()

  expect(await bandTexts(ui)).toEqual(['1 subagente rodando'])

  await spawn($, 'second')
  await ui.redraw()

  expect(await bandTexts(ui)).toEqual(['2 subagentes rodando'])

  await complete($, 'sub-1')
  await ui.redraw()

  expect(await bandTexts(ui)).toEqual(['1 subagente rodando'])

  await complete($, 'sub-2')
  await ui.redraw()

  expect(await bandTexts(ui)).toEqual([])
  expect(await ui.drawn()).toEqual(NEIGHBOR_TREE)
  await ui.unmount()
})

eachSurface('active sessions are the working and idle ones, counted in the plural, and read at the beat', async (surface, $, on) => {
  const world = stage(on, ACTIVE_PEERS)
  await begin($)

  const ui = await mountBand($, surface)

  expect(await ui.drawn()).toEqual(NEIGHBOR_TREE)

  await world.clock.advance(15_000)

  expect(await bandTexts(ui)).toEqual(['2 sessões ativas'])
  await ui.unmount()
})

eachSurface('one active session is singular and the part goes away when it is no longer active', async (surface, $, on) => {
  const world = stage(on, { 'sess:working-1': peer({ state: 'working', updatedAt: NOW + 15_000 }) })
  await begin($)

  const ui = await mountBand($, surface)

  await world.clock.advance(15_000)

  expect(await bandTexts(ui)).toEqual(['1 sessão ativa'])

  world.store.set('sess:working-1', peer({ state: 'ended', updatedAt: NOW + 15_000 }))
  await world.clock.advance(15_000)

  expect(await bandTexts(ui)).toEqual([])
  expect(await ui.drawn()).toEqual(NEIGHBOR_TREE)
  await ui.unmount()
})

eachSurface('the parts come in order, joined by a middle dot, each only when it has a value', async (surface, $, on) => {
  const world = stage(on, ACTIVE_PEERS)
  await begin($)
  await run($, 'as', 'worker')
  await spawn($)
  await spawn($, 'second')

  const ui = await mountBand($, surface)

  await world.clock.advance(15_000)

  expect(await bandTexts(ui)).toEqual(['@worker · 2 subagentes rodando · 2 sessões ativas'])
  await ui.unmount()
})

eachSurface('the band redraws by itself after the grouped write of 1 s and after the beat of 15 s', async (surface, $, on) => {
  const world = stage(on)
  await begin($)

  const ui = await mountBand($, surface)

  await spawn($)

  expect(await bandTexts(ui)).toEqual([])

  await world.clock.advance(999)

  expect(await bandTexts(ui)).toEqual([])

  await world.clock.advance(1)

  expect(await bandTexts(ui)).toEqual(['1 subagente rodando'])

  world.store.set('sess:late-1', peer({ state: 'working', updatedAt: NOW + 15_000 }))
  await world.clock.advance(13_999)

  expect(await bandTexts(ui)).toEqual(['1 subagente rodando'])

  await world.clock.advance(1)

  expect(await bandTexts(ui)).toEqual(['1 subagente rodando · 1 sessão ativa'])
  await ui.unmount()
})

eachSurface('the beat reads the other sessions once, and drawing the band reads nothing', async (surface, $, on) => {
  const world = stage(on, ACTIVE_PEERS)
  await begin($)

  const ui = await mountBand($, surface)

  for (const _round of [1, 2, 3]) {
    await ui.redraw()
  }

  expect(world.keyReads).toBe(0)

  await world.clock.advance(14_999)

  expect(world.keyReads).toBe(0)

  await world.clock.advance(1)

  expect(world.keyReads).toBe(1)

  await world.clock.advance(15_000)

  expect(world.keyReads).toBe(2)
  await ui.unmount()
})

for (const surface of SURFACES) {
  test(`what another plugin draws above the band is kept, with the band inside it [${surface}]`, { plugins: [NEIGHBOR_UNDER, NEIGHBOR_OVER] }, async ($, on) => {
    stage(on)
    await begin($)
    await run($, 'as', 'worker')

    const ui = await mountBand($, surface)

    expect((await ui.find({ type: 'Text', text: 'tip from the neighbor above' }))?.type).toBe('Text')
    expect((await ui.find({ type: 'Text', text: NEIGHBOR_LINE }))?.type).toBe('Text')
    expect((await ui.find({ type: 'Text', text: '@worker' }))?.type).toBe('Text')
    expect((await ui.find({ key: 'open-panel' }))?.type).toBe('Button')
    await ui.unmount()
  })

  test(`a survey holding the band keeps the band out of its way [${surface}]`, { plugins: [NEIGHBOR_UNDER] }, async ($, on) => {
    stage(on)
    await begin($)
    await run($, 'as', 'worker')

    const ui = await $.ui.mount({
      plugin: 'agent-studio',
      surface,
      component: 'AbovePrompt',
      props: { ...BAND_PROPS, hasSurvey: true },
    })

    expect(await ui.drawn()).toEqual(NEIGHBOR_TREE)
    expect(await ui.find({ key: 'open-panel' })).toBeUndefined()
    await ui.unmount()
  })

  test(`with the Monitor off there is no band, no registry write and no read [${surface}]`, { plugins: [NEIGHBOR_UNDER], options: { enableMonitor: false } }, async ($, on) => {
    const world = stage(on, ACTIVE_PEERS)
    await begin($)
    await run($, 'as', 'worker')

    const ui = await mountBand($, surface)

    await world.clock.advance(60_000)

    expect(await ui.drawn()).toEqual(NEIGHBOR_TREE)
    expect(world.keyReads).toBe(0)
    expect([...world.store.keys()].filter(key => key.startsWith('sess:')).length).toBe(Object.keys(ACTIVE_PEERS).length)
    await ui.unmount()
  })
}

eachSurface('pressing open-panel opens the panel on tab 1 as /agentes does', async (surface, $, on) => {
  const world = stage(on)
  await begin($)
  await run($, 'as', 'worker')
  await run($, 'agentes', 'sessoes')

  const ui = await mountBand($, surface)

  await ui.press({ key: 'open-panel' })

  expect(world.opens).toEqual([
    { id: 'agent-studio', title: 'Agentes', focus: true, closeOnEscape: true },
    { id: 'agent-studio', title: 'Agentes', focus: true, closeOnEscape: true },
  ])

  const pane = await $.ui.mount({
    plugin: 'agent-studio',
    surface,
    component: 'Pane',
    requestId: 'agent-studio',
    props: { title: 'Agentes', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })

  expect((await pane.find({ type: 'Text', text: 'Sessão como @worker' }))?.type).toBe('Text')
  await pane.unmount()
  await ui.unmount()
})

eachSurface('pressing open-panel where the pane is not placed does nothing and does not fail', async (surface, $, on) => {
  const world = stage(on)
  world.openResult = { isPlaced: false, reason: 'no pane here' }
  await begin($)
  await run($, 'as', 'worker')

  const ui = await mountBand($, surface)

  await ui.press({ key: 'open-panel' })

  expect(world.toasts).toEqual([])
  await ui.unmount()
})


