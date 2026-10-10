import type { AgentSpawnInput, PluginOptions, PromptComposeSection, ToolCallInput, TurnStepInput } from 'claude-code'

import type { ActiveAgent, AgentDefinition, CatalogView, ProcessFlags, SavedAgent, SavedSession, SessionState } from '../../types'
import * as messages from '../messages'
import {
  EFFORTS,
  composeAsAgent,
  effortOf,
  parseModelAliases,
  resolveModel,
  roleEndedNotice,
  roleNotice,
  spawnDenial,
  toolDenial,
} from './apply'
import { type Catalog, type CatalogEntry, type CatalogHost, findAgent, loadCatalog, readAgent } from './catalog'
import { sessionToSave } from './saved'

export type Host = CatalogHost & {
  sessionId: () => Promise<string>
  sessionModel: () => Promise<string>
  now: () => Promise<number>
  loadSaved: (sessionId: string) => Promise<SavedSession | null>
  save: (sessionId: string, saved: SavedSession | null) => Promise<void>
  loadFlags: () => Promise<ProcessFlags>
  saveFlags: (flags: ProcessFlags) => Promise<void>
  appendHidden: (text: string) => Promise<boolean>
  notify: (text: string) => Promise<void>
  status: (text: string | undefined) => Promise<void>
  submit: (text: string) => Promise<void>
  defaultAgent: () => Promise<string | undefined>
}

export type SessionStartEvent = { source: string; agent_type?: string | null }

export type AgentReading = { name: string; model?: string; effort?: string }

export type Launcher = {
  start: (host: Host) => Promise<void>
  classicStart: (host: Host, e: SessionStartEvent) => Promise<void>
  turnStarted: (host: Host) => Promise<void>
  command: (host: Host, args: string) => Promise<string>
  compose: (host: Host, sections: readonly PromptComposeSection[]) => Promise<readonly PromptComposeSection[]>
  step: (host: Host, e: TurnStepInput) => Promise<TurnStepInput>
  guard: (e: ToolCallInput, caller: string) => string | undefined
  spawnGuard: (e: AgentSpawnInput, caller: string) => string | undefined
  current: () => AgentReading | null
  catalogView: (host: Host) => Promise<CatalogView>
}

const ENGINE = 'engine'
const UNNAMED_NATIVE = ''
const SOURCES_THAT_CHANGE_SESSION = ['resume', 'fork']

const isMainLoopOfEngine = (agentId: string | undefined, caller: string) => agentId === undefined && caller === ENGINE

const aliasesOf = (options: PluginOptions) => {
  const text = options.modelAliases

  return parseModelAliases(typeof text === 'string' ? text : '')
}

export const createLauncher = (options: PluginOptions): Launcher => {
  const aliases = aliasesOf(options)
  let active: ActiveAgent | null = null
  let native: string | null = null
  let byDefault = false
  let optedOut = false
  let catalog: Catalog | null = null
  let sessionId = ''
  let flags: ProcessFlags = { promptFrozen: false, composeSeen: false }

  const acting = () => (native === null ? active : null)

  const activeOf = (entry: CatalogEntry): { agent: ActiveAgent; unresolved: string | undefined } => {
    const { model, unresolved } = resolveModel(entry.agent, aliases)

    return {
      agent: {
        definition: entry.agent,
        ...(model === undefined ? {} : { model }),
        source: entry.source,
        path: entry.path,
      },
      unresolved,
    }
  }

  const takeAgent = (agent: ActiveAgent | null, fromSettings: boolean) => {
    active = agent
    byDefault = fromSettings && agent !== null
  }

  const stateNow = (): SessionState => ({ active, native, byDefault, optedOut })

  const persist = async (host: Host) => {
    if (sessionId === '') {
      return
    }

    await host.save(sessionId, sessionToSave(stateNow(), await host.now()))
  }

  const refreshStatus = async (host: Host) => {
    const agent = acting()

    await host.status(
      agent === null ? undefined : messages.statusLine(agent.definition.name, agent.model, effortOf(agent.definition)),
    )
  }

  const setFlags = async (host: Host, changed: Partial<ProcessFlags>) => {
    const next = { ...flags, ...changed }

    if (next.promptFrozen === flags.promptFrozen && next.composeSeen === flags.composeSeen) {
      return
    }

    flags = next
    await host.saveFlags(next)
  }

  const revive = async (host: Host, pointer: SavedAgent): Promise<ActiveAgent | null> => {
    const file = await readAgent(host, pointer.path)

    if ('error' in file || file.agent.name !== pointer.name) {
      return null
    }

    return activeOf({ agent: file.agent, source: pointer.source, path: pointer.path }).agent
  }

  const restore = async (host: Host, kept: string | null = null) => {
    const saved = await host.loadSaved(sessionId)
    const pointer = saved?.agent ?? null

    native = saved?.native ?? kept
    optedOut = saved?.optedOut === true
    takeAgent(pointer === null ? null : await revive(host, pointer), saved?.byDefault === true)

    if (pointer !== null && active === null) {
      await persist(host)
    }

    return saved
  }

  const moveTo = async (host: Host, nextSessionId: string) => {
    if (nextSessionId === sessionId) {
      return
    }

    await host.save(sessionId, null)
    sessionId = nextSessionId
    await persist(host)
  }

  const markNative = async (host: Host, name: string) => {
    const dropped = active
    const wasDefault = byDefault

    native = name
    takeAgent(null, false)
    await persist(host)
    await refreshStatus(host)

    if (dropped !== null && !wasDefault) {
      await host.notify(messages.droppedForNative(dropped.definition.name))
    }
  }

  const catalogNow = async (host: Host) => {
    catalog ??= await loadCatalog(host)

    return catalog
  }

  const listCatalog = async (host: Host) => {
    const { entries, skipped } = await catalogNow(host)
    const list = messages.catalogList(
      entries.map(({ agent, source }) => ({
        name: agent.name,
        description: agent.description,
        source,
        isActive: acting()?.definition.name === agent.name,
      })),
      skipped,
    )

    return native === null ? list : [messages.nativeSession(native), list].join('\n')
  }

  const viewCatalog = async (host: Host): Promise<CatalogView> => {
    const { entries, skipped } = await catalogNow(host)

    return {
      agents: entries.map(entry => ({
        name: entry.agent.name,
        description: entry.agent.description,
        source: entry.source,
        model: activeOf(entry).agent.model,
        tools: entry.agent.tools,
        isActive: acting()?.definition.name === entry.agent.name,
      })),
      skipped: skipped.length,
      native,
    }
  }

  const describeActive = () => {
    if (native !== null) {
      return messages.nativeSession(native)
    }

    return messages.activeSummary(
      active === null
        ? null
        : {
            name: active.definition.name,
            source: active.source,
            path: active.path,
            model: active.model,
            effort: effortOf(active.definition),
            tools: active.definition.tools,
            disallowedTools: active.definition.disallowedTools,
          },
    )
  }

  const reload = async (host: Host) => {
    const fresh = await loadCatalog(host)
    const summary = messages.reloaded(fresh.entries.length, fresh.skipped)

    catalog = fresh

    if (active === null) {
      return summary
    }

    const entry = findAgent(fresh, active.definition.name)

    if (entry === undefined) {
      return [summary, messages.activeFileGone(active.definition.name)].join('\n')
    }

    active = activeOf(entry).agent
    await persist(host)
    await refreshStatus(host)

    return summary
  }

  const activationLine = async (host: Host, agent: AgentDefinition) => {
    if (!flags.promptFrozen) {
      return messages.activatedBeforeStart(agent.name)
    }

    return (await host.appendHidden(roleNotice(agent)))
      ? messages.activatedAfterStart(agent.name)
      : messages.activatedWithoutNotice(agent.name)
  }

  const deactivate = async (host: Host) => {
    const previous = active?.definition

    if (previous === undefined) {
      return messages.alreadyOff
    }

    takeAgent(null, false)
    optedOut = true
    await persist(host)
    await refreshStatus(host)

    if (!flags.promptFrozen) {
      return messages.deactivatedBeforeStart(previous.name)
    }

    return (await host.appendHidden(roleEndedNotice(previous)))
      ? messages.deactivatedAfterStart(previous.name)
      : messages.deactivatedWithoutNotice(previous.name)
  }

  const effortWarning = (agent: AgentDefinition) =>
    agent.effort === undefined || effortOf(agent) !== undefined ? [] : [messages.unknownEffort(agent.effort, EFFORTS)]

  const submitInitialPrompt = async (host: Host, prompt: string | undefined) => {
    if (prompt === undefined || prompt === '') {
      return
    }

    await host.submit(prompt)
  }

  const applyDefault = async (host: Host) => {
    const name = await host.defaultAgent()

    if (name === undefined) {
      return
    }

    const entry = findAgent(await catalogNow(host), name)

    if (entry === undefined) {
      await host.notify(messages.unknownDefaultAgent(name))

      return
    }

    takeAgent(activeOf(entry).agent, true)
    await persist(host)
  }

  const activate = async (host: Host, name: string) => {
    const found = await catalogNow(host)
    const entry = findAgent(found, name)

    if (entry === undefined) {
      return messages.unknownAgent(
        name,
        found.entries.map(listed => listed.agent.name),
      )
    }

    const { agent, unresolved } = activeOf(entry)

    takeAgent(agent, false)
    optedOut = false
    await persist(host)
    await refreshStatus(host)

    const line = await activationLine(host, entry.agent)

    await submitInitialPrompt(host, entry.agent.initialPrompt)

    return [
      line,
      ...(unresolved === undefined ? [] : [messages.unresolvedModel(unresolved)]),
      ...effortWarning(entry.agent),
      ...entry.agent.unapplied.map(messages.unappliedField),
    ].join('\n')
  }

  const modelFor = async (host: Host, agent: ActiveAgent, e: TurnStepInput) =>
    agent.model !== undefined && e.model === (await host.sessionModel()) ? agent.model : undefined

  const command = async (host: Host, args: string) => {
    const request = args.trim()

    if (request === '') {
      return listCatalog(host)
    }

    if (request === '?') {
      return describeActive()
    }

    if (request === '--reload') {
      return reload(host)
    }

    if (native !== null) {
      return messages.nativeSession(native)
    }

    return request === 'off' ? deactivate(host) : activate(host, request)
  }

  return {
    start: async host => {
      sessionId = await host.sessionId()
      flags = await host.loadFlags()

      if ((await restore(host, native)) === null && native === null) {
        await applyDefault(host)
      }

      if (acting() !== null) {
        await refreshStatus(host)
      }
    },
    classicStart: async (host, e) => {
      if (sessionId === '') {
        sessionId = await host.sessionId()
      }

      if (e.source === 'clear') {
        await moveTo(host, await host.sessionId())
        await setFlags(host, { promptFrozen: false })
      } else if (SOURCES_THAT_CHANGE_SESSION.includes(e.source)) {
        sessionId = await host.sessionId()
        await restore(host)
        await refreshStatus(host)
        await setFlags(host, { promptFrozen: false })
      }

      if (typeof e.agent_type === 'string' && e.agent_type !== UNNAMED_NATIVE && e.agent_type !== native) {
        await markNative(host, e.agent_type)
      }
    },
    turnStarted: async host => {
      if (!flags.composeSeen && native === null) {
        await markNative(host, UNNAMED_NATIVE)
      }

      await setFlags(host, { promptFrozen: true })
    },
    command,
    compose: async (host, sections) => {
      await setFlags(host, { composeSeen: true })

      const agent = acting()

      return agent === null ? sections : composeAsAgent(sections, agent.definition)
    },
    step: async (host, e) => {
      const agent = acting()

      if (agent === null || e.agentId !== undefined) {
        return e
      }

      const model = await modelFor(host, agent, e)
      const effort = effortOf(agent.definition)

      return { ...e, ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }) }
    },
    guard: (e, caller) => {
      const agent = acting()

      if (agent === null || !isMainLoopOfEngine(e.agentId, caller)) {
        return undefined
      }

      return toolDenial(agent.definition, String(e.tool))
    },
    spawnGuard: (e, caller) => {
      const agent = acting()

      if (agent === null || !isMainLoopOfEngine(e.parentAgentId, caller)) {
        return undefined
      }

      return spawnDenial(agent.definition, e.subagentType)
    },
    catalogView: viewCatalog,
    current: () => {
      const agent = acting()

      if (agent === null) {
        return null
      }

      const effort = effortOf(agent.definition)

      return {
        name: agent.definition.name,
        ...(agent.model === undefined ? {} : { model: agent.model }),
        ...(effort === undefined ? {} : { effort }),
      }
    },
  }
}
