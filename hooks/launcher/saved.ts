import type { SavedAgent, SavedSession, SessionState } from '../../types'

const KEY_PREFIX = 'launcher:'

export const storeKey = (sessionId: string): string => `${KEY_PREFIX}${sessionId}`

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const savedAgentOf = (value: unknown): SavedAgent | null | undefined => {
  if (value === null) {
    return null
  }

  if (!isRecord(value)) {
    return undefined
  }

  const { name, path, source } = value

  return typeof name === 'string' && typeof path === 'string' && (source === 'project' || source === 'user')
    ? { name, path, source }
    : undefined
}

export const savedSessionOf = (value: unknown): SavedSession | null => {
  if (!isRecord(value)) {
    return null
  }

  const agent = savedAgentOf(value.agent)
  const { native, at } = value

  if (agent === undefined || (native !== null && typeof native !== 'string') || typeof at !== 'number') {
    return null
  }

  return {
    agent,
    native,
    at,
    ...(value.byDefault === true ? { byDefault: true as const } : {}),
    ...(value.optedOut === true ? { optedOut: true as const } : {}),
  }
}

export const sessionToSave = (state: SessionState, at: number): SavedSession | null => {
  const { active, native, byDefault, optedOut } = state

  if (active === null && native === null && !optedOut) {
    return null
  }

  return {
    agent: active === null ? null : { name: active.definition.name, path: active.path, source: active.source },
    native,
    at,
    ...(byDefault && active !== null ? { byDefault: true as const } : {}),
    ...(optedOut ? { optedOut: true as const } : {}),
  }
}
