import type { PromptComposeSection } from 'claude-code'

import type { AgentDefinition } from './frontmatter'

export type ModelAliases = Readonly<Record<string, string>>

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export type Effort = (typeof EFFORTS)[number]

const AGENT_SECTION_ID = 'agent-studio:agent'
const MCP_PREFIX = 'mcp__'

export const parseModelAliases = (text: string): ModelAliases => {
  const pairs = text.split(',').flatMap(pair => {
    const cut = pair.indexOf('=')
    const alias = pair.slice(0, cut).trim().toLowerCase()
    const id = pair.slice(cut + 1).trim()

    return cut === -1 || alias === '' || id === '' ? [] : [[alias, id] as const]
  })

  return Object.fromEntries(pairs)
}

export const resolveModel = (
  agent: AgentDefinition,
  aliases: ModelAliases,
): { model?: string; unresolved?: string } => {
  const declared = agent.model

  if (declared === undefined || declared === 'inherit') {
    return {}
  }

  const key = declared.toLowerCase()

  if (Object.hasOwn(aliases, key)) {
    return { model: aliases[key] }
  }

  return declared.includes('-') ? { model: declared } : { unresolved: declared }
}

export const effortOf = (agent: AgentDefinition): Effort | undefined => {
  const declared = agent.effort?.toLowerCase()

  return EFFORTS.find(effort => effort === declared)
}

const entryMatches = (entry: string, tool: string): boolean => {
  const name = entry.replace(/\(.*\)\s*$/s, '').trim()

  if (name.endsWith('*')) {
    return tool.startsWith(name.slice(0, -1))
  }

  return name === tool || (name.startsWith(MCP_PREFIX) && tool.startsWith(`${name}__`))
}

const anyMatches = (entries: readonly string[], tool: string) => entries.some(entry => entryMatches(entry, tool))

export const toolDenial = (agent: AgentDefinition, tool: string): string | undefined => {
  const { tools, disallowedTools } = agent

  if (disallowedTools !== undefined && anyMatches(disallowedTools, tool)) {
    return `The agent "${agent.name}" may not use the ${tool} tool (it disallows: ${disallowedTools.join(', ')}). Use another tool or tell the user.`
  }

  if (tools !== undefined && !anyMatches(tools, tool)) {
    return `The agent "${agent.name}" may only use these tools: ${tools.join(', ')}. ${tool} is not one of them. Use one of those or tell the user.`
  }

  return undefined
}

const SPAWN_ENTRY = /^Agent\s*(?:\((.*)\))?$/s

const spawnTypesOf = (tools: readonly string[]): readonly string[] | undefined => {
  const listed = tools.flatMap(entry => {
    const match = SPAWN_ENTRY.exec(entry.trim())

    return match === null ? [] : [match[1]]
  })

  if (listed.length === 0 || listed.includes(undefined)) {
    return undefined
  }

  return listed.flatMap(names => (names ?? '').split(',').map(name => name.trim()).filter(name => name !== ''))
}

export const spawnDenial = (agent: AgentDefinition, subagentType: string): string | undefined => {
  const allowed = agent.tools === undefined ? undefined : spawnTypesOf(agent.tools)

  if (allowed === undefined || allowed.includes(subagentType)) {
    return undefined
  }

  return `The agent "${agent.name}" may only start these subagent types: ${allowed.join(', ')}. "${subagentType}" is not one of them. Use one of those or tell the user.`
}

const toolPolicy = (agent: AgentDefinition): string =>
  [
    agent.tools === undefined ? '' : `In this session you may use only these tools: ${agent.tools.join(', ')}.`,
    agent.disallowedTools === undefined
      ? ''
      : `You may not use these tools: ${agent.disallowedTools.join(', ')}.`,
  ]
    .filter(sentence => sentence !== '')
    .join(' ')

const agentText = (agent: AgentDefinition): string => {
  const text = [agent.body, toolPolicy(agent)].filter(part => part !== '').join('\n\n')

  return text === '' ? `You are the "${agent.name}" agent: ${agent.description}` : text
}

export const composeAsAgent = (
  sections: readonly PromptComposeSection[],
  agent: AgentDefinition,
): PromptComposeSection[] => [
  { id: AGENT_SECTION_ID, scope: 'session', text: agentText(agent) },
  ...sections.filter(section => section.scope === 'session'),
]

export const roleNotice = (next: AgentDefinition): string =>
  `From now on, in this conversation, you act as the agent "${next.name}" and no longer as any earlier agent role. Follow these instructions:\n\n${agentText(next)}`

export const roleEndedNotice = (previous: AgentDefinition): string =>
  `The role of the agent "${previous.name}" has ended. From now on, act with your default behaviour again and ignore the instructions that came with that role.`
