export type AgentDefinition = {
  name: string
  description: string
  body: string
  model?: string
  effort?: string
  tools?: readonly string[]
  disallowedTools?: readonly string[]
  initialPrompt?: string
  color?: string
  unapplied: readonly string[]
}

export type AgentSource = 'project' | 'user'

export type AgentFileError = 'no-opening-fence' | 'no-closing-fence' | 'no-name' | 'no-description'

export type SkippedFile = { path: string; reason: AgentFileError | 'unreadable' }

export type ActiveAgent = {
  definition: AgentDefinition
  model?: string
  source: AgentSource
  path: string
}

export type ModelSwitch = { from: string; to: string }

export type CatalogAgent = {
  name: string
  description: string
  source: AgentSource
  model: string | undefined
  tools: readonly string[] | undefined
  color: string | undefined
  isActive: boolean
  modelSwitch: ModelSwitch | undefined
}

export type CatalogView = {
  agents: readonly CatalogAgent[]
  skipped: number
  native: string | null
}

export type SavedAgent ={ name: string; path: string; source: AgentSource }

export type SavedSession = {
  agent: SavedAgent | null
  native: string | null
  at: number
  byDefault?: true
  optedOut?: true
}

export type SessionState = {
  active: ActiveAgent | null
  native: string | null
  byDefault: boolean
  optedOut: boolean
}

export type ProcessFlags = {
  promptFrozen: boolean
  composeSeen: boolean
}

export type SubagentStatus = 'running' | 'completed' | 'failed' | 'stopped'

export type Exchange = { kind: 'answer' | 'sent'; text: string; at: number }

export type SubagentRow = {
  id: string
  type: string
  task: string
  prompt: string
  model: string | null
  parentId: string | null
  background: boolean
  status: SubagentStatus
  tool: string | null
  tokens: number
  startedAt: number
  endedAt: number | null
  durationMs: number | null
  answer: string
  exchanges: readonly Exchange[]
}

export type SubagentLine = SubagentRow & { depth: number }

export type PublishedState = 'working' | 'idle' | 'ended'

export type PublishedSubagent = {
  type: string
  task: string
  status: SubagentStatus
  tool: string | null
  tokens: number
}

export type SessionEntry = {
  cwd: string
  repo: string | null
  agent: string | null
  model: string | null
  state: PublishedState
  turnStartedAt: number | null
  subagents: readonly PublishedSubagent[]
  lastAnswer?: string
  title?: string
  updatedAt: number
}

export type SessionPresence = 'trabalhando' | 'ociosa' | 'inativa' | 'encerrada'

export type OtherSession = Omit<SessionEntry, 'state'> & { sessionId: string; presence: SessionPresence }

export type PaneTab = 1 | 2 | 3

declare module 'claude-code' {
  interface PluginState {
    'agent-studio': {
      promptFrozen: boolean
      composeSeen: boolean
    }
  }
}
