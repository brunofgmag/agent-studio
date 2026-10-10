import type { On } from 'claude-code'
import { type Engine, expect, mock } from 'claude-code/testing'
import { test } from './in-portuguese'

type Surface = 'terminal' | 'desktop'

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
    command: 'agent-panel',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
}

const mountPane = ($: Engine, surface: Surface) =>
  $.ui.mount({ plugin: 'agent-studio', surface, component: 'Pane', requestId: 'agent-studio', props: PANE_PROPS })

type Outline = string | readonly [string, ...Outline[]]

type Node = { type: string; props?: { key?: string }; children?: readonly (Node | string)[] }

const outline = (element: Node | string): Outline => {
  if (typeof element === 'string') {
    return element
  }

  const key = element.props?.key === undefined ? '' : `#${element.props.key}`

  return [`${element.type}${key}`, ...(element.children ?? []).map(outline)]
}

const RULE = '─'.repeat(78)

const treeRow = (key: string, mark: string, meta: readonly Outline[], task: string): Outline => [
  'Box',
  ['Box', ['Box', ['Text', mark], [`Button#sub-${key}`], ...meta], ['Box', ['Text', task]]],
]

const TERMINAL_TREE: Outline = [
  'Box',
  ['Box', ['Button#tab-1'], ['Button#tab-2'], ['Button#tab-3']],
  ['Text', RULE],
  [
    'Box',
    [
      'Box',
      ['Box', ['Text', 'Sessão sem agente'], ['Select#switch-agent']],
      ['Box', ['Text', '1 rodando · 2 concluídos · 1 falhou · 0 tokens']],
      [
        'Box',
        [
          'Box',
          ['Text', 'Em andamento (1)'],
          treeRow(
            'sub-4',
            '●',
            [['Text', 'rodando ·'], ['Client#clock-sub-sub-4'], ['Text', '· 0']],
            'task of general-purpose',
          ),
        ],
        [
          'Box',
          ['Text', 'Terminados (3)'],
          treeRow('sub-1', '✓', [['Text', 'concluído · 0:00 · 0']], 'task of Explore'),
          treeRow('sub-2', '✓', [['Text', 'concluído · 0:00 · 0']], 'task of Plan'),
          treeRow('sub-3', '✗', [['Text', 'falhou · 0:00 · 0']], 'task of reviewer'),
        ],
      ],
      ['Box', ['Text', 'Tab escolhe uma linha, Enter abre o detalhe e Esc fecha o painel.']],
    ],
  ],
]

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the tab 1 list is the tabs, the rule, the header, the summary, the two groups and one row per subagent, with no drawing above it [${surface}]`, async ($, on) => {
    const world = stage(on)
    await runScenario($, world)

    const ui = await mountPane($, surface)

    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    expect(outline((await ui.drawn()) as Node)).toEqual(TERMINAL_TREE)
    await ui.unmount()
  })
}
