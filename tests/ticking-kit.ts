import type { FoundElement } from 'claude-code/testing'

import { type ClockProps, clockText } from '../hooks/timing'

type Mounted = { findAll: (query: { type?: string; key?: string }) => Promise<FoundElement[]> }

type Drawn = { type?: string; props?: Record<string, unknown>; children?: readonly unknown[] }

const asDrawn = (node: unknown): Drawn => (typeof node === 'object' && node !== null ? (node as Drawn) : {})

export const clockPropsOf = (client: { props: Record<string, unknown> }): ClockProps =>
  client.props.props as ClockProps

const shownBy = (node: unknown, now: number): string => {
  const { type, props, children } = asDrawn(node)

  if (type === 'Client') {
    return clockText(clockPropsOf({ props: props ?? {} }), now)
  }

  return (children ?? []).filter(child => typeof child === 'string').join('')
}

export const metaOfRow = (row: readonly unknown[], now: number): string =>
  row
    .slice(2)
    .map(node => shownBy(node, now))
    .filter(text => text !== '')
    .join(' ')

export const rowBoxesOf = async (ui: Mounted): Promise<(readonly unknown[])[]> =>
  (await ui.findAll({ type: 'Box' }))
    .map(box => box.children)
    .filter(children => asDrawn(children[1]).type === 'Button')

export const tickingMetasOf = async (ui: Mounted, now: number): Promise<string[]> =>
  (await rowBoxesOf(ui))
    .filter(row => row.some(node => asDrawn(node).type === 'Client'))
    .map(row => metaOfRow(row, now))
