import type { RenderElement } from 'claude-code'

import * as messages from '../messages'
import type { PaneElements } from './pane'

export const drawMessageField = (
  { Box, Input }: PaneElements,
  key: string,
  placeholder: string,
  onSend: (text: string) => void,
): RenderElement => (
  <Box marginTop={1}>
    {Input === undefined ? null : <Input key={key} placeholder={placeholder} submitLabel={messages.SEND_LABEL} onSubmit={onSend} />}
  </Box>
)
