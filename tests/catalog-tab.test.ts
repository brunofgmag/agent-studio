import type { On, RenderSurface, UiOpenResult } from 'claude-code'
import { type Engine, type Plugin, expect, mock } from 'claude-code/testing'
import { test } from './in-portuguese'

type Surface = 'terminal' | 'desktop'

type Stage = {
  files: Map<string, string>
  store: Map<string, unknown>
  surfaces: RenderSurface[]
  openResult: UiOpenResult
  failOpen: boolean
  opens: unknown[]
  panes: { id: string; title: string }[]
  toasts: string[]
  statuses: (string | undefined)[]
  submitted: { text: string; origin: unknown }[]
  clock: ReturnType<typeof mock.clock>
  session: ReturnType<typeof mock.session>
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

const BASE_SECTIONS = [
  { id: 'lean_body', scope: 'shared' as const, text: 'GENERIC BODY' },
  { id: 'communication', scope: 'session' as const, text: 'COMMUNICATION' },
]

const agentFile = (name: string, header = '', description = `${name} description`) =>
  `---\nname: ${name}\ndescription: ${description}\n${header}---\nYou are ${name}.\n`

const pathOf = (name: string) => `${PROJECT}/.claude/agents/${name}.md`

const HOME_FILE = 'C:/Users/dev/.claude/agents/home-only.md'

const DEFAULT_FILES: Readonly<Record<string, string>> = {
  [pathOf('plain')]: agentFile('plain'),
  [pathOf('starter')]: agentFile('starter', 'initialPrompt: start here\n'),
  [pathOf('worker')]: agentFile('worker', 'model: claude-opus-5-5[1m]\neffort: high\ntools: Read, Grep\n'),
  [HOME_FILE]: agentFile('home-only'),
}

const BROKEN = '---\nname: broken\n---\nx'

const slashed = (path: string) => path.replaceAll('\\', '/')

const stage = (on: On, files: Readonly<Record<string, string>> = DEFAULT_FILES): Stage => {
  const world: Stage = {
    files: new Map(Object.entries(files)),
    store: new Map(),
    surfaces: ['terminal'],
    openResult: { isPlaced: true },
    failOpen: false,
    opens: [],
    panes: [],
    toasts: [],
    statuses: [],
    submitted: [],
    clock: mock.clock(on, { now: NOW }),
    session: mock.session(on),
  }

  mock.env(on, { USERPROFILE: 'C:\\Users\\dev' })
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
  on('ui.status', (_$, e) => {
    world.statuses.push(e.text)

    return { value: undefined }
  })
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
  on('ui.panes', () => ({
    value: world.panes.map(({ id, title }) => ({ id, title, isShown: true, isFocused: true, isPlaced: world.openResult.isPlaced })),
  }))
  on('prompt.submit', (_$, e) => {
    world.submitted.push({ text: e.text, origin: e.origin })

    return { text: e.text }
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
  on('store.keys', () => ({ value: [...world.store.keys()] }))
  on('fs.read', (_$, e) => {
    const text = world.files.get(slashed(e.path))

    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })
  on('fs.list', (_$, e) => {
    const dir = slashed(e.path).replace(/\/$/, '')
    const names = [...world.files.keys()]
      .filter(file => file.startsWith(`${dir}/`))
      .map(file => file.slice(dir.length + 1))

    return names.length === 0
      ? { deny: `ENOENT ${e.path}` }
      : { value: names.map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })) }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.run', () => ({ text: 'bottom answered' }))
  on('classic.SessionStart', () => ({}))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('prompt.compose', () => ({ sections: BASE_SECTIONS }))
  on('agent.spawn', (_$, e) => ({ model: SESSION_MODEL, agentId: `agent-${e.subagentType}` }))
  on('agent.list', () => ({ value: [] }))

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

const as = ($: Engine, args = '') => run($, 'as', args)

const agentPanel = ($: Engine, args = '') => run($, 'agent-panel', args)

const mountPane = ($: Engine, surface: Surface) =>
  $.ui.mount({ plugin: 'agent-studio', surface, component: 'Pane', requestId: 'agent-studio', props: PANE_PROPS })

const mountPaneAt = ($: Engine, surface: Surface, columns: number) =>
  $.ui.mount({
    plugin: 'agent-studio',
    surface,
    component: 'Pane',
    requestId: 'agent-studio',
    props: { ...PANE_PROPS, bodyColumns: columns },
  })

const BUDGETS: Record<Surface, { button: number; confirm: number }> = {
  terminal: { button: 69, confirm: 64 },
  desktop: { button: 81, confirm: 76 },
}

const NARROW_BUDGETS: Record<Surface, { button: number; bare: number }> = {
  terminal: { button: 49, bare: 56 },
  desktop: { button: 57, bare: 65 },
}

const fitted = (text: string, budget: number) =>
  text.length <= budget ? text : `${text.slice(0, budget - 1).trimEnd()}…`

const mountMobile = ($: Engine) =>
  $.ui.mount({ plugin: 'agent-studio', surface: 'mobile', component: 'Pane', requestId: 'agent-studio', props: PANE_PROPS })

const sectionsOf = async ($: Engine) =>
  (
    await $.prompt.compose({
      model: 'claude-opus-5-5',
      promptModel: 'claude-opus-5-5',
      surfaces: ['terminal'],
      tools: [],
      outputStyle: null,
      traits: [],
    })
  ).sections

const startTurn = async ($: Engine) => {
  await sectionsOf($)
  await $.turn.start({ text: 'hello', turnId: 't1' })
}

const snapshotOf = async ($: Engine, world: Stage) => ({
  sections: await sectionsOf($),
  saved: world.store.get(`launcher:${SESSION}`),
  status: world.statuses.at(-1),
  hidden: JSON.stringify(world.session.appended().at(-1)?.message.content),
})

const eachSurface = (
  name: string,
  body: (surface: Surface, $: Engine, on: On) => Promise<void>,
  options: Record<string, boolean> = {},
) => {
  for (const surface of SURFACES) {
    test(`${name} [${surface}]`, { options }, ($, on) => body(surface, $, on))
  }
}

type Mounted = Awaited<ReturnType<typeof mountPane>> | Awaited<ReturnType<typeof mountMobile>>

type CatalogRow = { mark: string; markColor: unknown; name: string; nameProps: Record<string, unknown>; meta: string; description: string }

const ROW_TEXTS = 4

const rowTexts = async (ui: Mounted): Promise<CatalogRow[]> => {
  const texts = await ui.findAll({ type: 'Text' })
  const first = texts.findIndex(text => text.text.startsWith('Agentes disponíveis ('))
  const rows: CatalogRow[] = []

  for (let at = first + 1; first >= 0 && at + ROW_TEXTS <= texts.length; at += ROW_TEXTS) {
    const [mark, name, meta, description] = texts.slice(at, at + ROW_TEXTS)

    rows.push({
      mark: mark?.text ?? '',
      markColor: mark?.props.color,
      name: name?.text ?? '',
      nameProps: name?.props ?? {},
      meta: meta?.text ?? '',
      description: description?.text ?? '',
    })
  }

  return rows
}

const useKeys = async (ui: Mounted) =>
  (await ui.findAll({ type: 'Button' })).map(button => button.key).filter(key => key?.startsWith('use-'))

const textOf = async (ui: Mounted, text: string | RegExp) => (await ui.find({ type: 'Text', text }))?.text

const PANEL_ON_AGENTS = 'Painel de agentes aberto na aba Agentes.'

eachSurface('/as with no argument opens the panel on the Agentes tab and answers one sentence', async (surface, $, on) => {
  const world = stage(on)
  await begin($)

  expect(await as($)).toBe(PANEL_ON_AGENTS)
  expect(world.opens).toEqual([{ id: 'agent-studio', title: 'Agentes', focus: true, closeOnEscape: true }])

  const ui = await mountPane($, surface)

  expect((await ui.find({ key: 'tab-3' }))?.props.dimColor).toBe(false)
  expect((await ui.find({ key: 'tab-1' }))?.props.dimColor).toBe(true)
  expect(await useKeys(ui)).toEqual(['use-plain', 'use-starter', 'use-worker', 'use-home-only'])
  await ui.unmount()
})

const FALLBACKS = ['no surface', 'not placed', 'open throws'] as const

for (const mode of FALLBACKS) {
  eachSurface(`/as with no argument answers the list as text when there is ${mode}`, async (_surface, $, on) => {
    const world = stage(on)

    if (mode === 'no surface') {
      world.surfaces = []
    } else if (mode === 'not placed') {
      world.openResult = { isPlaced: false, reason: 'no pane here' }
    } else {
      world.failOpen = true
    }

    await begin($)

    const text = await as($)

    expect(text).toContain('Agentes disponíveis (4):')
    expect(text).toContain('  plain (projeto): plain description')
    expect(text).not.toBe(PANEL_ON_AGENTS)
    expect(world.panes).toEqual([])
  })
}

test('/as with no argument answers the list as text when the Monitor is off', { options: { enableMonitor: false } }, async ($, on) => {
  const world = stage(on)
  await begin($)

  expect(await as($)).toContain('Agentes disponíveis (4):')
  expect(world.opens).toEqual([])
})

eachSurface('/as with an argument keeps answering as text and opens no panel', async (_surface, $, on) => {
  const world = stage(on)
  await begin($)

  expect(await as($, '?')).toBe('Nenhum agente ativo. A sessão segue o comportamento padrão.')
  expect(await as($, 'plain')).toBe('Agente plain ativo.')
  expect(await as($, '--reload')).toBe('4 agentes encontrados.')
  expect(await as($, 'off')).toBe('Agente plain desativado.')
  expect(world.opens).toEqual([])
})

eachSurface('/agent-panel keeps opening on tab 1 and tab 3 is one press away', async (surface, $, on) => {
  stage(on)
  await begin($)

  expect(await agentPanel($)).toBe('Painel de agentes aberto.')

  const ui = await mountPane($, surface)

  expect((await ui.find({ key: 'tab-1' }))?.props.dimColor).toBe(false)
  expect(await useKeys(ui)).toEqual([])

  await ui.press({ key: 'tab-3' })

  expect(await useKeys(ui)).toEqual(['use-plain', 'use-starter', 'use-worker', 'use-home-only'])
  await ui.unmount()
})

eachSurface('tab 3 draws one row per agent with the source, the model or the session model, the tools or todas, and a use button', async (surface, $, on) => {
  stage(on)
  await begin($)
  await as($)

  const ui = await mountPane($, surface)

  expect(await textOf(ui, 'Agentes disponíveis (4)')).toBe('Agentes disponíveis (4)')
  expect((await rowTexts(ui)).map(({ mark, name, meta, description }) => [mark, name, meta, description])).toEqual([
    ['●', 'plain', 'projeto · modelo da sessão', 'plain description'],
    ['●', 'starter', 'projeto · modelo da sessão', 'starter description'],
    ['●', 'worker', 'projeto · modelo: claude-opus-5-5[1m] · 2 ferramentas', 'worker description'],
    ['●', 'home-only', 'usuário · modelo da sessão', 'home-only description'],
  ])

  const buttons = await ui.findAll({ type: 'Button' })

  expect(buttons.filter(button => button.key?.startsWith('use-')).map(button => button.text)).toEqual([
    'Usar',
    'Usar',
    'Usar',
    'Usar',
  ])
  await ui.unmount()
})

eachSurface('tab 3 cuts a long description and marks the active agent with the word ativo', async (surface, $, on) => {
  stage(on, { [pathOf('verbose')]: agentFile('verbose', '', 'a'.repeat(100)), ...DEFAULT_FILES })
  await begin($)
  await as($, 'worker')
  await as($)

  const ui = await mountPane($, surface)
  const rows = await rowTexts(ui)

  expect(rows.find(row => row.name === 'verbose')?.description).toBe(fitted(`${'a'.repeat(79)}…`, BUDGETS[surface].button))
  expect(rows.find(row => row.name === 'worker')?.meta).toBe('projeto · modelo: claude-opus-5-5[1m] · 2 ferramentas · ativo')
  expect(rows.filter(row => row.meta.endsWith(' · ativo'))).toHaveLength(1)
  await ui.unmount()
})

eachSurface('tab 3 colours the dot by the frontmatter colour, subtle when it is unknown or absent', async (surface, $, on) => {
  stage(on, {
    [pathOf('painted')]: agentFile('painted', 'color: red\n'),
    [pathOf('odd')]: agentFile('odd', 'color: magenta\n'),
    [pathOf('bare')]: agentFile('bare'),
  })
  await begin($)
  await as($)

  const ui = await mountPane($, surface)

  expect(Object.fromEntries((await rowTexts(ui)).map(row => [row.name, row.markColor]))).toEqual({
    bare: 'subtle',
    odd: 'subtle',
    painted: '#d1242f',
  })

  expect((await ui.find({ key: 'use-painted' }))?.text).toBe('Usar')
  await ui.unmount()
})

type Node = { type?: string; props?: Record<string, unknown>; children?: Node[] }

const rowColumnOf = async (ui: Mounted, name: string) =>
  (await ui.findAll({ type: 'Box' })).find(
    box =>
      box.props.flexDirection === 'column' &&
      box.children.length === 2 &&
      (box.children[0] as Node).children?.some(child => child.type === 'Text' && JSON.stringify(child).includes(`"${name}"`)) === true,
  )

eachSurface('a catalog row with a button is the identity alone on line 1 and the button then the truncated description on line 2, with no space-between row', async (surface, $, on) => {
  stage(on, { [pathOf('painted')]: agentFile('painted', 'color: red\n') })
  await begin($)
  await as($)

  const ui = await mountPane($, surface)
  const column = await rowColumnOf(ui, 'painted')
  const [identity, action] = (column?.children ?? []) as Node[]

  expect(identity?.props).toMatchObject({ flexDirection: 'row', gap: 1 })
  expect(identity?.props?.justifyContent).toBeUndefined()
  expect(identity?.children?.map(child => child.type)).toEqual(['Text', 'Text', 'Text'])
  expect(identity?.children?.[2]?.props).toMatchObject({ dimColor: true, wrap: 'truncate' })
  expect(action?.props).toMatchObject({ flexDirection: 'row', gap: 1 })
  expect(action?.props?.paddingLeft).toBeUndefined()
  expect(action?.children?.map(child => child.type)).toEqual(['Button', 'Text'])
  expect(action?.children?.[0]?.props).toMatchObject({ key: 'use-painted', label: 'Usar' })
  expect(action?.children?.[1]?.props).toMatchObject({ dimColor: true, wrap: 'truncate' })
  expect(action?.children?.[1]?.children).toEqual(['painted description'])
  expect((await ui.findAll({ type: 'Box' })).filter(box => box.props.justifyContent === 'space-between')).toEqual([])
  await ui.unmount()
})

eachSurface('a catalog row without a button keeps the description under the identity, indented by 2', async (surface, $, on) => {
  stage(on)
  await begin($)
  await $.classic.SessionStart({ source: 'startup', agent_type: 'architect' } as never)
  await as($)

  const ui = await mountPane($, surface)
  const column = await rowColumnOf(ui, 'worker')
  const [identity, description] = (column?.children ?? []) as Node[]

  expect(identity?.children?.map(child => child.type)).toEqual(['Text', 'Text', 'Text'])
  expect(description?.props).toMatchObject({ paddingLeft: 2 })
  expect(description?.children?.map(child => child.type)).toEqual(['Text'])
  expect(description?.children?.[0]?.props).toMatchObject({ dimColor: true, wrap: 'truncate' })
  expect(description?.children?.[0]?.children).toEqual(['worker description'])
  expect(await ui.find({ type: 'Button', text: 'Usar' })).toBeUndefined()
  await ui.unmount()
})

const VERBOSE = { [pathOf('verbose')]: agentFile('verbose', '', 'a'.repeat(100)), ...DEFAULT_FILES }

const NARROW = 60

const verboseAt = async ($: Engine, surface: Surface) => {
  const ui = await mountPaneAt($, surface, NARROW)
  const description = (await rowTexts(ui)).find(row => row.name === 'verbose')?.description

  await ui.unmount()

  return description
}

eachSurface('tab 3 ends a long description with an ellipsis at the room the button leaves', async (surface, $, on) => {
  stage(on, VERBOSE)
  await begin($)
  await as($)

  const description = await verboseAt($, surface)

  expect(description?.endsWith('…')).toBe(true)
  expect(description).toHaveLength(NARROW_BUDGETS[surface].button)
})

eachSurface('tab 3 draws a short description whole however narrow the pane is', async (surface, $, on) => {
  stage(on, VERBOSE)
  await begin($)
  await as($)

  const ui = await mountPaneAt($, surface, NARROW)

  expect((await rowTexts(ui)).find(row => row.name === 'plain')?.description).toBe('plain description')
  await ui.unmount()
})

eachSurface('tab 3 gives a row with no button the room the button would have taken', async (surface, $, on) => {
  stage(on, VERBOSE)
  await begin($)
  await $.classic.SessionStart({ source: 'startup', agent_type: 'architect' } as never)
  await as($)

  const description = await verboseAt($, surface)

  expect(description?.endsWith('…')).toBe(true)
  expect(description).toHaveLength(NARROW_BUDGETS[surface].bare)
  expect(NARROW_BUDGETS[surface].bare).toBeGreaterThan(NARROW_BUDGETS[surface].button)
})

test('tab 3 fits more characters on the desktop than on the terminal at the same width', async ($, on) => {
  stage(on, VERBOSE)
  await begin($)
  await as($)

  const terminal = await verboseAt($, 'terminal')
  const desktop = await verboseAt($, 'desktop')

  expect(terminal).toHaveLength(NARROW_BUDGETS.terminal.button)
  expect(desktop).toHaveLength(NARROW_BUDGETS.desktop.button)
  expect(desktop?.length).toBeGreaterThan(terminal?.length ?? 0)
})

eachSurface('tab 3 counts the ignored files and says where the reasons are', async (surface, $, on) => {
  stage(on, { ...DEFAULT_FILES, [pathOf('broken')]: BROKEN })
  await begin($)
  await as($)

  const ui = await mountPane($, surface)

  expect(await textOf(ui, /ignorado/)).toBe('1 arquivo ignorado. Os motivos aparecem em /as --reload.')
  await ui.unmount()
})

eachSurface('tab 3 counts several ignored files in the plural and says nothing when none is ignored', async (surface, $, on) => {
  const world = stage(on, { ...DEFAULT_FILES, [pathOf('broken')]: BROKEN, [pathOf('broken-2')]: BROKEN })
  await begin($)
  await as($)

  const ui = await mountPane($, surface)

  expect(await textOf(ui, /ignorado/)).toBe('2 arquivos ignorados. Os motivos aparecem em /as --reload.')

  world.files.delete(pathOf('broken'))
  world.files.delete(pathOf('broken-2'))
  await as($, '--reload')
  await ui.press({ key: 'tab-1' })
  await ui.press({ key: 'tab-3' })

  expect(await ui.find({ type: 'Text', text: /ignorado/ })).toBeUndefined()
  await ui.unmount()
})

eachSurface('tab 3 with no agent says so with the sentence /as uses and draws no use button', async (surface, $, on) => {
  stage(on, {})
  await begin($)
  await as($)

  const ui = await mountPane($, surface)

  expect(await textOf(ui, 'Nenhum agente encontrado em .claude/agents.')).toBe('Nenhum agente encontrado em .claude/agents.')
  expect(await useKeys(ui)).toEqual([])
  await ui.unmount()
})

eachSurface('tab 3 with only ignored files says no agent was found and counts them', async (surface, $, on) => {
  stage(on, { [pathOf('broken')]: BROKEN })
  await begin($)
  await as($)

  const ui = await mountPane($, surface)

  expect(await textOf(ui, 'Nenhum agente encontrado em .claude/agents.')).toBe('Nenhum agente encontrado em .claude/agents.')
  expect(await textOf(ui, /ignorado/)).toBe('1 arquivo ignorado. Os motivos aparecem em /as --reload.')
  await ui.unmount()
})

eachSurface('with the Launcher off tab 3 says so and tab 1 keeps its header', async (surface, $, on) => {
  stage(on)
  await begin($)
  await agentPanel($)

  const ui = await mountPane($, surface)

  expect(await ui.find({ type: 'Select' })).toBeUndefined()
  expect(await textOf(ui, 'Sessão sem agente')).toBe('Sessão sem agente')

  await ui.press({ key: 'tab-3' })

  expect(await textOf(ui, 'O Launcher está desligado. Ligue a opção "Launcher" nas opções do plugin para listar e usar agentes.')).toBeDefined()
  expect(await useKeys(ui)).toEqual([])
  await ui.unmount()
}, { enableLauncher: false })

for (const frozen of [false, true]) {
  eachSurface(`pressing use leaves the state /as leaves: prompt section, saved entry and hidden notice, and the same summary on the status line with the Monitor on${frozen ? ' after the first turn' : ''}`, async (surface, $, on) => {
    const world = stage(on)
    await begin($)

    if (frozen) {
      await startTurn($)
    }

    const answer = await as($, 'worker')
    const byCommand = await snapshotOf($, world)

    await as($, 'off')
    world.toasts.length = 0
    await agentPanel($)

    const ui = await mountPane($, surface)

    await ui.press({ key: 'tab-3' })
    await ui.press({ key: 'use-worker' })

    if (frozen) {
      expect(world.toasts).toEqual([])
      await ui.press({ key: 'use-worker' })
    }

    expect(await snapshotOf($, world)).toEqual(byCommand)
    expect(world.toasts).toEqual([answer])
    expect(byCommand.status).toBe('@worker · claude-opus-5-5[1m] · high')
    expect(byCommand.saved).toMatchObject({ agent: { name: 'worker', source: 'project' } })
    expect((byCommand.sections[0] as { id: string }).id).toBe('agent-studio:agent')

    if (frozen) {
      expect(byCommand.hidden).toContain('you act as the agent \\"worker\\"')
    } else {
      expect(byCommand.hidden).toBeUndefined()
    }

    await ui.unmount()
  })
}

eachSurface('pressing use on an agent with an initialPrompt submits it once, as /as does', async (surface, $, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'starter')
  await world.clock.advance(0)

  const byCommand = [...world.submitted]

  await as($, 'off')
  await as($)

  const ui = await mountPane($, surface)

  await ui.press({ key: 'use-starter' })
  await world.clock.advance(0)

  expect(byCommand).toHaveLength(1)
  expect(byCommand[0]?.text).toBe('start here')
  expect(world.submitted).toHaveLength(2)
  expect(world.submitted[1]).toEqual(byCommand[0])
  await ui.unmount()
})

eachSurface('pressing use on an agent without an initialPrompt submits nothing', async (surface, $, on) => {
  const world = stage(on)
  await begin($)
  await as($)

  const ui = await mountPane($, surface)

  await ui.press({ key: 'use-plain' })
  await world.clock.advance(60_000)

  expect(world.submitted).toEqual([])
  expect(world.toasts).toEqual(['Agente plain ativo.'])
  await ui.unmount()
})

eachSurface('after pressing use the row says ativo, the header names the agent and the registry publishes it', async (surface, $, on) => {
  const world = stage(on)
  await begin($)
  await as($)
  await world.clock.advance(1000)

  const ui = await mountPane($, surface)

  await ui.press({ key: 'use-worker' })

  expect((await rowTexts(ui)).find(row => row.name === 'worker')?.meta).toBe(
    'projeto · modelo: claude-opus-5-5[1m] · 2 ferramentas · ativo',
  )

  await world.clock.advance(1000)

  expect(world.store.get(`sess:${SESSION}`)).toMatchObject({ agent: 'worker' })

  await ui.press({ key: 'tab-1' })

  expect(await textOf(ui, 'Sessão como @worker · claude-opus-5-5[1m] · high')).toBeDefined()
  await ui.unmount()
})

eachSurface('a use button for an agent the launcher no longer knows toasts the command answer', async (surface, $, on) => {
  const world = stage(on)
  await begin($)
  await as($)

  const ui = await mountPane($, surface)

  world.files.delete(pathOf('plain'))
  await as($, '--reload')
  await ui.press({ key: 'use-plain' })

  expect(world.toasts.at(-1)).toBe('Não há agente chamado "plain". Agentes disponíveis: starter, worker, home-only.')
  await ui.unmount()
})

const OPTIONS = [
  { value: 'plain' },
  { value: 'starter' },
  { value: 'worker' },
  { value: 'home-only' },
  { value: 'off', label: 'desligar' },
]

eachSurface('the tab 1 header carries a Select with the catalog names and desligar, the current value selected', async (surface, $, on) => {
  stage(on)
  await begin($)
  await agentPanel($)

  const ui = await mountPane($, surface)
  const select = await ui.find({ key: 'switch-agent' })

  expect(select?.type).toBe('Select')
  expect(select?.props.label).toBe('Trocar agente')
  expect(select?.props.options).toEqual(OPTIONS)
  expect(select?.props.value).toBe('off')
  expect(await textOf(ui, 'Sessão sem agente')).toBeDefined()

  await as($, 'worker')
  await ui.redraw()

  expect((await ui.find({ key: 'switch-agent' }))?.props.value).toBe('worker')
  expect(await textOf(ui, 'Sessão como @worker · claude-opus-5-5[1m] · high')).toBeDefined()
  await ui.unmount()
})

eachSurface('an agent named off does not repeat the value of desligar in the Select', async (surface, $, on) => {
  stage(on, { [pathOf('off')]: agentFile('off'), [pathOf('plain')]: agentFile('plain') })
  await begin($)
  await agentPanel($)

  const ui = await mountPane($, surface)

  expect((await ui.find({ key: 'switch-agent' }))?.props.options).toEqual([
    { value: 'plain' },
    { value: 'off', label: 'desligar' },
  ])
  await ui.unmount()
})

eachSurface('an active agent the reloaded catalog no longer lists leaves the Select with no option selected', async (surface, $, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'worker')
  await agentPanel($)

  const ui = await mountPane($, surface)

  world.files.delete(pathOf('worker'))
  await as($, '--reload')
  await ui.press({ key: 'tab-3' })
  await ui.press({ key: 'tab-1' })

  const select = await ui.find({ key: 'switch-agent' })

  expect(select?.props.options).toEqual([
    { value: 'plain' },
    { value: 'starter' },
    { value: 'home-only' },
    { value: 'off', label: 'desligar' },
  ])
  expect(select?.props.value).toBeUndefined()
  await ui.unmount()
})

eachSurface('picking an agent in the Select leaves the state /as leaves and toasts the answer', async (surface, $, on) => {
  const world = stage(on)
  await begin($)

  const answer = await as($, 'worker')
  const byCommand = await snapshotOf($, world)

  await as($, 'off')
  world.toasts.length = 0
  await agentPanel($)

  const ui = await mountPane($, surface)

  await ui.select({ key: 'switch-agent', value: 'worker' })

  expect(await snapshotOf($, world)).toEqual(byCommand)
  expect(world.toasts).toEqual([answer])
  expect((await ui.find({ key: 'switch-agent' }))?.props.value).toBe('worker')
  await ui.unmount()
})

eachSurface('picking desligar in the Select turns the agent off like /as off', async (surface, $, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'worker')
  await agentPanel($)

  const ui = await mountPane($, surface)

  await ui.select({ key: 'switch-agent', value: 'off' })

  expect(world.toasts).toEqual(['Agente worker desativado.'])
  expect(world.statuses.at(-1)).toBeUndefined()
  expect(world.store.get(`launcher:${SESSION}`)).toMatchObject({ agent: null, optedOut: true })
  expect((await ui.find({ key: 'switch-agent' }))?.props.value).toBe('off')
  expect(await textOf(ui, 'Sessão sem agente')).toBeDefined()
  await ui.unmount()
})

eachSurface('a native session draws no use button and no Select and says why on tab 3 and tab 1', async (surface, $, on) => {
  const world = stage(on)
  await begin($)
  await $.classic.SessionStart({ source: 'startup', agent_type: 'architect' } as never)
  await as($)

  const ui = await mountPane($, surface)
  const sentence = 'Esta sessão já roda como o agente architect (claude --agent). Para trocar, abra outra sessão.'

  expect(await useKeys(ui)).toEqual([])
  expect(await textOf(ui, sentence)).toBe(sentence)
  expect((await rowTexts(ui)).length).toBe(4)

  await ui.press({ key: 'tab-1' })

  expect(await ui.find({ key: 'switch-agent' })).toBeUndefined()
  expect(await textOf(ui, sentence)).toBe(sentence)
  expect(world.toasts).toEqual([])
  await ui.unmount()
})

test('a surface with no Select keeps the tab 1 header as it was, and tab 3 still lists and uses', async ($, on) => {
  const world = stage(on)
  await begin($)
  await agentPanel($)

  const ui = await mountMobile($)

  expect(await ui.find({ type: 'Select' })).toBeUndefined()
  expect(await textOf(ui, 'Sessão sem agente')).toBeDefined()
  expect((await ui.findAll({ type: 'Box' })).filter(box => box.children.length === 0)).toEqual([])

  await ui.press({ key: 'tab-3' })
  await ui.press({ key: 'use-plain' })

  expect(world.toasts).toEqual(['Agente plain ativo.'])
  await ui.unmount()
})

eachSurface('the catalog is read when the panel opens and when tab 1 or tab 3 is chosen, and never by a beat', async (surface, $, on) => {
  const world = stage(on)
  await begin($)
  await agentPanel($)

  const ui = await mountPane($, surface)
  const names = async () => ((await ui.find({ key: 'switch-agent' }))?.props.options as { value: string }[]).map(option => option.value)
  const rows = async () => (await rowTexts(ui)).map(row => row.name)
  const addAgent = async (name: string) => {
    world.files.set(pathOf(name), agentFile(name))
    await as($, '--reload')
  }

  await addAgent('late')
  await world.clock.advance(4000)

  expect(await names()).toEqual(['plain', 'starter', 'worker', 'home-only', 'off'])

  await ui.press({ key: 'tab-3' })

  expect(await rows()).toEqual(['late', 'plain', 'starter', 'worker', 'home-only'])

  await addAgent('later')
  await world.clock.advance(4000)

  expect(await rows()).toEqual(['late', 'plain', 'starter', 'worker', 'home-only'])

  await ui.press({ key: 'tab-1' })

  expect(await names()).toEqual(['late', 'later', 'plain', 'starter', 'worker', 'home-only', 'off'])
  await ui.unmount()
})

eachSurface('the catalog read when the panel opens is already on the first drawing', async (surface, $, on) => {
  stage(on)
  await begin($)
  await as($)

  const ui = await mountPane($, surface)

  expect((await rowTexts(ui)).length).toBe(4)
  await ui.unmount()
})

const SONNET = 'claude-sonnet-5-5'
const OPUS = 'claude-opus-5-5[1m]'

const MODEL_FILES: Readonly<Record<string, string>> = {
  ...DEFAULT_FILES,
  [pathOf('sonnet')]: agentFile('sonnet', `model: ${SONNET}\n`),
}

const changeLine = (from: string, to: string) =>
  `O modelo muda de ${from} para ${to}. O próximo turno relê a conversa inteira sem cache.`

const labelOf = async (ui: Mounted, name: string) => (await ui.find({ key: `use-${name}` }))?.text

const descriptionOf = async (ui: Mounted, name: string) => (await rowTexts(ui)).find(row => row.name === name)?.description

const openFrozen = async ($: Engine, on: On, surface: Surface) => {
  const world = stage(on, MODEL_FILES)

  await begin($)
  await startTurn($)
  await as($)

  return { world, ui: await mountPane($, surface) }
}

eachSurface('the first press on an agent that switches the model asks to confirm and activates nothing', async (surface, $, on) => {
  const { world, ui } = await openFrozen($, on, surface)
  const before = await snapshotOf($, world)

  await ui.press({ key: 'use-worker' })

  expect(world.toasts).toEqual([])
  expect(await snapshotOf($, world)).toEqual(before)
  expect(await as($, '?')).toContain('Nenhum agente ativo')
  expect(await labelOf(ui, 'worker')).toBe('Confirmar')
  expect(await descriptionOf(ui, 'worker')).toBe(changeLine(SESSION_MODEL, OPUS))
  expect((await ui.find({ type: 'Text', text: changeLine(SESSION_MODEL, OPUS) }))?.props.wrap).toBe('wrap')
  expect(await labelOf(ui, 'sonnet')).toBe('Usar')
  expect(await descriptionOf(ui, 'sonnet')).toBe('sonnet description')
  await ui.unmount()
})

eachSurface('the second press activates with the warning in the toast and the row goes back to Usar', async (surface, $, on) => {
  const { world, ui } = await openFrozen($, on, surface)

  await ui.press({ key: 'use-worker' })
  await ui.press({ key: 'use-worker' })

  expect(world.toasts).toHaveLength(1)
  expect(world.toasts[0]?.split('\n')[1]).toBe(changeLine(SESSION_MODEL, OPUS))
  expect(world.store.get(`launcher:${SESSION}`)).toMatchObject({ agent: { name: 'worker' } })
  expect(await labelOf(ui, 'worker')).toBe('Usar')
  expect(await descriptionOf(ui, 'worker')).toBe('worker description')

  await ui.press({ key: 'use-sonnet' })

  expect(world.toasts).toHaveLength(1)
  expect(await labelOf(ui, 'sonnet')).toBe('Confirmar')
  expect(await descriptionOf(ui, 'sonnet')).toBe(changeLine(OPUS, SONNET))
  await ui.unmount()
})

eachSurface('pressing another row moves the pending, and a row with no model switch activates at once and clears it', async (surface, $, on) => {
  const { world, ui } = await openFrozen($, on, surface)

  await ui.press({ key: 'use-worker' })
  await ui.press({ key: 'use-sonnet' })

  expect(world.toasts).toEqual([])
  expect(await labelOf(ui, 'worker')).toBe('Usar')
  expect(await labelOf(ui, 'sonnet')).toBe('Confirmar')

  await ui.press({ key: 'use-worker' })

  expect(world.toasts).toEqual([])
  expect(await labelOf(ui, 'worker')).toBe('Confirmar')
  expect(await labelOf(ui, 'sonnet')).toBe('Usar')

  await ui.press({ key: 'use-plain' })

  expect(world.toasts).toHaveLength(1)
  expect(world.toasts[0]).toContain('Agente plain ativo.')
  expect(world.toasts[0]).not.toContain('O modelo muda')
  expect(await labelOf(ui, 'worker')).toBe('Usar')

  await ui.press({ key: 'use-worker' })

  expect(world.toasts).toHaveLength(1)
  expect(await labelOf(ui, 'worker')).toBe('Confirmar')
  await ui.unmount()
})

eachSurface('before the first prompt one press activates, whatever the model', async (surface, $, on) => {
  const world = stage(on, MODEL_FILES)
  await begin($)
  await as($)

  const ui = await mountPane($, surface)

  await ui.press({ key: 'use-worker' })

  expect(world.toasts).toEqual(['Agente worker ativo.'])
  await ui.unmount()
})

eachSurface('a conversation that starts with the tab already open still asks to confirm', async (surface, $, on) => {
  const world = stage(on, MODEL_FILES)
  await begin($)
  await as($)

  const ui = await mountPane($, surface)

  await startTurn($)
  await ui.press({ key: 'use-worker' })

  expect(world.toasts).toEqual([])
  expect(await labelOf(ui, 'worker')).toBe('Confirmar')
  await ui.unmount()
})

eachSurface('changing tab drops the pending confirmation', async (surface, $, on) => {
  const { world, ui } = await openFrozen($, on, surface)

  await ui.press({ key: 'use-worker' })
  await ui.press({ key: 'tab-1' })
  await ui.press({ key: 'tab-3' })

  expect(await labelOf(ui, 'worker')).toBe('Usar')

  await ui.press({ key: 'use-worker' })

  expect(world.toasts).toEqual([])
  expect(await labelOf(ui, 'worker')).toBe('Confirmar')
  await ui.unmount()
})

eachSurface('opening the panel again drops the pending confirmation', async (surface, $, on) => {
  const { world, ui } = await openFrozen($, on, surface)

  await ui.press({ key: 'use-worker' })
  await agentPanel($, 'agent-panel')
  await as($)

  expect(await labelOf(ui, 'worker')).toBe('Usar')

  await ui.press({ key: 'use-worker' })

  expect(world.toasts).toEqual([])
  await ui.unmount()
})

const CLOSER: Plugin = {
  name: 'closer',
  register(on) {
    on('command.run', { command: 'close-pane' }, async $ => {
      await $.ui.close({ id: 'agent-studio' })

      return { text: 'closed' }
    })
  },
}

for (const surface of SURFACES) {
  test(`closing the panel drops the pending confirmation [${surface}]`, { plugins: [CLOSER] }, async ($, on) => {
    const { world, ui } = await openFrozen($, on, surface)

    await ui.press({ key: 'use-worker' })
    await run($, 'close-pane')

    await ui.unmount()

    const again = await mountPane($, surface)

    expect(world.panes).toEqual([])
    expect(await labelOf(again, 'worker')).toBe('Usar')

    await again.press({ key: 'use-worker' })

    expect(world.toasts).toEqual([])
    await again.unmount()
  })
}

eachSurface('the tab 1 Select activates at once and the warning arrives in the toast', async (surface, $, on) => {
  const world = stage(on, MODEL_FILES)
  await begin($)
  await startTurn($)
  await agentPanel($)

  const ui = await mountPane($, surface)

  await ui.select({ key: 'switch-agent', value: 'worker' })

  expect(world.toasts).toHaveLength(1)
  expect(world.toasts[0]?.split('\n')[1]).toBe(changeLine(SESSION_MODEL, OPUS))
  expect(world.store.get(`launcher:${SESSION}`)).toMatchObject({ agent: { name: 'worker' } })
  await ui.unmount()
})
