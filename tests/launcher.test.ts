import type { On, PromptComposeSection } from 'claude-code'
import { type Engine, type Plugin, expect, mock, test } from 'claude-code/testing'

import {
  composeAsAgent,
  parseModelAliases,
  resolveModel,
  roleEndedNotice,
  roleNotice,
  toolDenial,
} from '../hooks/launcher/apply'
import type { AgentDefinition, ProcessFlags, SavedSession } from '../types'

type Agent = { file: string; text: string }

type Setup = {
  agents?: readonly Agent[]
  store?: Readonly<Record<string, unknown>>
  flags?: Partial<ProcessFlags>
  cwd?: string
  repoRoot?: string
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
  steps: { model: string; agentId: string | undefined }[]
  tools: { tool: string; agentId: string | undefined }[]
  registered: string[]
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
    registered: [],
    session: mock.session(on),
  }
  const filesNow = () => new Map(world.files.map(({ file, text }) => [slashed(file), text]))

  mock.env(on, HOME)
  mock.clock(on, { now: NOW })
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
    world.registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('classic.SessionStart', () => ({}))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('prompt.compose', () => ({ sections: BASE_SECTIONS }))
  on('turn.step', async function* (_$, e) {
    world.steps.push({ model: e.model, agentId: e.agentId })

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('tool.call', (_$, e) => {
    world.tools.push({ tool: String(e.tool), agentId: e.agentId })

    return { ref: 1, result: 'done', text: 'done' }
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

const stepModelOf = async ($: Engine, world: Stage, agentId?: string, model = SESSION_MODEL) => {
  const before = world.steps.length
  const stream = $.turn.step({
    turnId: 't1',
    index: 0,
    model,
    messageCount: 1,
    ...(agentId === undefined ? {} : { agentId }),
  })

  for await (const _chunk of stream) {
    continue
  }

  return world.steps.slice(before)[0]?.model
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

test('/as x saves a pointer without the body and /as off removes the key', async ($, on) => {
  const world = stage(on)
  await begin($)
  await as($, 'worker')

  expect(world.store.get(keyOf(SESSION))).toEqual({ ...saved('worker'), at: NOW })

  await as($, 'off')

  expect(world.store.has(keyOf(SESSION))).toBe(false)
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
