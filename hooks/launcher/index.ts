import type { PluginOptions, PromptComposeSection, ToolCallInput, TurnStepInput } from 'claude-code'

import type { ActiveAgent, AgentDefinition, ProcessFlags, SavedAgent, SavedSession } from '../../types'
import * as messages from '../messages'
import { composeAsAgent, parseModelAliases, resolveModel, roleEndedNotice, roleNotice, toolDenial } from './apply'
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
}

export type SessionStartEvent = { source: string; agent_type?: string | null }

export type Launcher = {
  start: (host: Host) => Promise<void>
  classicStart: (host: Host, e: SessionStartEvent) => Promise<void>
  turnStarted: (host: Host) => Promise<void>
  command: (host: Host, args: string) => Promise<string>
  compose: (host: Host, sections: readonly PromptComposeSection[]) => Promise<readonly PromptComposeSection[]>
  stepModel: (host: Host, e: TurnStepInput) => Promise<TurnStepInput>
  guard: (e: ToolCallInput, caller: string) => string | undefined
}

const ENGINE = 'engine'
const UNNAMED_NATIVE = ''
const SOURCES_THAT_CHANGE_SESSION = ['resume', 'fork']

const aliasesOf = (options: PluginOptions) => {
  const text = options.modelAliases

  return parseModelAliases(typeof text === 'string' ? text : '')
}

export const createLauncher = (options: PluginOptions): Launcher => {
  const aliases = aliasesOf(options)
  let active: ActiveAgent | null = null
  let native: string | null = null
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

  const persist = async (host: Host) => {
    await host.save(sessionId, sessionToSave(active, native, await host.now()))
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

  const restore = async (host: Host) => {
    const saved = await host.loadSaved(sessionId)
    const pointer = saved?.agent ?? null

    native = saved?.native ?? null
    active = pointer === null ? null : await revive(host, pointer)

    if (pointer !== null && active === null) {
      await persist(host)
    }
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

    native = name
    active = null
    await persist(host)

    if (dropped !== null) {
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

    active = null
    await persist(host)

    if (!flags.promptFrozen) {
      return messages.deactivatedBeforeStart(previous.name)
    }

    return (await host.appendHidden(roleEndedNotice(previous)))
      ? messages.deactivatedAfterStart(previous.name)
      : messages.deactivatedWithoutNotice(previous.name)
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

    active = agent
    await persist(host)

    return [
      await activationLine(host, entry.agent),
      ...(unresolved === undefined ? [] : [messages.unresolvedModel(unresolved)]),
      ...entry.agent.unapplied.map(messages.unappliedField),
    ].join('\n')
  }

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
      await restore(host)
    },
    classicStart: async (host, e) => {
      if (e.source === 'clear') {
        await moveTo(host, await host.sessionId())
        await setFlags(host, { promptFrozen: false })
      } else if (SOURCES_THAT_CHANGE_SESSION.includes(e.source)) {
        sessionId = await host.sessionId()
        await restore(host)
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
    stepModel: async (host, e) => {
      const model = acting()?.model

      if (model === undefined || e.agentId !== undefined || e.model !== (await host.sessionModel())) {
        return e
      }

      return { ...e, model }
    },
    guard: (e, caller) => {
      const agent = acting()

      if (agent === null || e.agentId !== undefined || caller !== ENGINE) {
        return undefined
      }

      return toolDenial(agent.definition, String(e.tool))
    },
  }
}
