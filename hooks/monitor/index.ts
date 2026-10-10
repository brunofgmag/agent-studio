import type { AgentInfo, ModelUsage, PluginOptions } from 'claude-code'

import type { OtherSession, SubagentLine } from '../../types'
import type { AgentReading } from '../launcher/index'
import * as messages from '../messages'
import { type CompletionFacts, type SpawnFacts, type SpawnOutcome, createCollector } from './collector'
import { type ClockPort, type Registry, type StorePort, type Summary, createRegistry } from './registry'

export type SessionFacts = {
  sessionId: string
  cwd: string
  repo: string | null
  model: string | null
}

export type MonitorHost = {
  session: () => Promise<SessionFacts>
  agents: () => Promise<readonly AgentInfo[]>
  store: StorePort
  clock: ClockPort
  invalidate: () => void
}

export type LauncherReading = { current: () => AgentReading | null }

export type Monitor = {
  start: (host: MonitorHost) => Promise<void>
  moved: (facts: SessionFacts) => void
  titled: (title: string | undefined) => void
  turnStarted: (at: number) => void
  turnCompleted: (facts: CompletionFacts, at: number) => void
  spawned: (spawn: SpawnFacts, outcome: SpawnOutcome, at: number) => void
  toolStarted: (agentId: string, tool: string) => void
  toolFinished: (agentId: string, tool: string) => void
  stepUsed: (agentId: string, usage: ModelUsage | null | undefined) => void
  sent: (agentId: string, text: string, at: number) => void
  changed: () => void
  ended: () => Promise<void>
  command: (host: MonitorHost, args: string) => Promise<string>
  lines: () => SubagentLine[]
  runningCount: () => number
  agentInForce: () => AgentReading | null
  checkAgainstEngine: () => Promise<void>
  lastOthers: () => readonly OtherSession[]
  readOthers: () => Promise<void>
}

const NO_SESSION: SessionFacts = { sessionId: '', cwd: '', repo: null, model: null }

export const SESSIONS_ARGUMENT = 'sessoes'

export const SESSION_CHANGING_SOURCES: readonly string[] = ['clear', 'resume', 'fork']

export const createMonitor = (options: PluginOptions, launcher: LauncherReading): Monitor => {
  const collector = createCollector()
  const shareAnswers = options.shareAnswers !== false
  let registry: Registry | null = null
  let engine: MonitorHost | null = null
  let others: readonly OtherSession[] = []
  let facts: SessionFacts = NO_SESSION
  let working = false
  let turnStartedAt: number | null = null
  let lastAnswer: string | undefined
  let title: string | undefined

  const snapshot = (): Summary => {
    const agent = launcher.current()

    return {
      cwd: facts.cwd,
      repo: facts.repo,
      agent: agent?.name ?? null,
      model: agent?.model ?? facts.model,
      state: working ? 'working' : 'idle',
      turnStartedAt,
      subagents: collector.lines().map(({ type, task, status, tool, tokens, endedAt }) => ({
        type,
        task,
        status,
        tool,
        tokens,
        endedAt,
      })),
      ...(lastAnswer === undefined ? {} : { lastAnswer }),
      ...(title === undefined ? {} : { title }),
    }
  }

  const changed = () => registry?.changed()

  const redraw = () => {
    try {
      engine?.invalidate()
    } catch {
      return
    }
  }

  const reconcileWithEngine = async (host: MonitorHost, at: number) => {
    try {
      collector.reconcile(await host.agents(), at)
    } catch {
      return
    }
  }

  const subagentTree = async (host: MonitorHost) => {
    const at = await host.clock.now()

    await reconcileWithEngine(host, at)

    const lines = collector.lines()
    const status = messages.agentStatus(launcher.current())

    if (lines.length === 0) {
      return messages.noSubagents
    }

    return messages.subagentTree(status === null ? null : messages.agentInForce(status), lines, at)
  }

  const otherSessions = async (host: MonitorHost) => {
    const sessions = (await registry?.others()) ?? []

    return sessions.length === 0 ? messages.noOtherSessions : messages.otherSessions(sessions, await host.clock.now())
  }

  return {
    start: async host => {
      try {
        engine = host
        facts = await host.session()
        registry ??= createRegistry({
          store: host.store,
          clock: host.clock,
          snapshot,
          shareAnswers,
          afterBatch: redraw,
          afterBeat: latest => {
            others = latest
            redraw()
          },
        })
        registry.start(facts.sessionId)
      } catch {
        registry = null
      }
    },
    moved: next => {
      collector.clear()
      others = []
      facts = next
      working = false
      turnStartedAt = null
      lastAnswer = undefined
      title = undefined
      registry?.moveTo(next.sessionId)
    },
    titled: next => {
      if (next === undefined || next === '' || next === title) {
        return
      }

      title = next
      changed()
    },
    turnStarted: at => {
      working = true
      turnStartedAt = at
      changed()
    },
    turnCompleted: (completion, at) => {
      if (completion.agentId === undefined) {
        working = false
        turnStartedAt = null
        lastAnswer = completion.answer
      } else {
        collector.turnCompleted(completion, at)
      }

      changed()
    },
    spawned: (spawn, outcome, at) => {
      collector.born(spawn, outcome, at)
      changed()
    },
    toolStarted: (agentId, tool) => {
      collector.toolStarted(agentId, tool)
      changed()
    },
    toolFinished: (agentId, tool) => {
      collector.toolFinished(agentId, tool)
      changed()
    },
    stepUsed: (agentId, usage) => {
      collector.stepUsed(agentId, usage)
      changed()
    },
    sent: (agentId, text, at) => collector.sent(agentId, text, at),
    changed,
    ended: async () => {
      await registry?.end()
    },
    command: async (host, args) => {
      const request = args.trim()

      if (request === '') {
        return subagentTree(host)
      }

      return request === SESSIONS_ARGUMENT ? otherSessions(host) : messages.agentsUsage
    },
    lines: () => collector.lines(),
    runningCount: () => collector.runningCount(),
    agentInForce: () => launcher.current(),
    checkAgainstEngine: async () => {
      if (engine !== null) {
        await reconcileWithEngine(engine, await engine.clock.now())
      }
    },
    lastOthers: () => others,
    readOthers: async () => {
      others = (await registry?.others()) ?? []
    },
  }
}
