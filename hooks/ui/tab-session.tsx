import type { RenderElement } from 'claude-code'

import type { CatalogView, Exchange, SubagentLine } from '../../types'
import * as messages from '../messages'
import { drawMessageField } from './message-field'
import type { PaneElements } from './pane'
import { drawActionRow, drawNote, drawPanel, drawPressableRow } from './row'

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

const optionsOf = (catalog: CatalogView) => [
  ...catalog.agents.filter(({ name }) => name !== OFF).map(({ name }) => ({ value: name })),
  { value: OFF, label: messages.OFF_OPTION_LABEL },
]

const selectedOf = (catalog: CatalogView, activeAgent: string | null) => {
  if (activeAgent === null) {
    return OFF
  }

  return catalog.agents.some(({ name }) => name === activeAgent) ? activeAgent : undefined
}

const drawHeader = ({ Box, Text, Select }: PaneElements, view: SessionView, actions: SessionActions) => {
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
        options={optionsOf(catalog)}
        value={selectedOf(catalog, view.activeAgent)}
        onSelect={name => actions.use(name)}
      />
    </Box>
  )
}

const drawLine = (elements: PaneElements, line: SubagentLine, now: number, actions: SessionActions) => {
  const { Box } = elements

  return (
    <Box paddingLeft={line.depth * INDENT} marginTop={1}>
      {drawPressableRow(elements, messages.subagentRow(line, now), {
        key: `sub-${line.id}`,
        onPress: () => actions.open(line.id),
      })}
    </Box>
  )
}

const drawGroup = (
  elements: PaneElements,
  group: messages.SubagentGroup,
  index: number,
  now: number,
  actions: SessionActions,
) => {
  const { Box, Text } = elements

  return (
    <Box flexDirection="column" marginTop={index === 0 ? 0 : 1}>
      <Text dimColor>{group.heading}</Text>
      {group.lines.map(line => drawLine(elements, line, now, actions))}
    </Box>
  )
}

const drawSummary = ({ Box, Text }: PaneElements, lines: readonly SubagentLine[]) => (
  <Box marginTop={1}>
    <Text dimColor wrap="truncate">
      {messages.subagentSummary(lines)}
    </Text>
  </Box>
)

const drawList = (elements: PaneElements, view: SessionView, actions: SessionActions): RenderElement => {
  const { Box, Text } = elements

  return (
    <Box flexDirection="column">
      {drawHeader(elements, view, actions)}
      {view.lines.length === 0 ? null : drawSummary(elements, view.lines)}
      <Box flexDirection="column" marginTop={1}>
        {view.lines.length === 0 ? (
          <Text>{messages.noSubagents}</Text>
        ) : (
          messages.subagentGroups(view.lines).map((group, index) => drawGroup(elements, group, index, view.now, actions))
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

const drawActions = ({ Box, Button }: PaneElements, line: SubagentLine, actions: SessionActions) => (
  <Box flexDirection="row" gap={1}>
    <Button key="back" label={messages.BACK_LABEL} onPress={actions.back} />
    {line.status === 'running' ? <Button key="stop" label={messages.STOP_LABEL} onPress={() => actions.stop(line)} /> : null}
  </Box>
)

const drawIdentity = (elements: PaneElements, line: SubagentLine, now: number) => {
  const { Box } = elements

  return (
    <Box flexDirection="column" marginTop={1}>
      {drawActionRow(elements, messages.subagentRow(line, now))}
      {line.model === null ? null : drawNote(elements, line.model)}
    </Box>
  )
}

const drawPrompt = (elements: PaneElements, line: SubagentLine, isOpen: boolean, actions: SessionActions) => {
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
      )}
    </Box>
  )
}

const drawExchange = (elements: PaneElements, exchange: Exchange) => {
  const { Text, Markdown } = elements

  return exchange.kind === 'answer' ? (
    drawPanel(elements, <Markdown text={exchange.text} />)
  ) : (
    <Text dimColor>{messages.youSaid(exchange.text)}</Text>
  )
}

const drawLatest = (elements: PaneElements, latest: Exchange | undefined) => {
  const { Text, Markdown } = elements

  return drawPanel(
    elements,
    latest === undefined ? <Text dimColor>{messages.noAnswerYet}</Text> : <Markdown key="answer" text={latest.text} />,
  )
}

const drawConversation = (elements: PaneElements, line: SubagentLine, areEarlierOpen: boolean, actions: SessionActions) => {
  const { Box, Text, Button } = elements
  const { earlier, latest, after } = conversationOf(line.exchanges)

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>{messages.answerHeading}</Text>
      {earlier.length === 0 ? null : (
        <Button key="toggle-earlier" plain label={messages.earlierLabel(earlier)} onPress={actions.toggleEarlier} />
      )}
      {areEarlierOpen ? earlier.map(exchange => drawExchange(elements, exchange)) : null}
      {drawLatest(elements, latest)}
      {after.map(exchange => drawExchange(elements, exchange))}
    </Box>
  )
}

const drawDetail = (elements: PaneElements, view: SessionView, line: SubagentLine, actions: SessionActions): RenderElement => {
  const { Box } = elements

  return (
    <Box flexDirection="column">
      {drawActions(elements, line, actions)}
      {drawIdentity(elements, line, view.now)}
      {drawPrompt(elements, line, view.isPromptOpen, actions)}
      {drawConversation(elements, line, view.areEarlierOpen, actions)}
      {drawMessageField(elements, `message-${view.sentCount}`, messages.MESSAGE_PLACEHOLDER_SUBAGENT, text => actions.send(line, text))}
    </Box>
  )
}

export const drawSession = (elements: PaneElements, view: SessionView, actions: SessionActions): RenderElement =>
  view.open === null ? drawList(elements, view, actions) : drawDetail(elements, view, view.open, actions)
