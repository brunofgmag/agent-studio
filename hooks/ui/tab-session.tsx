import type { RenderElement } from 'claude-code'

import type { CatalogView, Exchange, SubagentLine } from '../../types'
import type { Messages, SubagentGroup } from '../messages'
import { drawMessageField } from './message-field'
import type { PaneElements } from './pane'
import { type Room, drawActionRow, drawNote, drawPanel, drawPressableRow } from './row'

export type SessionView = {
  agentStatus: string | null
  activeAgent: string | null
  catalog: CatalogView | null
  lines: readonly SubagentLine[]
  open: SubagentLine | null
  isPromptOpen: boolean
  areEarlierOpen: boolean
  sentCount: number
  now: number
  room: Room
}

export type SessionActions = {
  open: (id: string) => void
  back: () => void
  stop: (line: SubagentLine) => void
  send: (line: SubagentLine, text: string) => void
  togglePrompt: () => void
  toggleEarlier: () => void
  use: (name: string) => void
}

const INDENT = 2

const OFF = 'off'

const optionsOf = (messages: Messages, catalog: CatalogView) => [
  ...catalog.agents.filter(({ name }) => name !== OFF).map(({ name }) => ({ value: name })),
  { value: OFF, label: messages.OFF_OPTION_LABEL },
]

const selectedOf = (catalog: CatalogView, activeAgent: string | null) => {
  if (activeAgent === null) {
    return OFF
  }

  return catalog.agents.some(({ name }) => name === activeAgent) ? activeAgent : undefined
}

const drawHeader = (
  { Box, Text, Select }: PaneElements,
  messages: Messages,
  view: SessionView,
  actions: SessionActions,
) => {
  const title = <Text bold>{messages.sessionHeader(view.agentStatus)}</Text>
  const { catalog } = view

  if (Select === undefined || catalog === null) {
    return title
  }

  if (catalog.native !== null) {
    return (
      <Box flexDirection="column">
        {title}
        <Text>{messages.nativeSession(catalog.native)}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="row" gap={2}>
      {title}
      <Select
        key="switch-agent"
        label={messages.SWITCH_LABEL}
        options={optionsOf(messages, catalog)}
        value={selectedOf(catalog, view.activeAgent)}
        onSelect={name => actions.use(name)}
      />
    </Box>
  )
}

const drawLine = (
  elements: PaneElements,
  messages: Messages,
  line: SubagentLine,
  now: number,
  room: Room,
  actions: SessionActions,
) => {
  const { Box } = elements
  const indent = line.depth * INDENT

  return (
    <Box paddingLeft={indent} marginTop={1}>
      {drawPressableRow(
        elements,
        messages.subagentRow(line, now),
        { key: `sub-${line.id}`, onPress: () => actions.open(line.id) },
        room,
        indent,
      )}
    </Box>
  )
}

const drawGroup = (
  elements: PaneElements,
  messages: Messages,
  group: SubagentGroup,
  index: number,
  now: number,
  room: Room,
  actions: SessionActions,
) => {
  const { Box, Text } = elements

  return (
    <Box flexDirection="column" marginTop={index === 0 ? 0 : 1}>
      <Text dimColor>{group.heading}</Text>
      {group.lines.map(line => drawLine(elements, messages, line, now, room, actions))}
    </Box>
  )
}

const drawSummary = ({ Box, Text }: PaneElements, messages: Messages, lines: readonly SubagentLine[]) => (
  <Box marginTop={1}>
    <Text dimColor wrap="truncate">
      {messages.subagentSummary(lines)}
    </Text>
  </Box>
)

const drawList = (
  elements: PaneElements,
  messages: Messages,
  view: SessionView,
  actions: SessionActions,
): RenderElement => {
  const { Box, Text } = elements

  return (
    <Box flexDirection="column">
      {drawHeader(elements, messages, view, actions)}
      {view.lines.length === 0 ? null : drawSummary(elements, messages, view.lines)}
      <Box flexDirection="column" marginTop={1}>
        {view.lines.length === 0 ? (
          <Text>{messages.noSubagents}</Text>
        ) : (
          messages.subagentGroups(view.lines).map((group, index) => drawGroup(elements, messages, group, index, view.now, view.room, actions))
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{messages.listHint}</Text>
      </Box>
    </Box>
  )
}

type Conversation = { earlier: readonly Exchange[]; latest: Exchange | undefined; after: readonly Exchange[] }

const conversationOf = (exchanges: readonly Exchange[]): Conversation => {
  const at = exchanges.findLastIndex(({ kind }) => kind === 'answer')

  return { earlier: exchanges.slice(0, Math.max(at, 0)), latest: exchanges[at], after: exchanges.slice(at + 1) }
}

const drawActions = (
  { Box, Button }: PaneElements,
  messages: Messages,
  line: SubagentLine,
  actions: SessionActions,
) => (
  <Box flexDirection="row" gap={1}>
    <Button key="back" label={messages.BACK_LABEL} onPress={actions.back} />
    {line.status === 'running' ? <Button key="stop" label={messages.STOP_LABEL} onPress={() => actions.stop(line)} /> : null}
  </Box>
)

const drawIdentity = (elements: PaneElements, messages: Messages, line: SubagentLine, now: number, room: Room) => {
  const { Box } = elements

  return (
    <Box flexDirection="column" marginTop={1}>
      {drawActionRow(elements, messages.subagentRow(line, now), room)}
      {line.model === null ? null : drawNote(elements, line.model)}
      {line.cachedTokens > 0 ? drawNote(elements, messages.tokensWithCache(line)) : null}
    </Box>
  )
}

const drawPrompt = (
  elements: PaneElements,
  messages: Messages,
  line: SubagentLine,
  isOpen: boolean,
  actions: SessionActions,
) => {
  const { Box, Text, Button, Markdown } = elements

  if (line.prompt === '') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold>{messages.promptHeading}</Text>
        {drawPanel(elements, <Text dimColor>{messages.noPrompt}</Text>)}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row" gap={1}>
        <Text bold>{messages.promptHeading}</Text>
        <Text dimColor>{messages.promptLines(line.prompt)}</Text>
        <Button
          key="toggle-prompt"
          plain
          label={isOpen ? messages.PROMPT_HIDE_LABEL : messages.PROMPT_SHOW_LABEL}
          onPress={actions.togglePrompt}
        />
      </Box>
      {drawPanel(
        elements,
        isOpen ? <Markdown key="prompt" text={line.prompt} /> : <Text dimColor>{messages.promptPreview(line.prompt)}</Text>,
        1,
      )}
    </Box>
  )
}

const drawExchange = (elements: PaneElements, messages: Messages, exchange: Exchange, marginTop = 0) => {
  const { Text, Markdown } = elements

  return exchange.kind === 'answer' ? (
    drawPanel(elements, <Markdown text={exchange.text} />, marginTop)
  ) : (
    <Text dimColor>{messages.youSaid(exchange.text)}</Text>
  )
}

const drawLatest = (elements: PaneElements, messages: Messages, latest: Exchange | undefined, marginTop: number) => {
  const { Text, Markdown } = elements

  return drawPanel(
    elements,
    latest === undefined ? <Text dimColor>{messages.noAnswerYet}</Text> : <Markdown key="answer" text={latest.text} />,
    marginTop,
  )
}

const drawConversation = (
  elements: PaneElements,
  messages: Messages,
  line: SubagentLine,
  areEarlierOpen: boolean,
  actions: SessionActions,
) => {
  const { Box, Text, Button } = elements
  const { earlier, latest, after } = conversationOf(line.exchanges)

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>{messages.answerHeading}</Text>
      {earlier.length === 0 ? null : (
        <Button key="toggle-earlier" plain label={messages.earlierLabel(earlier)} onPress={actions.toggleEarlier} />
      )}
      {areEarlierOpen
        ? earlier.map((exchange, at) => drawExchange(elements, messages, exchange, at === 0 ? 1 : 0))
        : null}
      {drawLatest(elements, messages, latest, earlier.length > 0 && !areEarlierOpen ? 1 : 0)}
      {after.map(exchange => drawExchange(elements, messages, exchange))}
    </Box>
  )
}

const drawDetail = (
  elements: PaneElements,
  messages: Messages,
  view: SessionView,
  line: SubagentLine,
  actions: SessionActions,
): RenderElement => {
  const { Box } = elements

  return (
    <Box flexDirection="column">
      {drawActions(elements, messages, line, actions)}
      {drawIdentity(elements, messages, line, view.now, view.room)}
      {drawPrompt(elements, messages, line, view.isPromptOpen, actions)}
      {drawConversation(elements, messages, line, view.areEarlierOpen, actions)}
      {drawMessageField(elements, messages, `message-${view.sentCount}`, messages.MESSAGE_PLACEHOLDER_SUBAGENT, text => actions.send(line, text))}
    </Box>
  )
}

export const drawSession = (
  elements: PaneElements,
  messages: Messages,
  view: SessionView,
  actions: SessionActions,
): RenderElement =>
  view.open === null
    ? drawList(elements, messages, view, actions)
    : drawDetail(elements, messages, view, view.open, actions)
