import { expect, test } from 'claude-code/testing'

import Clock from '../hooks/ui/clock'
import { type AgoTemplates, type ClockProps, clock, clockText, filled } from '../hooks/timing'
import { en } from '../hooks/words/en'
import { ptBr } from '../hooks/words/pt-br'

const SINCE = 5_000_000

const clockOf = (props: ClockProps, state?: number) => {
  const timers: { ms: number; fn: () => void }[] = []
  const stored: number[] = []
  const Text = (textProps: Record<string, unknown>) => ({ type: 'Text', props: textProps })
  const surface = {
    state,
    elements: { Text },
    every: (ms: number, fn: () => void) => {
      timers.push({ ms, fn })

      return () => undefined
    },
    setState: (next: number) => stored.push(next),
  }
  const tree = Clock(props, surface as never) as unknown as { props: { children: string[]; dimColor?: boolean } }

  return { timers, stored, props: tree.props }
}

const elapsedAt = (ms: number) => clockOf({ kind: 'elapsed', since: SINCE }, SINCE + ms).props

const agoAt = (templates: AgoTemplates, ms: number) =>
  clockOf({ kind: 'ago', since: SINCE, templates }, SINCE + ms).props

test('the elapsed clock reads minutes and seconds from the instant in its state, dim', () => {
  expect(elapsedAt(0)).toEqual({ dimColor: true, children: ['0:00'] })
  expect(elapsedAt(999).children).toEqual(['0:00'])
  expect(elapsedAt(1000).children).toEqual(['0:01'])
  expect(elapsedAt(83_000).children).toEqual(['1:23'])
  expect(elapsedAt(3_600_000).children).toEqual(['60:00'])
})

test('the elapsed clock never goes below zero when the instant is before the start', () => {
  expect(elapsedAt(-5000).children).toEqual(['0:00'])
})

test('the ago clock reads seconds, minutes and hours with the templates it was given, in both languages', () => {
  for (const [words, texts] of [
    [en, ['0 s ago', '1 s ago', '59 s ago', '1 min ago', '59 min ago', '1 h ago', '2 h ago']],
    [ptBr, ['há 0 s', 'há 1 s', 'há 59 s', 'há 1 min', 'há 59 min', 'há 1 h', 'há 2 h']],
  ] as const) {
    const spans = [0, 1000, 59_999, 60_000, 3_599_999, 3_600_000, 7_300_000]

    expect(spans.map(span => agoAt(words.ago, span).children[0])).toEqual(texts)
  }
})

test('the ago clock changes unit exactly at 60 seconds and at 3600 seconds', () => {
  expect(agoAt(en.ago, 59_000).children).toEqual(['59 s ago'])
  expect(agoAt(en.ago, 60_000).children).toEqual(['1 min ago'])
  expect(agoAt(en.ago, 3_599_000).children).toEqual(['59 min ago'])
  expect(agoAt(en.ago, 3_600_000).children).toEqual(['1 h ago'])
})

test('the clock starts one second timer only while it has no state, and the timer stores the instant', () => {
  const first = clockOf({ kind: 'elapsed', since: SINCE })
  const later = clockOf({ kind: 'elapsed', since: SINCE }, SINCE)

  expect(first.timers.map(({ ms }) => ms)).toEqual([1000])
  expect(later.timers).toEqual([])

  first.timers[0]?.fn()

  expect(first.stored).toHaveLength(1)
  expect(first.stored[0]).toBeGreaterThan(SINCE)
})

test('a clock with no state yet draws from the real clock', () => {
  const now = Date.now()

  expect(clockOf({ kind: 'elapsed', since: now }).props.children).toEqual(['0:00'])
  expect(clockOf({ kind: 'ago', since: now, templates: en.ago }).props.children).toEqual(['0 s ago'])
})

test('the minutes and seconds format pads the seconds and ignores a negative span', () => {
  expect(clock(0)).toBe('0:00')
  expect(clock(9000)).toBe('0:09')
  expect(clock(61_000)).toBe('1:01')
  expect(clock(-1000)).toBe('0:00')
})

test('the template puts the amount where the placeholder is', () => {
  expect(filled('há {n} min', 7)).toBe('há 7 min')
  expect(filled('{n} s ago', 0)).toBe('0 s ago')
})

for (const [language, words] of [
  ['English', en],
  ['Portuguese', ptBr],
] as const) {
  test(`the ${language} templates and the ago functions agree at 1, 59, 60, 3599 and 3600 seconds`, () => {
    const expected: [number, string][] = [
      [1, words.secondsAgo(1)],
      [59, words.secondsAgo(59)],
      [60, words.minutesAgo(1)],
      [3599, words.minutesAgo(59)],
      [3600, words.hoursAgo(1)],
    ]

    for (const [seconds, text] of expected) {
      expect(clockText({ kind: 'ago', since: 0, templates: words.ago }, seconds * 1000)).toBe(text)
    }
  })
}
