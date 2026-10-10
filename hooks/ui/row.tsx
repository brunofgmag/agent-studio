import type { RenderElement } from 'claude-code'

import type { RowParts } from '../messages'
import type { PaneElements } from './pane'

export type RowPress = { key: string; onPress: () => void }

const DESCRIPTION_INDENT = 2

const HEADER_CLOCK_KEY = 'clock-header'

const drawMeta = ({ Text, Client }: PaneElements, { meta, ticking }: RowParts, clockKey: string): RenderElement[] => {
  const dim = (text: string) => (
    <Text dimColor wrap="truncate">
      {text}
    </Text>
  )

  if (ticking === undefined || Client === undefined) {
    return [dim(meta)]
  }

  return [
    ...(ticking.before === '' ? [] : [dim(ticking.before)]),
    <Client key={clockKey} module="./clock.tsx" props={ticking.clock} />,
    ...(ticking.after === '' ? [] : [dim(ticking.after)]),
  ]
}

const identityOf = (elements: PaneElements, parts: RowParts) => {
  const { Text } = elements
  const { mark, markColor, name, isDim } = parts

  return [
    <Text color={markColor}>{mark}</Text>,
    <Text bold dimColor={isDim === true} wrap="truncate">
      {name}
    </Text>,
    ...drawMeta(elements, parts, HEADER_CLOCK_KEY),
  ]
}

export const drawNote = ({ Box, Text }: PaneElements, note: string): RenderElement => (
  <Box paddingLeft={DESCRIPTION_INDENT}>
    <Text dimColor wrap="truncate">
      {note}
    </Text>
  </Box>
)

export const drawPanel = ({ Box }: PaneElements, content: RenderElement, marginTop = 0): RenderElement => (
  <Box borderStyle="round" borderDimColor paddingX={1} marginTop={marginTop}>
    {content}
  </Box>
)

const drawDescription = (elements: PaneElements, { description }: RowParts) => drawNote(elements, description)

export const drawPressableRow = (elements: PaneElements, parts: RowParts, press: RowPress): RenderElement => {
  const { Box, Button, Text } = elements
  const { mark, markColor, name, isDim } = parts

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text color={markColor}>{mark}</Text>
        <Button key={press.key} plain dimColor={isDim === true} label={name} onPress={press.onPress} />
        {drawMeta(elements, parts, `clock-${press.key}`)}
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
