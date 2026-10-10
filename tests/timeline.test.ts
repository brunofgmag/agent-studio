import type { On } from 'claude-code'
import { type Engine, expect, mock, test } from 'claude-code/testing'

import { timelineBars, timelineSvg } from '../hooks/ui/timeline'
import { timelineAlt } from '../hooks/messages'
import type { SubagentLine } from '../types'

type Surface = 'terminal' | 'desktop' | 'mobile' | 'vscode'

const PROJECT = 'C:/work/app'
const SESSION = 'session-1'
const SESSION_MODEL = 'claude-haiku-5-5'
const NOW = 1_000_000_000

const PANE_PROPS = {
  title: 'Agentes',
  isFocused: true,
  bodyColumns: 80,
  placement: 'inline',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
} as const

const line = (over: Partial<SubagentLine> & Pick<SubagentLine, 'id' | 'startedAt'>): SubagentLine => ({
  type: 'general-purpose',
  task: 'task',
  prompt: '',
  model: null,
  parentId: null,
  background: false,
  status: 'completed',
  tool: null,
  tokens: 0,
  endedAt: null,
  durationMs: null,
  answer: '',
  depth: 0,
  ...over,
})

test('three finished subagents and one still running sit at hand-computed fractions of the scale', () => {
  const lines = [
    line({ id: 'a', type: 'Explore', status: 'completed', startedAt: 2000, endedAt: 4000 }),
    line({ id: 'c', type: 'reviewer', status: 'failed', startedAt: 4000, endedAt: 5000, parentId: 'a', depth: 1 }),
    line({ id: 'b', type: 'Plan', status: 'completed', startedAt: 3000, endedAt: 7000 }),
    line({ id: 'd', type: 'general-purpose', status: 'running', startedAt: 6000 }),
  ]

  expect(timelineBars(lines, 10_000)).toEqual([
    { id: 'a', type: 'Explore', status: 'completed', start: 0, width: 0.25 },
    { id: 'c', type: 'reviewer', status: 'failed', start: 0.25, width: 0.125 },
    { id: 'b', type: 'Plan', status: 'completed', start: 0.125, width: 0.5 },
    { id: 'd', type: 'general-purpose', status: 'running', start: 0.5, width: 0.5 },
  ])
})

test('the scale starts at the earliest birth wherever that line sits in the tree order', () => {
  const lines = [
    line({ id: 'late', startedAt: 6000, endedAt: 8000 }),
    line({ id: 'early', startedAt: 4000, endedAt: 5000 }),
  ]

  expect(timelineBars(lines, 8000).map(({ start, width }) => [start, width])).toEqual([
    [0.5, 0.5],
    [0, 0.25],
  ])
})

test('a single finished subagent fills its own scale up to now, and a single running one fills it whole', () => {
  expect(timelineBars([line({ id: 'a', startedAt: 5000, endedAt: 7000 })], 9000)).toMatchObject([{ start: 0, width: 0.5 }])
  expect(timelineBars([line({ id: 'a', status: 'running', startedAt: 5000 })], 9000)).toMatchObject([
    { start: 0, width: 1 },
  ])
})

test('a scale of zero length does not divide by zero: a newborn, and two born at the same instant', () => {
  expect(timelineBars([line({ id: 'a', status: 'running', startedAt: 5000 })], 5000)).toMatchObject([
    { start: 0, width: 1 },
  ])
  expect(
    timelineBars(
      [line({ id: 'a', status: 'running', startedAt: 5000 }), line({ id: 'b', status: 'running', startedAt: 5000 })],
      5000,
    ),
  ).toMatchObject([
    { start: 0, width: 1 },
    { start: 0, width: 1 },
  ])
  expect(
    timelineBars(
      [line({ id: 'a', startedAt: 5000, endedAt: 5000 }), line({ id: 'b', startedAt: 5000, endedAt: 5000 })],
      5000,
    ),
  ).toMatchObject([
    { start: 0, width: 1 },
    { start: 0, width: 1 },
  ])
})

test('two subagents born at the same instant share the start, and the running one is as long as the scale', () => {
  const lines = [
    line({ id: 'a', startedAt: 5000, endedAt: 7000 }),
    line({ id: 'b', status: 'running', startedAt: 5000 }),
  ]

  expect(timelineBars(lines, 9000).map(({ start, width }) => [start, width])).toEqual([
    [0, 0.5],
    [0, 1],
  ])
})

test('no line gives no bar', () => {
  expect(timelineBars([], 9000)).toEqual([])
})

test('a subagent that ended the instant it was born gets an honest zero width on a scale that has length', () => {
  const lines = [line({ id: 'a', startedAt: 2000, endedAt: 2000 }), line({ id: 'b', startedAt: 2000, endedAt: 6000 })]

  expect(timelineBars(lines, 10_000).map(({ start, width }) => [start, width])).toEqual([
    [0, 0],
    [0, 0.5],
  ])
})

const bar = (over: Partial<Parameters<typeof timelineSvg>[0][number]>) => ({
  id: 'x',
  type: 'Explore',
  status: 'completed' as const,
  start: 0,
  width: 0.25,
  ...over,
})

test('the document has one strip per subagent in the given order, the type as text beside the bar and a color per status', () => {
  const svg = timelineSvg(
    [
      bar({ type: 'Explore', status: 'completed', start: 0, width: 0.25 }),
      bar({ type: 'Plan', status: 'running', start: 0.125, width: 0.5 }),
      bar({ type: 'reviewer', status: 'failed', start: 0.75, width: 0.25 }),
    ],
    400,
  )

  expect(svg).toBe(
    [
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="90" viewBox="0 0 400 90">',
      '<text x="0" y="11" font-size="11" fill="currentColor">Explore</text>',
      '<rect x="0" y="15" width="100" height="10" rx="2" fill="#22a06b"/>',
      '<text x="50" y="41" font-size="11" fill="currentColor">Plan</text>',
      '<rect x="50" y="45" width="200" height="10" rx="2" fill="#3b82f6"/>',
      '<text x="400" y="71" font-size="11" text-anchor="end" fill="currentColor">reviewer</text>',
      '<rect x="300" y="75" width="100" height="10" rx="2" fill="#d1242f"/>',
      '</svg>',
    ].join('\n'),
  )
})

test('a stopped bar is grey, a bar narrower than two pixels is drawn two wide, and positions are rounded to hundredths', () => {
  const svg = timelineSvg(
    [bar({ status: 'stopped', start: 0, width: 0 }), bar({ status: 'completed', start: 1 / 3, width: 0.2 })],
    100,
  )

  expect(svg).toContain('<rect x="0" y="15" width="2" height="10" rx="2" fill="#8c959f"/>')
  expect(svg).toContain('<rect x="33.33" y="45" width="20" height="10" rx="2" fill="#22a06b"/>')
  expect(svg).toContain('<text x="33.33" y="41" font-size="11" fill="currentColor">Explore</text>')
})

test('a type with markup characters is escaped in the text', () => {
  const svg = timelineSvg([bar({ type: `a&b<c>"d'e` })], 400)

  expect(svg).toContain('>a&amp;b&lt;c&gt;&quot;d&#39;e</text>')
  expect(svg).not.toContain('<c>')
})

test('the alternative text counts the subagents and says each status in words', () => {
  expect(
    timelineAlt([
      { type: 'Explore', status: 'completed' },
      { type: 'Plan', status: 'running' },
      { type: 'reviewer', status: 'failed' },
      { type: 'worker', status: 'stopped' },
    ]),
  ).toBe('Linha do tempo de 4 subagentes: Explore concluído, Plan rodando, reviewer falhou, worker parado.')
  expect(timelineAlt([{ type: 'Explore', status: 'running' }])).toBe('Linha do tempo de 1 subagente: Explore rodando.')
})

const stage = (on: On) => {
  const world = { clock: mock.clock(on, { now: NOW }), ids: ['sub-1', 'sub-2', 'sub-3', 'sub-4'] }

  mock.session(on)
  mock.env(on, { USERPROFILE: 'C:\\Users\\bruno' })
  on('session.cwd', () => ({ value: PROJECT }))
  on('session.root', () => ({ value: PROJECT }))
  on('session.repo', () => ({ value: null }))
  on('session.id', () => ({ value: SESSION }))
  on('session.model', () => ({ value: SESSION_MODEL }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('settings.read', () => ({ value: {} }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({
    value: [{ id: 'agent-studio', title: 'Agentes', isShown: true, isFocused: true, isPlaced: true }],
  }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('store.delete', () => ({ value: undefined }))
  on('store.keys', () => ({ value: [] }))
  on('fs.read', (_$, e) => ({ deny: `ENOENT ${e.path}` }))
  on('fs.list', (_$, e) => ({ deny: `ENOENT ${e.path}` }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.run', () => ({ text: 'bottom answered' }))
  on('classic.SessionStart', () => ({}))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('prompt.compose', () => ({ sections: [] }))
  on('agent.spawn', (_$, e) => ({ model: SESSION_MODEL, agentId: world.ids.shift() ?? `extra-${e.subagentType}` }))
  on('agent.list', () => ({ value: [] }))

  return world
}

type World = ReturnType<typeof stage>

const spawn = ($: Engine, subagentType: string) =>
  $.agent.spawn({ prompt: 'go', description: `task of ${subagentType}`, subagentType, background: false } as never)

const complete = ($: Engine, agentId: string, reason = 'answer') =>
  $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 1, isAborted: false, reason, agentId } as never)

const runScenario = async ($: Engine, world: World) => {
  await $.session.start({ cwd: PROJECT, surface: null, isInteractive: true })
  await spawn($, 'Explore')
  await world.clock.advance(1000)
  await spawn($, 'Plan')
  await world.clock.advance(1000)
  await complete($, 'sub-1')
  await spawn($, 'reviewer')
  await world.clock.advance(1000)
  await complete($, 'sub-3', 'error')
  await world.clock.advance(1000)
  await spawn($, 'general-purpose')
  await world.clock.advance(1000)
  await complete($, 'sub-2')
  await world.clock.advance(3000)
  await $.command.run({
    command: 'agentes',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
}

const mountPane = ($: Engine, surface: Surface) =>
  $.ui.mount({ plugin: 'agent-studio', surface, component: 'Pane', requestId: 'agent-studio', props: PANE_PROPS })

const EXPECTED_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="120" viewBox="0 0 640 120">',
  '<text x="0" y="11" font-size="11" fill="currentColor">Explore</text>',
  '<rect x="0" y="15" width="160" height="10" rx="2" fill="#22a06b"/>',
  '<text x="80" y="41" font-size="11" fill="currentColor">Plan</text>',
  '<rect x="80" y="45" width="320" height="10" rx="2" fill="#22a06b"/>',
  '<text x="160" y="71" font-size="11" fill="currentColor">reviewer</text>',
  '<rect x="160" y="75" width="80" height="10" rx="2" fill="#d1242f"/>',
  '<text x="640" y="101" font-size="11" text-anchor="end" fill="currentColor">general-purpose</text>',
  '<rect x="320" y="105" width="320" height="10" rx="2" fill="#3b82f6"/>',
  '</svg>',
].join('\n')

const EXPECTED_ALT =
  'Linha do tempo de 4 subagentes: Explore concluído, Plan concluído, reviewer falhou, general-purpose rodando.'

type Outline = string | readonly [string, ...Outline[]]

type Node = { type: string; props?: { key?: string }; children?: readonly (Node | string)[] }

const outline = (element: Node | string): Outline => {
  if (typeof element === 'string') {
    return element
  }

  const key = element.props?.key === undefined ? '' : `#${element.props.key}`

  return [`${element.type}${key}`, ...(element.children ?? []).map(outline)]
}

const RULE = '─'.repeat(80)

const TERMINAL_TREE: Outline = [
  'Box',
  ['Box', ['Button#tab-1'], ['Button#tab-2'], ['Button#tab-3']],
  ['Text', RULE],
  [
    'Box',
    [
      'Box',
      ['Box', ['Text', 'Sessão sem agente'], ['Select#switch-agent']],
      [
        'Box',
        ['Box', ['Button#sub-sub-1']],
        ['Box', ['Button#sub-sub-2']],
        ['Box', ['Button#sub-sub-3']],
        ['Box', ['Button#sub-sub-4']],
      ],
      ['Box', ['Text', 'Tab escolhe uma linha, Enter abre o detalhe e Esc fecha o painel.']],
    ],
  ],
]

test('on the desktop the list carries the timeline above the tree, with the hand-computed document and its alternative text', async ($, on) => {
  const world = stage(on)
  await runScenario($, world)

  const ui = await mountPane($, 'desktop')
  const svg = await ui.find({ type: 'Svg' })
  const keys = (await ui.findAll({})).map(element => element.key)

  const wrapper = await ui.find({ key: 'timeline' })

  expect(wrapper?.type).toBe('Box')
  expect(wrapper?.children).toHaveLength(1)
  expect(svg?.type).toBe('Svg')
  expect(svg?.props.source).toBe(EXPECTED_SVG)
  expect(svg?.props.alt).toBe(EXPECTED_ALT)
  expect(keys.indexOf('timeline')).toBeGreaterThan(keys.indexOf('switch-agent'))
  expect(keys.indexOf('timeline')).toBeLessThan(keys.indexOf('sub-sub-1'))
  await ui.unmount()
})

test('on the terminal there is no timeline and the tab 1 tree is the one the list had before', async ($, on) => {
  const world = stage(on)
  await runScenario($, world)

  const ui = await mountPane($, 'terminal')

  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(outline((await ui.drawn()) as Node)).toEqual(TERMINAL_TREE)
  await ui.unmount()
})

for (const surface of ['mobile', 'vscode'] as const) {
  test(`where the table has Svg (${surface}) the timeline is drawn too`, async ($, on) => {
    const world = stage(on)
    await runScenario($, world)

    const ui = await mountPane($, surface)

    expect((await ui.find({ type: 'Svg' }))?.props.source).toBe(EXPECTED_SVG)
    await ui.unmount()
  })
}

test('without a subagent nothing is drawn on any surface', async ($, on) => {
  stage(on)
  await $.session.start({ cwd: PROJECT, surface: null, isInteractive: true })
  await $.command.run({
    command: 'agentes',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })

  for (const surface of ['desktop', 'mobile', 'vscode'] as const) {
    const ui = await mountPane($, surface)

    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: 'Nenhum subagente nesta sessão.' }))?.type).toBe('Text')
    await ui.unmount()
  }
})

test('the detail of a subagent has no timeline, and the list gets it back', async ($, on) => {
  const world = stage(on)
  await runScenario($, world)

  const ui = await mountPane($, 'desktop')

  await ui.press({ key: 'sub-sub-1' })

  expect(await ui.find({ type: 'Svg' })).toBeUndefined()

  await ui.press({ key: 'back' })

  expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe(EXPECTED_ALT)
  await ui.unmount()
})

test('the timeline follows the scale: a redraw later stretches the running bar and keeps the finished ones in place', async ($, on) => {
  const world = stage(on)
  await runScenario($, world)

  const ui = await mountPane($, 'desktop')

  await world.clock.advance(8000)
  await ui.redraw()

  const source = String((await ui.find({ type: 'Svg' }))?.props.source)

  expect(source).toContain('width="640" height="120" viewBox="0 0 640 120"')
  expect(source).toContain('<rect x="0" y="15" width="80" height="10" rx="2" fill="#22a06b"/>')
  expect(source).toContain('<rect x="160" y="105" width="480" height="10" rx="2" fill="#3b82f6"/>')
  await ui.unmount()
})
