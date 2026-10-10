import type { ClientModule } from 'claude-code'

import { type ClockProps, clockText } from '../timing'

const TICK_MS = 1000

const Clock: ClientModule<ClockProps, number> = (props, surface) => {
  if (surface.state === undefined) {
    surface.every(TICK_MS, () => surface.setState(Date.now()))
  }

  const { Text } = surface.elements

  return <Text dimColor>{clockText(props, surface.state ?? Date.now())}</Text>
}

export default Clock
