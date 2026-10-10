import { expect, test } from 'claude-code/testing'

import { parseAgentFile } from '../hooks/launcher/frontmatter'

const BOM = String.fromCharCode(0xfeff)

const agentOf =(text: string) => {
  const parsed = parseAgentFile(text)

  if ('error' in parsed) {
    throw new Error(parsed.error)
  }

  return parsed.agent
}

const errorOf = (text: string) => {
  const parsed = parseAgentFile(text)

  return 'error' in parsed ? parsed.error : undefined
}

test('a valid file gives name, description, model, effort and the trimmed body', () => {
  const agent = agentOf(
    ['---', 'name: reviewer', 'description: Reviews code', 'model: claude-opus-5-5[1m]', 'effort: high', '---', '', 'You review.', ''].join('\n'),
  )

  expect(agent).toEqual({
    name: 'reviewer',
    description: 'Reviews code',
    body: 'You review.',
    model: 'claude-opus-5-5[1m]',
    effort: 'high',
    unapplied: [],
  })
})

test('a file with no name is an error', () => {
  expect(errorOf('---\ndescription: d\n---\nbody')).toContain('name')
})

test('a file with no description is an error', () => {
  expect(errorOf('---\nname: n\n---\nbody')).toContain('description')
})

test('a file whose first line is not --- is an error', () => {
  expect(errorOf('\n---\nname: n\ndescription: d\n---\nbody')).toBe('no-opening-fence')
  expect(errorOf('name: n\ndescription: d\n---\nbody')).toBe('no-opening-fence')
})

test('a file with no closing --- is an error', () => {
  expect(errorOf('---\nname: n\ndescription: d\nbody')).toContain('closing')
})

test('an inline comma list gives tools and disallowedTools', () => {
  const agent = agentOf('---\nname: n\ndescription: d\ntools: Read, Grep\ndisallowedTools: Agent, mcp__*\n---\nb')

  expect(agent.tools).toEqual(['Read', 'Grep'])
  expect(agent.disallowedTools).toEqual(['Agent', 'mcp__*'])
})

test('a YAML list gives tools', () => {
  const agent = agentOf('---\nname: n\ndescription: d\ntools:\n  - Read\n  - Edit\ncolor: red\n---\nb')

  expect(agent.tools).toEqual(['Read', 'Edit'])
})

test('CRLF line endings parse the same', () => {
  const agent = agentOf('---\r\nname: n\r\ndescription: d\r\ntools: Read, Write\r\n---\r\nline one\r\nline two\r\n')

  expect(agent.name).toBe('n')
  expect(agent.tools).toEqual(['Read', 'Write'])
  expect(agent.body).toBe('line one\nline two')
})

test('a BOM before the opening --- is stripped', () => {
  expect(agentOf(BOM + '---\nname: n\ndescription: d\n---\nb').name).toBe('n')
})

test('quoted scalars lose their quotes', () => {
  const agent = agentOf('---\nname: "quoted"\ndescription: \'it is: fine\'\n---\nb')

  expect(agent.name).toBe('quoted')
  expect(agent.description).toBe('it is: fine')
})

test('a comma inside parentheses does not split a list entry', () => {
  const agent = agentOf('---\nname: n\ndescription: d\ntools: Agent(a, b), Read\n---\nb')

  expect(agent.tools).toEqual(['Agent(a, b)', 'Read'])
})

test('a nested map under an unused key is skipped', () => {
  const agent = agentOf(
    '---\nname: n\ndescription: d\nextra:\n  inner: 1\n  deeper:\n    - x\ntools: Read\n---\nb',
  )

  expect(agent.name).toBe('n')
  expect(agent.tools).toEqual(['Read'])
})

test('unknown keys are ignored', () => {
  const agent = agentOf('---\nname: n\ndescription: d\ncolor: blue\nbackground: true\n---\nb')

  expect(agent.unapplied).toEqual([])
  expect(agent.tools).toBeUndefined()
})

test('unapplied lists the fields the file declares but the launcher does not apply', () => {
  const agent = agentOf(
    [
      '---',
      'name: n',
      'description: d',
      'permissionMode: plan',
      'skills:',
      '  - vault-sweep',
      'mcpServers:',
      '  x:',
      '    command: y',
      'memory: user',
      'hooks:',
      '  Stop: []',
      '---',
      'b',
    ].join('\n'),
  )

  expect([...agent.unapplied].sort()).toEqual(['hooks', 'mcpServers', 'memory', 'permissionMode', 'skills'])
})

test('initialPrompt is parsed', () => {
  expect(agentOf('---\nname: n\ndescription: d\ninitialPrompt: start here\n---\nb').initialPrompt).toBe('start here')
})

test('a body with --- lines keeps everything after the first closing line', () => {
  expect(agentOf('---\nname: n\ndescription: d\n---\nfirst\n---\nsecond').body).toBe('first\n---\nsecond')
})

test('a file with only a name and a description has an empty body', () => {
  expect(agentOf('---\nname: architect\ndescription: Designs\n---\n').body).toBe('')
})

test('a folded block scalar joins its lines for the description', () => {
  const agent = agentOf('---\nname: n\ndescription: >\n  first part\n  second part\n---\nb')

  expect(agent.description).toBe('first part second part')
})

test('a flow list in brackets gives its entries', () => {
  expect(agentOf('---\nname: n\ndescription: d\ntools: [Read, Grep]\n---\nb').tools).toEqual(['Read', 'Grep'])
})

test('a list written as one quoted string loses the quotes before it is split', () => {
  expect(agentOf('---\nname: n\ndescription: d\ntools: "Read, Grep"\n---\nb').tools).toEqual(['Read', 'Grep'])
  expect(agentOf("---\nname: n\ndescription: d\ntools: 'Read, Bash(a, b)'\n---\nb").tools).toEqual([
    'Read',
    'Bash(a, b)',
  ])
})

test('a list of separately quoted entries keeps each entry whole', () => {
  expect(agentOf('---\nname: n\ndescription: d\ntools: "Read", "Grep"\n---\nb').tools).toEqual(['Read', 'Grep'])
})

test('an unquoted value loses the comment at its end and a quoted one keeps its text', () => {
  const agent = agentOf(
    '---\nname: n # the name\ndescription: "d # kept"\nmodel: sonnet   # cheap\ntools: Read, Grep # read only\n---\nb',
  )

  expect(agent.name).toBe('n')
  expect(agent.description).toBe('d # kept')
  expect(agent.model).toBe('sonnet')
  expect(agent.tools).toEqual(['Read', 'Grep'])
})

test('a # with no space before it is part of the value', () => {
  expect(agentOf('---\nname: n\ndescription: Reviews C# code\n---\nb').description).toBe('Reviews C# code')
})

test('maxTurns is read and reported as not applied', () => {
  expect(agentOf('---\nname: n\ndescription: d\nmaxTurns: 5\n---\nb').unapplied).toEqual(['maxTurns'])
})
