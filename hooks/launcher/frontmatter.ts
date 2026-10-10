import type { AgentDefinition, AgentFileError } from '../../types'

export type { AgentDefinition, AgentFileError }

export type AgentFile = { agent: AgentDefinition } | { error: AgentFileError }

type Field = { value: string; block: readonly string[] }

const BOM = String.fromCharCode(0xfeff)
const FENCE = '---'
const KEY_LINE = /^([A-Za-z_][\w-]*):(.*)$/
const LIST_ITEM = /^\s*-\s+(.*)$/
const BLOCK_SCALAR = /^[|>][+-]?$/
const TRAILING_COMMENT = /(^|\s+)#.*$/
const QUOTES = ['"', "'"]
const UNAPPLIED_KEYS = ['mcpServers', 'hooks', 'permissionMode', 'memory', 'skills', 'maxTurns'] as const

const isQuoted = (text: string): boolean =>
  text.length >= 2 && QUOTES.includes(text[0] ?? '') && text.endsWith(text[0] ?? '')

const unquote = (text: string): string => {
  const trimmed = text.trim()

  return isQuoted(trimmed) ? trimmed.slice(1, -1) : trimmed
}

const unquoteWhole = (text: string): string => {
  const trimmed = text.trim()
  const inner = trimmed.slice(1, -1)

  return isQuoted(trimmed) && !inner.includes(trimmed[0] ?? '') ? inner : trimmed
}

const withoutComment = (value: string): string =>
  QUOTES.includes(value[0] ?? '') ? value : value.replace(TRAILING_COMMENT, '')

const splitOutsideParentheses = (text: string): string[] => {
  const parts: string[] = []
  let depth = 0
  let current = ''

  for (const char of text) {
    if (char === '(') {
      depth += 1
    } else if (char === ')') {
      depth = Math.max(0, depth - 1)
    }

    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }

  parts.push(current)

  return parts
}

const readFields = (lines: readonly string[]): Map<string, Field> => {
  const fields = new Map<string, Field>()
  let block: string[] | undefined

  for (const line of lines) {
    const key = KEY_LINE.exec(line)

    if (key !== null) {
      block = []
      fields.set(key[1] ?? '', { value: withoutComment((key[2] ?? '').trim()), block })
    } else if (block !== undefined && !line.trimStart().startsWith('#')) {
      block.push(line)
    }
  }

  return fields
}

const scalarOf = (field: Field | undefined): string | undefined => {
  if (field === undefined) {
    return undefined
  }

  if (BLOCK_SCALAR.test(field.value)) {
    const lines = field.block.map(line => line.trim())

    return (field.value.startsWith('|') ? lines.join('\n') : lines.join(' ')).trim()
  }

  const value = unquote(field.value)

  return value === '' ? undefined : value
}

const listOf = (field: Field | undefined): string[] | undefined => {
  if (field === undefined) {
    return undefined
  }

  const inline = unquoteWhole(field.value).replace(/^\[(.*)\]$/, '$1')
  const items =
    inline === ''
      ? field.block.flatMap(line => LIST_ITEM.exec(line)?.[1] ?? [])
      : splitOutsideParentheses(inline)
  const entries = items.map(unquote).filter(item => item !== '')

  return entries.length === 0 ? undefined : entries
}

const optional = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } =>
  value === undefined ? {} : ({ [key]: value } as { [P in K]?: V })

export const parseAgentFile = (text: string): AgentFile => {
  const lines = (text.startsWith(BOM) ? text.slice(1) : text).split(/\r?\n/)

  if (lines[0]?.trimEnd() !== FENCE) {
    return { error: 'no-opening-fence' }
  }

  const closing = lines.findIndex((line, index) => index > 0 && line.trimEnd() === FENCE)

  if (closing === -1) {
    return { error: 'no-closing-fence' }
  }

  const fields = readFields(lines.slice(1, closing))
  const name = scalarOf(fields.get('name'))
  const description = scalarOf(fields.get('description'))

  if (name === undefined) {
    return { error: 'no-name' }
  }

  if (description === undefined) {
    return { error: 'no-description' }
  }

  return {
    agent: {
      name,
      description,
      body: lines.slice(closing + 1).join('\n').trim(),
      ...optional('model', scalarOf(fields.get('model'))),
      ...optional('effort', scalarOf(fields.get('effort'))),
      ...optional('tools', listOf(fields.get('tools'))),
      ...optional('disallowedTools', listOf(fields.get('disallowedTools'))),
      ...optional('initialPrompt', scalarOf(fields.get('initialPrompt'))),
      ...optional('color', scalarOf(fields.get('color'))),
      unapplied: UNAPPLIED_KEYS.filter(key => fields.has(key)),
    },
  }
}
