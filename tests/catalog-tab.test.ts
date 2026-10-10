import type { On, RenderSurface, UiOpenResult } from 'claude-code'
import { type Engine, expect, mock, test } from 'claude-code/testing'

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

const HOME_FILE = 'C:/Users/bruno/.claude/agents/home-only.md'

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

const agentes = ($: Engine, args = '') => run($, 'agentes', args)

const mountPane = ($: Engine, surface: Surface) =>
  $.ui.mount({ plugin: 'agent-studio', surface, component: 'Pane', requestId: 'agent-studio', props: PANE_PROPS })

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

const rowTexts = async (ui: Mounted) =>
  (await ui.findAll({ type: 'Text' })).map(text => text.text).filter(text => text.includes(' (projeto)') || text.includes(' (usuário)'))

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

eachSurface('/agentes keeps opening on tab 1 and tab 3 is one press away', async (surface, $, on) => {
  stage(on)
  await begin($)

  expect(await agentes($)).toBe('Painel de agentes aberto.')

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
  expect(await rowTexts(ui)).toEqual([
    'plain (projeto)  plain description  modelo da sessão  ferramentas: todas',
    'starter (projeto)  starter description  modelo da sessão  ferramentas: todas',
    'worker (projeto)  worker description  modelo: claude-opus-5-5[1m]  ferramentas: Read, Grep',
    'home-only (usuário)  home-only description  modelo da sessão  ferramentas: todas',
  ])

  const buttons = await ui.findAll({ type: 'Button' })

  expect(buttons.filter(button => button.key?.startsWith('use-')).map(button => button.text)).toEqual([
    'Usar nesta sessão',
    'Usar nesta sessão',
    'Usar nesta sessão',
    'Usar nesta sessão',
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

  expect(rows).toContain(`verbose (projeto)  ${'a'.repeat(79)}…  modelo da sessão  ferramentas: todas`)
  expect(rows).toContain('worker (projeto)  ativo  worker description  modelo: claude-opus-5-5[1m]  ferramentas: Read, Grep')
  expect(rows.filter(row => row.includes('  ativo  '))).toHaveLength(1)
  await ui.unmount()
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
  await agentes($)

  const ui = await mountPane($, surface)

  expect(await ui.find({ type: 'Select' })).toBeUndefined()
  expect(await textOf(ui, 'Sessão sem agente')).toBe('Sessão sem agente')

  await ui.press({ key: 'tab-3' })

  expect(await textOf(ui, 'O Launcher está desligado. Ligue a opção "Launcher" nas opções do plugin para listar e usar agentes.')).toBeDefined()
  expect(await useKeys(ui)).toEqual([])
  await ui.unmount()
}, { enableLauncher: false })

for (const frozen of [false, true]) {
  eachSurface(`pressing use leaves the state /as leaves: prompt section, saved entry, status line and hidden notice${frozen ? ' after the first turn' : ''}`, async (surface, $, on) => {
    const world = stage(on)
    await begin($)

    if (frozen) {
      await startTurn($)
    }

    const answer = await as($, 'worker')
    const byCommand = await snapshotOf($, world)

    await as($, 'off')
    world.toasts.length = 0
    await agentes($)

    const ui = await mountPane($, surface)

    await ui.press({ key: 'tab-3' })
    await ui.press({ key: 'use-worker' })

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

  expect(await rowTexts(ui)).toContain('worker (projeto)  ativo  worker description  modelo: claude-opus-5-5[1m]  ferramentas: Read, Grep')

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
  await agentes($)

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
  await agentes($)

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
  await agentes($)

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
  await agentes($)

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
  await agentes($)

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
  await agentes($)

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
  await agentes($)

  const ui = await mountPane($, surface)
  const names = async () => ((await ui.find({ key: 'switch-agent' }))?.props.options as { value: string }[]).map(option => option.value)
  const rows = async () => (await rowTexts(ui)).map(row => row.split(' ')[0])
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
