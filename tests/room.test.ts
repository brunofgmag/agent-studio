import { expect, test } from 'claude-code/testing'

import { descriptionBudget } from '../hooks/ui/row'

const TERMINAL = { columns: 80, surface: 'terminal' }

const DESKTOP = { columns: 80, surface: 'desktop' }

test('a terminal line has one character per cell, less the root padding and the description indent', () => {
  expect(descriptionBudget(TERMINAL)).toBe(76)
})

test('a desktop line fits more characters than the cells it has', () => {
  expect(descriptionBudget(DESKTOP)).toBe(89)
})

test('every surface other than the desktop counts one character per cell', () => {
  expect(descriptionBudget({ columns: 80, surface: 'mobile' })).toBe(76)
  expect(descriptionBudget({ columns: 80, surface: 'vscode' })).toBe(76)
})

test('a desktop line that is exactly 85 cells wide fits 100 characters', () => {
  expect(descriptionBudget({ columns: 89, surface: 'desktop' })).toBe(100)
})

test('the row indent takes cells off the line', () => {
  expect(descriptionBudget(TERMINAL, { indent: 4 })).toBe(72)
  expect(descriptionBudget(DESKTOP, { indent: 4 })).toBe(84)
})

test('a button replaces the description indent with its label, its padding and the gap', () => {
  expect(descriptionBudget(TERMINAL, { button: 'Use' })).toBe(70)
  expect(descriptionBudget(TERMINAL, { button: 'Confirm' })).toBe(66)
})

test('on the desktop the button label is counted in cells, rounded up', () => {
  expect(descriptionBudget(DESKTOP, { button: 'Use' })).toBe(82)
  expect(descriptionBudget(DESKTOP, { button: 'Confirm' })).toBe(78)
})

test('a button and an indent take their cells together', () => {
  expect(descriptionBudget(TERMINAL, { button: 'Use', indent: 4 })).toBe(66)
})

test('a line with no room left still gets ten characters', () => {
  expect(descriptionBudget({ columns: 10, surface: 'terminal' })).toBe(10)
  expect(descriptionBudget({ columns: 12, surface: 'desktop' })).toBe(10)
  expect(descriptionBudget({ columns: 0, surface: 'terminal' }, { button: 'Confirm' })).toBe(10)
})
