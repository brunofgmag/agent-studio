import type { On, SessionSendResult } from 'claude-code'
import { type Engine, expect, mock, test } from 'claude-code/testing'

import { type PaneElements, type PaneHost, createPane, isAutoModeRefusal, relayRequest } from '../hooks/ui/pane'
import type { OtherSession, SessionEntry, SubagentLine } from '../types'

type Surface = 'terminal' | 'desktop'

type Answer = { kind: 'result'; result: SessionSendResult } | { kind: 'throw'; message: string }

type Stage = {
  store: Map<string, unknown>
  toasts: string[]
  sends: { to: unknown; text: string }[]
  prompts: { text: string; origin: unknown }[]
  panes: { id: string; title: string }[]
  answer: Answer
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

const AUTO_REFUSAL = 'The server-side auto mode classifier gave no verdict for SendMessage'

const DELIVERED: Answer = { kind: 'result', result: { isDelivered: true } }

const refused = (reason: string): Answer => ({ kind: 'result', result: { isDelivered: false, reason } })

const TRICKY = 'Diga "olá": it\'s a `test`\n\nsegunda linha com ação e {chaves}\n  recuo'

const STATUS_REQUEST = 'Responda em uma linha o que você está fazendo agora.'

const peer = (over: Partial<SessionEntry> = {}): SessionEntry => ({
  cwd: 'C:/work/api',
  repo: null,
  agent: 'architect',
  model: null,
  state: 'working',
  turnStartedAt: null,
  subagents: [],
  updatedAt: NOW,
  ...over,
})

const stage = (on: On, answer: Answer = DELIVERED): Stage => {
  const world: Stage = {
    store: new Map<string, unknown>([['sess:peer-1', peer()]]),
    toasts: [],
    sends: [],
    prompts: [],
    panes: [],
    answer,
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
    world.panes = [{ id: e.id, title: e.title ?? e.id }]

    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
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
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.run', () => ({ text: 'bottom answered' }))
  on('classic.SessionStart', () => ({}))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('prompt.compose', () => ({ sections: [] }))
  on('agent.spawn', (_$, e) => ({ model: SESSION_MODEL, agentId: `agent-${e.subagentType}` }))
  on('agent.list', () => ({ value: [] }))
  on('session.send', (_$, e) => {
    world.sends.push({ to: e.to, text: e.text })

    if (world.answer.kind === 'throw') {
      throw new Error(world.answer.message)
    }

    return world.answer.result
  })
  on('prompt.submit', (_$, e) => {
    world.prompts.push({ text: e.text, origin: e.origin })

    return { text: e.text }
  })

  return world
}

const begin = ($: Engine) => $.session.start({ cwd: PROJECT, surface: null, isInteractive: true })

const agentes = async ($: Engine, args = '') =>
  (
    await $.command.run({
      command: 'agentes',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })
  ).text ?? ''

const spawn = ($: Engine) =>
  $.agent.spawn({
    prompt: 'Read every log and report.',
    description: 'read the logs',
    subagentType: 'Explore',
    background: false,
  } as never)

const mountPane = ($: Engine, surface: Surface) =>
  $.ui.mount({ plugin: 'agent-studio', surface, component: 'Pane', requestId: 'agent-studio', props: PANE_PROPS })

type Mounted = Awaited<ReturnType<typeof mountPane>>

const subagentDetail = async ($: Engine, surface: Surface) => {
  await begin($)
  await spawn($)
  await agentes($)

  const ui = await mountPane($, surface)

  await ui.press({ key: 'sub-agent-Explore' })

  return ui
}

const sessionDetail = async ($: Engine, surface: Surface) => {
  await begin($)
  await agentes($, 'sessoes')

  const ui = await mountPane($, surface)

  await ui.press({ key: 'sess-peer-1' })

  return ui
}

const typeMessage = (ui: Mounted, text: string, key = 'message-0') => ui.input({ key, text })

const eachSurface = (name: string, body: (surface: Surface, $: Engine, on: On) => Promise<void>) => {
  for (const surface of SURFACES) {
    test(`${name} [${surface}]`, ($, on) => body(surface, $, on))
  }
}

const RELAY_TO_SUBAGENT = [
  'Send a message with the SendMessage tool to the subagent whose agent id is agent-Explore.',
  'The message is the text between the two marker lines.',
  '--- message start ---',
  TRICKY,
  '--- message end ---',
].join('\n')

const RELAY_TO_SESSION = [
  'Send a message with the SendMessage tool to the session whose id is peer-1.',
  'The message is the text between the two marker lines.',
  '--- message start ---',
  TRICKY,
  '--- message end ---',
].join('\n')

eachSurface('a subagent detail has a message field and no Status button, and the list has neither', async (surface, $, on) => {
  stage(on)
  await begin($)
  await spawn($)
  await agentes($)

  const ui = await mountPane($, surface)

  expect(await ui.find({ key: 'message-0' })).toBeUndefined()
  expect(await ui.find({ key: 'status' })).toBeUndefined()

  await ui.press({ key: 'sub-agent-Explore' })

  const field = await ui.find({ key: 'message-0' })

  expect(field?.type).toBe('Input')
  expect(field?.props.placeholder).toBe('Mensagem para este subagente')
  expect(field?.props.submitLabel).toBe('enviar')
  expect(await ui.find({ key: 'status' })).toBeUndefined()
  await ui.unmount()
})

eachSurface('a session detail has a message field and a Status button, and the list has neither', async (surface, $, on) => {
  stage(on)
  await begin($)
  await agentes($, 'sessoes')

  const ui = await mountPane($, surface)

  expect(await ui.find({ key: 'message-0' })).toBeUndefined()
  expect(await ui.find({ key: 'status' })).toBeUndefined()

  await ui.press({ key: 'sess-peer-1' })

  const field = await ui.find({ key: 'message-0' })

  expect(field?.type).toBe('Input')
  expect(field?.props.placeholder).toBe('Mensagem para esta sessão')
  expect((await ui.find({ key: 'status' }))?.text).toBe('Status')
  await ui.unmount()
})

eachSurface('the message typed in a subagent detail goes to that subagent by its agent id', async (surface, $, on) => {
  const world = stage(on)
  const ui = await subagentDetail($, surface)

  await typeMessage(ui, 'check the logs')

  expect(world.sends).toEqual([{ to: 'agent-Explore', text: 'check the logs' }])
  await ui.unmount()
})

eachSurface('the message typed in a session detail goes to that session by its session id', async (surface, $, on) => {
  const world = stage(on)
  const ui = await sessionDetail($, surface)

  await typeMessage(ui, 'check the logs')

  expect(world.sends).toHaveLength(1)
  expect(world.sends[0]?.text).toBe('check the logs')
  expect(world.sends[0]?.to).toBe('peer-1')
  await ui.unmount()
})

eachSurface('a delivered message toasts the confirmation and submits no prompt, now or later', async (surface, $, on) => {
  const world = stage(on)
  const ui = await subagentDetail($, surface)

  await typeMessage(ui, 'check the logs')
  await world.clock.advance(60_000)

  expect(world.toasts).toEqual(['Mensagem enviada para o subagente Explore.'])
  expect(world.prompts).toEqual([])
  await ui.unmount()
})

eachSurface('the auto mode refusal submits exactly one prompt with the typed text untouched and the subagent as destination', async (surface, $, on) => {
  const world = stage(on, refused(AUTO_REFUSAL))
  const ui = await subagentDetail($, surface)

  await typeMessage(ui, TRICKY)

  expect(world.sends).toEqual([{ to: 'agent-Explore', text: TRICKY }])
  expect(world.prompts).toEqual([])

  await world.clock.advance(0)

  expect(world.prompts).toHaveLength(1)
  expect(world.prompts[0]?.text).toBe(RELAY_TO_SUBAGENT)
  expect(world.prompts[0]?.origin).toEqual({ kind: 'plugin', name: 'agent-studio' })
  expect(world.toasts).toEqual(['O modo auto recusou o envio direto. A mensagem para o subagente Explore virou um pedido na conversa.'])

  await world.clock.advance(60_000)

  expect(world.prompts).toHaveLength(1)
  await ui.unmount()
})

eachSurface('the auto mode refusal in a session detail names the session as destination', async (surface, $, on) => {
  const world = stage(on, refused(AUTO_REFUSAL))
  const ui = await sessionDetail($, surface)

  await typeMessage(ui, TRICKY)
  await world.clock.advance(0)

  expect(world.prompts.map(({ text }) => text)).toEqual([RELAY_TO_SESSION])
  expect(world.toasts).toEqual(['O modo auto recusou o envio direto. A mensagem para a sessão em C:/work/api virou um pedido na conversa.'])
  await ui.unmount()
})

eachSurface('the text goes to session.send exactly as typed, spaces and line breaks included', async (surface, $, on) => {
  const world = stage(on)
  const ui = await subagentDetail($, surface)

  await typeMessage(ui, `  ${TRICKY}\n `)

  expect(world.sends.map(({ text }) => text)).toEqual([`  ${TRICKY}\n `])
  await ui.unmount()
})

for (const reason of [
  'No agent is running with that id',
  'The recipient is gone',
  'blocked by a hook',
  'auto mode',
  'classifier gave no verdict',
]) {
  eachSurface(`a refusal that is not the auto mode one (${reason}) toasts the reason and submits no prompt`, async (surface, $, on) => {
    const world = stage(on, refused(reason))
    const ui = await subagentDetail($, surface)

    await typeMessage(ui, 'check the logs')
    await world.clock.advance(60_000)

    expect(world.toasts).toEqual([`Não foi possível enviar a mensagem para o subagente Explore: ${reason}`])
    expect(world.prompts).toEqual([])
    await ui.unmount()
  })
}

eachSurface('a send the engine rejects toasts a reason and submits no prompt', async (surface, $, on) => {
  const world = stage(on, { kind: 'throw', message: 'socket closed' })
  const ui = await subagentDetail($, surface)

  await typeMessage(ui, 'check the logs')
  await world.clock.advance(60_000)

  expect(world.toasts).toHaveLength(1)
  expect(world.toasts[0]?.startsWith('Não foi possível enviar a mensagem para o subagente Explore: ')).toBe(true)
  expect(world.prompts).toEqual([])
  await ui.unmount()
})

eachSurface('an empty or blank field sends nothing, toasts nothing and submits nothing', async (surface, $, on) => {
  const world = stage(on, refused(AUTO_REFUSAL))
  const ui = await subagentDetail($, surface)

  for (const text of ['', ' ', '   \n\t ']) {
    await typeMessage(ui, text)
  }

  await world.clock.advance(60_000)

  expect(world.sends).toEqual([])
  expect(world.toasts).toEqual([])
  expect(world.prompts).toEqual([])
  await ui.unmount()
})

eachSurface('Status sends the ready message to the session that is open', async (surface, $, on) => {
  const world = stage(on)
  const ui = await sessionDetail($, surface)

  await ui.press({ key: 'status' })

  expect(world.sends).toHaveLength(1)
  expect(world.sends[0]?.text).toBe(STATUS_REQUEST)
  expect(world.sends[0]?.to).toBe('peer-1')
  expect(world.toasts).toEqual(['Mensagem enviada para a sessão em C:/work/api.'])
  expect(world.prompts).toEqual([])
  await ui.unmount()
})

eachSurface('Status takes the same three outcomes as a typed message', async (surface, $, on) => {
  const world = stage(on, refused(AUTO_REFUSAL))
  const ui = await sessionDetail($, surface)

  await ui.press({ key: 'status' })
  await world.clock.advance(0)

  expect(world.prompts).toHaveLength(1)
  expect(world.prompts[0]?.text).toContain('the session whose id is peer-1')
  expect(world.prompts[0]?.text).toContain(`--- message start ---\n${STATUS_REQUEST}\n--- message end ---`)

  world.answer = refused('The recipient is gone')
  world.toasts.length = 0
  await ui.press({ key: 'status' })
  await world.clock.advance(60_000)

  expect(world.toasts).toEqual(['Não foi possível enviar a mensagem para a sessão em C:/work/api: The recipient is gone'])
  expect(world.prompts).toHaveLength(1)
  await ui.unmount()
})

eachSurface('one click makes at most one send and one prompt, with no retry and no timer', async (surface, $, on) => {
  const world = stage(on, refused(AUTO_REFUSAL))
  const ui = await subagentDetail($, surface)

  await typeMessage(ui, 'first')
  await world.clock.advance(0)
  await typeMessage(ui, 'second', 'message-1')
  await world.clock.advance(0)
  await world.clock.advance(120_000)

  expect(world.sends.map(({ text }) => text)).toEqual(['first', 'second'])
  expect(world.prompts).toHaveLength(2)
  expect(world.toasts).toHaveLength(2)
  await ui.unmount()
})

eachSurface('two failed sends make two toasts and no prompt', async (surface, $, on) => {
  const world = stage(on, refused('The recipient is gone'))
  const ui = await subagentDetail($, surface)

  await typeMessage(ui, 'first')
  await typeMessage(ui, 'second')
  await world.clock.advance(120_000)

  expect(world.sends).toHaveLength(2)
  expect(world.toasts).toHaveLength(2)
  expect(world.prompts).toEqual([])
  await ui.unmount()
})

test('a surface with no Input draws the session detail with Status and without a message field', async ($, on) => {
  const world = stage(on)

  await begin($)
  await agentes($, 'sessoes')

  const ui = await $.ui.mount({
    plugin: 'agent-studio',
    surface: 'mobile',
    component: 'Pane',
    requestId: 'agent-studio',
    props: PANE_PROPS,
  })

  await ui.press({ key: 'sess-peer-1' })

  expect(await ui.find({ key: 'message-0' })).toBeUndefined()

  await ui.press({ key: 'status' })

  expect(world.sends).toHaveLength(1)
  await ui.unmount()
})

test('only a reason that names the auto mode classifier is the auto mode refusal, in any letter case', () => {
  expect(isAutoModeRefusal(AUTO_REFUSAL)).toBe(true)
  expect(isAutoModeRefusal('AUTO MODE CLASSIFIER unavailable')).toBe(true)
  expect(isAutoModeRefusal('the Auto Mode Classifier said no')).toBe(true)
  expect(isAutoModeRefusal('auto mode')).toBe(false)
  expect(isAutoModeRefusal('classifier')).toBe(false)
  expect(isAutoModeRefusal('')).toBe(false)
  expect(isAutoModeRefusal('The recipient is gone')).toBe(false)
})

test('the relay prompt carries the destination, SendMessage and the whole text between two marker lines, and nothing else', () => {
  expect(relayRequest({ agentId: 'a-1' }, TRICKY)).toBe(
    [
      'Send a message with the SendMessage tool to the subagent whose agent id is a-1.',
      'The message is the text between the two marker lines.',
      '--- message start ---',
      TRICKY,
      '--- message end ---',
    ].join('\n'),
  )
  expect(relayRequest({ sessionId: 's-9' }, 'hi').split('\n')[0]).toBe(
    'Send a message with the SendMessage tool to the session whose id is s-9.',
  )
})

type Node = { type?: string; props?: { key?: string; onPress?: () => unknown; onSubmit?: (text: string) => unknown }; children?: unknown }

const leaf = (type: string) => (props: Record<string, unknown>) => ({ type, props, children: props.children })

const FAKE_ELEMENTS = {
  Box: leaf('Box'),
  Text: leaf('Text'),
  Button: leaf('Button'),
  Markdown: leaf('Markdown'),
  Input: leaf('Input'),
} as unknown as PaneElements

const nodeKeyed = (tree: unknown, key: string): Node | undefined => {
  if (Array.isArray(tree)) {
    return tree.map(child => nodeKeyed(child, key)).find(found => found !== undefined)
  }

  if (typeof tree !== 'object' || tree === null) {
    return undefined
  }

  const node = tree as Node

  return node.props?.key === key ? node : nodeKeyed(node.children, key)
}

test('a send that throws with the auto mode wording in its message is still no refusal to relay: toast, no prompt', async () => {
  const toasts: string[] = []
  const prompts: string[] = []
  const session: OtherSession = { ...peer(), sessionId: 'peer-1', presence: 'trabalhando' }
  const host: PaneHost = {
    surfaces: async () => ['terminal'],
    open: async () => ({ isPlaced: true }),
    close: async () => undefined,
    panes: async () => [{ id: 'agent-studio', title: 'Agentes', isShown: true, isFocused: true, isPlaced: true }],
    invalidate: () => undefined,
    focus: async () => true,
    toast: text => {
      toasts.push(text)
    },
    stopTask: async () => ({ isStopped: false, text: '' }),
    send: async () => {
      throw new Error(AUTO_REFUSAL)
    },
    submit: text => {
      prompts.push(text)
    },
    clock: { now: async () => NOW, after: () => ({ cancel: () => undefined }), every: () => ({ cancel: () => undefined }) },
  }
  const pane = createPane({
    lines: () => [],
    agentInForce: () => null,
    checkAgainstEngine: async () => undefined,
    lastOthers: () => [session],
    readOthers: async () => undefined,
    sent: () => undefined,
  })

  await pane.command(host, 'sessoes', async () => '')
  await nodeKeyed(await pane.render(host, FAKE_ELEMENTS, FOCUSED), 'sess-peer-1')?.props?.onPress?.()
  await nodeKeyed(await pane.render(host, FAKE_ELEMENTS, FOCUSED), 'message-0')?.props?.onSubmit?.('hello')

  expect(prompts).toEqual([])
  expect(toasts).toEqual([`Não foi possível enviar a mensagem para a sessão em C:/work/api: ${AUTO_REFUSAL}`])
})

const FOCUSED = { columns: 80, isFocused: true }

const UNFOCUSED = { columns: 80, isFocused: false }

const focusStage = (denied: readonly string[] = []) => {
  const focused: string[] = []
  const session: OtherSession = { ...peer(), sessionId: 'peer-1', presence: 'trabalhando' }
  const line: SubagentLine = {
    id: 'sub-1',
    type: 'Explore',
    task: 'read the logs',
    prompt: '',
    model: null,
    parentId: null,
    background: false,
    status: 'running',
    tool: null,
    tokens: 0,
    startedAt: NOW,
    endedAt: null,
    durationMs: null,
    answer: '',
    exchanges: [],
    depth: 0,
  }
  const host: PaneHost = {
    surfaces: async () => ['terminal'],
    open: async () => ({ isPlaced: true }),
    close: async () => undefined,
    panes: async () => [],
    invalidate: () => undefined,
    focus: async key => {
      focused.push(key)

      return !denied.includes(key)
    },
    toast: () => undefined,
    stopTask: async () => ({ isStopped: false, text: '' }),
    send: async () => ({ isDelivered: true }),
    submit: () => undefined,
    clock: { now: async () => NOW, after: () => ({ cancel: () => undefined }), every: () => ({ cancel: () => undefined }) },
  }
  const pane = createPane({
    lines: () => [line],
    agentInForce: () => null,
    checkAgainstEngine: async () => undefined,
    lastOthers: () => [session],
    readOthers: async () => undefined,
    sent: () => undefined,
  })
  const press = async (key: string) => {
    await nodeKeyed(await pane.render(host, FAKE_ELEMENTS, FOCUSED), key)?.props?.onPress?.()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  }

  return { host, pane, press, focused }
}

test('a press that changes the view moves the focus ring onto the back button, and back onto the row it left', async () => {
  const { host, pane, press, focused } = focusStage()

  await pane.command(host, '', async () => '')
  await press('sub-sub-1')
  await press('back')
  await press('tab-2')
  await press('sess-peer-1')
  await press('back')

  expect(focused).toEqual(['back', 'sub-sub-1', 'back', 'sess-peer-1'])
})

test('going back to a list whose row cannot take the focus ring moves it onto the tab', async () => {
  const { host, pane, press, focused } = focusStage(['sub-sub-1', 'sess-peer-1'])

  await pane.command(host, '', async () => '')
  await press('sub-sub-1')
  await press('back')
  await press('tab-2')
  await press('sess-peer-1')
  await press('back')

  expect(focused).toEqual(['back', 'sub-sub-1', 'tab-1', 'back', 'sess-peer-1', 'tab-2'])
})

test('a click that only hands the keyboard to the pane presses the button it landed on', async () => {
  const { host, pane } = focusStage()

  await pane.command(host, '', async () => '')
  await pane.render(host, FAKE_ELEMENTS, UNFOCUSED)
  pane.takeover('tab-2', 'person')?.()
  await Promise.resolve()

  expect(nodeKeyed(await pane.render(host, FAKE_ELEMENTS, FOCUSED), 'sess-peer-1')).toBeDefined()
})

test('a focus move is no press while the pane holds the keyboard, when a plugin moves it, with no element or with an unknown one', async () => {
  const { host, pane } = focusStage()

  await pane.command(host, '', async () => '')
  await pane.render(host, FAKE_ELEMENTS, FOCUSED)

  expect(pane.takeover('tab-2', 'person')).toBeUndefined()

  await pane.render(host, FAKE_ELEMENTS, UNFOCUSED)

  expect(pane.takeover('tab-2', 'plugin')).toBeUndefined()
  expect(pane.takeover(undefined, 'person')).toBeUndefined()
  expect(pane.takeover('gone', 'person')).toBeUndefined()
  expect(pane.takeover('tab-2', 'person')).toBeDefined()
})

const complete = ($: Engine, agentId: string, answer: string) =>
  $.turn.complete({ turnId: 't1', answer, durationMs: 1, isAborted: false, reason: 'answer', agentId } as never)

const openedSubagent = async ($: Engine, surface: Surface, answers: readonly string[] = []) => {
  await begin($)
  await spawn($)

  for (const answer of answers) {
    await complete($, 'agent-Explore', answer)
  }

  await agentes($)

  const ui = await mountPane($, surface)

  await ui.press({ key: 'sub-agent-Explore' })

  return ui
}

const conversationOf = async (ui: Mounted) =>
  (await ui.findAll({})).flatMap(element => {
    if (element.type === 'Markdown') {
      return [`[${element.text}]`]
    }

    return element.type === 'Text' && element.text.startsWith('Você: ') ? [element.text] : []
  })

eachSurface('a delivered message shows as Você under the last answer, and the field is drawn again with the next key', async (surface, $, on) => {
  stage(on)

  const ui = await openedSubagent($, surface, ['first answer'])

  expect(await conversationOf(ui)).toEqual(['[first answer]'])
  expect((await ui.find({ key: 'message-0' }))?.type).toBe('Input')

  await typeMessage(ui, 'and the tests?')

  expect(await conversationOf(ui)).toEqual(['[first answer]', 'Você: and the tests?'])
  expect(await ui.find({ key: 'message-0' })).toBeUndefined()
  expect((await ui.find({ key: 'message-1' }))?.type).toBe('Input')
  expect((await ui.find({ type: 'Text', text: 'Você: and the tests?' }))?.props.dimColor).toBe(true)
  await ui.unmount()
})

eachSurface('the field key keeps counting past the 20 exchanges the monitor keeps', async (surface, $, on) => {
  stage(on)

  const ui = await openedSubagent($, surface)

  for (let index = 0; index < 22; index += 1) {
    await typeMessage(ui, `message ${index}`, `message-${index}`)
  }

  expect((await ui.find({ key: 'message-22' }))?.type).toBe('Input')
  expect((await conversationOf(ui)).length).toBe(20)
  await ui.unmount()
})

eachSurface('a message relayed because of the auto mode is recorded and moves the field key, and a refused one is not', async (surface, $, on) => {
  const world = stage(on, refused(AUTO_REFUSAL))
  const ui = await openedSubagent($, surface)

  await typeMessage(ui, 'relayed one')
  await world.clock.advance(0)

  expect(await conversationOf(ui)).toEqual(['Você: relayed one'])
  expect((await ui.find({ key: 'message-1' }))?.type).toBe('Input')

  world.answer = refused('The recipient is gone')
  await typeMessage(ui, 'refused one', 'message-1')

  expect(await conversationOf(ui)).toEqual(['Você: relayed one'])
  expect(await ui.find({ key: 'message-2' })).toBeUndefined()
  expect((await ui.find({ key: 'message-1' }))?.type).toBe('Input')

  world.answer = { kind: 'throw', message: 'socket closed' }
  await typeMessage(ui, 'thrown one', 'message-1')

  expect(await conversationOf(ui)).toEqual(['Você: relayed one'])
  expect((await ui.find({ key: 'message-1' }))?.type).toBe('Input')
  await ui.unmount()
})

eachSurface('messages typed in a session detail are recorded nowhere and its field key stays message-0', async (surface, $, on) => {
  stage(on)
  await begin($)
  await spawn($)
  await agentes($, 'sessoes')

  const ui = await mountPane($, surface)

  await ui.press({ key: 'sess-peer-1' })
  await typeMessage(ui, 'to the session')
  await ui.press({ key: 'status' })

  expect((await ui.find({ key: 'message-0' }))?.type).toBe('Input')
  expect(await ui.find({ key: 'message-1' })).toBeUndefined()

  await ui.press({ key: 'back' })
  await ui.press({ key: 'tab-1' })
  await ui.press({ key: 'sub-agent-Explore' })

  expect(await conversationOf(ui)).toEqual([])
  expect((await ui.find({ key: 'message-0' }))?.type).toBe('Input')
  await ui.unmount()
})

eachSurface('sent messages after the last answer stay under it, and the earlier ones sit behind the toggle with the answers', async (surface, $, on) => {
  stage(on)

  const ui = await openedSubagent($, surface, ['answer one'])

  await typeMessage(ui, 'ask two')
  await complete($, 'agent-Explore', 'answer two')
  await ui.redraw()
  await typeMessage(ui, 'ask three', 'message-1')

  expect(await conversationOf(ui)).toEqual(['[answer two]', 'Você: ask three'])
  expect((await ui.find({ key: 'toggle-earlier' }))?.text).toBe('Respostas anteriores (1)')

  await ui.press({ key: 'toggle-earlier' })

  expect(await conversationOf(ui)).toEqual(['[answer one]', 'Você: ask two', '[answer two]', 'Você: ask three'])
  await ui.unmount()
})

eachSurface('with only sent messages before the answer the toggle counts messages', async (surface, $, on) => {
  stage(on)

  const ui = await openedSubagent($, surface)

  await typeMessage(ui, 'hello there')

  expect(await ui.find({ key: 'toggle-earlier' })).toBeUndefined()
  expect(await conversationOf(ui)).toEqual(['Você: hello there'])
  expect((await ui.find({ type: 'Text', text: 'Sem resposta ainda.' }))?.props.dimColor).toBe(true)

  await complete($, 'agent-Explore', 'hi back')
  await ui.redraw()

  expect((await ui.find({ key: 'toggle-earlier' }))?.text).toBe('Mensagens anteriores (1)')
  expect(await conversationOf(ui)).toEqual(['[hi back]'])

  await ui.press({ key: 'toggle-earlier' })

  expect(await conversationOf(ui)).toEqual(['Você: hello there', '[hi back]'])
  await ui.unmount()
})

const SENT_LINE: SubagentLine = {
  id: 'sub-1',
  type: 'Explore',
  task: 'read the logs',
  prompt: 'Read every log.',
  model: null,
  parentId: null,
  background: false,
  status: 'completed',
  tool: null,
  tokens: 0,
  startedAt: NOW,
  endedAt: NOW,
  durationMs: 0,
  answer: '',
  exchanges: [],
  depth: 0,
}

const recordingStage = (send: PaneHost['send'], line: SubagentLine = SENT_LINE) => {
  const recorded: { agentId: string; text: string; at: number }[] = []
  const session: OtherSession = { ...peer(), sessionId: 'peer-1', presence: 'trabalhando' }
  const host: PaneHost = {
    surfaces: async () => ['terminal'],
    open: async () => ({ isPlaced: true }),
    close: async () => undefined,
    panes: async () => [],
    invalidate: () => undefined,
    focus: async () => true,
    toast: () => undefined,
    stopTask: async () => ({ isStopped: false, text: '' }),
    send,
    submit: () => undefined,
    clock: { now: async () => NOW + 7, after: () => ({ cancel: () => undefined }), every: () => ({ cancel: () => undefined }) },
  }
  const pane = createPane({
    lines: () => [line],
    agentInForce: () => null,
    checkAgainstEngine: async () => undefined,
    lastOthers: () => [session],
    readOthers: async () => undefined,
    sent: (agentId, text, at) => {
      recorded.push({ agentId, text, at })
    },
  })
  const press = async (key: string) => {
    await nodeKeyed(await pane.render(host, FAKE_ELEMENTS, FOCUSED), key)?.props?.onPress?.()
  }
  const submit = async (key: string, text: string) => {
    await nodeKeyed(await pane.render(host, FAKE_ELEMENTS, FOCUSED), key)?.props?.onSubmit?.(text)
  }

  return { pane, host, press, submit, recorded }
}

test('the pane tells the monitor about a delivered and a relayed message to a subagent, with the instant, and about no refused or thrown one', async () => {
  let answer: () => Promise<SessionSendResult> = async () => ({ isDelivered: true })
  const { pane, host, press, submit, recorded } = recordingStage(() => answer())

  await pane.command(host, '', async () => '')
  await press('sub-sub-1')
  await submit('message-0', 'delivered one')

  answer = async () => ({ isDelivered: false, reason: AUTO_REFUSAL })
  await submit('message-1', 'relayed one')

  answer = async () => ({ isDelivered: false, reason: 'The recipient is gone' })
  await submit('message-2', 'refused one')

  answer = async () => {
    throw new Error('socket closed')
  }
  await submit('message-2', 'thrown one')
  await submit('message-2', '   ')

  expect(recorded).toEqual([
    { agentId: 'sub-1', text: 'delivered one', at: NOW + 7 },
    { agentId: 'sub-1', text: 'relayed one', at: NOW + 7 },
  ])
})

test('the pane tells the monitor about nothing that is sent from a session detail, a message or a Status', async () => {
  const { pane, host, press, submit, recorded } = recordingStage(async () => ({ isDelivered: true }))

  await pane.command(host, 'sessoes', async () => '')
  await press('sess-peer-1')
  await submit('message-0', 'to the session')
  await press('status')

  expect(recorded).toEqual([])
})

const textsOf = (tree: unknown): string[] => {
  if (typeof tree === 'string') {
    return [tree]
  }

  if (Array.isArray(tree)) {
    return tree.flatMap(textsOf)
  }

  return typeof tree === 'object' && tree !== null ? textsOf((tree as Node).children) : []
}

test('the model line is drawn when the subagent has a model and left out when it has none', async () => {
  const draw = async (line: SubagentLine) => {
    const { pane, host, press } = recordingStage(async () => ({ isDelivered: true }), line)

    await pane.command(host, '', async () => '')
    await press('sub-sub-1')

    return textsOf(await pane.render(host, FAKE_ELEMENTS, FOCUSED))
  }

  expect(await draw({ ...SENT_LINE, model: 'claude-haiku-5-5' })).toContain('claude-haiku-5-5')
  expect(await draw(SENT_LINE)).not.toContain('claude-haiku-5-5')
  expect(await draw(SENT_LINE)).not.toContain('')
})

const parentOf = (tree: unknown, key: string): Node | undefined => {
  if (Array.isArray(tree)) {
    return tree.map(child => parentOf(child, key)).find(found => found !== undefined)
  }

  if (typeof tree !== 'object' || tree === null) {
    return undefined
  }

  const node = tree as Node
  const children = Array.isArray(node.children) ? node.children : [node.children]

  return children.some(child => (child as Node | null)?.props?.key === key) ? node : parentOf(node.children, key)
}

test('the action buttons of a detail sit one cell apart, in a subagent and in another session', async () => {
  const { host, pane, press } = focusStage()

  await pane.command(host, '', async () => '')
  await press('sub-sub-1')

  expect((parentOf(await pane.render(host, FAKE_ELEMENTS, FOCUSED), 'back')?.props as { gap?: number }).gap).toBe(1)

  await press('back')
  await press('tab-2')
  await press('sess-peer-1')

  expect((parentOf(await pane.render(host, FAKE_ELEMENTS, FOCUSED), 'back')?.props as { gap?: number }).gap).toBe(1)
})

test('the tab row leaves one row above it, so the focus ring of a tab is not cut by the top of the pane', async () => {
  const { host, pane } = focusStage()

  await pane.command(host, '', async () => '')

  expect((parentOf(await pane.render(host, FAKE_ELEMENTS, FOCUSED), 'tab-1')?.props as { marginTop?: number }).marginTop).toBe(1)
})
