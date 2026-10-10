import type { Elements, RenderElement } from 'claude-code'

import type { SessionPresence } from '../../types'
import * as messages from '../messages'
import type { Monitor } from '../monitor/index'

export type BandElements = Pick<Elements['mobile'], 'Box' | 'Text' | 'Button'>

export type BandMonitor = Pick<Monitor, 'runningCount' | 'agentInForce' | 'lastOthers'>

export type BandDrawing = {
  below: RenderElement
  hasSurvey: boolean
  openPanel: () => Promise<unknown>
}

const ACTIVE: readonly SessionPresence[] = ['trabalhando', 'ociosa']

const factsOf = (monitor: BandMonitor): messages.BandFacts => ({
  agent: monitor.agentInForce()?.name ?? null,
  running: monitor.runningCount(),
  peers: monitor.lastOthers().filter(({ presence }) => ACTIVE.includes(presence)).length,
})

export const drawBand = (
  monitor: BandMonitor,
  { Box, Text, Button }: BandElements,
  { below, hasSurvey, openPanel }: BandDrawing,
): RenderElement => {
  const text = hasSurvey ? '' : messages.bandText(factsOf(monitor))

  if (text === '') {
    return below
  }

  return (
    <Box flexDirection="column">
      {below}
      <Box flexDirection="row" gap={2}>
        <Text>{text}</Text>
        <Button key="open-panel" hotkey="1" plain label={messages.OPEN_PANEL_LABEL} onPress={openPanel} />
      </Box>
    </Box>
  )
}
