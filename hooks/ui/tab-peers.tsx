import type { RenderElement } from 'claude-code'

import type { OtherSession } from '../../types'
import * as messages from '../messages'
import { drawMessageField } from './message-field'
import type { PaneElements } from './pane'

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

const drawList = ({ Box, Text, Button }: PaneElements, view: PeersView, actions: PeersActions): RenderElement => (
  <Box flexDirection="column">
    {view.sessions.length === 0 ? (
      <Text>{messages.noOtherSessions}</Text>
    ) : (
      view.sessions.map(session => (
        <Button
          key={`sess-${session.sessionId}`}
          plain
          label={messages.sessionRowText(session, view.now)}
          onPress={() => actions.open(session.sessionId)}
        />
      ))
    )}
    <Box marginTop={1}>
      <Text dimColor>{messages.listHint}</Text>
    </Box>
  </Box>
)

const drawDetail = (
  elements: PaneElements,
  session: OtherSession,
  now: number,
  actions: PeersActions,
): RenderElement => {
  const { Box, Text, Button, Markdown } = elements

  return (
    <Box flexDirection="column">
      {messages.sessionDetailFields(session, now).map(field => (
        <Text>{field}</Text>
      ))}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>{messages.lastAnswerHeading}</Text>
        {session.lastAnswer === undefined || session.lastAnswer === '' ? (
          <Text dimColor>{messages.noSharedAnswer}</Text>
        ) : (
          <Markdown key="last-answer" text={session.lastAnswer} />
        )}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>{messages.peerSubagentsHeading(session.subagents.length)}</Text>
        {session.subagents.length === 0 ? (
          <Text dimColor>{messages.noPeerSubagents}</Text>
        ) : (
          session.subagents.map(subagent => <Text>{messages.publishedSubagentText(subagent)}</Text>)
        )}
      </Box>
      {drawMessageField(elements, messages.MESSAGE_PLACEHOLDER_SESSION, text => actions.send(session, text))}
      <Box flexDirection="row" gap={2} marginTop={1}>
        <Button key="back" label={messages.BACK_LABEL} onPress={actions.back} />
        <Button key="status" label={messages.STATUS_LABEL} onPress={() => actions.status(session)} />
      </Box>
    </Box>
  )
}

export const drawPeers = (elements: PaneElements, view: PeersView, actions: PeersActions): RenderElement =>
  view.open === null ? drawList(elements, view, actions) : drawDetail(elements, view.open, view.now, actions)
