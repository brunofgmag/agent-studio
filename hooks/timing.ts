export type AgoTemplates = { seconds: string; minutes: string; hours: string }

export type AgoUnit = keyof AgoTemplates

export type ClockProps =
  | { kind: 'elapsed'; since: number }
  | { kind: 'ago'; since: number; templates: AgoTemplates }

const SECONDS_PER_MINUTE = 60

const SECONDS_PER_HOUR = 3600

const AMOUNT_PLACEHOLDER = '{n}'

const pad = (value: number) => String(value).padStart(2, '0')

export const clock = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000))

  return `${Math.floor(seconds / SECONDS_PER_MINUTE)}:${pad(seconds % SECONDS_PER_MINUTE)}`
}

export const filled = (template: string, amount: number): string =>
  template.replace(AMOUNT_PLACEHOLDER, String(amount))

export const agoBucket = (ms: number): { unit: AgoUnit; amount: number } => {
  const seconds = Math.max(0, Math.floor(ms / 1000))

  if (seconds < SECONDS_PER_MINUTE) {
    return { unit: 'seconds', amount: seconds }
  }

  return seconds < SECONDS_PER_HOUR
    ? { unit: 'minutes', amount: Math.floor(seconds / SECONDS_PER_MINUTE) }
    : { unit: 'hours', amount: Math.floor(seconds / SECONDS_PER_HOUR) }
}

export const clockText = (props: ClockProps, now: number): string => {
  if (props.kind === 'elapsed') {
    return clock(now - props.since)
  }

  const { unit, amount } = agoBucket(now - props.since)

  return filled(props.templates[unit], amount)
}
