import { expect, test } from 'claude-code/testing'

import { type RowParts, messagesIn } from '../hooks/messages'
import { clockText } from '../hooks/timing'
import type { CatalogAgent, OtherSession, SubagentLine, SubagentStatus } from '../types'

const {
  agentColor,
  catalogRow,
  earlierLabel,
  footerSummary,
  otherSessions,
  promptLines,
  promptPreview,
  sessionGroups,
  sessionName,
  sessionRow,
  subagentGroups,
  subagentRow,
  subagentSummary,
  youSaid,
} = messagesIn('pt-BR')

const english = messagesIn('en')

const AGO_PT = { seconds: 'há {n} s', minutes: 'há {n} min', hours: 'há {n} h' }

const AGO_EN = { seconds: '{n} s ago', minutes: '{n} min ago', hours: '{n} h ago' }

const expectSplitToJoin = ({ meta, ticking }: RowParts, now: number) => {
  if (ticking !== undefined) {
    expect([ticking.before, clockText(ticking.clock, now), ticking.after].filter(part => part !== '').join(' ')).toBe(meta)
  }
}

const NOW = 1_000_000

const line = (over: Partial<SubagentLine> = {}): SubagentLine => ({
  id: 'sub-1',
  type: 'Explore',
  task: 'read the logs',
  prompt: '',
  model: null,
  parentId: null,
  background: false,
  status: 'running',
  tool: null,
  tokens: 1500,
  cachedTokens: 0,
  startedAt: NOW - 12_000,
  endedAt: null,
  durationMs: null,
  answer: '',
  exchanges: [],
  depth: 0,
  ...over,
})

const session = (over: Partial<OtherSession> = {}): OtherSession => ({
  sessionId: 's1',
  cwd: 'C:/work/api',
  repo: null,
  agent: null,
  model: null,
  turnStartedAt: null,
  subagents: [],
  updatedAt: NOW - 5000,
  idleSince: NOW - 5000,
  presence: 'idle',
  ...over,
})

const agent = (over: Partial<CatalogAgent> = {}): CatalogAgent => ({
  name: 'worker',
  description: 'does the work',
  source: 'project',
  model: undefined,
  tools: undefined,
  color: undefined,
  isActive: false,
  modelSwitch: undefined,
  ...over,
})

const STATUSES: readonly [SubagentStatus, string, string, string][] = [
  ['running', '●', 'suggestion', 'rodando'],
  ['completed', '✓', 'success', 'concluído'],
  ['failed', '✗', 'error', 'falhou'],
  ['stopped', '■', 'inactive', 'parado'],
]

for (const [status, mark, color, word] of STATUSES) {
  test(`a ${status} subagent row has the glyph ${mark}, the colour ${color} and the word ${word} in the meta`, () => {
    const row = subagentRow(line({ status }), NOW)

    expect(row).toEqual({
      mark,
      markColor: color,
      name: 'Explore',
      meta: `${word} · 0:12 · 1.5k`,
      description: 'read the logs',
      ...(status === 'running'
        ? { ticking: { before: `${word} ·`, clock: { kind: 'elapsed', since: NOW - 12_000 }, after: '· 1.5k' } }
        : {}),
    })
    expectSplitToJoin(row, NOW)
  })
}

test('the meta of a subagent row names the tool when there is one and leaves it out when there is none', () => {
  expect(subagentRow(line({ tool: 'Grep' }), NOW).meta).toBe('rodando · Grep · 0:12 · 1.5k')
  expect(subagentRow(line({ tool: null }), NOW).meta).toBe('rodando · 0:12 · 1.5k')
})

test('a subagent row uses the recorded duration when it has one, and the task is flattened and cut at 200', () => {
  expect(subagentRow(line({ durationMs: 65_000 }), NOW).meta).toBe('rodando · 1:05 · 1.5k')

  const long = subagentRow(line({ task: `first\n\n  second ${'x'.repeat(300)}` }), NOW).description

  expect(long.startsWith('first second xxx')).toBe(true)
  expect(long).toHaveLength(200)
  expect(long.endsWith('…')).toBe(true)
})

test('a session is named by its title, trimmed', () => {
  expect(sessionName(session({ title: '  Fix the login bug ' }))).toBe('Fix the login bug')
})

test('a session without a title, or with a blank one, is named by the last folder of its cwd on either separator, ignoring a trailing one', () => {
  expect(sessionName(session({ cwd: 'C:/work/api' }))).toBe('api')
  expect(sessionName(session({ cwd: 'C:\\Users\\bruno\\Projetos\\agent-studio-spike' }))).toBe('agent-studio-spike')
  expect(sessionName(session({ cwd: 'C:\\work\\omega\\' }))).toBe('omega')
  expect(sessionName(session({ cwd: '/home/bruno/app/' }))).toBe('app')
  expect(sessionName(session({ cwd: 'C:/work/api', title: '' }))).toBe('api')
  expect(sessionName(session({ cwd: 'C:/work/api', title: '   ' }))).toBe('api')
  expect(sessionName(session({ cwd: '/' }))).toBe('/')
})

const PRESENCES: readonly [OtherSession['presence'], string, string, boolean][] = [
  ['working', 'trabalhando', 'success', false],
  ['idle', 'ociosa', 'warning', false],
  ['stale', 'inativa', 'inactive', false],
  ['ended', 'encerrada', 'inactive', true],
]

for (const [presence, word, color, isDim] of PRESENCES) {
  test(`a ${word} session row has the dot in ${color}, ${isDim ? 'a dim' : 'a normal'} name and the presence word in the meta`, () => {
    const row = sessionRow(session({ presence, agent: 'architect' }), NOW)

    expect(row).toMatchObject({ mark: '●', markColor: color, name: 'api' })
    expect(row.meta.startsWith(`@architect · ${word}`)).toBe(true)
    expect(row.isDim === true).toBe(isDim)
  })
}

const timed = (over: Partial<OtherSession>) => session({ agent: 'architect', ...over })

test('a working session row shows how long the turn has run, as minutes and seconds', () => {
  expect(sessionRow(timed({ presence: 'working', turnStartedAt: NOW - 83_000, updatedAt: NOW - 2000 }), NOW).meta).toBe(
    '@architect · trabalhando · 1:23',
  )
})

test('a working session row without a turn start omits the time', () => {
  expect(sessionRow(timed({ presence: 'working', turnStartedAt: null }), NOW).meta).toBe('@architect · trabalhando')
})

test('an idle session row shows how long ago it went idle, not its last sign of life', () => {
  const row = sessionRow(timed({ presence: 'idle', idleSince: NOW - 125_000, updatedAt: NOW - 3000 }), NOW)

  expect(row.meta).toBe('@architect · ociosa · há 2 min')
})

test('an idle session row without idleSince, as an older version published it, omits the time', () => {
  expect(sessionRow(timed({ presence: 'idle', idleSince: undefined, updatedAt: NOW - 3000 }), NOW).meta).toBe(
    '@architect · ociosa',
  )
})

test('a stale or ended session row shows the time since its last sign of life', () => {
  const quiet = { idleSince: NOW - 1000, turnStartedAt: NOW - 1000, updatedAt: NOW - 125_000 }

  expect(sessionRow(timed({ presence: 'stale', ...quiet }), NOW).meta).toBe('@architect · inativa · há 2 min')
  expect(sessionRow(timed({ presence: 'ended', ...quiet }), NOW).meta).toBe('@architect · encerrada · há 2 min')
})

test('the text form of the other sessions carries the same time per presence', () => {
  const text = otherSessions(
    [
      timed({ cwd: 'C:/a', presence: 'working', turnStartedAt: NOW - 83_000 }),
      timed({ cwd: 'C:/b', presence: 'working', turnStartedAt: null }),
      timed({ cwd: 'C:/c', presence: 'idle', idleSince: NOW - 125_000 }),
      timed({ cwd: 'C:/d', presence: 'idle', idleSince: undefined }),
      timed({ cwd: 'C:/e', presence: 'stale', updatedAt: NOW - 130_000 }),
      timed({ cwd: 'C:/f', presence: 'ended', updatedAt: NOW - 7_300_000 }),
    ],
    NOW,
  )

  expect(text.split('\n').slice(1)).toEqual([
    '  C:/a  @architect  trabalhando  0 subagentes  1:23',
    '  C:/b  @architect  trabalhando  0 subagentes',
    '  C:/c  @architect  ociosa  0 subagentes  há 2 min',
    '  C:/d  @architect  ociosa  0 subagentes',
    '  C:/e  @architect  inativa  0 subagentes  há 2 min',
    '  C:/f  @architect  encerrada  0 subagentes  há 2 h',
  ])
})

test('a session with no agent says sem agente in the meta', () => {
  expect(sessionRow(session(), NOW).meta).toBe('sem agente · ociosa · há 5 s')
})

test('the description of a session row is the subagent count then the last answer, or the full cwd when there is no answer', () => {
  const sub = { type: 'Explore', task: 't', status: 'running' as const, tool: null, tokens: 0 }

  expect(sessionRow(session({ subagents: [sub], lastAnswer: 'all  done\nnow' }), NOW).description).toBe('1 subagente · all done now')
  expect(sessionRow(session({ subagents: [sub, sub], lastAnswer: 'ok' }), NOW).description).toBe('2 subagentes · ok')
  expect(sessionRow(session({ subagents: [sub, sub] }), NOW).description).toBe('2 subagentes · C:/work/api')
  expect(sessionRow(session({ lastAnswer: 'ok' }), NOW).description).toBe('ok')
  expect(sessionRow(session(), NOW).description).toBe('C:/work/api')
  expect(sessionRow(session({ lastAnswer: '' }), NOW).description).toBe('C:/work/api')
  expect(sessionRow(session({ lastAnswer: 'y'.repeat(300) }), NOW).description).toHaveLength(200)
})

test('the description of a session row drops the markdown marks of the last answer', () => {
  const answer = ['## Result', 'The words are **ALFA**, *BETA* and `GAMMA`.'].join('\n')

  expect(sessionRow(session({ lastAnswer: answer }), NOW).description).toBe('Result The words are ALFA, BETA and GAMMA.')
})

test('the groups put the open sessions first, sorted by presence then newest, and the encerradas after, each heading counting its group', () => {
  const sessions = [
    session({ sessionId: 'ended-old', presence: 'ended', updatedAt: 1 }),
    session({ sessionId: 'stale', presence: 'stale', updatedAt: 90 }),
    session({ sessionId: 'idle-old', presence: 'idle', updatedAt: 10 }),
    session({ sessionId: 'working', presence: 'working', updatedAt: 5 }),
    session({ sessionId: 'ended-new', presence: 'ended', updatedAt: 50 }),
    session({ sessionId: 'idle-new', presence: 'idle', updatedAt: 20 }),
  ]
  const groups = sessionGroups(sessions)

  expect(groups.map(({ heading }) => heading)).toEqual(['Abertas (4)', 'Encerradas (2)'])
  expect(groups.map(({ sessions: group }) => group.map(({ sessionId }) => sessionId))).toEqual([
    ['working', 'idle-new', 'idle-old', 'stale'],
    ['ended-new', 'ended-old'],
  ])
  expect(sessions.map(({ sessionId }) => sessionId)[0]).toBe('ended-old')
})

test('an empty group has no heading, and no sessions give no group', () => {
  expect(sessionGroups([session({ presence: 'idle' })]).map(({ heading }) => heading)).toEqual(['Abertas (1)'])
  expect(sessionGroups([session({ presence: 'ended' })]).map(({ heading }) => heading)).toEqual(['Encerradas (1)'])
  expect(sessionGroups([])).toEqual([])
})

const several = (status: SubagentStatus, count: number, over: Partial<SubagentLine> = {}): SubagentLine[] =>
  Array.from({ length: count }, (_, index) => line({ id: `${status}-${index}`, status, tokens: 0, ...over }))

test('the summary counts each status with the singular for one and the plural for many', () => {
  expect(subagentSummary([...several('running', 1), ...several('completed', 1), ...several('failed', 1), ...several('stopped', 1)])).toBe(
    '1 rodando · 1 concluído · 1 falhou · 1 parado · 0 tokens',
  )
  expect(subagentSummary([...several('running', 3), ...several('completed', 2), ...several('failed', 2), ...several('stopped', 2)])).toBe(
    '3 rodando · 2 concluídos · 2 falharam · 2 parados · 0 tokens',
  )
})

test('the summary leaves out the statuses with a zero count and keeps the order whatever the order of the lines', () => {
  expect(subagentSummary([...several('stopped', 1), ...several('completed', 2)])).toBe('2 concluídos · 1 parado · 0 tokens')
  expect(subagentSummary(several('failed', 1))).toBe('1 falhou · 0 tokens')
  expect(subagentSummary([...several('stopped', 1), ...several('failed', 1), ...several('completed', 1), ...several('running', 1)])).toBe(
    '1 rodando · 1 concluído · 1 falhou · 1 parado · 0 tokens',
  )
})

test('the summary ends with the token total of every line, abbreviated', () => {
  const lines = [
    ...several('running', 2, { tokens: 100_000 }),
    ...several('completed', 2, { tokens: 10_000 }),
    ...several('stopped', 1, { tokens: 8000 }),
  ]

  expect(subagentSummary(lines)).toBe('2 rodando · 2 concluídos · 1 parado · 228k tokens')
  expect(subagentSummary(several('running', 1, { tokens: 1500 }))).toBe('1 rodando · 1.5k tokens')
  expect(subagentSummary(several('running', 1, { tokens: 42 }))).toBe('1 rodando · 42 tokens')
})

test('the summary of no subagent is empty', () => {
  expect(subagentSummary([])).toBe('')
})

const ids = (lines: readonly SubagentLine[]): string[] => lines.map(({ id }) => id)

test('a tree with a running child under a finished root goes whole to Em andamento, with its indentation', () => {
  const lines = [
    line({ id: 'root', status: 'completed', depth: 0 }),
    line({ id: 'child', status: 'running', depth: 1 }),
    line({ id: 'grandchild', status: 'completed', depth: 2 }),
    line({ id: 'other', status: 'failed', depth: 0 }),
  ]
  const groups = subagentGroups(lines)

  expect(groups.map(({ heading }) => heading)).toEqual(['Em andamento (3)', 'Terminados (1)'])
  expect(groups.map(({ lines: group }) => ids(group))).toEqual([['root', 'child', 'grandchild'], ['other']])
  expect(groups[0]?.lines.map(({ depth }) => depth)).toEqual([0, 1, 2])
})

test('a tree with no running line goes to Terminados', () => {
  const lines = [
    line({ id: 'root', status: 'completed', depth: 0 }),
    line({ id: 'child', status: 'stopped', depth: 1 }),
    line({ id: 'live', status: 'running', depth: 0 }),
  ]

  expect(subagentGroups(lines).map(({ lines: group }) => ids(group))).toEqual([['live'], ['root', 'child']])
})

test('the groups keep the order received inside each group', () => {
  const lines = [
    line({ id: 'done-1', status: 'completed' }),
    line({ id: 'live-1', status: 'running' }),
    line({ id: 'live-1-child', status: 'completed', depth: 1 }),
    line({ id: 'done-2', status: 'failed' }),
    line({ id: 'live-2', status: 'running' }),
    line({ id: 'done-3', status: 'stopped' }),
  ]

  expect(subagentGroups(lines).map(({ lines: group }) => ids(group))).toEqual([
    ['live-1', 'live-1-child', 'live-2'],
    ['done-1', 'done-2', 'done-3'],
  ])
})

test('an empty group has no heading, each heading counts its rows, and no subagent gives no group', () => {
  expect(subagentGroups([line({ status: 'running' })]).map(({ heading }) => heading)).toEqual(['Em andamento (1)'])
  expect(subagentGroups([line({ status: 'failed' }), line({ id: 'b', status: 'stopped' })]).map(({ heading }) => heading)).toEqual([
    'Terminados (2)',
  ])
  expect(subagentGroups([])).toEqual([])
})

test('a line with a depth and no root before it is its own tree', () => {
  const lines = [line({ id: 'orphan', status: 'completed', depth: 1 }), line({ id: 'root', status: 'running', depth: 0 })]

  expect(subagentGroups(lines).map(({ lines: group }) => ids(group))).toEqual([['root'], ['orphan']])
})

test('the groups do not reorder the list they receive', () => {
  const lines = [line({ id: 'a', status: 'completed' }), line({ id: 'b', status: 'running' })]

  subagentGroups(lines)

  expect(ids(lines)).toEqual(['a', 'b'])
})

const PALETTE: readonly [string, string][] = [
  ['red', '#d1242f'],
  ['blue', '#3b82f6'],
  ['green', '#22a06b'],
  ['yellow', '#d4a72c'],
  ['purple', '#8250df'],
  ['orange', '#e16f24'],
  ['pink', '#db61a2'],
  ['cyan', '#1b9aaa'],
]

for (const [name, hex] of PALETTE) {
  test(`the frontmatter colour ${name} maps to ${hex}`, () => {
    expect(agentColor(name)).toBe(hex)
    expect(catalogRow(agent({ color: name })).markColor).toBe(hex)
  })
}

test('an unknown or absent frontmatter colour maps to the subtle theme colour, and so does a name the table object would inherit', () => {
  expect(agentColor('magenta')).toBe('subtle')
  expect(agentColor('')).toBe('subtle')
  expect(agentColor(undefined)).toBe('subtle')
  expect(agentColor('constructor')).toBe('subtle')
})

test('a catalog row has the dot, the name, the meta with source, model, tool count and ativo, and the cut description', () => {
  expect(catalogRow(agent())).toEqual({
    mark: '●',
    markColor: 'subtle',
    name: 'worker',
    meta: 'projeto · modelo da sessão',
    description: 'does the work',
  })
  expect(catalogRow(agent({ source: 'user', model: 'claude-opus-5-5', tools: ['Read', 'Grep'], isActive: true })).meta).toBe(
    'usuário · modelo: claude-opus-5-5 · 2 ferramentas · ativo',
  )
  expect(catalogRow(agent({ tools: ['Read'] })).meta).toBe('projeto · modelo da sessão · 1 ferramenta')
  expect(catalogRow(agent({ description: 'a'.repeat(100) })).description).toBe(`${'a'.repeat(79)}…`)
})

test('the footer summary is empty with nothing to show, and each part appears only with a value', () => {
  expect(footerSummary({ agent: null, running: 0, peers: 0 })).toBe('')
  expect(footerSummary({ agent: { name: 'worker' }, running: 0, peers: 0 })).toBe('@worker')
  expect(footerSummary({ agent: null, running: 1, peers: 0 })).toBe('1 subagente rodando')
  expect(footerSummary({ agent: null, running: 0, peers: 1 })).toBe('1 sessão trabalhando')
})

test('the footer summary carries the model and the effort of the agent, then the counts in the plural, joined by a middle dot', () => {
  expect(
    footerSummary({ agent: { name: 'thinker', model: 'claude-opus-5-5', effort: 'high' }, running: 2, peers: 3 }),
  ).toBe('@thinker · claude-opus-5-5 · high · 2 subagentes rodando · 3 sessões trabalhando')
})

test('the prompt line count is 1 linha for one line and N linhas for more, ignoring trailing line breaks and counting CRLF once', () => {
  expect(promptLines('one')).toBe('1 linha')
  expect(promptLines('one\n')).toBe('1 linha')
  expect(promptLines('one\ntwo\nthree')).toBe('3 linhas')
  expect(promptLines('one\r\ntwo')).toBe('2 linhas')
  expect(promptLines('one\n\ntwo')).toBe('3 linhas')
})

test('the prompt preview is flattened and cut at 300 characters with an ellipsis', () => {
  expect(promptPreview('first\n\n  second')).toBe('first second')
  expect(promptPreview('a'.repeat(300))).toBe('a'.repeat(300))
  expect(promptPreview('a'.repeat(301))).toBe(`${'a'.repeat(299)}…`)
})

test('the earlier toggle counts the earlier answers, and counts the messages only when there is no earlier answer', () => {
  const answer = { kind: 'answer', text: 'a', at: 1 } as const
  const sent = { kind: 'sent', text: 's', at: 2 } as const

  expect(earlierLabel([answer])).toBe('Respostas anteriores (1)')
  expect(earlierLabel([answer, sent, answer, sent, sent])).toBe('Respostas anteriores (2)')
  expect(earlierLabel([sent])).toBe('Mensagens anteriores (1)')
  expect(earlierLabel([sent, sent])).toBe('Mensagens anteriores (2)')
})

test('a sent message is shown as Você and its text', () => {
  expect(youSaid('and the tests?')).toBe('Você: and the tests?')
})

test('a running subagent row splits its meta around the clock, and the tool joins the text before it', () => {
  expect(subagentRow(line({ tool: 'Grep' }), NOW).ticking).toEqual({
    before: 'rodando · Grep ·',
    clock: { kind: 'elapsed', since: NOW - 12_000 },
    after: '· 1.5k',
  })
  expect(subagentRow(line({ tool: null }), NOW).ticking).toEqual({
    before: 'rodando ·',
    clock: { kind: 'elapsed', since: NOW - 12_000 },
    after: '· 1.5k',
  })
})

test('a subagent row that is not running, or that has a recorded duration, has no split, because its time is final', () => {
  for (const status of ['completed', 'failed', 'stopped'] as const) {
    expect(subagentRow(line({ status, durationMs: 2400, endedAt: NOW }), NOW).ticking).toBeUndefined()
  }

  expect(subagentRow(line({ durationMs: 65_000 }), NOW).ticking).toBeUndefined()
})

test('a working session row splits around the turn clock, with nothing after it', () => {
  const row = sessionRow(timed({ presence: 'working', turnStartedAt: NOW - 83_000 }), NOW)

  expect(row.ticking).toEqual({
    before: '@architect · trabalhando ·',
    clock: { kind: 'elapsed', since: NOW - 83_000 },
    after: '',
  })
  expect(sessionRow(timed({ presence: 'working', turnStartedAt: null }), NOW).ticking).toBeUndefined()
})

test('an idle session row splits around the time since it went idle, and one without idleSince has no split', () => {
  expect(sessionRow(timed({ presence: 'idle', idleSince: NOW - 125_000, updatedAt: NOW - 3000 }), NOW).ticking).toEqual({
    before: '@architect · ociosa ·',
    clock: { kind: 'ago', since: NOW - 125_000, templates: AGO_PT },
    after: '',
  })
  expect(sessionRow(timed({ presence: 'idle', idleSince: undefined }), NOW).ticking).toBeUndefined()
})

test('a stale or ended session row splits around the time since its last sign of life', () => {
  const quiet = { idleSince: NOW - 1000, turnStartedAt: NOW - 1000, updatedAt: NOW - 125_000 }

  expect(sessionRow(timed({ presence: 'stale', ...quiet }), NOW).ticking).toEqual({
    before: '@architect · inativa ·',
    clock: { kind: 'ago', since: NOW - 125_000, templates: AGO_PT },
    after: '',
  })
  expect(sessionRow(timed({ presence: 'ended', ...quiet }), NOW).ticking).toEqual({
    before: '@architect · encerrada ·',
    clock: { kind: 'ago', since: NOW - 125_000, templates: AGO_PT },
    after: '',
  })
})

test('a session row in English carries the English templates', () => {
  expect(english.sessionRow(timed({ presence: 'stale', updatedAt: NOW - 125_000 }), NOW).ticking).toEqual({
    before: '@architect · inactive ·',
    clock: { kind: 'ago', since: NOW - 125_000, templates: AGO_EN },
    after: '',
  })
})

test('the split joined back equals the meta for every status, tool, presence and age, in both languages', () => {
  const spans = [0, 1000, 59_000, 60_000, 3_599_000, 3_600_000, 7_300_000]

  for (const words of [messagesIn('pt-BR'), english]) {
    for (const status of ['running', 'completed', 'failed', 'stopped'] as const) {
      for (const tool of ['Grep', null]) {
        for (const durationMs of [null, 2400]) {
          expectSplitToJoin(words.subagentRow(line({ status, tool, durationMs }), NOW), NOW)
        }
      }
    }

    for (const presence of ['working', 'idle', 'stale', 'ended'] as const) {
      for (const agent of ['architect', null]) {
        for (const span of spans) {
          const at = NOW - span
          const row = words.sessionRow(
            session({ presence, agent, turnStartedAt: at, idleSince: at, updatedAt: at }),
            NOW,
          )

          expect(row.ticking).toBeDefined()
          expectSplitToJoin(row, NOW)
        }
      }
    }
  }
})
