import type { AgentInfo, ModelUsage } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import {
  type Collector,
  type CompletionFacts,
  LINE_LIMIT,
  type SpawnFacts,
  createCollector,
  tokensOf,
} from '../hooks/monitor/collector'

const usage = (input: number, output = 0, read = 0, created = 0): ModelUsage => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: created,
})

const spawn = (over: Partial<SpawnFacts> = {}): SpawnFacts => ({
  subagentType: 'general-purpose',
  description: 'read the logs',
  prompt: 'Read every log and report.',
  background: false,
  ...over,
})

const bear = (collector: Collector, id: string, at: number, over: Partial<SpawnFacts> = {}, model = 'claude-haiku-5-5') =>
  collector.born(spawn(over), { agentId: id, model }, at)

const complete = (
  collector: Collector,
  id: string,
  at: number,
  over: Partial<CompletionFacts> = {},
) => collector.turnCompleted({ agentId: id, answer: 'done', durationMs: 500, reason: 'answer', ...over }, at)

const listed = (id: string, status: AgentInfo['status'], over: Partial<AgentInfo> = {}): AgentInfo => ({
  id,
  description: `task of ${id}`,
  type: 'Explore',
  status,
  ...over,
})

const lineOf = (collector: Collector, id: string) => collector.lines().find(line => line.id === id)

test('birth, tool, step and end make one line with type, task, model, tool, summed tokens, duration and status', () => {
  const collector = createCollector()

  bear(collector, 'a1', 1000)
  collector.toolStarted('a1', 'Read')

  expect(lineOf(collector, 'a1')).toMatchObject({
    type: 'general-purpose',
    task: 'read the logs',
    prompt: 'Read every log and report.',
    model: 'claude-haiku-5-5',
    status: 'running',
    tool: 'Read',
    parentId: null,
    background: false,
    startedAt: 1000,
    endedAt: null,
    durationMs: null,
    tokens: 0,
  })

  collector.toolFinished('a1', 'Read')
  collector.stepUsed('a1', usage(10, 5, 100, 20))
  collector.stepUsed('a1', usage(1, 1))
  complete(collector, 'a1', 3000, { durationMs: 1800, answer: 'the full answer' })

  expect(lineOf(collector, 'a1')).toMatchObject({
    status: 'completed',
    tool: null,
    tokens: 137,
    startedAt: 1000,
    endedAt: 3000,
    durationMs: 1800,
    answer: 'the full answer',
  })
  expect(collector.runningCount()).toBe(0)
})

test('tokensOf adds the four counters', () => {
  expect(tokensOf(usage(1, 2, 4, 8))).toBe(15)
})

test('a nested subagent sits right under its parent with one more level, whatever the birth order', () => {
  const collector = createCollector()

  bear(collector, 'root-1', 1000)
  bear(collector, 'root-2', 1100)
  bear(collector, 'child-1', 1200, { parentAgentId: 'root-1' })
  bear(collector, 'grandchild', 1300, { parentAgentId: 'child-1' })

  expect(collector.lines().map(({ id, depth }) => [id, depth])).toEqual([
    ['root-1', 0],
    ['child-1', 1],
    ['grandchild', 2],
    ['root-2', 0],
  ])
})

test('a child whose parent is unknown or removed becomes a root', () => {
  const collector = createCollector()

  bear(collector, 'orphan', 1000, { parentAgentId: 'never-seen' })

  expect(collector.lines().map(({ id, depth }) => [id, depth])).toEqual([['orphan', 0]])
})

test('an orphan born before a root keeps its place among the roots', () => {
  const collector = createCollector()

  bear(collector, 'orphan', 1000, { parentAgentId: 'never-seen' })
  bear(collector, 'root', 1100)

  expect(collector.lines().map(({ id, depth }) => [id, depth])).toEqual([
    ['orphan', 0],
    ['root', 0],
  ])
})

test('a parent loop does not make a line vanish', () => {
  const collector = createCollector()

  bear(collector, 'a', 1000, { parentAgentId: 'b' })
  bear(collector, 'b', 1000, { parentAgentId: 'a' })

  expect(collector.lines().map(({ id }) => id)).toEqual(['a', 'b'])
})

test('events with no known agent make no line: a denied spawn, the main loop and unknown ids', () => {
  const collector = createCollector()

  collector.born(spawn(), {}, 1000)
  collector.toolStarted('ghost', 'Bash')
  collector.stepUsed('ghost', usage(5))
  collector.turnCompleted({ answer: 'main', durationMs: 5, reason: 'answer', usage: usage(9) }, 2000)
  complete(collector, 'ghost', 2000)

  expect(collector.lines()).toEqual([])
  expect(collector.runningCount()).toBe(0)
})

test('an interrupted end is stopped, an error is failed, an answer and a refusal are completed', () => {
  const collector = createCollector()

  for (const id of ['x1', 'x2', 'x3', 'x4']) {
    bear(collector, id, 1000)
  }

  complete(collector, 'x1', 2000, { reason: 'aborted' })
  complete(collector, 'x2', 2000, { reason: 'error' })
  complete(collector, 'x3', 2000, { reason: 'answer' })
  complete(collector, 'x4', 2000, { reason: 'refusal' })

  expect(collector.lines().map(({ id, status }) => [id, status])).toEqual([
    ['x1', 'stopped'],
    ['x2', 'failed'],
    ['x3', 'completed'],
    ['x4', 'completed'],
  ])
})

test('the usage of turn.complete replaces the step sum of that run', () => {
  const collector = createCollector()

  bear(collector, 'a1', 1000)
  collector.stepUsed('a1', usage(10))
  collector.stepUsed('a1', usage(20))
  complete(collector, 'a1', 2000, { usage: usage(100, 50) })

  expect(lineOf(collector, 'a1')?.tokens).toBe(150)
})

test('an end with no usage keeps the step sum of that run', () => {
  const collector = createCollector()

  bear(collector, 'a1', 1000)
  collector.stepUsed('a1', usage(10, 5))
  collector.stepUsed('a1', null)
  complete(collector, 'a1', 2000, { reason: 'error' })

  expect(lineOf(collector, 'a1')?.tokens).toBe(15)
})

test('a completed subagent that gets a step or a tool again is running, and its runs add up', () => {
  const collector = createCollector()

  bear(collector, 'a1', 1000)
  collector.stepUsed('a1', usage(10))
  complete(collector, 'a1', 2000, { usage: usage(40), durationMs: 700 })
  collector.stepUsed('a1', usage(5))

  expect(lineOf(collector, 'a1')).toMatchObject({ status: 'running', endedAt: null, durationMs: null, tokens: 45 })

  complete(collector, 'a1', 4000, { usage: usage(30), durationMs: 900 })

  expect(lineOf(collector, 'a1')).toMatchObject({ status: 'completed', endedAt: 4000, durationMs: 1600, tokens: 70 })

  collector.toolStarted('a1', 'Grep')

  expect(lineOf(collector, 'a1')).toMatchObject({ status: 'running', tool: 'Grep', tokens: 70 })
})

test('a stopped or failed subagent is not reopened by a late step', () => {
  const collector = createCollector()

  bear(collector, 's1', 1000)
  bear(collector, 'f1', 1000)
  complete(collector, 's1', 2000, { reason: 'aborted' })
  complete(collector, 'f1', 2000, { reason: 'error' })
  collector.stepUsed('s1', usage(1))
  collector.toolStarted('f1', 'Read')

  expect(lineOf(collector, 's1')?.status).toBe('stopped')
  expect(lineOf(collector, 'f1')?.status).toBe('failed')
})

test('parallel tools of one subagent keep the one still running on the line', () => {
  const collector = createCollector()

  bear(collector, 'a1', 1000)
  collector.toolStarted('a1', 'Read')
  collector.toolStarted('a1', 'Grep')
  collector.toolFinished('a1', 'Grep')

  expect(lineOf(collector, 'a1')?.tool).toBe('Read')

  collector.toolFinished('a1', 'Read')

  expect(lineOf(collector, 'a1')?.tool).toBe(null)
})

test('the end clears the tool in use', () => {
  const collector = createCollector()

  bear(collector, 'a1', 1000)
  collector.toolStarted('a1', 'Read')
  complete(collector, 'a1', 2000)

  expect(lineOf(collector, 'a1')?.tool).toBe(null)
})

test('a subagent only the official list knows appears with what the list gives and empty model and tokens', () => {
  const collector = createCollector()

  collector.reconcile([listed('early', 'running', { parentId: 'boss', description: 'born before the plugin' })], 5000)

  expect(collector.lines()).toEqual([
    {
      id: 'early',
      type: 'Explore',
      task: 'born before the plugin',
      prompt: '',
      model: null,
      parentId: 'boss',
      background: false,
      status: 'running',
      tool: null,
      tokens: 0,
      startedAt: 5000,
      endedAt: null,
      durationMs: null,
      answer: '',
      depth: 0,
    },
  ])
})

test('the list wins over the local status when it says completed, failed or killed', () => {
  const collector = createCollector()

  for (const id of ['c', 'f', 'k']) {
    bear(collector, id, 1000)
  }

  collector.reconcile([listed('c', 'completed'), listed('f', 'failed'), listed('k', 'killed')], 4000)

  expect(collector.lines().map(({ id, status, endedAt, durationMs }) => [id, status, endedAt, durationMs])).toEqual([
    ['c', 'completed', 4000, 3000],
    ['f', 'failed', 4000, 3000],
    ['k', 'stopped', 4000, 3000],
  ])
})

test('every other list status counts as running, and an agreeing end is left as it was', () => {
  const collector = createCollector()

  for (const id of ['p', 'w', 'i', 'done']) {
    bear(collector, id, 1000)
  }

  complete(collector, 'done', 2000, { durationMs: 321, usage: usage(7) })
  complete(collector, 'i', 2000)
  collector.reconcile(
    [listed('p', 'pending'), listed('w', 'waiting'), listed('i', 'idle'), listed('done', 'completed')],
    9000,
  )

  expect(collector.lines().map(({ id, status }) => [id, status])).toEqual([
    ['p', 'running'],
    ['w', 'running'],
    ['i', 'running'],
    ['done', 'completed'],
  ])
  expect(lineOf(collector, 'done')).toMatchObject({ endedAt: 2000, durationMs: 321, tokens: 7 })
})

test('reconciling a known subagent keeps its model, prompt and tokens', () => {
  const collector = createCollector()

  bear(collector, 'a1', 1000)
  collector.stepUsed('a1', usage(12))
  collector.reconcile([listed('a1', 'running')], 2000)

  expect(lineOf(collector, 'a1')).toMatchObject({
    model: 'claude-haiku-5-5',
    prompt: 'Read every log and report.',
    tokens: 12,
    type: 'general-purpose',
  })
})

test('with one line over the limit the oldest finished one leaves, and an older running one stays', () => {
  const collector = createCollector()

  bear(collector, 'running-old', 1)

  for (let index = 0; index < LINE_LIMIT - 1; index += 1) {
    bear(collector, `done-${index}`, 10 + index)
    complete(collector, `done-${index}`, 1000 + index)
  }

  expect(collector.lines().length).toBe(LINE_LIMIT)

  bear(collector, 'newest', 5000)

  const ids = collector.lines().map(({ id }) => id)

  expect(ids.length).toBe(LINE_LIMIT)
  expect(ids).toContain('running-old')
  expect(ids).toContain('newest')
  expect(ids).not.toContain('done-0')
  expect(ids).toContain('done-1')
})

test('the oldest end is judged by when it ended, not by when it was born', () => {
  const collector = createCollector()

  bear(collector, 'born-first-ended-last', 1)
  bear(collector, 'born-last-ended-first', 2)
  complete(collector, 'born-last-ended-first', 100)
  complete(collector, 'born-first-ended-last', 900)

  for (let index = 0; index < LINE_LIMIT - 1; index += 1) {
    bear(collector, `r-${index}`, 10 + index)
  }

  const ids = collector.lines().map(({ id }) => id)

  expect(ids).toContain('born-first-ended-last')
  expect(ids).not.toContain('born-last-ended-first')
})

test('when every line is running the limit is exceeded and none leaves', () => {
  const collector = createCollector()

  for (let index = 0; index < LINE_LIMIT + 5; index += 1) {
    bear(collector, `r-${index}`, index)
  }

  expect(collector.lines().length).toBe(LINE_LIMIT + 5)
  expect(collector.runningCount()).toBe(LINE_LIMIT + 5)
})

test('lines the list brings in count toward the limit too', () => {
  const collector = createCollector()

  collector.reconcile(
    Array.from({ length: LINE_LIMIT + 3 }, (_unused, index) => listed(`l-${index}`, 'completed')),
    100,
  )

  expect(collector.lines().length).toBe(LINE_LIMIT)
})

test('clear forgets every line', () => {
  const collector = createCollector()

  bear(collector, 'a1', 1000)
  collector.clear()

  expect(collector.lines()).toEqual([])
  expect(collector.runningCount()).toBe(0)
})
