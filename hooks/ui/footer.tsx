import type { Elements, RenderElement } from 'claude-code'

import type { Messages } from '../messages'
import type { Monitor } from '../monitor/index'

export type FooterElements = Pick<Elements['mobile'], 'Box' | 'Button'>

export type FooterMonitor = Pick<Monitor, 'runningCount' | 'agentInForce' | 'lastOthers'>

export const footerSummaryOf = (monitor: FooterMonitor, messages: Messages): string =>
  messages.footerSummary({
    agent: monitor.agentInForce(),
    running: monitor.runningCount(),
    peers: monitor.lastOthers().filter(({ presence }) => presence === 'working').length,
  })

export const drawFooterButton = (
  { Box, Button }: FooterElements,
  messages: Messages,
  below: RenderElement,
  openPanel: () => Promise<unknown>,
): RenderElement => (
  <Box flexDirection="row" alignItems="center" gap={2}>
    {below}
    <Button key="open-panel-footer" variant="secondary" label={messages.FOOTER_PANEL_LABEL} onPress={openPanel} />
  </Box>
)
