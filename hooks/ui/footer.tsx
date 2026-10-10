import type { Elements, RenderElement } from 'claude-code'

import type { SessionPresence } from '../../types'
import * as messages from '../messages'
import type { Monitor } from '../monitor/index'

export type FooterElements = Pick<Elements['mobile'], 'Box' | 'Button'>

export type FooterMonitor = Pick<Monitor, 'runningCount' | 'agentInForce' | 'lastOthers'>

const ACTIVE: readonly SessionPresence[] = ['trabalhando', 'ociosa']

export const footerSummaryOf = (monitor: FooterMonitor): string =>
  messages.footerSummary({
    agent: monitor.agentInForce(),
    running: monitor.runningCount(),
    peers: monitor.lastOthers().filter(({ presence }) => ACTIVE.includes(presence)).length,
  })

export const drawFooterButton = (
  { Box, Button }: FooterElements,
  below: RenderElement,
  openPanel: () => Promise<unknown>,
): RenderElement => (
  <Box flexDirection="row" alignItems="center" gap={2}>
    {below}
    <Button key="open-panel-footer" variant="secondary" label={messages.FOOTER_PANEL_LABEL} onPress={openPanel} />
  </Box>
)
