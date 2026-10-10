import type { RenderElement } from 'claude-code'

import type { OtherSession } from '../../types'
import type { Messages, SessionGroup } from '../messages'
import { drawMessageField } from './message-field'
import type { PaneElements } from './pane'
import { type Room, drawActionRow, drawNote, drawPanel, drawPressableRow } from './row'

export type PeersView = {
  sessions: readonly OtherSession[]
  open: OtherSession | null
  now: number
  room: Room
}

export type PeersActions = {
  open: (sessionId: string) => void
  back: () => void
  send: (session: OtherSession, text: string) => void
  status: (session: OtherSession) => void
}

const drawSession = (
  elements: PaneElements,
  messages: Messages,
  session: OtherSession,
  now: number,
  room: Room,
  actions: PeersActions,
) => {
  const { Box } = elements

  return (
    <Box marginTop={1}>
      {drawPressableRow(
        elements,
        messages.sessionRow(session, now),
        { key: `sess-${session.sessionId}`, onPress: () => actions.open(session.sessionId) },
        room,
      )}
    </Box>
  )
}

const drawGroup = (
  elements: PaneElements,
  messages: Messages,
  group: SessionGroup,
  index: number,
  now: number,
  room: Room,
  actions: PeersActions,
) => {
  const { Box, Text } = elements

  return (
    <Box flexDirection="column" marginTop={index === 0 ? 0 : 1}>
      <Text dimColor>{group.heading}</Text>
      {group.sessions.map(session => drawSession(elements, messages, session, now, room, actions))}
    </Box>
  )
}

const drawList = (
  elements: PaneElements,
  messages: Messages,
  view: PeersView,
  actions: PeersActions,
): RenderElement => {
  const { Box, Text } = elements

  return (
    <Box flexDirection="column">
      {view.sessions.length === 0 ? (
        <Text>{messages.noOtherSessions}</Text>
      ) : (
        messages.sessionGroups(view.sessions).map((group, index) => drawGroup(elements, messages, group, index, view.now, view.room, actions))
      )}
      <Box marginTop={1}>
        <Text dimColor>{messages.listHint}</Text>
      </Box>
    </Box>
  )
}

const drawActions = (
  { Box, Button }: PaneElements,
  messages: Messages,
  session: OtherSession,
  actions: PeersActions,
) => (
  <Box flexDirection="row" gap={1}>
    <Button key="back" label={messages.BACK_LABEL} onPress={actions.back} />
    <Button key="status" label={messages.STATUS_LABEL} onPress={() => actions.status(session)} />
  </Box>
)

const drawIdentity = (elements: PaneElements, messages: Messages, session: OtherSession, now: number, room: Room) => {
  const { Box } = elements
  const parts = messages.sessionRow(session, now)

  return (
    <Box flexDirection="column" marginTop={1}>
      {drawActionRow(elements, parts, room)}
      {parts.description === session.cwd ? null : drawNote(elements, session.cwd)}
    </Box>
  )
}

const drawLastAnswer = (elements: PaneElements, messages: Messages, session: OtherSession) => {
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

const drawSubagents = ({ Box, Text }: PaneElements, messages: Messages, session: OtherSession) => (
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
  messages: Messages,
  session: OtherSession,
  now: number,
  room: Room,
  actions: PeersActions,
): RenderElement => {
  const { Box } = elements

  return (
    <Box flexDirection="column">
      {drawActions(elements, messages, session, actions)}
      {drawIdentity(elements, messages, session, now, room)}
      {drawLastAnswer(elements, messages, session)}
      {drawSubagents(elements, messages, session)}
      {drawMessageField(elements, messages, 'message-0', messages.MESSAGE_PLACEHOLDER_SESSION, text => actions.send(session, text))}
    </Box>
  )
}

export const drawPeers = (
  elements: PaneElements,
  messages: Messages,
  view: PeersView,
  actions: PeersActions,
): RenderElement =>
  view.open === null
    ? drawList(elements, messages, view, actions)
    : drawDetail(elements, messages, view.open, view.now, view.room, actions)
