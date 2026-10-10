import type { AgentInfo, AgentSpawnInput, ModelUsage, TurnCompleteReason } from 'claude-code'

import type { SubagentLine, SubagentRow, SubagentStatus } from '../../types'

export type SpawnFacts = Pick<AgentSpawnInput, 'subagentType' | 'description' | 'prompt' | 'parentAgentId' | 'background'>

export type SpawnOutcome = { agentId?: string; model?: string }

export type CompletionFacts = {
  agentId?: string
  answer: string
  durationMs: number
  reason: TurnCompleteReason
  usage?: ModelUsage
}

export type Collector = {
  born: (spawn: SpawnFacts, outcome: SpawnOutcome, at: number) => void
  toolStarted: (agentId: string, tool: string) => void
  toolFinished: (agentId: string, tool: string) => void
  stepUsed: (agentId: string, usage: ModelUsage | null | undefined) => void
  turnCompleted: (facts: CompletionFacts, at: number) => void
  reconcile: (listed: readonly AgentInfo[], at: number) => void
  clear: () => void
  lines: () => SubagentLine[]
  runningCount: () => number
}

type Tracked = {
  row: SubagentRow
  earlierTokens: number
  runTokens: number
  earlierMs: number
  tools: string[]
}

export const LINE_LIMIT = 200

const STATUS_OF_REASON: Record<TurnCompleteReason, SubagentStatus> = {
  aborted: 'stopped',
  error: 'failed',
  answer: 'completed',
  refusal: 'completed',
}

const FINAL_OF_LISTED: Partial<Record<AgentInfo['status'], SubagentStatus>> = {
  completed: 'completed',
  failed: 'failed',
  killed: 'stopped',
}

export const tokensOf = (usage: ModelUsage): number =>
  usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens

const blankRow = (id: string, startedAt: number): SubagentRow => ({
  id,
  type: '',
  task: '',
  prompt: '',
  model: null,
  parentId: null,
  background: false,
  status: 'running',
  tool: null,
  tokens: 0,
  startedAt,
  endedAt: null,
  durationMs: null,
  answer: '',
})

const trackedOf = (row: SubagentRow): Tracked => ({ row, earlierTokens: 0, runTokens: 0, earlierMs: 0, tools: [] })

const refresh = (tracked: Tracked) => {
  tracked.row.tokens = tracked.earlierTokens + tracked.runTokens
  tracked.row.tool = tracked.tools.at(-1) ?? null
}

const reopen = (tracked: Tracked) => {
  tracked.row.status = 'running'
  tracked.row.endedAt = null
  tracked.row.durationMs = null
}

const resume = (tracked: Tracked) => {
  if (tracked.row.status === 'completed') {
    reopen(tracked)
  }
}

const finish = (tracked: Tracked, status: SubagentStatus, at: number, durationMs: number) => {
  tracked.row.status = status
  tracked.row.endedAt = at
  tracked.row.durationMs = durationMs
  tracked.tools = []
  refresh(tracked)
}

const oldestFinished = (all: Iterable<Tracked>): Tracked | undefined =>
  [...all]
    .filter(({ row }) => row.status !== 'running')
    .reduce<Tracked | undefined>(
      (best, tracked) => (best === undefined || (tracked.row.endedAt ?? 0) < (best.row.endedAt ?? 0) ? tracked : best),
      undefined,
    )

const shownParentOf = (row: SubagentRow, known: ReadonlySet<string>): string | null =>
  row.parentId !== null && row.parentId !== row.id && known.has(row.parentId) ? row.parentId : null

const treeOrder = (rows: readonly SubagentRow[]): SubagentLine[] => {
  const known = new Set(rows.map(row => row.id))
  const childrenOf = new Map<string | null, SubagentRow[]>()

  for (const row of rows) {
    const parent = shownParentOf(row, known)

    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), row])
  }

  const ordered: SubagentLine[] = []
  const seen = new Set<string>()

  const walk = (row: SubagentRow, depth: number) => {
    if (seen.has(row.id)) {
      return
    }

    seen.add(row.id)
    ordered.push({ ...row, depth })
    childrenOf.get(row.id)?.forEach(child => walk(child, depth + 1))
  }

  childrenOf.get(null)?.forEach(root => walk(root, 0))
  rows.forEach(row => walk(row, 0))

  return ordered
}

export const createCollector = (): Collector => {
  const records = new Map<string, Tracked>()

  const trim = () => {
    while (records.size > LINE_LIMIT) {
      const oldest = oldestFinished(records.values())

      if (oldest === undefined) {
        return
      }

      records.delete(oldest.row.id)
    }
  }

  const adopt = (info: AgentInfo, at: number): Tracked => {
    const tracked = trackedOf(blankRow(info.id, at))

    Object.assign(tracked.row, { type: info.type, task: info.description, parentId: info.parentId ?? null })
    records.set(info.id, tracked)

    return tracked
  }

  return {
    born: (spawn, outcome, at) => {
      const id = outcome.agentId

      if (id === undefined) {
        return
      }

      const tracked = records.get(id) ?? trackedOf(blankRow(id, at))

      Object.assign(tracked.row, {
        type: spawn.subagentType,
        task: spawn.description,
        prompt: spawn.prompt,
        model: outcome.model ?? null,
        parentId: spawn.parentAgentId ?? null,
        background: spawn.background,
      })
      records.set(id, tracked)
      trim()
    },
    toolStarted: (agentId, tool) => {
      const tracked = records.get(agentId)

      if (tracked === undefined) {
        return
      }

      resume(tracked)
      tracked.tools.push(tool)
      refresh(tracked)
    },
    toolFinished: (agentId, tool) => {
      const tracked = records.get(agentId)
      const index = tracked?.tools.lastIndexOf(tool) ?? -1

      if (tracked === undefined || index === -1) {
        return
      }

      tracked.tools.splice(index, 1)
      refresh(tracked)
    },
    stepUsed: (agentId, usage) => {
      const tracked = records.get(agentId)

      if (tracked === undefined) {
        return
      }

      resume(tracked)
      tracked.runTokens += usage === null || usage === undefined ? 0 : tokensOf(usage)
      refresh(tracked)
    },
    turnCompleted: (facts, at) => {
      const tracked = facts.agentId === undefined ? undefined : records.get(facts.agentId)

      if (tracked === undefined) {
        return
      }

      tracked.earlierTokens += facts.usage === undefined ? tracked.runTokens : tokensOf(facts.usage)
      tracked.runTokens = 0
      tracked.earlierMs += facts.durationMs
      tracked.row.answer = facts.answer
      finish(tracked, STATUS_OF_REASON[facts.reason], at, tracked.earlierMs)
      trim()
    },
    reconcile: (listed, at) => {
      for (const info of listed) {
        const tracked = records.get(info.id) ?? adopt(info, at)
        const final = FINAL_OF_LISTED[info.status]

        if (final === undefined) {
          reopen(tracked)
        } else if (tracked.row.status !== final) {
          finish(tracked, final, at, at - tracked.row.startedAt)
        }
      }

      trim()
    },
    clear: () => records.clear(),
    lines: () => treeOrder([...records.values()].map(({ row }) => row)),
    runningCount: () => [...records.values()].filter(({ row }) => row.status === 'running').length,
  }
}
