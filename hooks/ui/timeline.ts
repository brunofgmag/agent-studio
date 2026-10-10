import type { SubagentLine, SubagentStatus } from '../../types'

export type TimelineBar = {
  id: string
  type: string
  status: SubagentStatus
  start: number
  width: number
}

const COLOR: Record<SubagentStatus, string> = {
  running: '#3b82f6',
  completed: '#22a06b',
  failed: '#d1242f',
  stopped: '#8c959f',
}

const ROW_HEIGHT = 30
const LABEL_BASELINE = 11
const FONT_SIZE = 11
const BAR_TOP = 15
const BAR_HEIGHT = 10
const BAR_RADIUS = 2
const MIN_BAR_WIDTH = 2

const ESCAPED: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

const escaped = (text: string): string => text.replace(/[&<>"']/g, character => ESCAPED[character] ?? character)

const pixels = (value: number): number => Number(value.toFixed(2))

export const timelineBars = (lines: readonly SubagentLine[], at: number): TimelineBar[] => {
  const origin = Math.min(...lines.map(({ startedAt }) => startedAt))
  const span = at - origin
  const hasScale = span > 0

  return lines.map(({ id, type, status, startedAt, endedAt }) => ({
    id,
    type,
    status,
    start: hasScale ? (startedAt - origin) / span : 0,
    width: hasScale ? ((endedAt ?? at) - startedAt) / span : 1,
  }))
}

const labelOf = (x: number, barWidth: number, width: number) =>
  x + barWidth / 2 > width / 2
    ? { x: pixels(Math.min(x + barWidth, width)), anchor: ' text-anchor="end"' }
    : { x, anchor: '' }

const drawStrip = (bar: TimelineBar, index: number, width: number): string[] => {
  const x = pixels(bar.start * width)
  const barWidth = pixels(Math.max(bar.width * width, MIN_BAR_WIDTH))
  const top = index * ROW_HEIGHT
  const label = labelOf(x, barWidth, width)

  return [
    `<text x="${label.x}" y="${top + LABEL_BASELINE}" font-size="${FONT_SIZE}"${label.anchor} fill="currentColor">${escaped(bar.type)}</text>`,
    `<rect x="${x}" y="${top + BAR_TOP}" width="${barWidth}" height="${BAR_HEIGHT}" rx="${BAR_RADIUS}" fill="${COLOR[bar.status]}"/>`,
  ]
}

export const timelineSvg = (bars: readonly TimelineBar[], width: number): string => {
  const height = bars.length * ROW_HEIGHT

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    ...bars.flatMap((bar, index) => drawStrip(bar, index, width)),
    '</svg>',
  ].join('\n')
}
