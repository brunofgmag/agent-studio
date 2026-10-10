import type { RenderElement } from 'claude-code'

import type { CatalogView, SubagentLine } from '../../types'
import * as messages from '../messages'
import { drawMessageField } from './message-field'
import type { PaneElements } from './pane'
import { timelineBars, timelineSvg } from './timeline'

export type SessionView = {
  agentStatus: string | null
  activeAgent: string | null
  catalog: CatalogView | null
  lines: readonly SubagentLine[]
  open: SubagentLine | null
  now: number
}

export type SessionActions = {
  open: (id: string) => void
  back: () => void
  stop: (line: SubagentLine) => void
  send: (line: SubagentLine, text: string) => void
  use: (name: string) => void
}

const INDENT = 2

const TIMELINE_WIDTH = 640

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

const drawRow = ({ Box, Button }: PaneElements, line: SubagentLine, now: number, actions: SessionActions) => (
  <Box paddingLeft={line.depth * INDENT}>
    <Button key={`sub-${line.id}`} plain label={messages.subagentRowText(line, now)} onPress={() => actions.open(line.id)} />
  </Box>
)

const drawTimeline = ({ Box, Svg }: PaneElements, { lines, now }: SessionView) => {
  if (Svg === undefined || lines.length === 0) {
    return null
  }

  const bars = timelineBars(lines, now)

  return (
    <Box key="timeline" marginTop={1}>
      <Svg source={timelineSvg(bars, TIMELINE_WIDTH)} alt={messages.timelineAlt(bars)} />
    </Box>
  )
}

const drawList = (elements: PaneElements, view: SessionView, actions: SessionActions): RenderElement => {
  const { Box, Text } = elements

  return (
    <Box flexDirection="column">
      {drawHeader(elements, view, actions)}
      {drawTimeline(elements, view)}
      <Box flexDirection="column" marginTop={1}>
        {view.lines.length === 0 ? (
          <Text>{messages.noSubagents}</Text>
        ) : (
          view.lines.map(line => drawRow(elements, line, view.now, actions))
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{messages.listHint}</Text>
      </Box>
    </Box>
  )
}

const drawDetail = (elements: PaneElements, line: SubagentLine, actions: SessionActions): RenderElement => {
  const { Box, Text, Button, Markdown } = elements

  return (
    <Box flexDirection="column">
      {messages.subagentDetailFields(line).map(field => (
        <Text>{field}</Text>
      ))}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>{messages.promptHeading}</Text>
        <Text>{line.prompt === '' ? messages.noPrompt : line.prompt}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>{messages.answerHeading}</Text>
        {line.answer === '' ? <Text dimColor>{messages.noAnswerYet}</Text> : <Markdown key="answer" text={line.answer} />}
      </Box>
      {drawMessageField(elements, messages.MESSAGE_PLACEHOLDER_SUBAGENT, text => actions.send(line, text))}
      <Box flexDirection="row" gap={2} marginTop={1}>
        <Button key="back" label={messages.BACK_LABEL} onPress={actions.back} />
        {line.status === 'running' ? <Button key="stop" label={messages.STOP_LABEL} onPress={() => actions.stop(line)} /> : null}
      </Box>
    </Box>
  )
}

export const drawSession = (elements: PaneElements, view: SessionView, actions: SessionActions): RenderElement =>
  view.open === null ? drawList(elements, view, actions) : drawDetail(elements, view.open, actions)
