import type { On, SessionSendResult, TurnUsage } from 'claude-code'
import { type Engine, type Plugin, expect, mock, test } from 'claude-code/testing'

import { messagesIn } from '../hooks/messages'
import { en } from '../hooks/words/en'
import { ptBr } from '../hooks/words/pt-br'
import type { SessionEntry } from '../types'
import { tickingMetasOf } from './ticking-kit'

type Registered = { name: string; description: string | undefined; argumentHint: string | undefined }

type Stage = {
  store: Map<string, unknown>
  toasts: string[]
  statuses: (string | undefined)[]
  registered: Registered[]
  surfaces: ('terminal' | 'desktop')[]
  panes: { id: string; title: string }[]
  opens: unknown[]
  sends: { to: unknown; text: string }[]
  sendResult: SessionSendResult
  clock: ReturnType<typeof mock.clock>
}

const PROJECT = 'C:/work/app'
const SESSION = 'session-1'
const SESSION_MODEL = 'claude-haiku-5-5'
const OPUS = 'claude-opus-5-5[1m]'
const NOW = 1_000_000_000

const WORKER_FILE = `${PROJECT}/.claude/agents/worker.md`

const WORKER_TEXT = `---\nname: worker\ndescription: worker description\nmodel: ${OPUS}\neffort: high\n---\nYou are worker.\n`

const PANE_PROPS = {
  title: 'Agents',
  isFocused: true,
  bodyColumns: 80,
  placement: 'inline',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
} as const

const usage = (input: number, output = 0, read = 0, created = 0): TurnUsage => ({
  model: SESSION_MODEL,
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: created,
})

const peer = (over: Partial<SessionEntry> = {}): SessionEntry => ({
  cwd: 'C:/work/api',
  repo: null,
  agent: 'architect',
  model: null,
  state: 'working',
  turnStartedAt: NOW - 65_000,
  subagents: [{ type: 'Explore', task: 'read the logs', status: 'running', tool: null, tokens: 1500 }],
  lastAnswer: 'the api is fine',
  updatedAt: NOW - 5000,
  ...over,
})

const PEERS = {
  'sess:peer-1': peer(),
  'sess:peer-2': peer({ cwd: 'C:/work/old', agent: null, state: 'ended', subagents: [], updatedAt: NOW - 120_000 }),
}

const NEIGHBOR: Plugin = {
  name: 'neighbor',
  tier: 'append',
  register(on) {
    on('ui.render', { component: 'SessionMode' }, ($, e) => {
      const { Text } = $.ui.resolve(e)

      return Text({ children: 'mode of the neighbor' })
    })
  },
}

const DELIVERED: SessionSendResult = { isDelivered: true }

const stage = (on: On, seed: Readonly<Record<string, unknown>> = PEERS): Stage => {
  const world: Stage = {
    store: new Map(Object.entries(seed)),
    toasts: [],
    statuses: [],
    registered: [],
    surfaces: ['terminal'],
    panes: [],
    opens: [],
    sends: [],
    sendResult: DELIVERED,
    clock: mock.clock(on, { now: NOW }),
  }

  mock.session(on)
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
    world.panes = [{ id: e.id, title: e.title ?? e.id }]

    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    world.panes = world.panes.filter(({ id }) => id !== e.id)

    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: world.panes.map(({ id, title }) => ({ id, title, isShown: true, isFocused: true, isPlaced: true })),
  }))
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
  on('fs.read', (_$, e) =>
    e.path.replaceAll('\\', '/') === WORKER_FILE ? { value: WORKER_TEXT } : { deny: `ENOENT ${e.path}` },
  )
  on('fs.list', (_$, e) =>
    e.path.replaceAll('\\', '/').replace(/\/$/, '') === `${PROJECT}/.claude/agents`
      ? { value: [{ name: 'worker.md', kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false }] }
      : { deny: `ENOENT ${e.path}` },
  )
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => {
    world.registered.push({ name: e.name, description: e.description, argumentHint: e.argumentHint })

    return { value: { command: e.name } }
  })
  on('command.run', () => ({ text: 'bottom answered' }))
  on('classic.SessionStart', () => ({}))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('prompt.compose', () => ({ sections: [] }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: usage(1200, 300) }
  })
  on('tool.call', () => ({ ref: 1, result: 'ran', text: 'Task stopped' }))
  on('agent.spawn', (_$, e) => ({ model: SESSION_MODEL, agentId: `agent-${e.subagentType}` }))
  on('agent.list', () => ({ value: [] }))
  on('session.send', (_$, e) => {
    world.sends.push({ to: e.to, text: e.text })

    return world.sendResult
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

const as = ($: Engine, args = '') => run($, 'as', args)

const agentPanel = ($: Engine, args = '') => run($, 'agent-panel', args)

const spawn = (
  $: Engine,
  over: { description?: string; subagentType?: string; prompt?: string } = {},
) =>
  $.agent.spawn({
    prompt: over.prompt ?? 'Read every log and report.',
    description: over.description ?? 'read the logs',
    subagentType: over.subagentType ?? 'Explore',
    background: false,
  } as never)

const complete = ($: Engine, agentId: string, answer: string, used = usage(2000, 500)) =>
  $.turn.complete({
    turnId: 't1',
    answer,
    durationMs: 2400,
    isAborted: false,
    reason: 'answer',
    agentId,
    usage: used,
  } as never)

const startFrozenTurn = async ($: Engine) => {
  await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: ['terminal'],
    tools: [],
    outputStyle: null,
    traits: [],
  })
  await $.turn.start({ text: 'hello', turnId: 't1' })
}

const mountPane = ($: Engine) =>
  $.ui.mount({ plugin: 'agent-studio', surface: 'terminal', component: 'Pane', requestId: 'agent-studio', props: PANE_PROPS })

const mountFooter = ($: Engine) =>
  $.ui.mount({ plugin: 'agent-studio', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })

type Mounted = Awaited<ReturnType<typeof mountPane>>

const textsOf = async (ui: Mounted) => (await ui.findAll({ type: 'Text' })).map(text => text.text)

const hasText = async (ui: Mounted, text: string) => (await textsOf(ui)).includes(text)

const labelOf = async (ui: Mounted, key: string) => (await ui.find({ key }))?.text

test('no language, an unknown language and a value that is not a string give English', () => {
  for (const language of [undefined, 'en', 'fr', '', 42, null, {}]) {
    expect(messagesIn(language).noSubagents).toBe('No subagents in this session.')
  }
})

for (const language of ['pt-BR', 'pt-br', 'PT-BR', 'pt', ' pt-BR ']) {
  test(`the language "${language}" gives Portuguese`, () => {
    expect(messagesIn(language).noSubagents).toBe('Nenhum subagente nesta sessão.')
  })
}

test('the footer counts sessions working in English, singular and plural', () => {
  const { footerSummary } = messagesIn('en')

  expect(footerSummary({ agent: null, running: 0, peers: 1 })).toBe('1 session working')
  expect(footerSummary({ agent: null, running: 0, peers: 3 })).toBe('3 sessions working')
})

test('the time of a session reads in English per presence: turn length, time idle, last sign of life', () => {
  const { sessionRow, otherSessions } = messagesIn('en')
  const base = { sessionId: 's', cwd: 'C:/a', repo: null, agent: 'architect', model: null, subagents: [] }
  const sessions = [
    { ...base, presence: 'working', turnStartedAt: NOW - 83_000, updatedAt: NOW - 2000, idleSince: NOW - 99_000 },
    { ...base, presence: 'working', turnStartedAt: null, updatedAt: NOW - 2000 },
    { ...base, presence: 'idle', turnStartedAt: null, updatedAt: NOW - 2000, idleSince: NOW - 125_000 },
    { ...base, presence: 'idle', turnStartedAt: null, updatedAt: NOW - 2000 },
    { ...base, presence: 'stale', turnStartedAt: null, updatedAt: NOW - 130_000, idleSince: NOW - 1000 },
    { ...base, presence: 'ended', turnStartedAt: null, updatedAt: NOW - 7_300_000, idleSince: NOW - 1000 },
  ] as const

  expect(sessions.map(session => sessionRow(session, NOW).meta)).toEqual([
    '@architect · working · 1:23',
    '@architect · working',
    '@architect · idle · 2 min ago',
    '@architect · idle',
    '@architect · inactive · 2 min ago',
    '@architect · ended · 2 h ago',
  ])
  expect(otherSessions(sessions, NOW).split('\n').slice(1)).toEqual([
    '  C:/a  @architect  working  0 subagents  1:23',
    '  C:/a  @architect  working  0 subagents',
    '  C:/a  @architect  idle  0 subagents  2 min ago',
    '  C:/a  @architect  idle  0 subagents',
    '  C:/a  @architect  inactive  0 subagents  2 min ago',
    '  C:/a  @architect  ended  0 subagents  2 h ago',
  ])
})

test('with no option the commands are registered in English under their English names', async ($, on) => {
  const world = stage(on)

  await begin($)

  expect(world.registered).toEqual([
    { name: 'as', description: 'Run this session as an agent from .claude/agents', argumentHint: '[agent|off]' },
    {
      name: 'agent-panel',
      description: "Show this session's subagents and the other open sessions",
      argumentHint: '[sessions]',
    },
  ])
})

test('with language pt-BR the commands keep their names and carry the Portuguese descriptions', { options: { language: 'pt-BR' } }, async ($, on) => {
  const world = stage(on)

  await begin($)

  expect(world.registered).toEqual([
    { name: 'as', description: 'Faz a sessão atuar como um agente de .claude/agents', argumentHint: '[agente|off]' },
    {
      name: 'agent-panel',
      description: 'Mostra os subagentes desta sessão e as outras sessões abertas',
      argumentHint: '[sessions]',
    },
  ])
})

test('/as reads in English: unknown agent, none active, activation, summary, reload and off', async ($, on) => {
  const world = stage(on)

  world.surfaces = []
  await begin($)

  expect(await as($, 'x')).toBe('There is no agent named "x". Available agents: worker.')
  expect(await as($, '?')).toBe('No active agent. The session follows its default behavior.')
  expect(await as($)).toContain('Available agents (1):')
  expect(await as($, 'worker')).toBe('Agent worker is active.')
  expect((await as($, '?')).split('\n')).toEqual([
    'Active agent: worker (project)',
    `File: ${WORKER_FILE}`,
    `Model: ${OPUS}`,
    'Effort: high',
    'Allowed tools: all',
    'Disallowed tools: none',
  ])
  expect(await as($, '--reload')).toBe('1 agent found.')
  expect(await as($, 'off')).toBe('Agent worker deactivated.')
  expect(await as($, 'off')).toBe('No agent is active.')
})

test('/as warns in English that the model changes, and that the system prompt waits for a /clear', async ($, on) => {
  stage(on)
  await begin($)
  await startFrozenTurn($)

  expect((await as($, 'worker')).split('\n')).toEqual([
    'Agent worker is active. The model and tools apply now. The system prompt only changes after a /clear or a compaction.',
    `The model changes from ${SESSION_MODEL} to ${OPUS}. The next turn rereads the whole conversation without cache.`,
  ])
  expect((await as($, 'off')).split('\n')).toEqual([
    'Agent worker deactivated. The system prompt only goes back to the default after a /clear or a compaction.',
    `The model goes back from ${OPUS} to ${SESSION_MODEL}. The next turn rereads the whole conversation without cache.`,
  ])
})

test('/agent-panel answers in English as text where there is no screen, and says how to use it', async ($, on) => {
  const world = stage(on)

  world.surfaces = []
  await begin($)

  expect(await agentPanel($)).toBe('No subagents in this session.')
  expect(await agentPanel($, 'sessions')).toBe(
    [
      'Other sessions (2):',
      '  C:/work/api  @architect  working  1 subagent  1:05',
      '  C:/work/old  no agent  ended  0 subagents  2 min ago',
    ].join('\n'),
  )
  expect(await agentPanel($, 'whatever')).toBe(
    "Usage: /agent-panel for this session's subagents, /agent-panel sessions for the other sessions.",
  )

  world.store.clear()

  expect(await agentPanel($, 'sessions')).toBe('No other sessions registered.')
})

test('/agent-panel opens the panel and answers in English, and the old name is gone', async ($, on) => {
  const world = stage(on)

  await begin($)

  expect(await agentPanel($)).toBe('Agent panel opened.')
  expect(world.opens).toEqual([{ id: 'agent-studio', title: 'Agents', focus: true, closeOnEscape: true }])
  expect(await agentPanel($, 'sessions')).toBe('Agent panel opened on the Other sessions tab.')
  expect(await as($)).toBe('Agent panel opened on the Agents tab.')
  expect(world.registered.map(({ name }) => name)).toEqual(['as', 'agent-panel'])
  expect(await run($, 'agentes')).toBe('bottom answered')
})

test('the tabs, the list headings, the summary and a row read in English on tab 1', async ($, on) => {
  stage(on)
  await begin($)
  await spawn($)
  await spawn($, { description: 'plan it', subagentType: 'Plan' })
  await complete($, 'agent-Plan', 'plan ready')
  await agentPanel($)

  const ui = await mountPane($)

  expect(await Promise.all(['tab-1', 'tab-2', 'tab-3'].map(key => labelOf(ui, key)))).toEqual([
    'This session',
    'Other sessions',
    'Agents',
  ])
  expect(await hasText(ui, 'Session with no agent')).toBe(true)
  expect(await hasText(ui, '1 running · 1 completed · 2.5k tokens')).toBe(true)
  expect(await hasText(ui, 'In progress (1)')).toBe(true)
  expect(await hasText(ui, 'Finished (1)')).toBe(true)
  expect(await hasText(ui, 'Tab picks a row, Enter opens its detail and Esc closes the panel.')).toBe(true)
  expect(await tickingMetasOf(ui, NOW)).toEqual(['running · 0:00 · 0'])
  expect(await hasText(ui, 'completed · 0:02 · 2.5k')).toBe(true)
  await ui.unmount()
})

test('the group headings and a row read in English on tab 2', async ($, on) => {
  stage(on)
  await begin($)
  await agentPanel($, 'sessions')

  const ui = await mountPane($)

  expect(await textsOf(ui)).toEqual(
    expect.arrayContaining([
      'Open (1)',
      '1 subagent · the api is fine',
      'Ended (1)',
    ]),
  )
  expect(await tickingMetasOf(ui, NOW)).toEqual(['@architect · working · 1:05', 'no agent · ended · 2 min ago'])
  await ui.unmount()
})

test('the catalog heading and the Use and Confirm buttons read in English on tab 3', async ($, on) => {
  stage(on)
  await begin($)
  await startFrozenTurn($)
  await agentPanel($)

  const ui = await mountPane($)

  await ui.press({ key: 'tab-3' })

  expect(await hasText(ui, 'Available agents (1)')).toBe(true)
  expect(await labelOf(ui, 'use-worker')).toBe('Use')

  await ui.press({ key: 'use-worker' })

  expect(await labelOf(ui, 'use-worker')).toBe('Confirm')
  const warning = `The model changes from ${SESSION_MODEL} to ${OPUS}. The next turn rereads the whole conversation without cache.`

  expect(await hasText(ui, warning)).toBe(true)
  await ui.unmount()
})

test('the subagent detail reads in English: headings, toggles, buttons and the message toasts', async ($, on) => {
  const world = stage(on)

  await begin($)
  await spawn($, { prompt: 'first line\nsecond line' })
  await agentPanel($)

  const ui = await mountPane($)

  await ui.press({ key: 'sub-agent-Explore' })

  expect(await labelOf(ui, 'back')).toBe('Back')
  expect(await labelOf(ui, 'stop')).toBe('Stop')
  expect(await hasText(ui, 'Prompt given')).toBe(true)
  expect(await hasText(ui, '2 lines')).toBe(true)
  expect(await labelOf(ui, 'toggle-prompt')).toBe('show all')

  await ui.press({ key: 'toggle-prompt' })

  expect(await labelOf(ui, 'toggle-prompt')).toBe('collapse')
  expect(await hasText(ui, 'Answer')).toBe(true)
  expect(await hasText(ui, 'No answer yet.')).toBe(true)
  expect((await ui.find({ key: 'message-0' }))?.props).toMatchObject({
    placeholder: 'Message for this subagent',
    submitLabel: 'send',
  })

  await ui.input({ key: 'message-0', text: 'hello there' })

  expect(world.toasts).toEqual(['Message sent to the subagent Explore.'])
  expect(await hasText(ui, 'You: hello there')).toBe(true)

  world.sendResult = { isDelivered: false, reason: 'no such agent' }
  await ui.input({ key: 'message-1', text: 'again' })

  expect(world.toasts.at(-1)).toBe('Could not send the message to the subagent Explore: no such agent')

  world.sendResult = { isDelivered: false, reason: 'Blocked by the auto mode classifier' }
  await ui.input({ key: 'message-1', text: 'once more' })

  expect(world.toasts.at(-1)).toBe(
    'Auto mode refused the direct send. The message for the subagent Explore became a request in the conversation.',
  )
  await ui.unmount()
})

test('the subagent detail notes the total with cache reads in English, and only when there are reads', async ($, on) => {
  stage(on)

  await begin($)
  await spawn($, { description: 'with reads', subagentType: 'Explore' })
  await spawn($, { description: 'without reads', subagentType: 'Plan' })
  await complete($, 'agent-Explore', 'done', usage(1000, 200, 48_500, 300))
  await complete($, 'agent-Plan', 'done')
  await agentPanel($)

  const ui = await mountPane($)

  await ui.press({ key: 'sub-agent-Explore' })

  expect(await hasText(ui, '50k tokens with cache reads')).toBe(true)
  await ui.press({ key: 'back' })
  await ui.press({ key: 'sub-agent-Plan' })

  expect((await textsOf(ui)).some(text => text.includes('cache reads'))).toBe(false)
  await ui.unmount()
})

test('the stop toasts read in English', async ($, on) => {
  const world = stage(on)

  await begin($)
  await spawn($)
  await agentPanel($)

  const ui = await mountPane($)

  await ui.press({ key: 'sub-agent-Explore' })
  await ui.press({ key: 'stop' })

  expect(world.toasts).toEqual(['Stop request sent to Explore: Task stopped'])
  await ui.unmount()
})

test('the session detail reads in English: headings, the Status button and the message toast', async ($, on) => {
  const world = stage(on)

  await begin($)
  await agentPanel($, 'sessions')

  const ui = await mountPane($)

  await ui.press({ key: 'sess-peer-1' })

  expect(await labelOf(ui, 'back')).toBe('Back')
  expect(await labelOf(ui, 'status')).toBe('Status')
  expect(await hasText(ui, 'Last answer')).toBe(true)
  expect(await hasText(ui, 'Subagents in this session (1)')).toBe(true)
  expect((await ui.find({ key: 'message-0' }))?.props.placeholder).toBe('Message for this session')

  await ui.press({ key: 'status' })

  expect(world.sends.at(-1)?.text).toBe('Reply in one line with what you are doing now.')
  expect(world.toasts).toEqual(['Message sent to the session in C:/work/api.'])
  await ui.unmount()
})

test('the footer button and the status summary read in English', { plugins: [NEIGHBOR] }, async ($, on) => {
  const world = stage(on)

  await begin($)
  await as($, 'worker')
  await spawn($)
  await agentPanel($, 'sessions')

  const ui = await mountFooter($)

  expect((await ui.find({ key: 'open-panel-footer' }))?.text).toBe('Panel')
  expect(world.statuses.at(-1)).toBe(`@worker · ${OPUS} · high · 1 subagent running · 1 session working`)
  await ui.unmount()
})

const SEAMS = [
  {
    language: 'en',
    description: 'Run this session as an agent from .claude/agents',
    asAnswer: 'No active agent. The session follows its default behavior.',
    text: 'No subagents in this session.',
    usage: "Usage: /agent-panel for this session's subagents, /agent-panel sessions for the other sessions.",
    opened: 'Agent panel opened.',
    title: 'Agents',
    tab: 'This session',
    button: 'Panel',
    summary: '1 session working',
  },
  {
    language: 'pt-BR',
    description: 'Faz a sessão atuar como um agente de .claude/agents',
    asAnswer: 'Nenhum agente ativo. A sessão segue o comportamento padrão.',
    text: 'Nenhum subagente nesta sessão.',
    usage: 'Uso: /agent-panel para os subagentes desta sessão, /agent-panel sessions para as outras sessões.',
    opened: 'Painel de agentes aberto.',
    title: 'Agentes',
    tab: 'Esta sessão',
    button: 'Painel',
    summary: '1 sessão trabalhando',
  },
] as const

for (const seam of SEAMS) {
  test(`with language ${seam.language} the registration, the launcher, the monitor, the pane and the footer all read the same language`, { options: { language: seam.language }, plugins: [NEIGHBOR] }, async ($, on) => {
    const world = stage(on, { 'sess:peer-1': peer() })

    world.surfaces = []
    await begin($)

    expect(world.registered[0]?.description).toBe(seam.description)
    expect(await as($, '?')).toBe(seam.asAnswer)
    expect(await agentPanel($)).toBe(seam.text)
    expect(await agentPanel($, 'whatever')).toBe(seam.usage)

    world.surfaces = ['terminal']

    expect(await agentPanel($)).toBe(seam.opened)
    expect(world.opens).toEqual([{ id: 'agent-studio', title: seam.title, focus: true, closeOnEscape: true }])

    const pane = await mountPane($)

    expect(await labelOf(pane, 'tab-1')).toBe(seam.tab)
    expect(await hasText(pane, seam.text)).toBe(true)
    await pane.unmount()
    await agentPanel($, 'sessions')

    const footer = await mountFooter($)

    expect((await footer.find({ key: 'open-panel-footer' }))?.text).toBe(seam.button)
    expect(world.statuses.at(-1)).toBe(seam.summary)
    await footer.unmount()
  })
}

const PORTUGUESE_ONLY = /[À-ÿ]|\b(agentes?|sessão|sessões|arquivos?|mensagens?|nenhum|nenhuma|para|não|uma?|resposta|voltar|usar|painel|ferramentas?|modelo|ignorados?|encontrados?|desativado|ativos?|abertas?|encerradas?|terminados|ainda|esta|este|outras?)\b/i

const EQUAL_BY_NATURE: readonly string[] = ['effortLine', 'tokensTotal', 'agentsArgumentHint', 'statusLabel']

type Leaf = [path: string, text: string]

const leavesOf = (value: unknown, path: string): Leaf[] => {
  if (typeof value === 'string') {
    return [[path, value]]
  }

  if (typeof value === 'function') {
    return [1, 2].map((count): Leaf => [`${path}(${count})`, String((value as (...args: number[]) => unknown)(count, count))])
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) => leavesOf(inner, `${path}.${key}`))
}

test('every English word differs from its Portuguese counterpart wherever the Portuguese is Portuguese', () => {
  const english = new Map(leavesOf(en, 'words'))
  const portuguese = leavesOf(ptBr, 'words')

  expect(portuguese.length).toBe(english.size)

  const untranslated = portuguese.filter(([path, text]) => {
    const key = path.split('.')[1]?.replace(/\(\d\)$/, '') ?? ''

    return english.get(path) === text && PORTUGUESE_ONLY.test(text) && !EQUAL_BY_NATURE.includes(key)
  })

  expect(untranslated).toEqual([])
})

test('the allow-listed entries are the only ones that match their Portuguese counterpart', () => {
  const english = new Map(leavesOf(en, 'words'))
  const equal = leavesOf(ptBr, 'words')
    .filter(([path, text]) => english.get(path) === text)
    .map(([path]) => path.split('.')[1]?.replace(/\(\d\)$/, '') ?? '')

  expect([...new Set(equal)].sort()).toEqual([...EQUAL_BY_NATURE].sort())
})
