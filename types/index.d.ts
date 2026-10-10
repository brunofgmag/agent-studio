export type AgentDefinition = {
  name: string
  description: string
  body: string
  model?: string
  effort?: string
  tools?: readonly string[]
  disallowedTools?: readonly string[]
  initialPrompt?: string
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

export type SavedAgent = { name: string; path: string; source: AgentSource }

export type SavedSession = {
  agent: SavedAgent | null
  native: string | null
  at: number
}

export type ProcessFlags = {
  promptFrozen: boolean
  composeSeen: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'agent-studio': {
      promptFrozen: boolean
      composeSeen: boolean
    }
  }
}
