import type { RenderElement } from 'claude-code'

import type { RowParts } from '../messages'
import type { PaneElements } from './pane'

export type RowPress = { key: string; onPress: () => void }

const DESCRIPTION_INDENT = 2

const identityOf = ({ Text }: PaneElements, { mark, markColor, name, meta, isDim }: RowParts) => [
  <Text color={markColor}>{mark}</Text>,
  <Text bold dimColor={isDim === true} wrap="truncate">
    {name}
  </Text>,
  <Text dimColor wrap="truncate">
    {meta}
  </Text>,
]

export const drawNote = ({ Box, Text }: PaneElements, note: string): RenderElement => (
  <Box paddingLeft={DESCRIPTION_INDENT}>
    <Text dimColor wrap="truncate">
      {note}
    </Text>
  </Box>
)

export const drawPanel = ({ Box }: PaneElements, content: RenderElement): RenderElement => (
  <Box borderStyle="round" borderDimColor paddingX={1}>
    {content}
  </Box>
)

const drawDescription = (elements: PaneElements, { description }: RowParts) => drawNote(elements, description)

export const drawPressableRow = (elements: PaneElements, parts: RowParts, press: RowPress): RenderElement => {
  const { Box, Button, Text } = elements
  const { mark, markColor, name, meta, isDim } = parts

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text color={markColor}>{mark}</Text>
        <Button key={press.key} plain dimColor={isDim === true} label={name} onPress={press.onPress} />
        <Text dimColor wrap="truncate">
          {meta}
        </Text>
      </Box>
      {drawDescription(elements, parts)}
    </Box>
  )
}

const drawActionLine = ({ Box, Text }: PaneElements, { description }: RowParts, action: RenderElement) => (
  <Box flexDirection="row" gap={1}>
    {action}
    <Text dimColor wrap="truncate">
      {description}
    </Text>
  </Box>
)

export const drawActionRow = (elements: PaneElements, parts: RowParts, action?: RenderElement): RenderElement => {
  const { Box } = elements

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        {identityOf(elements, parts)}
      </Box>
      {action === undefined ? drawDescription(elements, parts) : drawActionLine(elements, parts, action)}
    </Box>
  )
}
