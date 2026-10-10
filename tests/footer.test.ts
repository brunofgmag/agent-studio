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
  statuses: (string | undefined)[]
  failStatus: boolean
  spawnIds: string[]
  clock: ReturnType<typeof mock.clock>
}

const PROJECT = 'C:/work/app'
const SESSION = 'session-1'
const SESSION_MODEL = 'claude-haiku-5-5'
const NOW = 1_000_000_000
const SURFACES: readonly Surface[] = ['terminal', 'desktop']

const FOOTER_PROPS = { modes: [] } as const

const AGENTS_DIR = `${PROJECT}/.claude/agents`

const AGENT_FILES: Readonly<Record<string, string>> = {
  [`${AGENTS_DIR}/worker.md`]: '---\nname: worker\ndescription: worker description\n---\nYou are worker.\n',
  [`${AGENTS_DIR}/thinker.md`]:
    '---\nname: thinker\ndescription: thinker description\nmodel: claude-opus-5-5\neffort: high\n---\nYou are thinker.\n',
}

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
    statuses: [],
    failStatus: false,
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
  on('ui.status', (_$, e) => {
    if (world.failStatus) {
      return { deny: 'no status line here' }
    }

    world.statuses.push(e.text)

    return { value: undefined }
  })
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
  on('fs.read', (_$, e) => {
    const text = AGENT_FILES[e.path.replaceAll('\\', '/')]

    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })
  on('fs.list', (_$, e) =>
    e.path.replaceAll('\\', '/').replace(/\/$/, '') === AGENTS_DIR
      ? {
          value: Object.keys(AGENT_FILES).map(path => ({
            name: path.slice(AGENTS_DIR.length + 1),
            kind: 'file' as const,
            size: 1,
            mtimeMs: 0,
            isLink: false,
          })),
        }
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

const mountFooter = ($: Engine, surface: Surface) =>
  $.ui.mount({ plugin: 'agent-studio', surface, component: 'SessionMode', props: FOOTER_PROPS })

const NEIGHBOR_LINE = 'mode of the neighbor'

const NEIGHBOR_UNDER: Plugin = {
  name: 'neighbor-under',
  tier: 'append',
  register(on) {
    on('ui.render', { component: 'SessionMode' }, ($, e) => {
      const { Text } = $.ui.resolve(e)

      return Text({ children: 'mode of the neighbor' })
    })
  },
}

const NEIGHBOR_OVER: Plugin = {
  name: 'neighbor-over',
  tier: 'prepend',
  register(on) {
    on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
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

const summaryOf = (world: Stage) => world.statuses.at(-1)

const ACTIVE_PEERS = {
  'sess:working-1': peer({ state: 'working' }),
  'sess:idle-2': peer({ state: 'idle' }),
  'sess:stale-3': peer({ state: 'working', updatedAt: NOW - 61_000 }),
  'sess:ended-4': peer({ state: 'ended' }),
  [`sess:${SESSION}`]: peer({ state: 'working' }),
}

eachSurface('with nothing to show the footer is what came from below and a secondary button labelled Painel, and no status is sent', async (surface, $, on) => {
  const world = stage(on)
  await begin($)

  const ui = await mountFooter($, surface)
  const button = await ui.find({ key: 'open-panel-footer' })

  expect(button?.type).toBe('Button')
  expect(button?.text).toBe('Painel')
  expect(button?.props.variant).toBe('secondary')
  expect(button?.props.plain).toBeUndefined()
  expect(button?.props.hotkey).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: NEIGHBOR_LINE }))?.type).toBe('Text')
  expect(world.statuses).toEqual([])
  await ui.unmount()
})

eachSurface('the button has no frame around it and the footer draws no text of its own', async (surface, $, on) => {
  stage(on)
  await begin($)
  await run($, 'as', 'worker')

  const ui = await mountFooter($, surface)
  const boxes = await ui.findAll({ type: 'Box' })

  expect(boxes.filter(box => box.props.borderStyle !== undefined)).toEqual([])
  expect((await ui.findAll({ type: 'Text' })).map(text => text.text)).toEqual([NEIGHBOR_LINE])
  await ui.unmount()
})

eachSurface('the footer is a row with what came from below first and the one button after it, with or without a summary', async (surface, $, on) => {
  stage(on)
  await begin($)

  const ui = await mountFooter($, surface)
  const bare = await ui.drawn()

  expect(bare).toMatchObject({ type: 'Box', props: { flexDirection: 'row', alignItems: 'center', gap: 2 } })

  const { children: bareChildren } = bare as { children: { type: string }[] }

  expect(bareChildren).toHaveLength(2)
  expect(bareChildren[0]).toEqual(NEIGHBOR_TREE)
  expect(bareChildren[1]?.type).toBe('Button')

  await run($, 'as', 'worker')
  await spawn($)
  await ui.redraw()

  const { children } = (await ui.drawn()) as { children: { type: string }[] }

  expect(children.map(child => child.type)).toEqual(['Text', 'Button'])
  expect(children[0]).toEqual(NEIGHBOR_TREE)
  await ui.unmount()
})

eachSurface('the agent in force is sent to the status line as @name, and /as off takes it back', async (surface, $, on) => {
  const world = stage(on)
  await begin($)

  const ui = await mountFooter($, surface)

  await run($, 'as', 'worker')
  await ui.redraw()

  expect(summaryOf(world)).toBe('@worker')

  await run($, 'as', 'off')
  await ui.redraw()

  expect(summaryOf(world)).toBeUndefined()
  expect(world.statuses).toEqual(['@worker', undefined])
  await ui.unmount()
})

eachSurface('the agent summary carries the model and the effort of the agent file, then follows the next /as', async (surface, $, on) => {
  const world = stage(on)
  await begin($)

  const ui = await mountFooter($, surface)

  await run($, 'as', 'thinker')
  await ui.redraw()

  expect(summaryOf(world)).toBe('@thinker · claude-opus-5-5 · high')

  await run($, 'as', 'worker')
  await ui.redraw()

  expect(summaryOf(world)).toBe('@worker')
  await ui.unmount()
})

eachSurface('running subagents are counted in the singular and the plural and the status is cleared at zero', async (surface, $, on) => {
  const world = stage(on)
  await begin($)

  const ui = await mountFooter($, surface)

  await spawn($)
  await ui.redraw()

  expect(summaryOf(world)).toBe('1 subagente rodando')

  await spawn($, 'second')
  await ui.redraw()

  expect(summaryOf(world)).toBe('2 subagentes rodando')

  await complete($, 'sub-1')
  await ui.redraw()

  expect(summaryOf(world)).toBe('1 subagente rodando')

  await complete($, 'sub-2')
  await ui.redraw()

  expect(summaryOf(world)).toBeUndefined()
  expect(world.statuses).toEqual(['1 subagente rodando', '2 subagentes rodando', '1 subagente rodando', undefined])
  await ui.unmount()
})

eachSurface('active sessions are the working and idle ones, counted in the plural, and read at the beat', async (surface, $, on) => {
  const world = stage(on, ACTIVE_PEERS)
  await begin($)

  const ui = await mountFooter($, surface)

  expect(summaryOf(world)).toBeUndefined()

  await world.clock.advance(15_000)

  expect(summaryOf(world)).toBe('2 sessões ativas')
  await ui.unmount()
})

eachSurface('one active session is singular and the status is cleared when it is no longer active', async (surface, $, on) => {
  const world = stage(on, { 'sess:working-1': peer({ state: 'working', updatedAt: NOW + 15_000 }) })
  await begin($)

  const ui = await mountFooter($, surface)

  await world.clock.advance(15_000)

  expect(summaryOf(world)).toBe('1 sessão ativa')

  world.store.set('sess:working-1', peer({ state: 'ended', updatedAt: NOW + 15_000 }))
  await world.clock.advance(15_000)

  expect(summaryOf(world)).toBeUndefined()
  expect(world.statuses).toEqual(['1 sessão ativa', undefined])
  await ui.unmount()
})

eachSurface('the parts come in order, joined by a middle dot, each only when it has a value', async (surface, $, on) => {
  const world = stage(on, ACTIVE_PEERS)
  await begin($)
  await run($, 'as', 'worker')
  await spawn($)
  await spawn($, 'second')

  const ui = await mountFooter($, surface)

  await world.clock.advance(15_000)

  expect(summaryOf(world)).toBe('@worker · 2 subagentes rodando · 2 sessões ativas')
  await ui.unmount()
})

eachSurface('the summary reaches the status line by itself after the grouped write of 1 s and after the beat of 15 s', async (surface, $, on) => {
  const world = stage(on)
  await begin($)

  const ui = await mountFooter($, surface)

  await spawn($)

  expect(summaryOf(world)).toBeUndefined()

  await world.clock.advance(999)

  expect(summaryOf(world)).toBeUndefined()

  await world.clock.advance(1)

  expect(summaryOf(world)).toBe('1 subagente rodando')

  world.store.set('sess:late-1', peer({ state: 'working', updatedAt: NOW + 15_000 }))
  await world.clock.advance(13_999)

  expect(summaryOf(world)).toBe('1 subagente rodando')

  await world.clock.advance(1)

  expect(summaryOf(world)).toBe('1 subagente rodando · 1 sessão ativa')
  await ui.unmount()
})

eachSurface('a redraw whose summary equals the last one sent calls the status line no more', async (surface, $, on) => {
  const world = stage(on)
  await begin($)

  const ui = await mountFooter($, surface)

  await spawn($)
  await ui.redraw()
  await ui.redraw()
  await ui.redraw()

  expect(world.statuses).toEqual(['1 subagente rodando'])

  await spawn($, 'second')
  await ui.redraw()
  await ui.redraw()

  expect(world.statuses).toEqual(['1 subagente rodando', '2 subagentes rodando'])
  await ui.unmount()
})

eachSurface('a redraw after /as sends nothing more, because the launcher already sent that summary', async (surface, $, on) => {
  const world = stage(on)
  await begin($)

  const ui = await mountFooter($, surface)

  await run($, 'as', 'worker')
  await ui.redraw()
  await ui.redraw()

  expect(world.statuses).toEqual(['@worker'])
  await ui.unmount()
})

eachSurface('/as off with no counts sends undefined, and with counts sends what is left', async (surface, $, on) => {
  const world = stage(on)
  await begin($)
  await run($, 'as', 'worker')
  await run($, 'as', 'off')

  expect(world.statuses).toEqual(['@worker', undefined])

  await spawn($)
  await run($, 'as', 'thinker')
  await run($, 'as', 'off')

  expect(world.statuses.slice(2)).toEqual(['@thinker · claude-opus-5-5 · high · 1 subagente rodando', '1 subagente rodando'])
})

eachSurface('a restored agent reaches the status line at the start and again at the turn start', async (surface, $, on) => {
  const world = stage(on, { 'launcher:session-1': { agent: { name: 'worker', path: `${AGENTS_DIR}/worker.md`, source: 'project' }, native: null, at: 1 } })
  await begin($)

  expect(world.statuses).toEqual(['@worker'])

  await $.prompt.compose({
    model: SESSION_MODEL,
    promptModel: SESSION_MODEL,
    surfaces: ['terminal'],
    tools: [],
    outputStyle: null,
    traits: [],
  })
  await $.turn.start({ text: 'hello', turnId: 't1' })

  expect(world.statuses).toEqual(['@worker', '@worker'])
})

eachSurface('a failing status call is swallowed, the footer is still drawn and the next summary goes through', async (surface, $, on) => {
  const world = stage(on)
  world.failStatus = true
  await begin($)

  const ui = await mountFooter($, surface)

  await spawn($)
  await ui.redraw()

  expect((await ui.find({ key: 'open-panel-footer' }))?.type).toBe('Button')
  expect(world.statuses).toEqual([])

  world.failStatus = false
  await spawn($, 'second')
  await ui.redraw()

  expect(world.statuses).toEqual(['2 subagentes rodando'])
  await ui.unmount()
})

eachSurface('the beat reads the other sessions once, and drawing the footer reads nothing', async (surface, $, on) => {
  const world = stage(on, ACTIVE_PEERS)
  await begin($)

  const ui = await mountFooter($, surface)

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
  test(`what another plugin draws around the footer is kept, with the button inside it [${surface}]`, { plugins: [NEIGHBOR_UNDER, NEIGHBOR_OVER] }, async ($, on) => {
    stage(on)
    await begin($)
    await run($, 'as', 'worker')

    const ui = await mountFooter($, surface)

    expect((await ui.find({ type: 'Text', text: 'tip from the neighbor above' }))?.type).toBe('Text')
    expect((await ui.find({ type: 'Text', text: NEIGHBOR_LINE }))?.type).toBe('Text')
    expect((await ui.find({ key: 'open-panel-footer' }))?.type).toBe('Button')
    await ui.unmount()
  })

  test(`with the Monitor off there is no button, no registry write and no read [${surface}]`, { plugins: [NEIGHBOR_UNDER], options: { enableMonitor: false } }, async ($, on) => {
    const world = stage(on, ACTIVE_PEERS)
    await begin($)
    await run($, 'as', 'worker')

    const ui = await mountFooter($, surface)

    await world.clock.advance(60_000)

    expect(await ui.drawn()).toEqual(NEIGHBOR_TREE)
    expect(await ui.find({ key: 'open-panel-footer' })).toBeUndefined()
    expect(world.keyReads).toBe(0)
    expect([...world.store.keys()].filter(key => key.startsWith('sess:')).length).toBe(Object.keys(ACTIVE_PEERS).length)
    await ui.unmount()
  })
}

eachSurface('pressing the footer button opens the panel on tab 1 as /agentes does', async (surface, $, on) => {
  const world = stage(on)
  await begin($)
  await run($, 'as', 'worker')
  await run($, 'agentes', 'sessoes')

  const ui = await mountFooter($, surface)

  await ui.press({ key: 'open-panel-footer' })

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

eachSurface('pressing the footer button where the pane is not placed does nothing and does not fail', async (surface, $, on) => {
  const world = stage(on)
  world.openResult = { isPlaced: false, reason: 'no pane here' }
  await begin($)
  await run($, 'as', 'worker')

  const ui = await mountFooter($, surface)

  await ui.press({ key: 'open-panel-footer' })

  expect(world.toasts).toEqual([])
  await ui.unmount()
})
