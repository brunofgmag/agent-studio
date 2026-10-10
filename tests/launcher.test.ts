import type { On, PromptComposeSection, TurnStepInput } from 'claude-code'
import { type Engine, type Plugin, expect, mock, test } from 'claude-code/testing'

import {
  composeAsAgent,
  parseModelAliases,
  resolveModel,
  roleEndedNotice,
  roleNotice,
  spawnDenial,
  toolDenial,
} from '../hooks/launcher/apply'
import { type Host, createLauncher } from '../hooks/launcher/index'
import * as messages from '../hooks/messages'
import type { AgentDefinition, ProcessFlags, SavedSession } from '../types'

type Agent = { file: string; text: string }

type Setup = {
  agents?: readonly Agent[]
  store?: Readonly<Record<string, unknown>>
  flags?: Partial<ProcessFlags>
  cwd?: string
  repoRoot?: string
  settings?: Readonly<Record<string, unknown>>
  submitFail?: true
}

type Stage = {
  sessionId: string
  refusesAppend: boolean
  files: Agent[]
  store: Map<string, unknown>
  stateWrites: { key: string; value: unknown }[]
  lists: string[]
  reads: string[]
  toasts: string[]
  steps: { model: string; effort: TurnStepInput['effort']; agentId: string | undefined }[]
  tools: { tool: string; agentId: string | undefined }[]
  statuses: (string | undefined)[]
  spawns: { subagentType: string; parentAgentId: string | undefined }[]
  submitted: { text: string; origin: unknown }[]
  registered: string[]
  clock: ReturnType<typeof mock.clock>
  session: ReturnType<typeof mock.session>
}

const HOME = { USERPROFILE: 'C:\\Users\\bruno' }
const PROJECT = 'C:/work/app'
const SESSION = 'session-1'
const SESSION_MODEL = 'claude-haiku-5-5'
const NOW = 1000

const BASE_SECTIONS: PromptComposeSection[] = [
  { id: 'lean_body', scope: 'shared', text: 'GENERIC BODY' },
  { id: 'communication', scope: 'session', text: 'COMMUNICATION' },
  { id: 'pronouns', scope: 'session', text: 'PRONOUNS' },
  { id: 'memory', scope: 'session', text: 'MEMORY' },
]

const BASE_IDS = ['lean_body', 'communication', 'pronouns', 'memory']

const slashed = (path: string) => path.replaceAll('\\', '/')

const keyOf = (sessionId: string) => `launcher:${sessionId}`

const pathOf = (name: string) => `${PROJECT}/.claude/agents/${name}.md`

const agent = (name: string, header = '', body = `You are ${name}.`) =>
  `---\nname: ${name}\ndescription: ${name} description\n${header}---\n${body}\n`

const saved = (name: string | null, native: string | null = null): SavedSession => ({
  agent: name === null ? null : { name, path: pathOf(name), source: 'project' },
  native,
  at: 1,
})

const DEFAULT_AGENTS: Agent[] = [
  { file: pathOf('worker'), text: agent('worker', 'model: claude-opus-5-5[1m]\n') },
  { file: pathOf('restricted'), text: agent('restricted', 'tools: Read, Grep\n') },
  { file: pathOf('careful'), text: agent('careful', 'disallowedTools: Bash, mcp__*\n') },
  {
    file: pathOf('serverless'),
    text: agent('serverless', 'disallowedTools: mcp__Claude_Browser, Write(*.md)\n'),
  },
  { file: pathOf('aliased'), text: agent('aliased', 'model: sonnet\n') },
  { file: pathOf('shouty'), text: agent('shouty', 'model: Sonnet\n') },
  { file: pathOf('custom'), text: agent('custom', 'model: fast\n') },
  { file: pathOf('lost'), text: agent('lost', 'model: gemini\n') },
  { file: pathOf('extras'), text: agent('extras', 'skills:\n  - vault-sweep\npermissionMode: plan\n') },
  { file: pathOf('plain'), text: agent('plain') },
  { file: 'C:/Users/bruno/.claude/agents/worker.md', text: agent('worker', 'model: claude-sonnet-5-5\n') },
  { file: 'C:/Users/bruno/.claude/agents/home-only.md', text: agent('home-only') },
]

const stage = (on: On, setup: Setup = {}): Stage => {
  const cwd = setup.cwd ?? PROJECT
  const world: Stage = {
    sessionId: SESSION,
    refusesAppend: false,
    files: [...(setup.agents ?? DEFAULT_AGENTS)],
    store: new Map(Object.entries(setup.store ?? {})),
    stateWrites: [],
    lists: [],
    reads: [],
    toasts: [],
    steps: [],
    tools: [],
    statuses: [],
    spawns: [],
    submitted: [],
    registered: [],
    clock: mock.clock(on, { now: NOW }),
    session: mock.session(on),
  }
  const filesNow = () => new Map(world.files.map(({ file, text }) => [slashed(file), text]))

  mock.env(on, HOME)
  on('session.cwd', () => ({ value: cwd }))
  on('session.root', () => ({ value: cwd }))
  on('session.repo', () => ({
    value: setup.repoRoot === undefined ? null : { root: setup.repoRoot, remote: null, internal: false, name: null },
  }))
  on('session.id', () => ({ value: world.sessionId }))
  on('session.model', () => ({ value: SESSION_MODEL }))
  on('session.append', { door: 'note' }, (_$, e, next) =>
    world.refusesAppend ? { deny: 'refused by the test' } : next(e),
  )
  on('ui.toast', (_$, e) => {
    world.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.status', (_$, e) => {
    world.statuses.push(e.text)

    return { value: undefined }
  })
  on('settings.read', () => ({ value: setup.settings ?? {} }))
  on('prompt.submit', (_$, e) => {
    if (setup.submitFail) {
      throw new Error('busy')
    }

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
  on('state.set', (_$, e, next) => {
    world.stateWrites.push({ key: e.key, value: e.value })

    return next(e)
  })

  if (setup.flags?.promptFrozen !== undefined) {
    const value = setup.flags.promptFrozen

    on('state.get', { plugin: 'agent-studio', key: 'promptFrozen' }, () => ({ value: { value, version: 1 } }))
  }

  if (setup.flags?.composeSeen !== undefined) {
    const value = setup.flags.composeSeen

    on('state.get', { plugin: 'agent-studio', key: 'composeSeen' }, () => ({ value: { value, version: 1 } }))
  }

  on('fs.read', (_$, e) => {
    world.reads.push(slashed(e.path))
    const text = filesNow().get(slashed(e.path))

    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })
  on('fs.list', (_$, e) => {
    world.lists.push(slashed(e.path))
    const dir = slashed(e.path).replace(/\/$/, '')
    const children = new Map<string, 'file' | 'dir'>()

    for (const file of filesNow().keys()) {
      if (file.startsWith(`${dir}/`)) {
        const [head, ...rest] = file.slice(dir.length + 1).split('/')
        children.set(head ?? '', rest.length === 0 ? 'file' : 'dir')
      }
    }

    if (children.size === 0) {
      return { deny: `ENOENT ${e.path}` }
    }

    return {
      value: [...children].map(([name, kind]) => ({ name, kind, size: 1, mtimeMs: 0, isLink: false })),
    }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => {
    if (e.name !== 'agentes') {
      world.registered.push(e.name)
    }

    return { value: { command: e.name } }
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('agent.list', () => ({ value: [] }))
  on('classic.SessionStart', () => ({}))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('prompt.compose', () => ({ sections: BASE_SECTIONS }))
  on('turn.step', async function* (_$, e) {
    world.steps.push({ model: e.model, effort: e.effort, agentId: e.agentId })

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('tool.call', (_$, e) => {
    world.tools.push({ tool: String(e.tool), agentId: e.agentId })

    return { ref: 1, result: 'done', text: 'done' }
  })
  on('agent.spawn', (_$, e) => {
    world.spawns.push({ subagentType: e.subagentType, parentAgentId: e.parentAgentId })

    return { model: SESSION_MODEL, agentId: 'spawned-1' }
  })

  return world
}

const begin = ($: Engine) => $.session.start({ cwd: PROJECT, surface: null, isInteractive: true })

const run = async ($: Engine, command: string, args: string) => {
  const result = await $.command.run({
    command,
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })

  return result.text ?? ''
}

const as = ($: Engine, args: string) => run($, 'as', args)

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

const idsOf = async ($: Engine) => (await sectionsOf($)).map(section => section.id)

type StepRequest = { agentId?: string; model?: string; effort?: TurnStepInput['effort'] }

const stepOf = async ($: Engine, world: Stage, request: StepRequest = {}) => {
  const before = world.steps.length
  const stream = $.turn.step({
    turnId: 't1',
    index: 0,
    model: request.model ?? SESSION_MODEL,
    messageCount: 1,
    ...(request.agentId === undefined ? {} : { agentId: request.agentId }),
    ...(request.effort === undefined ? {} : { effort: request.effort }),
  })

  for await (const _chunk of stream) {
    continue
  }

  return world.steps.slice(before)[0]
}

const stepModelOf = async ($: Engine, world: Stage, agentId?: string, model = SESSION_MODEL) =>
  (await stepOf($, world, { model, ...(agentId === undefined ? {} : { agentId }) }))?.model

const stepEffortOf = async ($: Engine, world: Stage, request: StepRequest = {}) =>
  (await stepOf($, world, request))?.effort

const spawnOf = async ($: Engine, world: Stage, subagentType: string, parentAgentId?: string) => {
  const before = world.spawns.length
  const result = await $.agent.spawn({
    prompt: 'go',
    description: 'go',
    subagentType,
    ...(parentAgentId === undefined ? {} : { parentAgentId }),
  } as never)

  return { reached: world.spawns.length > before, result }
}

const useTool = async ($: Engine, world: Stage, tool: string, agentId?: string) => {
  const before = world.tools.length
  const result = await $.tool.call({ tool, ...(agentId === undefined ? {} : { agentId }) } as never)

  return { reached: world.tools.length > before, result }
}

const startTurnWithoutCompose = ($: Engine) => $.turn.start({ text: 'hello', turnId: 't1' })

const startTurn = async ($: Engine) => {
  await sectionsOf($)

  return startTurnWithoutCompose($)
}

const rowText = (world: Stage, index: number) => JSON.stringify(world.session.appended()[index]?.message.content)

const lastWrite = (world: Stage, key: string) => world.stateWrites.findLast(write => write.key === key)?.value

test('session.start registers the /as command and reads no agent file', async ($, on) => {
  const world = stage(on)
  await begin($)

  expect(world.registered).toEqual(['as'])
  expect(world.lists).toEqual([])
  expect(world.reads).toEqual([])

  await as($, '')

  expect(world.lists.length > 0).toBe(true)
})

test('/as lists the catalog with the active one marked and skipped files counted', async ($, on) => {
  stage(on, {
    agents: [...DEFAULT_AGENTS, { file: pathOf('broken'), text: '---\nname: broken\n---\nx' }],
  })
  await begin($)
  await as($, 'plain')

  const text = await as($, '')

  expect(text).toContain('Agentes disponíveis (11)')
  expect(text).toContain('* plain (projeto)')
  expect(text).toContain('  home-only (usuário)')
  expect(text).toContain('1 arquivo ignorado:')
  expect(text).toContain(`${pathOf('broken')}: falta o campo description`)
})

test('the catalog starts at the repository root when the session sits below it', async ($, on) => {
  stage(on, { cwd: `${PROJECT}/packages/web`, repoRoot: PROJECT })
  await begin($)

  expect(await as($, 'plain')).toContain('Agente plain ativo.')
})

test('/as x changes what prompt.compose answers: shared dropped, agent first, session kept in order', async ($, on) => {
  stage(on)
  await begin($)

  expect(await idsOf($)).toEqual(BASE_IDS)

  await as($, 'plain')
  const sections = await sectionsOf($)

  expect(sections.map(section => section.id)).toEqual([
    'agent-studio:agent',
    'communication',
    'pronouns',
    'memory',
  ])
  expect(sections[0]).toEqual({ id: 'agent-studio:agent', scope: 'session', text: 'You are plain.' })
  expect(sections.some(section => section.text === 'GENERIC BODY')).toBe(false)
})

test('an agent that restricts tools says so in its prompt section', async ($, on) => {
  stage(on)
  await begin($)
  await as($, 'restricted')

  const text = (await sectionsOf($))[0]?.text ?? ''

  expect(text).toContain('You are restricted.')
  expect(text).toContain('only these tools: Read, Grep')
})

test('turn.step takes the agent model on the main loop and keeps its own inside a subagent', async ($, on) => {
  const world = stage(on)
  await begin($)

  expect(await stepModelOf($, world)).toBe(SESSION_MODEL)

  await as($, 'worker')

  expect(await stepModelOf($, world)).toBe('claude-opus-5-5[1m]')
  expect(await stepModelOf($, world, 'sub-1')).toBe(SESSION_MODEL)
})

test('a step the engine moved off the session model keeps the model it came with', async ($, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'worker')

  expect(await stepModelOf($, world, undefined, 'claude-fallback-1')).toBe('claude-fallback-1')
})

test('an agent without a model leaves the step model alone', async ($, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'plain')

  expect(await stepModelOf($, world)).toBe(SESSION_MODEL)
})

test('a model alias is resolved through modelAliases', async ($, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'aliased')

  expect(await stepModelOf($, world)).toBe('claude-sonnet-5-5')
})

test('an alias is matched without regard to case', async ($, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'shouty')

  expect(await stepModelOf($, world)).toBe('claude-sonnet-5-5')
})

test('modelAliases from the options replace the defaults', { options: { modelAliases: 'fast=claude-opus-5-5' } }, async ($, on) => {
  const world = stage(on)
  await begin($)

  const text = await as($, 'custom')

  expect(await stepModelOf($, world)).toBe('claude-opus-5-5')
  expect(text).not.toContain('apelido')
})

test('an unknown alias leaves the model alone and is reported', async ($, on) => {
  const world = stage(on)
  await begin($)

  const text = await as($, 'lost')

  expect(text).toContain('O modelo "gemini" não tem apelido configurado')
  expect(await stepModelOf($, world)).toBe(SESSION_MODEL)
})

test('a tool outside the allowlist is denied on the main loop and passes in a subagent loop', async ($, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'restricted')

  const denied = await useTool($, world, 'Bash')
  const allowed = await useTool($, world, 'Read')
  const inSubagent = await useTool($, world, 'Bash', 'sub-1')

  expect(denied.reached).toBe(false)
  expect(JSON.stringify(denied.result)).toContain('restricted')
  expect(JSON.stringify(denied.result)).toContain('Read, Grep')
  expect(allowed.reached).toBe(true)
  expect(inSubagent.reached).toBe(true)
})

const CALLER: Plugin = {
  name: 'caller',
  register(on) {
    on('command.run', { command: 'call-bash' }, async $ => {
      const result = await $.tool.call({ tool: 'Bash' } as never)

      return { text: JSON.stringify(result) }
    })
  },
}

test('a tool call another plugin makes is not judged by the guard', { plugins: [CALLER] }, async ($, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'restricted')

  await run($, 'call-bash', '')

  expect(world.tools).toEqual([{ tool: 'Bash', agentId: undefined }])
  expect((await useTool($, world, 'Bash')).reached).toBe(false)
})

test('disallowedTools with a wildcard denies matching tools only', async ($, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'careful')

  expect((await useTool($, world, 'Bash')).reached).toBe(false)
  expect((await useTool($, world, 'mcp__github__create_issue')).reached).toBe(false)
  expect((await useTool($, world, 'Read')).reached).toBe(true)
})

test('a server-level disallowed entry denies that server and a suffix on the entry is ignored', async ($, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'serverless')

  expect((await useTool($, world, 'mcp__Claude_Browser__navigate')).reached).toBe(false)
  expect((await useTool($, world, 'mcp__Claude_Browser_Other__navigate')).reached).toBe(true)
  expect((await useTool($, world, 'Write')).reached).toBe(false)
  expect((await useTool($, world, 'Edit')).reached).toBe(true)
})

test('/as off restores compose, model and tools', async ($, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'worker')
  await as($, 'restricted')
  await as($, 'off')

  expect(await idsOf($)).toEqual(BASE_IDS)
  expect(await stepModelOf($, world)).toBe(SESSION_MODEL)
  expect((await useTool($, world, 'Bash')).reached).toBe(true)
  expect(await as($, 'off')).toContain('Nenhum agente está ativo')
})

test('before the first turn /as and /as off append nothing; after it /as appends a hidden row', async ($, on) => {
  const world = stage(on)
  await begin($)

  const before = await as($, 'plain')
  const off = await as($, 'off')
  await as($, 'plain')

  expect(world.session.appended()).toHaveLength(0)
  expect(before).toContain('Agente plain ativo.')
  expect(before).not.toContain('/clear')
  expect(off).toContain('Agente plain desativado.')
  expect(off).not.toContain('/clear')

  await startTurn($)
  const after = await as($, 'restricted')

  expect(world.session.appended()).toHaveLength(1)
  expect(world.session.appended()[0]?.message.type).toBe('user')
  expect(rowText(world, 0)).toContain('act as the agent \\"restricted\\"')
  expect(rowText(world, 0)).toContain('only these tools: Read, Grep')
  expect(after).toContain('depois de um /clear ou de uma compactação')
})

test('/as off after the conversation started appends the ending notice', async ($, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'plain')
  await startTurn($)

  const text = await as($, 'off')

  expect(world.session.appended()).toHaveLength(1)
  expect(rowText(world, 0)).toContain('The role of the agent \\"plain\\" has ended')
  expect(text).toContain('depois de um /clear ou de uma compactação')
})

test('a refused hidden row leaves model and tools in force and /as says the instructions did not get in', async ($, on) => {
  const world = stage(on)
  await begin($)
  await startTurn($)
  world.refusesAppend = true

  const activated = await as($, 'restricted')

  expect(world.session.appended()).toHaveLength(0)
  expect(activated).toContain('as instruções do agente não entraram na conversa')
  expect((await useTool($, world, 'Bash')).reached).toBe(false)

  const off = await as($, 'off')

  expect(off).toContain('o aviso de que o papel acabou não entrou na conversa')
  expect((await useTool($, world, 'Bash')).reached).toBe(true)
})

test('after a compaction /as still appends the hidden row', async ($, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'plain')
  await startTurn($)
  await $.classic.SessionStart({ source: 'compact' })
  await as($, 'restricted')

  expect(world.session.appended()).toHaveLength(1)
})

test('the agent survives /clear, the entry moves to the new session id and the prompt counts as open again', async ($, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'restricted')
  await startTurn($)
  world.sessionId = 'session-2'
  await $.classic.SessionStart({ source: 'clear' })

  expect((await sectionsOf($))[0]?.id).toBe('agent-studio:agent')
  expect((await useTool($, world, 'Bash')).reached).toBe(false)
  expect(world.store.has(keyOf(SESSION))).toBe(false)
  expect(world.store.get(keyOf('session-2'))).toEqual({ ...saved('restricted'), at: NOW })

  await as($, 'plain')

  expect(world.session.appended()).toHaveLength(0)
})

test('/as x saves a pointer without the body and /as off keeps only the opt-out', async ($, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'worker')

  expect(world.store.get(keyOf(SESSION))).toEqual({ ...saved('worker'), at: NOW })

  await as($, 'off')

  expect(world.store.get(keyOf(SESSION))).toEqual({ agent: null, native: null, at: NOW, optedOut: true })
})

test('a new process restores the agent from the store with one file read and no directory listing', async ($, on) => {
  const world = stage(on, { store: { [keyOf(SESSION)]: saved('restricted') } })
  await begin($)

  expect(world.lists).toEqual([])
  expect(world.reads).toEqual([pathOf('restricted')])
  expect((await sectionsOf($))[0]?.text).toContain('You are restricted.')
  expect((await useTool($, world, 'Bash')).reached).toBe(false)
  expect(await as($, '?')).toContain('Agente ativo: restricted (projeto)')
})

test('a restored agent gets its model resolved again', async ($, on) => {
  const world = stage(on, { store: { [keyOf(SESSION)]: saved('aliased') } })
  await begin($)

  expect(await stepModelOf($, world)).toBe('claude-sonnet-5-5')
})

test('a saved pointer to a missing file leaves no agent and removes the key', async ($, on) => {
  const world = stage(on, { store: { [keyOf(SESSION)]: saved('vanished') } })
  await begin($)

  expect(await idsOf($)).toEqual(BASE_IDS)
  expect(await as($, '?')).toContain('Nenhum agente ativo')
  expect(world.store.has(keyOf(SESSION))).toBe(false)
})

test('a saved pointer to a file that no longer parses leaves no agent and removes the key', async ($, on) => {
  const world = stage(on, {
    agents: [{ file: pathOf('broken'), text: '---\nname: broken\n---\nx' }],
    store: { [keyOf(SESSION)]: saved('broken') },
  })
  await begin($)

  expect(await idsOf($)).toEqual(BASE_IDS)
  expect(world.store.has(keyOf(SESSION))).toBe(false)
})

test('a saved pointer to a file that now holds another agent leaves no agent', async ($, on) => {
  const world = stage(on, {
    agents: [{ file: pathOf('renamed'), text: agent('someone-else', 'tools: Read\n') }],
    store: { [keyOf(SESSION)]: saved('renamed') },
  })
  await begin($)

  expect(await idsOf($)).toEqual(BASE_IDS)
  expect((await useTool($, world, 'Bash')).reached).toBe(true)
  expect(world.store.has(keyOf(SESSION))).toBe(false)
})

test('a store entry of another shape is ignored', async ($, on) => {
  stage(on, { store: { [keyOf(SESSION)]: { agent: 'restricted' } } })
  await begin($)

  expect(await idsOf($)).toEqual(BASE_IDS)
})

test('a resume in the same process drops the agent of the session it left', async ($, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'restricted')
  await startTurn($)
  world.sessionId = 'session-2'
  await $.classic.SessionStart({ source: 'resume' })

  expect(await idsOf($)).toEqual(BASE_IDS)
  expect((await useTool($, world, 'Bash')).reached).toBe(true)
  expect(world.store.get(keyOf(SESSION))).toEqual({ ...saved('restricted'), at: NOW })

  await as($, 'plain')

  expect(world.session.appended()).toHaveLength(0)
})

test('a resume in the same process takes the agent saved for the session it enters', async ($, on) => {
  const world = stage(on, { store: { [keyOf('session-2')]: saved('careful') } })
  await begin($)
  await as($, 'restricted')
  world.sessionId = 'session-2'
  await $.classic.SessionStart({ source: 'resume' })

  expect(await as($, '?')).toContain('Agente ativo: careful')
  expect((await useTool($, world, 'Grep')).reached).toBe(true)
  expect((await useTool($, world, 'Bash')).reached).toBe(false)
})

test('a fork starts from what is saved for the new session id', async ($, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'restricted')
  world.sessionId = 'session-3'
  await $.classic.SessionStart({ source: 'fork' })

  expect(await as($, '?')).toContain('Nenhum agente ativo')
})

test('the two process flags are written to $.state as the session moves', async ($, on) => {
  const world = stage(on)
  await begin($)

  expect(world.stateWrites).toEqual([])

  await sectionsOf($)

  expect(lastWrite(world, 'composeSeen')).toBe(true)
  expect(lastWrite(world, 'promptFrozen')).toBe(false)

  await startTurnWithoutCompose($)

  expect(lastWrite(world, 'promptFrozen')).toBe(true)

  await $.classic.SessionStart({ source: 'clear' })

  expect(lastWrite(world, 'promptFrozen')).toBe(false)
  expect(lastWrite(world, 'composeSeen')).toBe(true)
})

test('a module that starts with the flags already in $.state takes them', async ($, on) => {
  const world = stage(on, { flags: { promptFrozen: true, composeSeen: true } })
  await begin($)
  await as($, 'restricted')

  expect(world.session.appended()).toHaveLength(1)

  await startTurnWithoutCompose($)

  expect(world.toasts).toEqual([])
  expect((await useTool($, world, 'Bash')).reached).toBe(false)
})

test('/as ? describes the active agent, its model and its tool restriction', async ($, on) => {
  stage(on)
  await begin($)

  expect(await as($, '?')).toContain('Nenhum agente ativo')

  await as($, 'worker')
  const worker = await as($, '?')

  expect(worker).toContain('Agente ativo: worker (projeto)')
  expect(worker).toContain('Modelo: claude-opus-5-5[1m]')
  expect(worker).toContain('Ferramentas permitidas: todas')

  await as($, 'restricted')

  expect(await as($, '?')).toContain('Ferramentas permitidas: Read, Grep')
})

test('/as with an unknown name says so and lists the names', async ($, on) => {
  stage(on)
  await begin($)

  const text = await as($, 'nobody')

  expect(text).toContain('Não há agente chamado "nobody"')
  expect(text).toContain('plain')
  expect((await sectionsOf($))[0]?.id).toBe('lean_body')
})

test('/as reports the fields it read but does not apply', async ($, on) => {
  stage(on)
  await begin($)

  const text = await as($, 'extras')

  expect(text).toContain('skills')
  expect(text).toContain('permissionMode')
})

test('/as --reload picks up files created after the session started', async ($, on) => {
  const world = stage(on)
  await begin($)

  expect(await as($, 'late')).toContain('Não há agente chamado "late"')

  world.files.push({ file: pathOf('late'), text: agent('late') })

  expect(await as($, '--reload')).toContain('12 agentes encontrados')
  expect(await as($, 'late')).toContain('Agente late ativo.')
})

test('/as --reload brings the active agent up to date with its file', async ($, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'plain')

  expect((await useTool($, world, 'Bash')).reached).toBe(true)

  world.files = world.files.map(entry =>
    entry.file === pathOf('plain') ? { ...entry, text: agent('plain', 'tools: Read\nmodel: sonnet\n') } : entry,
  )
  await as($, '--reload')

  expect((await useTool($, world, 'Bash')).reached).toBe(false)
  expect(await stepModelOf($, world)).toBe('claude-sonnet-5-5')
  expect(await as($, '?')).toContain('Ferramentas permitidas: Read')
})

test('/as --reload keeps the active agent as loaded when its file is gone, and says so', async ($, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'restricted')

  world.files = world.files.filter(entry => entry.file !== pathOf('restricted'))
  const text = await as($, '--reload')

  expect(text).toContain('10 agentes encontrados')
  expect(text).toContain('O arquivo do agente restricted não está mais no catálogo')
  expect((await useTool($, world, 'Bash')).reached).toBe(false)
  expect(await as($, '?')).toContain('Agente ativo: restricted')
})

test('the project agent beats the user agent with the same name through the engine', async ($, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'worker')

  expect(await stepModelOf($, world)).toBe('claude-opus-5-5[1m]')
  expect(await as($, '?')).toContain(pathOf('worker'))
})

test('in a session with a native agent /as changes nothing, and the list and /as ? say why', async ($, on) => {
  const world = stage(on)
  await begin($)
  await $.classic.SessionStart({ source: 'startup', agent_type: 'architect' })

  const text = await as($, 'plain')
  const off = await as($, 'off')

  expect(text).toContain('já roda como o agente architect')
  expect(off).toContain('já roda como o agente architect')
  expect(await as($, '?')).toContain('já roda como o agente architect')
  expect(await as($, '')).toContain('já roda como o agente architect')
  expect((await sectionsOf($))[0]?.id).toBe('lean_body')
  expect(world.session.appended()).toHaveLength(0)
  expect(world.store.get(keyOf(SESSION))).toEqual({ agent: null, native: 'architect', at: NOW })
})

test('a SessionStart for a native agent while the session id answers empty writes no key to the store', async ($, on) => {
  const world = stage(on)
  world.sessionId = ''
  await begin($)
  await $.classic.SessionStart({ source: 'startup', agent_type: 'architect' })

  expect([...world.store.keys()]).toEqual([])
})

test('a SessionStart with a null agent_type does not forget the native agent', async ($, on) => {
  stage(on)
  await begin($)
  await $.classic.SessionStart({ source: 'startup', agent_type: 'architect' })
  await $.classic.SessionStart({ source: 'compact', agent_type: null } as never)

  expect(await as($, 'plain')).toContain('já roda como o agente architect')
})

test('the native agent saved for the session survives a new process', async ($, on) => {
  stage(on, { store: { [keyOf(SESSION)]: saved(null, 'architect') } })
  await begin($)

  expect(await as($, 'plain')).toContain('já roda como o agente architect')
  expect((await sectionsOf($))[0]?.id).toBe('lean_body')
})

test('a saved entry with both a native agent and an /as agent applies nothing of the /as agent', async ($, on) => {
  const world = stage(on, { store: { [keyOf(SESSION)]: saved('restricted', 'architect') } })
  await begin($)

  expect(await idsOf($)).toEqual(BASE_IDS)
  expect((await useTool($, world, 'Bash')).reached).toBe(true)
  expect(await as($, '')).not.toContain('* restricted')
})

test('an agent active when the session turns out to be native stops acting', async ($, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'restricted')
  await $.classic.SessionStart({ source: 'startup', agent_type: 'architect' })

  expect((await useTool($, world, 'Bash')).reached).toBe(true)
  expect(await stepModelOf($, world)).toBe(SESSION_MODEL)
})

test('a first turn with no prompt.compose before it marks the session native, drops the agent and tells the user', async ($, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'restricted')
  await startTurnWithoutCompose($)

  expect(world.toasts).toHaveLength(1)
  expect(world.toasts[0]).toContain('restricted')
  expect((await useTool($, world, 'Bash')).reached).toBe(true)
  expect(world.store.get(keyOf(SESSION))).toEqual({ agent: null, native: '', at: NOW })
  expect(await as($, 'plain')).toContain('já roda como um agente nativo')
  expect(world.session.appended()).toHaveLength(0)
})

test('a native session found with no agent active is marked without a toast', async ($, on) => {
  const world = stage(on)
  await begin($)
  await startTurnWithoutCompose($)

  expect(world.toasts).toEqual([])
  expect(await as($, 'plain')).toContain('já roda como um agente nativo')
})

test('a first turn that follows prompt.compose leaves the agent alone', async ($, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'restricted')
  await startTurn($)

  expect(world.toasts).toEqual([])
  expect((await useTool($, world, 'Bash')).reached).toBe(false)
  expect(await as($, '?')).toContain('Agente ativo: restricted')
})

test('with enableLauncher false the plugin hooks nothing', { options: { enableLauncher: false } }, async ($, on) => {
  const world = stage(on)
  on('command.run', () => ({ text: 'bottom answered' }))
  await begin($)

  expect(await as($, 'plain')).toBe('bottom answered')
  expect(await idsOf($)).toEqual(BASE_IDS)
  expect((await useTool($, world, 'Bash')).reached).toBe(true)
})

const EXTRA_AGENTS: Agent[] = [
  { file: pathOf('designer'), text: agent('designer', 'model: claude-opus-5-5[1m]\neffort: xhigh\n') },
  { file: pathOf('thinker'), text: agent('thinker', 'effort: high\n') },
  { file: pathOf('loud'), text: agent('loud', 'effort: XHigh\n') },
  { file: pathOf('muddled'), text: agent('muddled', 'effort: turbo\n') },
  { file: pathOf('starter'), text: agent('starter', 'initialPrompt: start here\n') },
  { file: pathOf('blank-start'), text: agent('blank-start', 'initialPrompt: |\n') },
  { file: pathOf('dispatcher'), text: agent('dispatcher', 'tools: Agent(researcher), Read\n') },
  { file: pathOf('free-dispatcher'), text: agent('free-dispatcher', 'tools: Agent, Read\n') },
  { file: pathOf('multi-dispatcher'), text: agent('multi-dispatcher', 'tools: Agent(a), Agent(b, c)\n') },
  { file: pathOf('reader'), text: agent('reader', 'tools: Read\n') },
]

const WITH_EXTRAS = [...DEFAULT_AGENTS, ...EXTRA_AGENTS]

const DESIGNER_LINE = '@designer · claude-opus-5-5[1m] · xhigh'

test('turn.step takes the agent effort on the main loop and leaves a subagent step alone', async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS })
  await begin($)

  expect(await stepEffortOf($, world, { effort: 'low' })).toBe('low')

  await as($, 'designer')

  expect(await stepEffortOf($, world, { effort: 'low' })).toBe('xhigh')
  expect(await stepEffortOf($, world)).toBe('xhigh')
  expect(await stepEffortOf($, world, { agentId: 'sub-1', effort: 'low' })).toBe('low')
  expect(await stepEffortOf($, world, { agentId: 'sub-1' })).toBeUndefined()
})

test('the effort does not depend on the model comparison, which only guards the model', async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS })
  await begin($)
  await as($, 'designer')

  const step = await stepOf($, world, { model: 'claude-fallback-1', effort: 'low' })

  expect(step?.model).toBe('claude-fallback-1')
  expect(step?.effort).toBe('xhigh')
})

test('an agent with an effort and no model changes the effort only', async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS })
  await begin($)
  await as($, 'thinker')

  const step = await stepOf($, world)

  expect(step?.model).toBe(SESSION_MODEL)
  expect(step?.effort).toBe('high')
})

test('an agent without effort leaves the step effort as it came', async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS })
  await begin($)
  await as($, 'worker')

  expect(await stepEffortOf($, world, { effort: 'medium' })).toBe('medium')
  expect(await stepEffortOf($, world)).toBeUndefined()
})

test('the effort word is matched without regard to case', async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS })
  await begin($)
  await as($, 'loud')

  expect(await stepEffortOf($, world)).toBe('xhigh')
})

test('an effort outside the five words is not applied, and /as says so', { options: { enableMonitor: false } }, async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS })
  await begin($)

  const text = await as($, 'muddled')

  expect(text).toContain('O effort "turbo"')
  expect(text).toContain('low, medium, high, xhigh, max')
  expect(await stepEffortOf($, world, { effort: 'low' })).toBe('low')
  expect(await as($, '?')).toContain('Effort: o da sessão')
  expect(world.statuses).toEqual(['@muddled', '@muddled'])
})

test('a valid effort adds no warning to /as', async ($, on) => {
  stage(on, { agents: WITH_EXTRAS })
  await begin($)

  expect(await as($, 'designer')).not.toContain('effort')
})

test('/as ? shows the effort of the agent or says it is the session one', async ($, on) => {
  stage(on, { agents: WITH_EXTRAS })
  await begin($)
  await as($, 'designer')

  const designer = (await as($, '?')).split('\n')

  expect(designer.indexOf('Effort: xhigh')).toBe(designer.findIndex(line => line.startsWith('Modelo:')) + 1)

  await as($, 'plain')

  expect(await as($, '?')).toContain('Effort: o da sessão')
})

test('the status line is written on /as, replaced by the next agent and cleared by /as off', { options: { enableMonitor: false } }, async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS })
  await begin($)

  expect(world.statuses).toEqual([])

  await as($, 'designer')
  await as($, 'plain')
  await as($, 'thinker')
  await as($, 'worker')
  await as($, 'off')

  expect(world.statuses).toEqual([DESIGNER_LINE, '@plain', '@thinker · high', '@worker · claude-opus-5-5[1m]', undefined])
})

test('the status line shows the resolved model of an alias', { options: { enableMonitor: false } }, async ($, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'aliased')

  expect(world.statuses).toEqual(['@aliased · claude-sonnet-5-5'])
})

test('the status line is cleared when the session turns out to be native', { options: { enableMonitor: false } }, async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS })
  await begin($)
  await as($, 'designer')
  await $.classic.SessionStart({ source: 'startup', agent_type: 'architect' })

  expect(world.statuses).toEqual([DESIGNER_LINE, undefined])
})

test('the status line is cleared when the first turn shows the session is native', { options: { enableMonitor: false } }, async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS })
  await begin($)
  await as($, 'designer')
  await startTurnWithoutCompose($)

  expect(world.statuses).toEqual([DESIGNER_LINE, undefined])
})

test('an agent restored from the store in a new process writes the status line with no /as', { options: { enableMonitor: false } }, async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS, store: { [keyOf(SESSION)]: saved('designer') } })
  await begin($)

  expect(world.statuses).toEqual([DESIGNER_LINE])
})

test('a restored agent has its status line written again at each turn start and by /as ?', { options: { enableMonitor: false } }, async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS, store: { [keyOf(SESSION)]: saved('designer') } })
  await begin($)
  await startTurn($)

  expect(world.statuses).toEqual([DESIGNER_LINE, DESIGNER_LINE])

  await as($, '?')

  expect(world.statuses).toEqual([DESIGNER_LINE, DESIGNER_LINE, DESIGNER_LINE])
})

test('with the Monitor on /as, a replacement and /as off send the summary of the Monitor, and undefined when it is empty', async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS })
  await begin($)
  await as($, 'designer')
  await as($, 'thinker')
  await as($, 'off')

  expect(world.statuses).toEqual([DESIGNER_LINE, '@thinker · high', undefined])
})

test('with the Monitor on a restored agent sends the summary at the start, at a turn start and on /as ?', async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS, store: { [keyOf(SESSION)]: saved('designer') } })
  await begin($)

  expect(world.statuses).toEqual([DESIGNER_LINE])

  await startTurn($)

  expect(world.statuses).toEqual([DESIGNER_LINE, DESIGNER_LINE])

  await as($, '?')

  expect(world.statuses).toEqual([DESIGNER_LINE, DESIGNER_LINE, DESIGNER_LINE])
})

test('with no agent in force a turn start and /as ? do not touch the status line', { options: { enableMonitor: false } }, async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS })
  await begin($)
  await startTurn($)
  await as($, '?')

  expect(world.statuses).toEqual([])
})

test('a start with no agent to restore does not touch the status line', { options: { enableMonitor: false } }, async ($, on) => {
  const world = stage(on, { store: { [keyOf(SESSION)]: saved(null, 'architect') } })
  await begin($)

  expect(world.statuses).toEqual([])
})

test('a start that cannot restore the saved agent does not touch the status line', { options: { enableMonitor: false } }, async ($, on) => {
  const world = stage(on, { store: { [keyOf(SESSION)]: saved('vanished') } })
  await begin($)

  expect(world.statuses).toEqual([])
})

test('a resume writes the status line for the agent of the session it enters and clears it when there is none', { options: { enableMonitor: false } }, async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS, store: { [keyOf('session-2')]: saved('thinker') } })
  await begin($)
  await as($, 'designer')
  world.sessionId = 'session-2'
  await $.classic.SessionStart({ source: 'resume' })

  expect(world.statuses).toEqual([DESIGNER_LINE, '@thinker · high'])

  world.sessionId = 'session-3'
  await $.classic.SessionStart({ source: 'resume' })

  expect(world.statuses).toEqual([DESIGNER_LINE, '@thinker · high', undefined])
})

test('a resume into a native session shows no status line for the agent saved beside it', { options: { enableMonitor: false } }, async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS, store: { [keyOf('session-2')]: saved('designer', 'architect') } })
  await begin($)
  await as($, 'thinker')
  world.sessionId = 'session-2'
  await $.classic.SessionStart({ source: 'resume' })

  expect(world.statuses).toEqual(['@thinker · high', undefined])
})

test('a fork clears the status line when the new session has no agent', { options: { enableMonitor: false } }, async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS })
  await begin($)
  await as($, 'designer')
  world.sessionId = 'session-3'
  await $.classic.SessionStart({ source: 'fork' })

  expect(world.statuses).toEqual([DESIGNER_LINE, undefined])
})

test('/as --reload rewrites the status line from the new file', { options: { enableMonitor: false } }, async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS })
  await begin($)
  await as($, 'designer')

  world.files = world.files.map(entry =>
    entry.file === pathOf('designer') ? { ...entry, text: agent('designer', 'effort: low\n') } : entry,
  )
  await as($, '--reload')

  expect(world.statuses).toEqual([DESIGNER_LINE, '@designer · low'])
  expect(await stepEffortOf($, world)).toBe('low')
})

test('/as off with no agent in force leaves the status line alone', { options: { enableMonitor: false } }, async ($, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'off')

  expect(world.statuses).toEqual([])
})

const submissions = async (world: Stage) => {
  await world.clock.settle()

  return world.submitted.length
}

test('/as on an agent with an initialPrompt submits the text once, as the user', async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS })
  await begin($)
  await as($, 'starter')

  expect(world.submitted).toEqual([])

  await world.clock.settle()

  expect(world.submitted).toEqual([
    { text: 'start here', origin: { kind: 'plugin', name: 'agent-studio', asUser: true } },
  ])
})

test('a failing submit does not undo the activation', async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS, submitFail: true })
  await begin($)

  expect(await as($, 'starter')).toContain('Agente starter ativo.')
  expect(await submissions(world)).toBe(0)
  expect(world.store.get(keyOf(SESSION))).toEqual({ ...saved('starter'), at: NOW })
  expect((await sectionsOf($))[0]?.id).toBe('agent-studio:agent')
})

test('an agent without an initialPrompt, or with an empty one, submits nothing', async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS })
  await begin($)
  await as($, 'plain')
  await as($, 'blank-start')

  expect(await submissions(world)).toBe(0)
})

test('/as refused for an unknown name submits nothing', async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS })
  await begin($)
  await as($, 'nobody')

  expect(await submissions(world)).toBe(0)
})

test('/as refused in a native session submits nothing', async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS })
  await begin($)
  await $.classic.SessionStart({ source: 'startup', agent_type: 'architect' })
  await as($, 'starter')

  expect(await submissions(world)).toBe(0)
})

test('an agent with an initialPrompt restored from the store in a new process submits nothing', async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS, store: { [keyOf(SESSION)]: saved('starter') } })
  await begin($)

  expect(await as($, '?')).toContain('Agente ativo: starter')
  expect(await submissions(world)).toBe(0)
})

test('/clear with an initialPrompt agent in force submits nothing', async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS, store: { [keyOf(SESSION)]: saved('starter') } })
  await begin($)
  world.sessionId = 'session-2'
  await $.classic.SessionStart({ source: 'clear' })

  expect(await as($, '?')).toContain('Agente ativo: starter')
  expect(await submissions(world)).toBe(0)
})

test('a resume or a fork into a session whose agent has an initialPrompt submits nothing', async ($, on) => {
  const world = stage(on, {
    agents: WITH_EXTRAS,
    store: { [keyOf('session-2')]: saved('starter'), [keyOf('session-3')]: saved('starter') },
  })
  await begin($)
  world.sessionId = 'session-2'
  await $.classic.SessionStart({ source: 'resume' })

  expect(await as($, '?')).toContain('Agente ativo: starter')

  world.sessionId = 'session-3'
  await $.classic.SessionStart({ source: 'fork' })

  expect(await as($, '?')).toContain('Agente ativo: starter')
  expect(await submissions(world)).toBe(0)
})

test('/as --reload with an initialPrompt agent in force submits nothing', async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS, store: { [keyOf(SESSION)]: saved('starter') } })
  await begin($)
  await as($, '--reload')

  expect(await as($, '?')).toContain('Agente ativo: starter')
  expect(await submissions(world)).toBe(0)
})

test('a classic SessionStart that names a native agent submits nothing', async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS, store: { [keyOf(SESSION)]: saved('starter') } })
  await begin($)
  await $.classic.SessionStart({ source: 'startup', agent_type: 'architect' })

  expect(await submissions(world)).toBe(0)
})

test('a classic SessionStart with an agent_type before session.start saves only launcher:<id> and the session stays native', async ($, on) => {
  const world = stage(on)
  await $.classic.SessionStart({ source: 'startup', agent_type: 'architect' })

  expect([...world.store.keys()]).toEqual([keyOf(SESSION)])

  await begin($)

  expect([...world.store.keys()]).toEqual([keyOf(SESSION)])
  expect(world.store.get(keyOf(SESSION))).toEqual({ agent: null, native: 'architect', at: NOW })
  expect(await as($, '?')).toContain('já roda como o agente architect')
})

test('session.start keeps a native agent found before it when the saved entry carries none', { options: { enableMonitor: false } }, async ($, on) => {
  const world = stage(on, { settings: { agent: 'plain' } })
  await $.classic.SessionStart({ source: 'startup', agent_type: 'architect' })
  world.store.delete(keyOf(SESSION))
  await begin($)

  expect(await as($, '?')).toContain('já roda como o agente architect')
  expect(world.store.has(keyOf(SESSION))).toBe(false)
  expect(world.statuses.filter(text => text !== undefined)).toEqual([])
})

test('a new session with the settings agent starts with it in force and saved, with no row, no toast and no submit', { options: { enableMonitor: false } }, async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS, settings: { agent: 'starter' } })
  await begin($)

  expect((await sectionsOf($))[0]?.id).toBe('agent-studio:agent')
  expect(world.store.get(keyOf(SESSION))).toEqual({ ...saved('starter'), at: NOW, byDefault: true })
  expect(world.statuses).toEqual(['@starter'])
  expect(world.toasts).toEqual([])
  expect(world.session.appended()).toHaveLength(0)
  expect(await submissions(world)).toBe(0)
})

test('the settings agent restricts tools and moves the model like a /as would', async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS, settings: { agent: 'restricted' } })
  await begin($)

  expect((await useTool($, world, 'Bash')).reached).toBe(false)
  expect(await as($, '?')).toContain('Agente ativo: restricted (projeto)')
})

test('a start without the agent key lists no folder and saves nothing', { options: { enableMonitor: false } }, async ($, on) => {
  const world = stage(on, { settings: { model: 'opus' } })
  await begin($)

  expect(world.lists).toEqual([])
  expect(world.reads).toEqual([])
  expect(world.store.size).toBe(0)
  expect(world.statuses).toEqual([])
})

test('an agent key that that is not a string is ignored', async ($, on) => {
  const world = stage(on, { settings: { agent: 42 } })
  await begin($)

  expect(world.lists).toEqual([])
  expect(world.store.size).toBe(0)
})

test('an empty agent key is ignored', async ($, on) => {
  const world = stage(on, { settings: { agent: '' } })
  await begin($)

  expect(world.lists).toEqual([])
  expect(world.store.size).toBe(0)
})

test('/as off in a session with the settings agent is saved as the user choice', { options: { enableMonitor: false } }, async ($, on) => {
  const world = stage(on, { settings: { agent: 'restricted' } })
  await begin($)
  await as($, 'off')

  expect(world.store.get(keyOf(SESSION))).toEqual({ agent: null, native: null, at: NOW, optedOut: true })
  expect(world.statuses).toEqual(['@restricted', undefined])
})

test('/as off survives a new process: the settings agent does not come back', { options: { enableMonitor: false } }, async ($, on) => {
  const world = stage(on, {
    settings: { agent: 'restricted' },
    store: { [keyOf(SESSION)]: { agent: null, native: null, at: 1, optedOut: true } },
  })
  await begin($)

  expect(world.lists).toEqual([])
  expect(await as($, '?')).toContain('Nenhum agente ativo')
  expect((await useTool($, world, 'Bash')).reached).toBe(true)
  expect(world.toasts).toEqual([])
  expect(world.statuses).toEqual([])
})

test('/as off on an agent chosen by hand is saved as the user choice as well', async ($, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'plain')
  await as($, 'off')

  expect(world.store.get(keyOf(SESSION))).toEqual({ agent: null, native: null, at: NOW, optedOut: true })
})

test('/as x after /as off takes the opt-out and the default mark off the entry', async ($, on) => {
  const world = stage(on, { settings: { agent: 'restricted' } })
  await begin($)
  await as($, 'off')
  await as($, 'plain')

  expect(world.store.get(keyOf(SESSION))).toEqual({ ...saved('plain'), at: NOW })

  await as($, 'off')
  await as($, 'plain')
  await as($, 'off')

  expect(world.store.get(keyOf(SESSION))).toEqual({ agent: null, native: null, at: NOW, optedOut: true })
})

test('/as x over the settings agent takes the default mark off the entry', async ($, on) => {
  const world = stage(on, { settings: { agent: 'restricted' } })
  await begin($)
  await as($, 'plain')

  expect(world.store.get(keyOf(SESSION))).toEqual({ ...saved('plain'), at: NOW })
})

test('an entry saved with an agent beats the settings agent', async ($, on) => {
  const world = stage(on, { settings: { agent: 'restricted' }, store: { [keyOf(SESSION)]: saved('plain') } })
  await begin($)

  expect(await as($, '?')).toContain('Agente ativo: plain')
  expect(world.lists).toEqual([])
  expect(world.store.get(keyOf(SESSION))).toEqual(saved('plain'))
})

test('a restored settings agent keeps its default mark in the store', async ($, on) => {
  const entry = { ...saved('restricted'), byDefault: true as const }
  const world = stage(on, { settings: { agent: 'plain' }, store: { [keyOf(SESSION)]: entry } })
  await begin($)

  expect(await as($, '?')).toContain('Agente ativo: restricted')

  await as($, '--reload')

  expect(world.store.get(keyOf(SESSION))).toEqual({ ...entry, at: NOW })

  await as($, 'off')

  expect(world.store.get(keyOf(SESSION))).toEqual({ agent: null, native: null, at: NOW, optedOut: true })
})

test('a settings agent restored in a new process is dropped in silence when the session turns out native', async ($, on) => {
  const entry = { ...saved('restricted'), byDefault: true as const }
  const world = stage(on, { store: { [keyOf(SESSION)]: entry } })
  await begin($)
  await $.classic.SessionStart({ source: 'startup', agent_type: 'architect' })

  expect(world.toasts).toEqual([])
})

test('an opt-out restored in a new process moves with /clear to the new session id', async ($, on) => {
  const world = stage(on, {
    settings: { agent: 'restricted' },
    store: { [keyOf(SESSION)]: { agent: null, native: null, at: 1, optedOut: true } },
  })
  await begin($)
  world.sessionId = 'session-2'
  await $.classic.SessionStart({ source: 'clear' })

  expect(world.store.get(keyOf('session-2'))).toEqual({ agent: null, native: null, at: NOW, optedOut: true })
  expect(world.store.has(keyOf(SESSION))).toBe(false)
})

test('a native entry saved for the session beats the settings agent and shows no toast', async ($, on) => {
  const world = stage(on, { settings: { agent: 'restricted' }, store: { [keyOf(SESSION)]: saved(null, 'architect') } })
  await begin($)

  expect(world.lists).toEqual([])
  expect(await idsOf($)).toEqual(BASE_IDS)
  expect(world.toasts).toEqual([])
})

test('a session that turns out native drops the settings agent in silence', { options: { enableMonitor: false } }, async ($, on) => {
  const world = stage(on, { settings: { agent: 'restricted' } })
  await begin($)
  await $.classic.SessionStart({ source: 'startup', agent_type: 'architect' })

  expect(world.toasts).toEqual([])
  expect(await idsOf($)).toEqual(BASE_IDS)
  expect(world.store.get(keyOf(SESSION))).toEqual({ agent: null, native: 'architect', at: NOW })
  expect(world.statuses).toEqual(['@restricted', undefined])
})

test('a first turn with no prompt.compose drops the settings agent in silence', async ($, on) => {
  const world = stage(on, { settings: { agent: 'restricted' } })
  await begin($)
  await startTurnWithoutCompose($)

  expect(world.toasts).toEqual([])
  expect(world.store.get(keyOf(SESSION))).toEqual({ agent: null, native: '', at: NOW })
})

test('the toast for an agent chosen by hand stays when the session turns out native', async ($, on) => {
  const world = stage(on, { settings: { agent: 'restricted' } })
  await begin($)
  await as($, 'plain')
  await $.classic.SessionStart({ source: 'startup', agent_type: 'architect' })

  expect(world.toasts).toHaveLength(1)
  expect(world.toasts[0]).toContain('plain')
})

test('a settings agent missing from the catalog leaves the session without an agent, tells the user once and saves nothing', { options: { enableMonitor: false } }, async ($, on) => {
  const world = stage(on, { settings: { agent: 'ghost' } })
  await begin($)

  expect(world.toasts).toHaveLength(1)
  expect(world.toasts[0]).toContain('"ghost"')
  expect(world.store.size).toBe(0)
  expect(world.statuses).toEqual([])
  expect(await idsOf($)).toEqual(BASE_IDS)
  expect(world.toasts).toHaveLength(1)
})

test('the settings agent is applied at the start only: not on /clear, resume or fork', async ($, on) => {
  const world = stage(on, { settings: { agent: 'restricted' }, agents: WITH_EXTRAS })
  await begin($)
  await as($, 'off')
  world.sessionId = 'session-2'
  await $.classic.SessionStart({ source: 'resume' })

  expect(await as($, '?')).toContain('Nenhum agente ativo')

  world.sessionId = 'session-3'
  await $.classic.SessionStart({ source: 'fork' })

  expect(await as($, '?')).toContain('Nenhum agente ativo')
  expect(world.store.has(keyOf('session-2'))).toBe(false)
  expect(world.store.has(keyOf('session-3'))).toBe(false)
})

test('/clear carries the default mark and the opt-out to the new session id', async ($, on) => {
  const world = stage(on, { settings: { agent: 'restricted' } })
  await begin($)
  world.sessionId = 'session-2'
  await $.classic.SessionStart({ source: 'clear' })

  expect(world.store.get(keyOf('session-2'))).toEqual({ ...saved('restricted'), at: NOW, byDefault: true })
  expect(world.store.has(keyOf(SESSION))).toBe(false)

  await as($, 'off')
  world.sessionId = 'session-3'
  await $.classic.SessionStart({ source: 'clear' })

  expect(world.store.get(keyOf('session-3'))).toEqual({ agent: null, native: null, at: NOW, optedOut: true })
  expect(world.store.has(keyOf('session-2'))).toBe(false)
})

test('a default mark that is not true is ignored, so the toast for a hand-chosen agent stays', async ($, on) => {
  const world = stage(on, { store: { [keyOf(SESSION)]: { ...saved('plain'), byDefault: 1 } } })
  await begin($)
  await $.classic.SessionStart({ source: 'startup', agent_type: 'architect' })

  expect(world.toasts).toHaveLength(1)
})

test('a spawn of a listed type reaches the bottom and an unlisted one is refused naming the allowed types', async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS })
  await begin($)
  await as($, 'dispatcher')

  const allowed = await spawnOf($, world, 'researcher')
  const refused = await spawnOf($, world, 'implementer')

  expect(allowed.reached).toBe(true)
  expect(JSON.stringify(allowed.result)).toContain('spawned-1')
  expect(refused.reached).toBe(false)
  expect(JSON.stringify(refused.result)).toContain('dispatcher')
  expect(JSON.stringify(refused.result)).toContain('researcher')
  expect(JSON.stringify(refused.result)).toContain('implementer')
  expect(world.spawns.map(spawn => spawn.subagentType)).toEqual(['researcher'])
})

test('Agent without parentheses lets any type through', async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS })
  await begin($)
  await as($, 'free-dispatcher')

  expect((await spawnOf($, world, 'implementer')).reached).toBe(true)
  expect((await spawnOf($, world, 'researcher')).reached).toBe(true)
})

test('several Agent(...) entries add up their types', async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS })
  await begin($)
  await as($, 'multi-dispatcher')

  expect((await spawnOf($, world, 'a')).reached).toBe(true)
  expect((await spawnOf($, world, 'b')).reached).toBe(true)
  expect((await spawnOf($, world, 'c')).reached).toBe(true)
  expect((await spawnOf($, world, 'd')).reached).toBe(false)
})

test('an allowlist with no Agent entry leaves spawn to the tool guard', async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS })
  await begin($)
  await as($, 'reader')

  expect((await spawnOf($, world, 'implementer')).reached).toBe(true)
  expect((await useTool($, world, 'Agent')).reached).toBe(false)
})

test('a spawn from inside a subagent loop is not judged', async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS })
  await begin($)
  await as($, 'dispatcher')

  const nested = await spawnOf($, world, 'implementer', 'sub-1')

  expect(nested.reached).toBe(true)
  expect(world.spawns).toEqual([{ subagentType: 'implementer', parentAgentId: 'sub-1' }])
})

const SPAWNER: Plugin = {
  name: 'spawner',
  register(on) {
    on('command.run', { command: 'spawn-other' }, async $ => {
      const result = await $.agent.spawn({ prompt: 'go', description: 'go', subagentType: 'implementer' })

      return { text: JSON.stringify(result) }
    })
  },
}

test('a spawn another plugin makes is not judged', { plugins: [SPAWNER] }, async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS })
  await begin($)
  await as($, 'dispatcher')

  await run($, 'spawn-other', '')

  expect(world.spawns).toHaveLength(1)
  expect((await spawnOf($, world, 'implementer')).reached).toBe(false)
})

test('with no agent in force, after /as off and in a native session every spawn passes', async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS })
  await begin($)

  expect((await spawnOf($, world, 'implementer')).reached).toBe(true)

  await as($, 'dispatcher')
  await as($, 'off')

  expect((await spawnOf($, world, 'implementer')).reached).toBe(true)

  await as($, 'dispatcher')
  await $.classic.SessionStart({ source: 'startup', agent_type: 'architect' })

  expect((await spawnOf($, world, 'implementer')).reached).toBe(true)
})

test('a native entry saved beside an /as agent leaves every spawn through', async ($, on) => {
  const world = stage(on, { agents: WITH_EXTRAS, store: { [keyOf(SESSION)]: saved('dispatcher', 'architect') } })
  await begin($)

  expect((await spawnOf($, world, 'implementer')).reached).toBe(true)
})

const definition = (extra: Partial<AgentDefinition>): AgentDefinition => ({
  name: 'pure',
  description: 'd',
  body: 'Body.',
  unapplied: [],
  ...extra,
})

test('parseModelAliases keeps good pairs and drops blanks and malformed ones', () => {
  expect(parseModelAliases(' Opus = claude-opus-5-5 ,, bad, =x, y=, sonnet=claude-sonnet-5-5')).toEqual({
    opus: 'claude-opus-5-5',
    sonnet: 'claude-sonnet-5-5',
  })
  expect(parseModelAliases('')).toEqual({})
})

test('resolveModel passes ids and inherit through and never reads inherited object keys', () => {
  expect(resolveModel(definition({ model: 'inherit' }), {})).toEqual({})
  expect(resolveModel(definition({}), {})).toEqual({})
  expect(resolveModel(definition({ model: 'claude-opus-5-5[1m]' }), {})).toEqual({ model: 'claude-opus-5-5[1m]' })
  expect(resolveModel(definition({ model: 'constructor' }), {})).toEqual({ unresolved: 'constructor' })
})

test('resolveModel looks an alias up before it takes a hyphenated name for an id', () => {
  const aliases = parseModelAliases('opus-fast=claude-opus-5-5')

  expect(resolveModel(definition({ model: 'opus-fast' }), aliases)).toEqual({ model: 'claude-opus-5-5' })
  expect(resolveModel(definition({ model: 'Opus-Fast' }), aliases)).toEqual({ model: 'claude-opus-5-5' })
})

test('Agent(x, y) in tools allows the Agent tool and nothing else of that name', () => {
  const agent = definition({ tools: ['Agent(a, b)', 'Read'] })

  expect(toolDenial(agent, 'Agent')).toBeUndefined()
  expect(toolDenial(agent, 'Read')).toBeUndefined()
  expect(toolDenial(agent, 'Write')).toContain('Agent(a, b), Read')
})

test('a tool in both tools and disallowedTools is denied', () => {
  const agent = definition({ tools: ['Read', 'Bash'], disallowedTools: ['Bash'] })

  expect(toolDenial(agent, 'Bash')).toContain('may not use the Bash tool')
  expect(toolDenial(agent, 'Read')).toBeUndefined()
})

test('the agent section names the disallowed tools when there is no allowlist', () => {
  const [section] = composeAsAgent(BASE_SECTIONS, definition({ disallowedTools: ['Bash', 'mcp__*'] }))

  expect(section?.text).toBe('Body.\n\nYou may not use these tools: Bash, mcp__*.')
})

test('roleNotice carries the body and the restriction, and roleEndedNotice names the role that ended', () => {
  const next = roleNotice(definition({ tools: ['Read'] }))

  expect(next).toContain('act as the agent "pure"')
  expect(next).toContain('Body.')
  expect(next).toContain('only these tools: Read')
  expect(roleEndedNotice(definition({}))).toContain('The role of the agent "pure" has ended')
})

test('an agent with an empty body still gets a prompt section naming it', () => {
  const [section] = composeAsAgent(BASE_SECTIONS, definition({ body: '' }))

  expect(section?.text).toBe('You are the "pure" agent: d')
})

test('spawnDenial lets everything through without tools, without an Agent entry and with a bare Agent', () => {
  expect(spawnDenial(definition({}), 'implementer')).toBeUndefined()
  expect(spawnDenial(definition({ tools: ['Read', 'Grep'] }), 'implementer')).toBeUndefined()
  expect(spawnDenial(definition({ tools: ['Agent', 'Read'] }), 'implementer')).toBeUndefined()
  expect(spawnDenial(definition({ tools: ['Agent(a)', 'Agent'] }), 'implementer')).toBeUndefined()
})

test('spawnDenial takes the union of the Agent(...) names, trimmed, and names the agent and the types', () => {
  const agent = definition({ name: 'lead', tools: ['Agent( a ,b)', 'Read', 'Agent(c)'] })

  expect(spawnDenial(agent, 'a')).toBeUndefined()
  expect(spawnDenial(agent, 'b')).toBeUndefined()
  expect(spawnDenial(agent, 'c')).toBeUndefined()
  expect(spawnDenial(agent, 'd')).toBe(
    'The agent "lead" may only start these subagent types: a, b, c. "d" is not one of them. Use one of those or tell the user.',
  )
})

test('spawnDenial matches the type exactly', () => {
  const agent = definition({ tools: ['Agent(researcher)'] })

  expect(spawnDenial(agent, 'Researcher')).toContain('"Researcher" is not one of them')
  expect(spawnDenial(agent, 'researcher-2')).toContain('"researcher-2" is not one of them')
})

const catalogHostOf = (files: readonly Agent[], listed: string[]): Host => {
  const byPath = new Map(files.map(({ file, text }) => [slashed(file), text]))

  return {
    cwd: async () => PROJECT,
    root: async () => PROJECT,
    home: async () => 'C:\\Users\\bruno',
    list: async path => {
      const dir = slashed(path).replace(/\/$/, '')

      listed.push(dir)

      return [...byPath.keys()]
        .filter(file => file.startsWith(`${dir}/`) && !file.slice(dir.length + 1).includes('/'))
        .map(file => ({ name: file.slice(dir.length + 1), kind: 'file' as const }))
    },
    read: async path => {
      const text = byPath.get(slashed(path))

      if (text === undefined) {
        throw new Error(`ENOENT ${path}`)
      }

      return text
    },
    sessionId: async () => SESSION,
    sessionModel: async () => SESSION_MODEL,
    now: async () => NOW,
    loadSaved: async () => null,
    save: async () => undefined,
    loadFlags: async () => ({ promptFrozen: false, composeSeen: false }),
    saveFlags: async () => undefined,
    appendHidden: async () => true,
    notify: async () => undefined,
    status: async () => undefined,
    submit: async () => undefined,
    defaultAgent: async () => undefined,
  }
}

test('catalogView lists the resolved catalog with the active one marked, counts the skipped files and reads the folders once', async () => {
  const listed: string[] = []
  const host = catalogHostOf(
    [...DEFAULT_AGENTS, { file: pathOf('broken'), text: '---\nname: broken\n---\nx' }],
    listed,
  )
  const launcher = createLauncher({ modelAliases: 'sonnet=claude-sonnet-5-5' })

  await launcher.start(host)

  const first = await launcher.catalogView(host)
  const byName = Object.fromEntries(first.agents.map(item => [item.name, item]))
  const reads = listed.length

  expect(first.agents).toHaveLength(11)
  expect(first.agents.map(item => item.name).slice(0, 3)).toEqual(['aliased', 'careful', 'custom'])
  expect(first.skipped).toBe(1)
  expect(first.native).toBeNull()
  expect(byName.worker).toEqual({
    name: 'worker',
    description: 'worker description',
    source: 'project',
    model: 'claude-opus-5-5[1m]',
    tools: undefined,
    isActive: false,
  })
  expect(byName.restricted?.tools).toEqual(['Read', 'Grep'])
  expect(byName.aliased?.model).toBe('claude-sonnet-5-5')
  expect(byName.lost?.model).toBeUndefined()
  expect(byName.plain?.model).toBeUndefined()
  expect(byName['home-only']?.source).toBe('user')
  expect(first.agents.filter(item => item.isActive)).toEqual([])

  await launcher.command(host, 'restricted')

  const second = await launcher.catalogView(host)

  expect(second.agents.filter(item => item.isActive).map(item => item.name)).toEqual(['restricted'])
  expect(listed.length).toBe(reads)
})

test('catalogView carries the frontmatter color and leaves it undefined when the file has none', async () => {
  const host = catalogHostOf(
    [
      { file: pathOf('painted'), text: '---\nname: painted\ndescription: d\ncolor: green\n---\nx' },
      { file: pathOf('bare'), text: '---\nname: bare\ndescription: d\n---\nx' },
    ],
    [],
  )
  const launcher = createLauncher({})

  await launcher.start(host)

  const view = await launcher.catalogView(host)

  expect(Object.fromEntries(view.agents.map(item => [item.name, item.color]))).toEqual({ painted: 'green', bare: undefined })
})

test('catalogView reports the native name and marks no agent active in a native session', async () => {
  const host = catalogHostOf(DEFAULT_AGENTS, [])
  const launcher = createLauncher({})

  await launcher.start(host)
  await launcher.command(host, 'plain')
  await launcher.classicStart(host, { source: 'startup', agent_type: 'architect' })

  const view = await launcher.catalogView(host)

  expect(view.native).toBe('architect')
  expect(view.agents.some(item => item.isActive)).toBe(false)
})

test('catalogView of an empty catalog is an empty list with no skipped file', async () => {
  const host = catalogHostOf([], [])
  const launcher = createLauncher({})

  await launcher.start(host)

  expect(await launcher.catalogView(host)).toEqual({ agents: [], skipped: 0, native: null })
})

const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'

const SWITCH_AGENTS: Agent[] = [
  { file: pathOf('opus'), text: agent('opus', `model: ${OPUS}\n`) },
  { file: pathOf('opus-twin'), text: agent('opus-twin', `model: ${OPUS}\n`) },
  { file: pathOf('sonnet'), text: agent('sonnet', `model: ${SONNET}\n`) },
  { file: pathOf('same'), text: agent('same', `model: ${SESSION_MODEL}\n`) },
  { file: pathOf('bare'), text: agent('bare') },
  { file: pathOf('lost'), text: agent('lost', 'model: gemini\n') },
]

const switchHostOf = (promptFrozen: boolean): Host => ({
  ...catalogHostOf(SWITCH_AGENTS, []),
  loadFlags: async () => ({ promptFrozen, composeSeen: promptFrozen }),
})

const switchLauncherOf = async (promptFrozen: boolean, ...before: string[]) => {
  const host = switchHostOf(promptFrozen)
  const launcher = createLauncher({})

  await launcher.start(host)

  for (const request of before) {
    await launcher.command(host, request)
  }

  return { host, launcher }
}

const linesOf = (text: string) => text.split('\n')

const changeLine = (from: string, to: string) =>
  `O modelo muda de ${from} para ${to}. O próximo turno relê a conversa inteira sem cache.`

const returnLine = (from: string, to: string) =>
  `O modelo volta de ${from} para ${to}. O próximo turno relê a conversa inteira sem cache.`

test('/as mid-conversation with another model warns right after the first line, from the session model', async () => {
  const { host, launcher } = await switchLauncherOf(true)

  const lines = linesOf(await launcher.command(host, 'opus'))

  expect(lines[0]).toContain('Agente opus ativo.')
  expect(lines[1]).toBe(changeLine(SESSION_MODEL, OPUS))
  expect(lines).toHaveLength(2)
})

test('/as mid-conversation from an agent with a model warns from that model', async () => {
  const { host, launcher } = await switchLauncherOf(true, 'opus')

  expect(linesOf(await launcher.command(host, 'sonnet'))[1]).toBe(changeLine(OPUS, SONNET))
})

test('/as mid-conversation to an agent without a model warns with the session model as destination', async () => {
  const { host, launcher } = await switchLauncherOf(true, 'opus')

  expect(linesOf(await launcher.command(host, 'bare'))[1]).toBe(changeLine(OPUS, SESSION_MODEL))
})

test('/as mid-conversation that leaves the model as it is adds no line', async () => {
  const fromNone = await switchLauncherOf(true)
  const fromOpus = await switchLauncherOf(true, 'opus')
  const fromBare = await switchLauncherOf(true, 'bare')
  const fromLost = await switchLauncherOf(true)
  const lostLines = linesOf(await fromLost.launcher.command(fromLost.host, 'lost'))

  expect(await fromNone.launcher.command(fromNone.host, 'bare')).toBe(messages.activatedAfterStart('bare'))
  expect(await fromNone.launcher.command(fromNone.host, 'same')).toBe(messages.activatedAfterStart('same'))
  expect(await fromOpus.launcher.command(fromOpus.host, 'opus-twin')).toBe(messages.activatedAfterStart('opus-twin'))
  expect(await fromOpus.launcher.command(fromOpus.host, 'opus')).toBe(messages.activatedAfterStart('opus'))
  expect(await fromBare.launcher.command(fromBare.host, 'same')).toBe(messages.activatedAfterStart('same'))
  expect(lostLines[1]).toContain('"gemini"')
  expect(lostLines.some(line => line.startsWith('O modelo muda'))).toBe(false)
})

test('/as before the first prompt never warns, whatever the models', async () => {
  const { host, launcher } = await switchLauncherOf(false)

  expect(await launcher.command(host, 'opus')).toBe(messages.activatedBeforeStart('opus'))
  expect(await launcher.command(host, 'sonnet')).toBe(messages.activatedBeforeStart('sonnet'))
  expect(await launcher.command(host, 'off')).toBe(messages.deactivatedBeforeStart('sonnet'))
})

test('/as off mid-conversation warns when the model goes back to the session one', async () => {
  const { host, launcher } = await switchLauncherOf(true, 'opus')

  const lines = linesOf(await launcher.command(host, 'off'))

  expect(lines[0]).toContain('Agente opus desativado.')
  expect(lines[1]).toBe(returnLine(OPUS, SESSION_MODEL))
  expect(lines).toHaveLength(2)
})

test('/as off mid-conversation adds no line when the agent had no model or the session one', async () => {
  const bare = await switchLauncherOf(true, 'bare')
  const same = await switchLauncherOf(true, 'same')
  const lost = await switchLauncherOf(true, 'lost')

  expect(await bare.launcher.command(bare.host, 'off')).toBe(messages.deactivatedAfterStart('bare'))
  expect(await same.launcher.command(same.host, 'off')).toBe(messages.deactivatedAfterStart('same'))
  expect(await lost.launcher.command(lost.host, 'off')).toBe(messages.deactivatedAfterStart('lost'))
})

test('/as off with no agent active still answers that none is', async () => {
  const { host, launcher } = await switchLauncherOf(true)

  expect(await launcher.command(host, 'off')).toBe(messages.alreadyOff)
})

const modelSwitchesOf = async (launcher: Awaited<ReturnType<typeof switchLauncherOf>>['launcher'], host: Host) =>
  Object.fromEntries((await launcher.catalogView(host)).agents.map(item => [item.name, item.modelSwitch]))

test('catalogView tells, per agent, the model switch that activating it would cause', async () => {
  const idle = await switchLauncherOf(true)

  expect(await modelSwitchesOf(idle.launcher, idle.host)).toEqual({
    opus: { from: SESSION_MODEL, to: OPUS },
    'opus-twin': { from: SESSION_MODEL, to: OPUS },
    sonnet: { from: SESSION_MODEL, to: SONNET },
    same: undefined,
    bare: undefined,
    lost: undefined,
  })

  const onOpus = await switchLauncherOf(true, 'opus')

  expect(await modelSwitchesOf(onOpus.launcher, onOpus.host)).toEqual({
    opus: undefined,
    'opus-twin': undefined,
    sonnet: { from: OPUS, to: SONNET },
    same: { from: OPUS, to: SESSION_MODEL },
    bare: { from: OPUS, to: SESSION_MODEL },
    lost: { from: OPUS, to: SESSION_MODEL },
  })

  const onBare = await switchLauncherOf(true, 'bare')

  expect((await modelSwitchesOf(onBare.launcher, onBare.host)).opus).toEqual({ from: SESSION_MODEL, to: OPUS })
  expect((await modelSwitchesOf(onBare.launcher, onBare.host)).bare).toBeUndefined()
})

test('catalogView tells no model switch before the first prompt', async () => {
  const idle = await switchLauncherOf(false)
  const onOpus = await switchLauncherOf(false, 'opus')

  expect(Object.values(await modelSwitchesOf(idle.launcher, idle.host)).every(value => value === undefined)).toBe(true)
  expect(Object.values(await modelSwitchesOf(onOpus.launcher, onOpus.host)).every(value => value === undefined)).toBe(true)
})

test('catalogView and /as agree on whether activating an agent warns, and on the models', async () => {
  const names = SWITCH_AGENTS.map(({ file }) => file.slice(file.lastIndexOf('/') + 1, -3))

  for (const promptFrozen of [true, false]) {
    for (const before of [[], ['opus'], ['bare'], ['sonnet', 'off']]) {
      for (const name of names) {
        const { host, launcher } = await switchLauncherOf(promptFrozen, ...before)
        const view = (await launcher.catalogView(host)).agents.find(item => item.name === name)
        const answer = await launcher.command(host, name)
        const warned = linesOf(answer).filter(line => line.startsWith('O modelo muda'))

        expect(warned).toEqual(view?.modelSwitch === undefined ? [] : [changeLine(view.modelSwitch.from, view.modelSwitch.to)])
      }
    }
  }
})
