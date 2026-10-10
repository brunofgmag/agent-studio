import type { RenderElement } from 'claude-code'

import { type RowParts, cut } from '../messages'
import type { PaneElements } from './pane'

export type RowPress = { key: string; onPress: () => void }

export type RowAction = { label: string; element: RenderElement }

export type Room = { columns: number; surface: string }

type Claim = { indent?: number; button?: string }

export const SIDE_ROOM = 1

const DESCRIPTION_INDENT = 2

const ROW_GAP = 1

const BUTTON_PADDING = 4

const MIN_BUDGET = 10

export const CELLS_PER_CHARACTER = 0.85

const DESKTOP = 'desktop'

const cellsOfCharacters = ({ surface }: Room, characters: number): number =>
  surface === DESKTOP ? Math.ceil(characters * CELLS_PER_CHARACTER) : characters

const charactersOfCells = ({ surface }: Room, cells: number): number =>
  surface === DESKTOP ? Math.floor(cells / CELLS_PER_CHARACTER) : cells

const leadOf = (room: Room, button: string | undefined): number =>
  button === undefined ? DESCRIPTION_INDENT : cellsOfCharacters(room, button.length) + BUTTON_PADDING + ROW_GAP

export const descriptionBudget = (room: Room, { indent = 0, button }: Claim = {}): number => {
  const cells = room.columns - 2 * SIDE_ROOM - indent - leadOf(room, button)

  return Math.max(charactersOfCells(room, cells), MIN_BUDGET)
}

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

const drawDescription = (elements: PaneElements, { description }: RowParts, room: Room, indent: number) =>
  drawNote(elements, cut(description, descriptionBudget(room, { indent })))

export const drawPressableRow = (
  elements: PaneElements,
  parts: RowParts,
  press: RowPress,
  room: Room,
  indent = 0,
): RenderElement => {
  const { Box, Button, Text } = elements
  const { mark, markColor, name, isDim } = parts

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text color={markColor}>{mark}</Text>
        <Button key={press.key} plain dimColor={isDim === true} label={name} onPress={press.onPress} />
        {drawMeta(elements, parts, `clock-${press.key}`)}
      </Box>
      {drawDescription(elements, parts, room, indent)}
    </Box>
  )
}

const drawActionLine = (
  { Box, Text }: PaneElements,
  { description, isNotice }: RowParts,
  room: Room,
  action: RowAction,
) => (
  <Box flexDirection="row" gap={ROW_GAP}>
    {action.element}
    {isNotice === true ? (
      <Text dimColor wrap="wrap">
        {description}
      </Text>
    ) : (
      <Text dimColor wrap="truncate">
        {cut(description, descriptionBudget(room, { button: action.label }))}
      </Text>
    )}
  </Box>
)

export const drawActionRow = (
  elements: PaneElements,
  parts: RowParts,
  room: Room,
  action?: RowAction,
): RenderElement => {
  const { Box } = elements

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        {identityOf(elements, parts)}
      </Box>
      {action === undefined ? drawDescription(elements, parts, room, 0) : drawActionLine(elements, parts, room, action)}
    </Box>
  )
}
