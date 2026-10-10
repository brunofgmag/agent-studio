import type { AgentInfo, On, TurnUsage, UiOpenResult } from 'claude-code'
import { type Engine, type Plugin, expect, mock } from 'claude-code/testing'

import type { SessionEntry } from '../types'
import { test } from './in-portuguese'
import { clockPropsOf, metaOfRow } from './ticking-kit'

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
  idleSince: NOW,
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

const agentPanel = ($: Engine, args = '') => run($, 'agent-panel', args)

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

const complete = ($: Engine, agentId: string, answer: string, durationMs = 2400, used = usage(2000, 500)) =>
  $.turn.complete({
    turnId: 't1',
    answer,
    durationMs,
    isAborted: false,
    reason: 'answer',
    agentId,
    usage: used,
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

const LINE_ONE = '✓ general-purpose concluído · 0:02 · 2.5k'

type Mounted = Awaited<ReturnType<typeof mountPane>>

type RowFacts = {
  key: string
  mark: string
  color: unknown
  name: string
  isNameDim: unknown
  meta: string
  description: string
}

const rowFacts = async (ui: Mounted): Promise<RowFacts[]> => {
  const columns = (await ui.findAll({ type: 'Box' })).map(box => box.children)

  return columns.flatMap(column => {
    const [rowBox, descriptionBox] = column as { children?: unknown[] }[]
    const [mark, name] = (rowBox?.children ?? []) as { type?: string; props?: Record<string, unknown>; children?: unknown[] }[]
    const description = (descriptionBox?.children?.[0] as { children?: string[] } | undefined)?.children?.join('')

    return column.length !== 2 ||
      mark?.type !== 'Text' ||
      mark.props?.color === undefined ||
      name?.type !== 'Button' ||
      description === undefined
      ? []
      : [
          {
            key: String(name.props?.key),
            mark: String(mark.children?.join('')),
            color: mark.props.color,
            name: String(name.props?.label),
            isNameDim: name.props?.dimColor,
            meta: metaOfRow(rowBox?.children ?? [], NOW),
            description,
          },
        ]
  })
}

const rowLines = async (ui: Mounted): Promise<Record<string, string>> =>
  Object.fromEntries((await rowFacts(ui)).map(row => [row.key, `${row.mark} ${row.name} ${row.meta}`]))

const GROUP_HEADING = /^(Abertas|Encerradas|Em andamento|Terminados) \(\d+\)$/

const groupMargins = async (ui: Mounted): Promise<unknown[]> =>
  (await ui.findAll({ type: 'Box' })).flatMap(box => {
    const first = box.children[0] as { type?: string; children?: unknown[] } | undefined

    return first?.type === 'Text' && GROUP_HEADING.test(String(first.children?.[0])) ? [box.props.marginTop] : []
  })

const listing = async (ui: Mounted): Promise<string[]> => {
  const rowKeys = new Set((await rowFacts(ui)).map(row => row.key))

  return (await ui.findAll({})).flatMap(element => {
    const isHeading = element.type === 'Text' && GROUP_HEADING.test(element.text)
    const isName = element.type === 'Button' && rowKeys.has(String(element.key))

    return isHeading || isName ? [element.text] : []
  })
}

eachSurface('/agent-panel opens the panel with focus and Esc to close, and answers with one sentence', async (surface, $, on) => {
  const world = stage(on, surface)
  await begin($)

  expect(await agentPanel($)).toBe('Painel de agentes aberto.')
  expect(world.opens).toEqual([{ id: 'agent-studio', title: 'Agentes', focus: true, closeOnEscape: true }])
  expect(world.panes).toEqual([{ id: 'agent-studio', title: 'Agentes' }])
})

eachSurface('the three tab buttons carry the digits as hotkeys and switch the tab', async (surface, $, on) => {
  stage(on, surface)
  await begin($)
  await agentPanel($)

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
  expect((await ui.find({ key: 'use-worker' }))?.text).toBe('Usar')

  await ui.press({ key: 'tab-1' })

  expect((await ui.find({ type: 'Text', text: 'Nenhum subagente nesta sessão.' }))?.type).toBe('Text')
  await ui.unmount()
})

eachSurface('the rule under the tabs is cut at the edge of the body and never wraps to a second row', async (surface, $, on) => {
  stage(on, surface)
  await begin($)
  await agentPanel($)

  const ui = await mountPane($, surface)
  const rule = await ui.find({ type: 'Text', text: '─'.repeat(PANE_PROPS.bodyColumns - 2) })

  expect(rule?.props.wrap).toBe('truncate')
  await ui.unmount()
})

const tabButtons = async (ui: Mounted) => (await ui.findAll({ type: 'Button' })).filter(button => /^tab-\d$/.test(button.key ?? ''))

eachSurface('each tab is a button of the app with no plain and no box around it, the active one bright and the others dim, in a row with a gap of 1', async (surface, $, on) => {
  stage(on, surface)
  await begin($)
  await agentPanel($)

  const ui = await mountPane($, surface)
  const buttons = await tabButtons(ui)

  expect(buttons.map(button => button.key)).toEqual(['tab-1', 'tab-2', 'tab-3'])
  expect(buttons.map(button => button.props.plain)).toEqual([undefined, undefined, undefined])
  expect(buttons.map(button => button.props.hotkey)).toEqual(['1', '2', '3'])
  expect(buttons.map(button => button.props.dimColor === true)).toEqual([false, true, true])

  const row = (await ui.findAll({ type: 'Box' })).find(box => box.children.length === 3 && box.children.every(child => (child as { type?: string }).type === 'Button'))

  expect(row?.props.flexDirection).toBe('row')
  expect(row?.props.gap).toBe(1)
  expect((await ui.findAll({ type: 'Box' })).filter(box => box.props.borderStyle === 'round')).toEqual([])

  await ui.press({ key: 'tab-3' })

  expect((await tabButtons(ui)).map(button => button.props.dimColor === true)).toEqual([true, true, false])
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
  await agentPanel($)

  const ui = await mountPane($, surface)
  const rows = await rowLines(ui)

  expect(Object.entries(rows)).toEqual([
    ['sub-sub-1', '● Explore rodando · 0:00 · 1.5k'],
    ['sub-sub-2', '● general-purpose rodando · 0:00 · 0'],
    ['sub-sub-3', '✓ Plan concluído · 0:02 · 2.5k'],
  ])

  const rowBoxes = (await ui.findAll({ type: 'Box' })).filter(box => box.props.marginTop !== undefined && box.props.paddingLeft !== undefined)

  expect(rowBoxes.map(box => box.props.paddingLeft)).toEqual([0, 2, 0])
  expect(rowBoxes.map(box => box.props.marginTop)).toEqual([1, 1, 1])
  await ui.unmount()
})

eachSurface('tab 1 groups the trees under Em andamento and Terminados, a tree with any running line staying whole in Em andamento, with the second group one line below the first', async (surface, $, on) => {
  stage(on, surface)
  await begin($)
  await spawn($, { description: 'parent', subagentType: 'Explore' })
  await spawn($, { description: 'child', parentAgentId: 'sub-1' })
  await spawn($, { description: 'other root', subagentType: 'Plan' })
  await complete($, 'sub-1', 'parent done')
  await complete($, 'sub-3', 'plan ready')
  await agentPanel($)

  const ui = await mountPane($, surface)

  expect(await listing(ui)).toEqual(['Em andamento (2)', 'Explore', 'general-purpose', 'Terminados (1)', 'Plan'])
  expect(await groupMargins(ui)).toEqual([0, 1])

  const headings = (await ui.findAll({ type: 'Text' })).filter(text => GROUP_HEADING.test(text.text))

  expect(headings.map(text => text.props.dimColor)).toEqual([true, true])

  const rowBoxes = (await ui.findAll({ type: 'Box' })).filter(box => box.props.marginTop !== undefined && box.props.paddingLeft !== undefined)

  expect(rowBoxes.map(box => box.props.paddingLeft)).toEqual([0, 2, 0])
  await ui.unmount()
})

eachSurface('tab 1 draws only the heading of the group that has rows', async (surface, $, on) => {
  stage(on, surface)
  await begin($)
  await spawn($, { description: 'one', subagentType: 'Explore' })
  await spawn($, { description: 'two', subagentType: 'Plan' })
  await agentPanel($)

  const running = await mountPane($, surface)

  expect(await listing(running)).toEqual(['Em andamento (2)', 'Explore', 'Plan'])
  expect(await groupMargins(running)).toEqual([0])
  await running.unmount()

  await complete($, 'sub-1', 'one done')
  await complete($, 'sub-2', 'two done')

  const finished = await mountPane($, surface)

  expect(await listing(finished)).toEqual(['Terminados (2)', 'Explore', 'Plan'])
  expect(await groupMargins(finished)).toEqual([0])
  await finished.unmount()
})

eachSurface('tab 1 opens the detail of a row under either group', async (surface, $, on) => {
  stage(on, surface)
  await begin($)
  await spawn($, { description: 'live one', subagentType: 'Explore' })
  await spawn($, { description: 'done one', subagentType: 'Plan' })
  await complete($, 'sub-2', 'finished')
  await agentPanel($)

  const ui = await mountPane($, surface)

  await ui.press({ key: 'sub-sub-2' })

  expect((await ui.find({ key: 'back' }))?.type).toBe('Button')
  expect(await ui.find({ key: 'stop' })).toBeUndefined()
  await ui.press({ key: 'back' })
  await ui.press({ key: 'sub-sub-1' })

  expect((await ui.find({ key: 'stop' }))?.type).toBe('Button')
  await ui.unmount()
})

eachSurface('tab 1 shows a dim summary under the header that truncates, with the counts by status and the token total, and none when there is no subagent', async (surface, $, on) => {
  stage(on, surface)
  await begin($)
  await agentPanel($)

  const empty = await mountPane($, surface)

  expect(await empty.find({ type: 'Text', text: 'Nenhum subagente nesta sessão.' })).toBeDefined()
  expect((await empty.findAll({ type: 'Text' })).filter(text => text.text.includes('tokens') || text.text === '')).toEqual([])
  await empty.unmount()

  await spawn($, { description: 'parent', subagentType: 'Explore' })
  await spawn($, { description: 'child', parentAgentId: 'sub-1' })
  await spawn($, { description: 'other root', subagentType: 'Plan' })
  await step($, 'sub-1')
  await complete($, 'sub-3', 'plan ready')

  const ui = await mountPane($, surface)
  const summary = await ui.find({ type: 'Text', text: '2 rodando · 1 concluído · 4.0k tokens' })

  expect(summary?.props.dimColor).toBe(true)
  expect(summary?.props.wrap).toBe('truncate')
  expect(await ui.find({ type: 'Text', text: 'Nenhum subagente nesta sessão.' })).toBeUndefined()

  const texts = (await ui.findAll({ type: 'Text' })).map(text => text.text)

  expect(texts.indexOf('Sessão sem agente')).toBeLessThan(texts.indexOf('2 rodando · 1 concluído · 4.0k tokens'))
  expect(texts.indexOf('2 rodando · 1 concluído · 4.0k tokens')).toBeLessThan(texts.indexOf('Em andamento (2)'))
  await ui.unmount()
})

eachSurface('tab 1 rows carry the status glyph in its colour, the type as the name of a plain button outside of which the marks live, the status word and the clock in the meta, and the task as the description', async (surface, $, on) => {
  stage(on, surface)
  await begin($)
  await spawn($, { description: 'running one', subagentType: 'Explore' })
  await spawn($, { description: 'done one', subagentType: 'Plan' })
  await complete($, 'sub-2', 'finished')
  await agentPanel($)

  const ui = await mountPane($, surface)

  expect(await rowFacts(ui)).toEqual([
    { key: 'sub-sub-1', mark: '●', color: 'suggestion', name: 'Explore', isNameDim: false, meta: 'rodando · 0:00 · 0', description: 'running one' },
    { key: 'sub-sub-2', mark: '✓', color: 'success', name: 'Plan', isNameDim: false, meta: 'concluído · 0:02 · 2.5k', description: 'done one' },
  ])

  const shown = ['rodando ·', '· 0', 'running one', 'concluído · 0:02 · 2.5k', 'done one']
  const texts = (await ui.findAll({ type: 'Text' })).filter(text => shown.includes(text.text))
  const names = (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('sub-'))

  expect(texts.map(text => text.text)).toEqual(shown)
  expect(texts.map(text => text.props.wrap)).toEqual(Array(5).fill('truncate'))
  expect((await ui.findAll({ type: 'Client' })).map(client => [client.key, clockPropsOf(client)])).toEqual([
    ['clock-sub-sub-1', { kind: 'elapsed', since: NOW }],
  ])
  expect(names.map(button => [button.key, button.text, button.props.plain])).toEqual([
    ['sub-sub-1', 'Explore', true],
    ['sub-sub-2', 'Plan', true],
  ])

  const indented = (await ui.findAll({ type: 'Box' })).filter(box => box.props.paddingLeft === 2 && box.props.marginTop === undefined)

  expect(indented.map(box => (box.children[0] as { children: string[] }).children)).toEqual([['running one'], ['done one']])
  await ui.unmount()
})

eachSurface('the header names the agent in force or says there is none', async (surface, $, on) => {
  stage(on, surface)
  await begin($)
  await agentPanel($)

  const ui = await mountPane($, surface)

  expect((await ui.find({ type: 'Text', text: 'Sessão sem agente' }))?.type).toBe('Text')
  await ui.unmount()
})

eachSurface('the header names the agent in force with its model and effort', async (surface, $, on) => {
  stage(on, surface)
  await begin($)
  await run($, 'as', 'worker')
  await agentPanel($)

  const ui = await mountPane($, surface)

  expect((await ui.find({ type: 'Text', text: 'Sessão como @worker · claude-opus-5-5[1m] · high' }))?.type).toBe('Text')
  await ui.unmount()
})

eachSurface('pressing a row opens the detail with the prompt and the full answer, and back returns to the list', async (surface, $, on) => {
  stage(on, surface)
  await begin($)
  await spawn($, { prompt: 'Read every log and report.' })
  await complete($, 'sub-1', 'Found **3** errors.\n\n- one\n- two')
  await agentPanel($)

  const ui = await mountPane($, surface)

  await ui.press({ key: 'sub-sub-1' })

  expect(await ui.find({ key: 'sub-sub-1' })).toBeUndefined()
  expect((await ui.find({ type: 'Markdown', key: 'answer' }))?.props.text).toBe('Found **3** errors.\n\n- one\n- two')

  for (const field of [
    'general-purpose',
    'concluído · 0:02 · 2.5k',
    'read the logs',
    SESSION_MODEL,
    'Read every log and report.',
  ]) {
    expect((await ui.find({ type: 'Text', text: field }))?.type).toBe('Text')
  }

  expect((await ui.find({ key: 'back' }))?.text).toBe('Voltar')

  await ui.press({ key: 'back' })

  expect((await rowLines(ui))['sub-sub-1']).toBe(LINE_ONE)
  expect(await ui.find({ key: 'back' })).toBeUndefined()
  await ui.unmount()
})

const SHOWN_TYPES = ['Text', 'Button', 'Markdown', 'Input', 'Client']

const detailSequence = async (ui: Mounted): Promise<string[]> => {
  const shown = (await ui.findAll({})).filter(element => SHOWN_TYPES.includes(element.type))
  const rule = shown.findIndex(element => element.type === 'Text' && element.text.startsWith('─'))

  return shown.slice(rule + 1).map(element => element.key ?? element.text)
}

const panelsOf = async (ui: Mounted) =>
  (await ui.findAll({ type: 'Box' })).filter(
    box =>
      box.props.borderStyle === 'round' &&
      box.props.borderDimColor === true &&
      box.props.paddingX === 1 &&
      !JSON.stringify(box.children).includes('"Button"'),
  )

const LOGS_PROMPT = 'line one\nline two\nline three'

eachSurface('the subagent detail is the actions, the header, the model, the prompt, the answer and the message field, top to bottom', async (surface, $, on) => {
  stage(on, surface)
  await begin($)
  await spawn($, { prompt: LOGS_PROMPT })
  await complete($, 'sub-1', 'Found it.')
  await agentPanel($)

  const ui = await mountPane($, surface)

  await ui.press({ key: 'sub-sub-1' })

  expect(await detailSequence(ui)).toEqual([
    'back',
    '✓',
    'general-purpose',
    'concluído · 0:02 · 2.5k',
    'read the logs',
    SESSION_MODEL,
    'Prompt dado',
    '3 linhas',
    'toggle-prompt',
    'line one line two line three',
    'Resposta',
    'answer',
    'message-0',
  ])
  await ui.unmount()
})

eachSurface('the row meta, the summary and the detail leave the cache reads out of the count, and the detail adds a dim note with the total', async (surface, $, on) => {
  stage(on, surface)
  await begin($)
  await spawn($)
  await complete($, 'sub-1', 'Found it.', 2400, usage(1000, 200, 48_500, 300))
  await agentPanel($)

  const ui = await mountPane($, surface)

  expect(await rowFacts(ui)).toMatchObject([{ meta: 'concluído · 0:02 · 1.5k' }])
  expect(await ui.find({ type: 'Text', text: '1 concluído · 1.5k tokens' })).toBeDefined()

  await ui.press({ key: 'sub-sub-1' })

  const texts = (await ui.findAll({ type: 'Text' })).map(text => text.text)

  expect(texts).toContain('concluído · 0:02 · 1.5k')
  expect(texts).not.toContain('1 concluído · 1.5k tokens')
  expect((await ui.find({ type: 'Text', text: '50k tokens com a leitura de cache' }))?.props.dimColor).toBe(true)
  expect(texts.indexOf('50k tokens com a leitura de cache')).toBeGreaterThan(texts.indexOf('read the logs'))
  await ui.unmount()
})

eachSurface('the detail header is not pressable: a coloured mark, a bold type, a dim meta and the task, then the model dim and indented by 2', async (surface, $, on) => {
  stage(on, surface)
  await begin($)
  await spawn($, { prompt: LOGS_PROMPT })
  await complete($, 'sub-1', 'Found it.')
  await agentPanel($)

  const ui = await mountPane($, surface)

  await ui.press({ key: 'sub-sub-1' })

  expect((await ui.find({ type: 'Text', text: '✓' }))?.props.color).toBe('success')
  expect((await ui.find({ type: 'Text', text: 'general-purpose' }))?.props.bold).toBe(true)
  expect((await ui.find({ type: 'Text', text: 'concluído · 0:02 · 2.5k' }))?.props.dimColor).toBe(true)
  expect((await ui.find({ type: 'Text', text: 'read the logs' }))?.props.dimColor).toBe(true)
  expect(await ui.find({ key: 'sub-sub-1' })).toBeUndefined()

  const model = (await ui.findAll({ type: 'Box' })).find(
    box => box.props.paddingLeft === 2 && JSON.stringify(box.children).includes(SESSION_MODEL),
  )

  expect(model).toBeDefined()
  expect((await ui.find({ type: 'Text', text: SESSION_MODEL }))?.props.dimColor).toBe(true)
  await ui.unmount()
})

eachSurface('a running subagent shows Voltar and Parar first, and no answer yet is a dim sentence in the panel with no earlier toggle', async (surface, $, on) => {
  stage(on, surface)
  await begin($)
  await spawn($, { prompt: LOGS_PROMPT })
  await agentPanel($)

  const ui = await mountPane($, surface)

  await ui.press({ key: 'sub-sub-1' })

  const sequence = await detailSequence(ui)

  expect(sequence.slice(0, 2)).toEqual(['back', 'stop'])
  expect(sequence.slice(-3)).toEqual(['Resposta', 'Sem resposta ainda.', 'message-0'])
  expect(await ui.find({ type: 'Markdown', key: 'answer' })).toBeUndefined()
  expect(await ui.find({ key: 'toggle-earlier' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: 'Sem resposta ainda.' }))?.props.dimColor).toBe(true)
  expect(await panelsOf(ui)).toHaveLength(2)
  await ui.unmount()
})

eachSurface('the prompt is flattened and cut at 300 until mostrar tudo is pressed, then the whole prompt is a Markdown until recolher', async (surface, $, on) => {
  stage(on, surface)
  await begin($)

  const long = `${'word '.repeat(80)}\n\nsecond paragraph`

  await spawn($, { prompt: long })
  await agentPanel($)

  const ui = await mountPane($, surface)

  await ui.press({ key: 'sub-sub-1' })

  const preview = await ui.find({ type: 'Text', text: 'word word' })

  expect(preview?.text).toHaveLength(300)
  expect(preview?.text.endsWith('…')).toBe(true)
  expect(preview?.props.dimColor).toBe(true)
  expect((await ui.find({ key: 'toggle-prompt' }))?.text).toBe('mostrar tudo')
  expect((await ui.find({ key: 'toggle-prompt' }))?.props.plain).toBe(true)
  expect(await ui.find({ type: 'Markdown', key: 'prompt' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: '3 linhas' }))?.props.dimColor).toBe(true)

  await ui.press({ key: 'toggle-prompt' })

  expect((await ui.find({ type: 'Markdown', key: 'prompt' }))?.props.text).toBe(long)
  expect(await ui.find({ type: 'Text', text: 'word word' })).toBeUndefined()
  expect((await ui.find({ key: 'toggle-prompt' }))?.text).toBe('recolher')
  expect(await panelsOf(ui)).toHaveLength(2)

  await ui.press({ key: 'toggle-prompt' })

  expect(await ui.find({ type: 'Markdown', key: 'prompt' })).toBeUndefined()
  expect((await ui.find({ key: 'toggle-prompt' }))?.text).toBe('mostrar tudo')
  await ui.unmount()
})

eachSurface('a one line prompt says 1 linha, and an empty prompt says it was not recorded in the panel with no toggle', async (surface, $, on) => {
  stage(on, surface)
  await begin($)
  await spawn($, { prompt: 'just one line' })
  await spawn($, { prompt: '' })
  await agentPanel($)

  const ui = await mountPane($, surface)

  await ui.press({ key: 'sub-sub-1' })

  expect((await ui.find({ type: 'Text', text: '1 linha' }))?.type).toBe('Text')
  expect(await ui.find({ type: 'Text', text: '1 linhas' })).toBeUndefined()

  await ui.press({ key: 'back' })
  await ui.press({ key: 'sub-sub-2' })

  expect(await ui.find({ key: 'toggle-prompt' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: 'Prompt não registrado.' }))?.props.dimColor).toBe(true)
  expect(await ui.find({ type: 'Text', text: /linha/ })).toBeUndefined()
  expect(await panelsOf(ui)).toHaveLength(2)
  await ui.unmount()
})

eachSurface('the last answer is a panel with the Markdown, and the earlier ones sit behind Respostas anteriores until it is pressed', async (surface, $, on) => {
  stage(on, surface)
  await begin($)
  await spawn($)
  await complete($, 'sub-1', 'first answer')
  await complete($, 'sub-1', 'second answer')
  await complete($, 'sub-1', 'third answer')
  await agentPanel($)

  const ui = await mountPane($, surface)

  await ui.press({ key: 'sub-sub-1' })

  const toggle = await ui.find({ key: 'toggle-earlier' })

  expect(toggle?.text).toBe('Respostas anteriores (2)')
  expect(toggle?.props.plain).toBe(true)
  expect((await ui.find({ type: 'Markdown', key: 'answer' }))?.props.text).toBe('third answer')
  expect(await ui.findAll({ type: 'Markdown' })).toHaveLength(1)

  await ui.press({ key: 'toggle-earlier' })

  expect((await ui.findAll({ type: 'Markdown' })).map(markdown => markdown.props.text)).toEqual([
    'first answer',
    'second answer',
    'third answer',
  ])
  expect(await panelsOf(ui)).toHaveLength(4)

  await ui.press({ key: 'toggle-earlier' })

  expect(await ui.findAll({ type: 'Markdown' })).toHaveLength(1)
  await ui.unmount()
})

eachSurface('the prompt and earlier toggles close when the detail is left for the list or for another row, and when the tab changes', async (surface, $, on) => {
  stage(on, surface)
  await begin($)
  await spawn($, { prompt: LOGS_PROMPT })
  await spawn($, { prompt: LOGS_PROMPT })
  await complete($, 'sub-1', 'first')
  await complete($, 'sub-1', 'second')
  await complete($, 'sub-2', 'first')
  await complete($, 'sub-2', 'second')
  await agentPanel($)

  const ui = await mountPane($, surface)
  const expand = async () => {
    await ui.press({ key: 'toggle-prompt' })
    await ui.press({ key: 'toggle-earlier' })
  }
  const state = async () => [(await ui.find({ key: 'toggle-prompt' }))?.text, (await ui.findAll({ type: 'Markdown' })).length]

  await ui.press({ key: 'sub-sub-1' })
  await expand()

  expect(await state()).toEqual(['recolher', 3])

  await ui.press({ key: 'back' })
  await ui.press({ key: 'sub-sub-1' })

  expect(await state()).toEqual(['mostrar tudo', 1])

  await expand()
  await ui.press({ key: 'back' })
  await ui.press({ key: 'sub-sub-2' })

  expect(await state()).toEqual(['mostrar tudo', 1])

  await expand()
  await ui.press({ key: 'tab-3' })
  await ui.press({ key: 'tab-1' })
  await ui.press({ key: 'sub-sub-2' })

  expect(await state()).toEqual(['mostrar tudo', 1])
  await ui.unmount()
})

eachSurface('a subagent that left the collector with its detail open sends the panel back to the list and keeps it there', async (surface, $, on) => {
  const world = stage(on, surface)
  await begin($)
  await spawn($)
  await agentPanel($)

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
  await agentPanel($)

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
  await agentPanel($)

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
    await agentPanel($)

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
  await agentPanel($)

  const ui = await mountPane($, surface)
  const before = world.listCalls

  await world.clock.advance(1999)

  expect(world.listCalls).toBe(before)

  world.listed = [{ id: 'early-1', description: 'born before', type: 'Explore', status: 'running' }]
  await world.clock.advance(1)

  expect(world.listCalls).toBe(before + 1)
  expect((await rowLines(ui))['sub-early-1']).toBe('● Explore rodando · 0:00 · 0')

  await world.clock.advance(4000)

  expect(world.listCalls).toBe(before + 3)
  await ui.unmount()
})

const BEAT_MS = 2000

const redrawsOf = (on: On) => {
  const count = { renders: 0 }

  on('ui.invalidate', (_$, e, next) => {
    if (e.event === 'ui.render') {
      count.renders += 1
    }

    return next(e)
  })

  return count
}

eachSurface('a beat that finds nothing new to draw asks for no redraw, and a running clock alone never asks for one', async (surface, $, on) => {
  const redraws = redrawsOf(on)
  const world = stage(on, surface)
  await begin($)
  await agentPanel($)
  await world.clock.advance(2000)

  const idle = redraws.renders

  await world.clock.advance(2000)
  await world.clock.advance(2000)

  expect(redraws.renders).toBe(idle)

  await spawn($)
  await world.clock.advance(2000)

  const running = redraws.renders

  expect(running).toBeGreaterThan(idle)

  for (let beat = 0; beat < 6; beat += 1) {
    await world.clock.advance(2000)
  }

  expect(redraws.renders).toBe(running)
})

const completeMain = ($: Engine) =>
  $.turn.complete({
    turnId: 't1',
    answer: 'done',
    durationMs: 1000,
    isAborted: false,
    reason: 'answer',
    usage: usage(10, 5),
  } as never)

eachSurface('with the panel open on tab 1 and no subagent, a registry write asks for no redraw, and a spawn asks at once', async (surface, $, on) => {
  const redraws = redrawsOf(on)
  const world = stage(on, surface)
  await begin($)
  await agentPanel($)
  await world.clock.advance(2000)

  const idle = redraws.renders

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await world.clock.advance(1000)

  expect(redraws.renders).toBe(idle)

  await completeMain($)
  await world.clock.advance(1000)

  expect(redraws.renders).toBe(idle)

  await spawn($)
  await world.clock.advance(1000)

  expect(redraws.renders).toBe(idle + 1)
})

eachSurface('with a subagent running, token and tool updates within 5 s of the last redraw ask for none, and one arrives at 5 s', async (surface, $, on) => {
  const redraws = redrawsOf(on)
  const world = stage(on, surface)
  await begin($)
  await agentPanel($)
  await world.clock.advance(2000)
  await spawn($)
  await world.clock.advance(1000)

  const drawn = redraws.renders

  await step($, 'sub-1')
  await $.tool.call({ tool: 'Grep', agentId: 'sub-1' } as never)
  await world.clock.advance(4000)

  expect(redraws.renders).toBe(drawn)

  await world.clock.advance(1000)

  expect(redraws.renders).toBe(drawn + 1)
})

eachSurface('a subagent that completes changes the structure and is drawn at once', async (surface, $, on) => {
  const redraws = redrawsOf(on)
  const world = stage(on, surface)
  await begin($)
  await agentPanel($)
  await world.clock.advance(2000)
  await spawn($)
  await world.clock.advance(2000)

  const drawn = redraws.renders

  await complete($, 'sub-1', 'finished')
  await world.clock.advance(1000)

  expect(redraws.renders).toBe(drawn + 1)
})

eachSurface('with the panel closed a registry write asks for no redraw and no pane query', async (surface, $, on) => {
  const redraws = redrawsOf(on)
  const world = stage(on, surface)
  await begin($)
  await agentPanel($)
  await closePane($)
  await world.clock.advance(2000)

  const idle = redraws.renders
  const queries = world.paneQueries

  await spawn($)
  await world.clock.advance(1000)

  expect(redraws.renders).toBe(idle)
  expect(world.paneQueries).toBe(queries)
})

eachSurface('the panels under the prompt heading row and under the earlier toggle carry a margin of 1, the last answer without a toggle does not', async (surface, $, on) => {
  stage(on, surface)
  await begin($)
  await spawn($, { prompt: 'just one line' })
  await complete($, 'sub-1', 'only answer')
  await spawn($, { prompt: 'second line' })
  await complete($, 'sub-2', 'first answer')
  await complete($, 'sub-2', 'second answer')
  await complete($, 'sub-2', 'third answer')
  await agentPanel($)

  const ui = await mountPane($, surface)
  const margins = async () => (await panelsOf(ui)).map(panel => panel.props.marginTop)

  await ui.press({ key: 'sub-sub-1' })

  expect(await margins()).toEqual([1, 0])

  await ui.press({ key: 'back' })
  await ui.press({ key: 'sub-sub-2' })

  expect(await margins()).toEqual([1, 1])

  await ui.press({ key: 'toggle-earlier' })

  expect(await margins()).toEqual([1, 1, 0, 0])
  await ui.unmount()
})

eachSurface('opening the panel twice does not start a second timer', async (surface, $, on) => {
  const world = stage(on, surface)
  await begin($)
  await agentPanel($)
  await agentPanel($)
  await agentPanel($, 'sessions')
  await agentPanel($)

  const before = world.listCalls

  await world.clock.advance(2000)

  expect(world.listCalls).toBe(before + 1)
  expect(world.opens).toHaveLength(1)
})

eachSurface('/agent-panel on a pane that is already open switches the tab and answers the usual sentence, with no second open, no close and one timer', async (surface, $, on) => {
  const world = stage(on, surface, peerStore())
  await begin($)

  expect(await agentPanel($)).toBe('Painel de agentes aberto.')

  const ui = await mountPane($, surface)

  world.openResult = { isPlaced: false, reason: 'already open' }

  expect(await agentPanel($, 'sessions')).toBe('Painel de agentes aberto na aba Outras sessões.')
  await ui.redraw()

  expect(world.opens).toHaveLength(1)
  expect(world.panes).toEqual([{ id: 'agent-studio', title: 'Agentes' }])
  expect((await sessionRows(ui)).length).toBe(3)

  expect(await agentPanel($)).toBe('Painel de agentes aberto.')
  await ui.redraw()

  expect(world.opens).toHaveLength(1)
  expect(world.panes).toHaveLength(1)
  expect((await sessionRows(ui)).length).toBe(0)
  expect((await ui.find({ type: 'Text', text: 'Nenhum subagente nesta sessão.' }))?.type).toBe('Text')

  const lists = world.listCalls

  await world.clock.advance(2000)

  expect(world.listCalls).toBe(lists + 1)
  await ui.unmount()
})

eachSurface('/agent-panel on a listed pane whose timer had stopped starts one timer again', async (surface, $, on) => {
  const world = stage(on, surface)
  await begin($)
  await agentPanel($)

  world.panes = []
  await world.clock.advance(2000)

  const lists = world.listCalls

  await world.clock.advance(2000)

  expect(world.listCalls).toBe(lists)

  world.panes = [{ id: 'agent-studio', title: 'Agentes' }]

  expect(await agentPanel($)).toBe('Painel de agentes aberto.')
  expect(world.opens).toHaveLength(1)

  const before = world.listCalls

  await world.clock.advance(2000)

  expect(world.listCalls).toBe(before + 1)
})

eachSurface('a closed panel leaves no timer: no engine list, no pane query, and the registry read only by its own 15 s beat', async (surface, $, on) => {
  const world = stage(on, surface)
  await begin($)
  await agentPanel($)
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
  await agentPanel($)

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
  await agentPanel($)

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

  expect(await agentPanel($)).toBe(ROW_ONE)
  expect(world.opens).toEqual([])
  expect(await agentPanel($, 'sessions')).toBe('Nenhuma outra sessão registrada.')
  expect(world.opens).toEqual([])
})

eachSurface('a pane that is not placed answers as text, is closed and leaves no timer', async (surface, $, on) => {
  const world = stage(on, surface)
  world.openResult = { isPlaced: false, reason: 'no pane here' }
  await begin($)
  await spawn($)
  await complete($, 'sub-1', 'done')

  expect(await agentPanel($)).toBe(ROW_ONE)
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

  expect(await agentPanel($)).toBe('Nenhum subagente nesta sessão.')
})

eachSurface('an argument the command does not know answers the usage and opens no pane', async (surface, $, on) => {
  const world = stage(on, surface)
  await begin($)

  expect(await agentPanel($, 'whatever')).toContain('Uso: /agent-panel')
  expect(world.opens).toEqual([])
})

const ONE_MINUTE = 60_000

const HEARTBEAT_MS = 15_000

const peerStore = (): Record<string, unknown> => ({
  'sess:working-1': entry({
    cwd: 'C:/work/api',
    agent: 'architect',
    state: 'working',
    turnStartedAt: NOW - 83_000,
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
    'sess:idle-4': entry({ cwd: 'C:/work/lib', state: 'idle', idleSince: NOW - 1000, updatedAt: NOW - 1000 }),
  })
  await begin($)
  await agentPanel($)

  const ui = await mountPane($, surface)

  await ui.press({ key: 'tab-2' })

  const rows = await sessionRows(ui)

  expect(rows.map(row => row.key).sort()).toEqual(['sess-ended-3', 'sess-idle-4', 'sess-stale-2', 'sess-working-1'])
  expect(await ui.find({ key: `sess-${SESSION}` })).toBeUndefined()

  const text = await rowLines(ui)

  expect(text['sess-working-1']).toBe('● api @architect · trabalhando · 1:23')
  expect(text['sess-idle-4']).toBe('● lib sem agente · ociosa · há 1 s')
  expect(text['sess-stale-2']).toBe('● web sem agente · inativa · há 1 min')
  expect(text['sess-ended-3']).toBe('● docs @writer · encerrada · há 2 min')
  await ui.unmount()
})

eachSurface('tab 2 rows carry the presence colour, the dim name of an encerrada, and the description with the count and the answer or the folder', async (surface, $, on) => {
  stage(on, surface, {
    ...peerStore(),
    'sess:idle-4': entry({ cwd: 'C:/work/lib', state: 'idle', idleSince: NOW - 1000, updatedAt: NOW - 1000 }),
  })
  await begin($)
  await agentPanel($, 'sessions')

  const ui = await mountPane($, surface)
  const rows = Object.fromEntries((await rowFacts(ui)).map(row => [row.name, row]))

  expect(Object.keys(rows)).toEqual(['api', 'lib', 'web', 'docs'])
  expect(rows.api).toMatchObject({
    mark: '●',
    color: 'success',
    meta: '@architect · trabalhando · 1:23',
    description: '2 subagentes · Mapped the payment module and found two call sites that skip validation.',
  })
  expect(rows.lib).toMatchObject({ color: 'warning', meta: 'sem agente · ociosa · há 1 s', description: 'C:/work/lib' })
  expect(rows.web).toMatchObject({ color: 'inactive', meta: 'sem agente · inativa · há 1 min', description: 'C:/work/web' })
  expect(rows.docs).toMatchObject({ color: 'inactive', meta: '@writer · encerrada · há 2 min', description: 'C:/work/docs' })
  expect([rows.api, rows.lib, rows.web].map(row => row?.isNameDim)).toEqual([false, false, false])
  expect(rows.docs?.isNameDim).toBe(true)
  await ui.unmount()
})

eachSurface('tab 2 groups the sessions under Abertas and Encerradas, sorted by presence and then newest, and draws no heading for an empty group', async (surface, $, on) => {
  const world = stage(on, surface, {
    ...peerStore(),
    'sess:idle-4': entry({ cwd: 'C:/work/lib', state: 'idle', idleSince: NOW - 1000, updatedAt: NOW - 1000 }),
    'sess:idle-5': entry({ cwd: 'C:/work/newer-idle', state: 'idle', updatedAt: NOW - 500 }),
    'sess:ended-6': entry({ cwd: 'C:/work/newer-ended', state: 'ended', updatedAt: NOW - 90_000 }),
  })
  await begin($)
  await agentPanel($, 'sessions')

  const ui = await mountPane($, surface)

  expect(await listing(ui)).toEqual([
    'Abertas (4)',
    'api',
    'newer-idle',
    'lib',
    'web',
    'Encerradas (2)',
    'newer-ended',
    'docs',
  ])

  expect(await groupMargins(ui)).toEqual([0, 1])

  for (const key of ['sess:ended-3', 'sess:ended-6']) {
    world.store.delete(key)
  }

  await world.clock.advance(2000)

  expect(await listing(ui)).toEqual(['Abertas (4)', 'api', 'newer-idle', 'lib', 'web'])

  for (const key of ['sess:working-1', 'sess:stale-2', 'sess:idle-4', 'sess:idle-5']) {
    world.store.delete(key)
  }

  world.store.set('sess:ended-7', entry({ cwd: 'C:/work/gone', state: 'ended' }))
  await world.clock.advance(2000)

  expect(await listing(ui)).toEqual(['Encerradas (1)', 'gone'])
  await ui.unmount()
})

eachSurface('a session row is named by its title when it has one and by the last folder of its cwd when not, on either separator and with a trailing one', async (surface, $, on) => {
  stage(on, surface, {
    'sess:titled': entry({ cwd: 'C:/work/api', title: 'Fix the login bug', updatedAt: NOW - 1000 }),
    'sess:slash': entry({ cwd: 'C:/work/alpha', updatedAt: NOW - 2000 }),
    'sess:back': entry({ cwd: 'C:\\Users\\bruno\\Projetos\\agent-studio-spike', updatedAt: NOW - 3000 }),
    'sess:trailing': entry({ cwd: 'C:\\work\\omega\\', updatedAt: NOW - 4000 }),
    'sess:empty-title': entry({ cwd: 'C:/work/zeta/', title: '', updatedAt: NOW - 5000 }),
  })
  await begin($)
  await agentPanel($, 'sessions')

  const ui = await mountPane($, surface)

  expect(await listing(ui)).toEqual(['Abertas (5)', 'Fix the login bug', 'alpha', 'agent-studio-spike', 'omega', 'zeta'])
  await ui.unmount()
})

eachSurface('three other sessions draw three rows with three states, and the first one opens with two subagents', async (surface, $, on) => {
  stage(on, surface, peerStore())
  await begin($)
  await agentPanel($, 'sessions')

  const ui = await mountPane($, surface)
  const rows = await sessionRows(ui)

  expect(rows.map(row => row.key)).toEqual(['sess-working-1', 'sess-stale-2', 'sess-ended-3'])
  expect(Object.values(await rowLines(ui)).map(line => /trabalhando|ociosa|inativa|encerrada/.exec(line)?.[0])).toEqual([
    'trabalhando',
    'inativa',
    'encerrada',
  ])

  await ui.press({ key: 'sess-working-1' })

  expect((await ui.find({ type: 'Text', text: 'api' }))?.props.bold).toBe(true)
  expect((await ui.find({ type: 'Text', text: '@architect · trabalhando ·' }))?.props.dimColor).toBe(true)
  expect(clockPropsOf((await ui.find({ key: 'clock-header' }))!)).toEqual({ kind: 'elapsed', since: NOW - 83_000 })
  expect((await ui.find({ type: 'Text', text: 'C:/work/api' }))?.props.dimColor).toBe(true)
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

eachSurface('the detail of another session is the actions, the header, the cwd, the last answer in a panel, the subagents and the message field', async (surface, $, on) => {
  stage(on, surface, peerStore())
  await begin($)
  await agentPanel($, 'sessions')

  const ui = await mountPane($, surface)

  await ui.press({ key: 'sess-working-1' })

  expect(await detailSequence(ui)).toEqual([
    'back',
    'status',
    '●',
    'api',
    '@architect · trabalhando ·',
    'clock-header',
    '2 subagentes · Mapped the payment module and found two call sites that skip validation.',
    'C:/work/api',
    'Última resposta',
    'last-answer',
    'Subagentes desta sessão (2)',
    '● rodando  Explore  map the module  Grep  18k',
    '✓ concluído  Plan  sketch the migration  —  31k',
    'message-0',
  ])
  expect((await ui.find({ type: 'Text', text: '●' }))?.props.color).toBe('success')
  expect((await ui.find({ type: 'Text', text: 'api' }))?.props.bold).toBe(true)
  expect((await ui.find({ type: 'Text', text: 'C:/work/api' }))?.props.dimColor).toBe(true)
  expect(await ui.find({ key: 'sess-working-1' })).toBeUndefined()
  expect(await panelsOf(ui)).toHaveLength(1)
  await ui.unmount()
})

eachSurface('the cwd line is left out when the header already shows it, and no answer is a dim sentence in the panel', async (surface, $, on) => {
  stage(on, surface, { 'sess:quiet-1': entry({ cwd: 'C:/work/quiet', updatedAt: NOW }) })
  await begin($)
  await agentPanel($, 'sessions')

  const ui = await mountPane($, surface)

  await ui.press({ key: 'sess-quiet-1' })

  expect(await detailSequence(ui)).toEqual([
    'back',
    'status',
    '●',
    'quiet',
    'sem agente · ociosa ·',
    'clock-header',
    'C:/work/quiet',
    'Última resposta',
    'Nenhuma resposta publicada.',
    'Subagentes desta sessão (0)',
    'Nenhum subagente publicado.',
    'message-0',
  ])
  expect((await ui.find({ type: 'Text', text: 'Nenhuma resposta publicada.' }))?.props.dimColor).toBe(true)
  expect(await panelsOf(ui)).toHaveLength(1)
  await ui.unmount()
})

eachSurface('the subagents of another session never reach tab 1', async (surface, $, on) => {
  stage(on, surface, peerStore())
  await begin($)
  await agentPanel($, 'sessions')

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
  await agentPanel($, 'sessions')

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
  await agentPanel($)

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
  await agentPanel($, 'sessions')

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

eachSurface('/agent-panel sessions opens the panel on tab 2 and says so', async (surface, $, on) => {
  stage(on, surface, peerStore())
  await begin($)

  expect(await agentPanel($, 'sessions')).toBe('Painel de agentes aberto na aba Outras sessões.')

  const ui = await mountPane($, surface)

  expect((await sessionRows(ui)).length).toBe(3)
  await ui.unmount()
})

eachSurface('a clear empties the last reading of the other sessions on tab 2, and the next beat there reads them again', async (surface, $, on) => {
  const world = stage(on, surface, peerStore())
  await begin($)
  await agentPanel($, 'sessions')

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

eachSurface('on tab 2 time passing alone asks for no redraw, until a session turns stale, and then none again', async (surface, $, on) => {
  const redraws = redrawsOf(on)
  const world = stage(on, surface, {
    'sess:working-1': entry({ cwd: 'C:/work/api', state: 'working', turnStartedAt: NOW - 1000, updatedAt: NOW }),
    'sess:fresh-2': entry({ cwd: 'C:/work/web', state: 'idle', idleSince: NOW - 1000, updatedAt: NOW }),
  })
  await begin($)
  await agentPanel($, 'sessions')

  const drawn = redraws.renders

  for (let beat = 0; beat < 10; beat += 1) {
    await world.clock.advance(2000)
  }

  expect(redraws.renders).toBe(drawn)

  for (let beat = 0; beat < 25; beat += 1) {
    await world.clock.advance(2000)
  }

  expect(redraws.renders).toBe(drawn + 1)

  for (let beat = 0; beat < 20; beat += 1) {
    await world.clock.advance(2000)
  }

  expect(redraws.renders).toBe(drawn + 1)
})

eachSurface('on tab 2 a session going idle, a new turn or a new idle moment redraws at once, and a heartbeat alone does not', async (surface, $, on) => {
  const redraws = redrawsOf(on)
  const world = stage(on, surface, {
    'sess:live-1': entry({ cwd: 'C:/work/api', state: 'working', turnStartedAt: NOW, updatedAt: NOW }),
  })
  await begin($)
  await agentPanel($, 'sessions')
  await world.clock.advance(2000)

  const drawn = redraws.renders
  const publish = (over: Partial<SessionEntry>) => world.store.set('sess:live-1', entry({ cwd: 'C:/work/api', ...over }))

  publish({ state: 'working', turnStartedAt: NOW, updatedAt: NOW + 2000 })
  await world.clock.advance(2000)

  expect(redraws.renders).toBe(drawn)

  publish({ state: 'working', turnStartedAt: NOW + 3000, updatedAt: NOW + 4000 })
  await world.clock.advance(2000)

  expect(redraws.renders).toBe(drawn + 1)

  publish({ state: 'idle', idleSince: NOW + 5000, updatedAt: NOW + 5000 })
  await world.clock.advance(2000)

  expect(redraws.renders).toBe(drawn + 2)

  publish({ state: 'idle', idleSince: NOW + 7000, updatedAt: NOW + 7000 })
  await world.clock.advance(2000)

  expect(redraws.renders).toBe(drawn + 3)

  publish({ state: 'idle', idleSince: NOW + 7000, updatedAt: NOW + 8000 })
  await world.clock.advance(2000)

  expect(redraws.renders).toBe(drawn + 3)
})

eachSurface('a running row hands its start to a clock surface module that draws the time from the real clock and keeps ticking', async (surface, $, on) => {
  stage(on, surface)
  await begin($)
  await spawn($)
  await agentPanel($)

  const ui = await mountPane($, surface)
  const client = await ui.find({ type: 'Client' })
  const shown = async () => (await ui.findAll({ type: 'Text', in: 'clock-sub-sub-1' })).map(text => [text.text, text.props.dimColor])

  expect(client?.key).toBe('clock-sub-sub-1')
  expect(String(client?.props.module)).toMatch(/hooks[\/]ui[\/]clock\.tsx$/)
  expect(client === undefined ? undefined : clockPropsOf(client)).toEqual({ kind: 'elapsed', since: NOW })
  expect(await shown()).toEqual([[expect.stringMatching(/^\d+:\d\d$/), true]])

  const row = (await ui.findAll({ type: 'Box' })).find(box => box.children.some(child => (child as { type?: string }).type === 'Client'))
  const parts = (row?.children ?? []) as { type: string; props: Record<string, unknown>; children?: string[] }[]

  expect(row?.props).toMatchObject({ flexDirection: 'row', gap: 1 })
  expect(parts.map(part => part.type)).toEqual(['Text', 'Button', 'Text', 'Client', 'Text'])
  expect(parts.filter(part => part.type === 'Text').map(part => [part.children, part.props.dimColor, part.props.wrap])).toEqual([
    [['●'], undefined, undefined],
    [['rodando ·'], true, 'truncate'],
    [['· 0'], true, 'truncate'],
  ])

  await ui.advance(1000)

  expect(await shown()).toEqual([[expect.stringMatching(/^\d+:\d\d$/), true]])
  await ui.unmount()
})

eachSurface('a finished row draws one text for its meta and no clock module', async (surface, $, on) => {
  stage(on, surface)
  await begin($)
  await spawn($)
  await complete($, 'sub-1', 'done')
  await agentPanel($)

  const ui = await mountPane($, surface)

  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: 'concluído · 0:02 · 2.5k' }))?.props.wrap).toBe('truncate')
  await ui.unmount()
})

for (const surface of ['mobile', 'vscode'] as const) {
  test(`on a surface whose element table has no Client the running meta stays one text [${surface}]`, async ($, on) => {
    stage(on, 'terminal')
    await begin($)
    await spawn($)
    await agentPanel($)

    const ui = await $.ui.mount({ plugin: 'agent-studio', surface, component: 'Pane', requestId: 'agent-studio', props: PANE_PROPS })

    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: 'rodando · 0:00 · 0' }))?.props.dimColor).toBe(true)
    await ui.unmount()
  })
}

eachSurface('tab 2 rows hand the clock props per presence: the turn start, the idle moment or the last sign of life', async (surface, $, on) => {
  stage(on, surface, {
    ...peerStore(),
    'sess:idle-4': entry({ cwd: 'C:/work/lib', state: 'idle', idleSince: NOW - 9000, updatedAt: NOW - 1000 }),
  })
  await begin($)
  await agentPanel($, 'sessions')

  const ui = await mountPane($, surface)
  const clients = await ui.findAll({ type: 'Client' })
  const ago = { seconds: 'há {n} s', minutes: 'há {n} min', hours: 'há {n} h' }

  expect(clients.map(client => [client.key, clockPropsOf(client)])).toEqual([
    ['clock-sess-working-1', { kind: 'elapsed', since: NOW - 83_000 }],
    ['clock-sess-idle-4', { kind: 'ago', since: NOW - 9000, templates: ago }],
    ['clock-sess-stale-2', { kind: 'ago', since: NOW - 61_000, templates: ago }],
    ['clock-sess-ended-3', { kind: 'ago', since: NOW - 120_000, templates: ago }],
  ])
  await ui.unmount()
})
