import type { RenderElement } from 'claude-code'

import type { OtherSession } from '../../types'
import * as messages from '../messages'
import { drawMessageField } from './message-field'
import type { PaneElements } from './pane'
import { drawActionRow, drawNote, drawPanel, drawPressableRow } from './row'

export type PeersView = {
  sessions: readonly OtherSession[]
  open: OtherSession | null
  now: number
}

export type PeersActions = {
  open: (sessionId: string) => void
  back: () => void
  send: (session: OtherSession, text: string) => void
  status: (session: OtherSession) => void
}

const drawSession = (elements: PaneElements, session: OtherSession, now: number, actions: PeersActions) => {
  const { Box } = elements

  return (
    <Box marginTop={1}>
      {drawPressableRow(elements, messages.sessionRow(session, now), {
        key: `sess-${session.sessionId}`,
        onPress: () => actions.open(session.sessionId),
      })}
    </Box>
  )
}

const drawGroup = (
  elements: PaneElements,
  group: messages.SessionGroup,
  index: number,
  now: number,
  actions: PeersActions,
) => {
  const { Box, Text } = elements

  return (
    <Box flexDirection="column" marginTop={index === 0 ? 0 : 1}>
      <Text dimColor>{group.heading}</Text>
      {group.sessions.map(session => drawSession(elements, session, now, actions))}
    </Box>
  )
}

const drawList = (elements: PaneElements, view: PeersView, actions: PeersActions): RenderElement => {
  const { Box, Text } = elements

  return (
    <Box flexDirection="column">
      {view.sessions.length === 0 ? (
        <Text>{messages.noOtherSessions}</Text>
      ) : (
        messages.sessionGroups(view.sessions).map((group, index) => drawGroup(elements, group, index, view.now, actions))
      )}
      <Box marginTop={1}>
        <Text dimColor>{messages.listHint}</Text>
      </Box>
    </Box>
  )
}

const drawActions = ({ Box, Button }: PaneElements, session: OtherSession, actions: PeersActions) => (
  <Box flexDirection="row" gap={1}>
    <Button key="back" label={messages.BACK_LABEL} onPress={actions.back} />
    <Button key="status" label={messages.STATUS_LABEL} onPress={() => actions.status(session)} />
  </Box>
)

const drawIdentity = (elements: PaneElements, session: OtherSession, now: number) => {
  const { Box } = elements
  const parts = messages.sessionRow(session, now)

  return (
    <Box flexDirection="column" marginTop={1}>
      {drawActionRow(elements, parts)}
      {parts.description === session.cwd ? null : drawNote(elements, session.cwd)}
    </Box>
  )
}

const drawLastAnswer = (elements: PaneElements, session: OtherSession) => {
  const { Box, Text, Markdown } = elements
  const answer = session.lastAnswer ?? ''

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>{messages.lastAnswerHeading}</Text>
      {drawPanel(
        elements,
        answer === '' ? <Text dimColor>{messages.noSharedAnswer}</Text> : <Markdown key="last-answer" text={answer} />,
      )}
    </Box>
  )
}

const drawSubagents = ({ Box, Text }: PaneElements, session: OtherSession) => (
  <Box flexDirection="column" marginTop={1}>
    <Text bold>{messages.peerSubagentsHeading(session.subagents.length)}</Text>
    {session.subagents.length === 0 ? (
      <Text dimColor>{messages.noPeerSubagents}</Text>
    ) : (
      session.subagents.map(subagent => <Text>{messages.publishedSubagentText(subagent)}</Text>)
    )}
  </Box>
)

const drawDetail = (
  elements: PaneElements,
  session: OtherSession,
  now: number,
  actions: PeersActions,
): RenderElement => {
  const { Box } = elements

  return (
    <Box flexDirection="column">
      {drawActions(elements, session, actions)}
      {drawIdentity(elements, session, now)}
      {drawLastAnswer(elements, session)}
      {drawSubagents(elements, session)}
      {drawMessageField(elements, 'message-0', messages.MESSAGE_PLACEHOLDER_SESSION, text => actions.send(session, text))}
    </Box>
  )
}

export const drawPeers = (elements: PaneElements, view: PeersView, actions: PeersActions): RenderElement =>
  view.open === null ? drawList(elements, view, actions) : drawDetail(elements, view.open, view.now, actions)
