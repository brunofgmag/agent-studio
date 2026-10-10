import type {
  OtherSession,
  PublishedState,
  PublishedSubagent,
  SessionEntry,
  SessionPresence,
  SubagentStatus,
} from '../../types'

export type StorePort = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
  keys: () => Promise<string[]>
}

export type TimerPort = { cancel: () => void }

export type ClockPort = {
  now: () => Promise<number>
  after: (ms: number, fn: () => void) => TimerPort
  every: (ms: number, fn: () => void) => TimerPort
}

export type BriefSubagent = PublishedSubagent & { endedAt: number | null }

export type Summary = {
  cwd: string
  repo: string | null
  agent: string | null
  model: string | null
  state: Exclude<PublishedState, 'ended'>
  turnStartedAt: number | null
  subagents: readonly BriefSubagent[]
  lastAnswer?: string
}

export type RegistryOptions = {
  store: StorePort
  clock: ClockPort
  snapshot: () => Summary
  shareAnswers: boolean
  afterBatch?: () => void
  afterBeat?: (others: OtherSession[]) => void
}

type Publication = 'beat' | 'farewell'

export type Registry = {
  start: (sessionId: string) => void
  changed: () => void
  moveTo: (sessionId: string) => void
  end: () => Promise<void>
  others: () => Promise<OtherSession[]>
}

export const KEY_PREFIX = 'sess:'
export const BATCH_MS = 1000
export const HEARTBEAT_MS = 15_000
export const INACTIVE_AFTER_MS = 60_000
export const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000
export const SUBAGENT_LIMIT = 30
export const ANSWER_LIMIT = 300

const STATES: readonly PublishedState[] = ['working', 'idle', 'ended']
const STATUSES: readonly SubagentStatus[] = ['running', 'completed', 'failed', 'stopped']

export const keyOf = (sessionId: string): string => `${KEY_PREFIX}${sessionId}`

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string'

const subagentOf = (value: unknown): PublishedSubagent | null => {
  if (!isRecord(value)) {
    return null
  }

  const { type, task, status, tool, tokens } = value

  return typeof type === 'string' &&
    typeof task === 'string' &&
    STATUSES.includes(status as SubagentStatus) &&
    isTextOrNull(tool) &&
    typeof tokens === 'number'
    ? { type, task, status: status as SubagentStatus, tool, tokens }
    : null
}

export const entryOf = (value: unknown): SessionEntry | null => {
  if (!isRecord(value)) {
    return null
  }

  const { cwd, repo, agent, model, state, turnStartedAt, subagents, lastAnswer, updatedAt } = value
  const briefs = Array.isArray(subagents) ? subagents.map(subagentOf) : null

  if (
    typeof cwd !== 'string' ||
    !isTextOrNull(repo) ||
    !isTextOrNull(agent) ||
    !isTextOrNull(model) ||
    !STATES.includes(state as PublishedState) ||
    (turnStartedAt !== null && typeof turnStartedAt !== 'number') ||
    briefs === null ||
    briefs.includes(null) ||
    typeof updatedAt !== 'number'
  ) {
    return null
  }

  return {
    cwd,
    repo,
    agent,
    model,
    state: state as PublishedState,
    turnStartedAt,
    subagents: briefs as PublishedSubagent[],
    updatedAt,
    ...(typeof lastAnswer === 'string' ? { lastAnswer } : {}),
  }
}

const published = ({ endedAt: _endedAt, ...subagent }: BriefSubagent): PublishedSubagent => subagent

const byRelevance = (a: BriefSubagent, b: BriefSubagent): number => {
  if ((a.status === 'running') !== (b.status === 'running')) {
    return a.status === 'running' ? -1 : 1
  }

  return (b.endedAt ?? 0) - (a.endedAt ?? 0)
}

const presenceOf = (entry: SessionEntry, now: number): SessionPresence => {
  if (entry.state === 'ended') {
    return 'encerrada'
  }

  if (now - entry.updatedAt > INACTIVE_AFTER_MS) {
    return 'inativa'
  }

  return entry.state === 'working' ? 'trabalhando' : 'ociosa'
}

export const createRegistry = (options: RegistryOptions): Registry => {
  const { store, clock, snapshot, shareAnswers, afterBatch, afterBeat } = options
  let sessionId = ''
  let stopped = true
  let batch: TimerPort | null = null
  let heartbeat: TimerPort | null = null
  let farewells: string[] = []
  let queue: Promise<void> = Promise.resolve()

  const enqueue = (work: () => Promise<void>): Promise<void> => {
    queue = queue.then(work).catch(() => undefined)

    return queue
  }

  const entryNow = (publication: Publication, updatedAt: number): SessionEntry => {
    const { subagents, lastAnswer, state, ...rest } = snapshot()

    return {
      ...rest,
      state: publication === 'farewell' ? 'ended' : state,
      subagents: [...subagents].sort(byRelevance).slice(0, SUBAGENT_LIMIT).map(published),
      updatedAt,
      ...(shareAnswers && lastAnswer !== undefined ? { lastAnswer: lastAnswer.slice(0, ANSWER_LIMIT) } : {}),
    }
  }

  const publish = (publication: Publication) => {
    const key = keyOf(sessionId)

    return enqueue(async () => {
      const gone = farewells

      farewells = []
      await store.set(key, entryNow(publication, await clock.now()))

      for (const old of gone) {
        await store.delete(old)
      }
    })
  }

  const cancelTimers = () => {
    batch?.cancel()
    heartbeat?.cancel()
    batch = null
    heartbeat = null
  }

  const changed = () => {
    if (stopped || batch !== null) {
      return
    }

    batch = clock.after(BATCH_MS, () => {
      batch = null
      void publish('beat')
        .then(() => afterBatch?.())
        .catch(() => undefined)
    })
  }

  const begin = (id: string) => {
    cancelTimers()
    sessionId = id
    stopped = false
    heartbeat = clock.every(HEARTBEAT_MS, () => {
      void beat().catch(() => undefined)
    })
    changed()
  }

  const prune = async (key: string) => {
    try {
      await store.delete(key)
    } catch {
      return
    }
  }

  const readOne = async (key: string, now: number): Promise<OtherSession | null> => {
    const entry = entryOf(await store.get(key))

    if (entry === null) {
      return null
    }

    if (now - entry.updatedAt > PRUNE_AFTER_MS) {
      await prune(key)

      return null
    }

    return { ...entry, sessionId: key.slice(KEY_PREFIX.length), presence: presenceOf(entry, now) }
  }

  const readAll = async (): Promise<OtherSession[]> => {
    try {
      const own = keyOf(sessionId)
      const keys = (await store.keys()).filter(key => key.startsWith(KEY_PREFIX) && key !== own)
      const now = await clock.now()
      const read = await Promise.all(keys.map(key => readOne(key, now).catch(() => null)))

      return read.filter((session): session is OtherSession => session !== null).sort((a, b) => b.updatedAt - a.updatedAt)
    } catch {
      return []
    }
  }

  const beat = async () => {
    await publish('beat')

    if (afterBeat !== undefined) {
      afterBeat(await readAll())
    }
  }

  return {
    start: begin,
    changed,
    moveTo: id => {
      if (id === sessionId && !stopped) {
        return
      }

      if (!stopped) {
        farewells.push(keyOf(sessionId))
      }

      begin(id)
    },
    end: async () => {
      if (stopped) {
        return
      }

      stopped = true
      cancelTimers()
      await publish('farewell')
    },
    others: readAll,
  }
}
