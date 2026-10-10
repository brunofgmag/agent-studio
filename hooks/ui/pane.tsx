import type { Elements, PaneOpenArgs, RenderElement, SessionSendResult, UiOpenResult, UiPane } from 'claude-code'

import type { CatalogView, OtherSession, PaneTab, SubagentLine } from '../../types'
import * as messages from '../messages'
import { SESSIONS_ARGUMENT, type Monitor } from '../monitor/index'
import type { ClockPort, TimerPort } from '../monitor/registry'
import { drawCatalogTab } from './tab-catalog'
import { drawPeers } from './tab-peers'
import { drawSession } from './tab-session'

export type PaneElements = Pick<Elements['mobile'], 'Box' | 'Text' | 'Button' | 'Markdown'> &
  Partial<Pick<Elements['terminal'], 'Input' | 'Select'>> &
  Partial<Pick<Elements['desktop'], 'Svg'>>

export type StopOutcome = { isStopped: boolean; text: string }

export type Destination = { agentId: string } | { sessionId: string }

type Recipient = { to: Destination; label: string }

export type AgentsPort = {
  view: () => Promise<CatalogView>
  use: (name: string) => Promise<string>
}

export type PaneHost = {
  surfaces: () => Promise<readonly string[]>
  open: (pane: PaneOpenArgs) => Promise<UiOpenResult>
  close: (id: string) => Promise<void>
  panes: () => Promise<readonly UiPane[]>
  invalidate: () => void
  toast: (text: string) => void
  stopTask: (agentId: string) => Promise<StopOutcome>
  send: (to: Destination, text: string) => Promise<SessionSendResult>
  submit: (text: string) => void
  agents?: AgentsPort
  clock: ClockPort
}

export type PaneMonitor = Pick<
  Monitor,
  'lines' | 'agentInForce' | 'checkAgainstEngine' | 'lastOthers' | 'readOthers'
>

export type Pane = {
  open: (host: PaneHost, tab?: PaneTab) => Promise<boolean>
  command: (host: PaneHost, args: string, asText: () => Promise<string>) => Promise<string>
  render: (host: PaneHost, elements: PaneElements, columns: number) => Promise<RenderElement>
  closed: (host: PaneHost) => Promise<void>
}

export const PANE_ID = 'agent-studio'

export const BEAT_MS = 2000

const TABS: readonly PaneTab[] = [1, 2, 3]

const TAB_OF_ARGUMENT = new Map<string, PaneTab>([
  ['', 1],
  [SESSIONS_ARGUMENT, 2],
])

const attempt = async (work: () => Promise<void>) => {
  try {
    await work()
  } catch {
    return
  }
}

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

type Delivery = { kind: 'delivered' } | { kind: 'auto-mode' } | { kind: 'refused'; reason: string }

export const isAutoModeRefusal = (reason: string): boolean => reason.toLowerCase().includes('auto mode classifier')

const recipientOf = (to: Destination): string =>
  'agentId' in to ? `the subagent whose agent id is ${to.agentId}` : `the session whose id is ${to.sessionId}`

export const relayRequest = (to: Destination, text: string): string =>
  [
    `Send a message with the SendMessage tool to ${recipientOf(to)}.`,
    'The message is the text between the two marker lines.',
    '--- message start ---',
    text,
    '--- message end ---',
  ].join('\n')

const deliveryOf = (result: SessionSendResult): Delivery => {
  if (result.isDelivered) {
    return { kind: 'delivered' }
  }

  return isAutoModeRefusal(result.reason) ? { kind: 'auto-mode' } : { kind: 'refused', reason: result.reason }
}

const sendOnce = async (host: PaneHost, to: Destination, text: string): Promise<Delivery> => {
  try {
    return deliveryOf(await host.send(to, text))
  } catch (error) {
    return { kind: 'refused', reason: reasonOf(error) }
  }
}

const deliver = async (host: PaneHost, { to, label }: Recipient, text: string) => {
  if (text.trim() === '') {
    return
  }

  const delivery = await sendOnce(host, to, text)

  if (delivery.kind === 'delivered') {
    host.toast(messages.messageSent(label))
  } else if (delivery.kind === 'auto-mode') {
    host.submit(relayRequest(to, text))
    host.toast(messages.messageRelayed(label))
  } else {
    host.toast(messages.messageFailed(label, delivery.reason))
  }
}

const subagentRecipient = (line: SubagentLine): Recipient => ({
  to: { agentId: line.id },
  label: messages.subagentTarget(line.type),
})

const sessionRecipient = (session: OtherSession): Recipient => ({
  to: { sessionId: session.sessionId },
  label: messages.sessionTarget(session),
})

export const createPane = (monitor: PaneMonitor): Pane => {
  const readers: Record<PaneTab, (() => Promise<void>) | null> = {
    1: monitor.checkAgainstEngine,
    2: monitor.readOthers,
    3: null,
  }
  let tab: PaneTab = 1
  let catalog: CatalogView | null = null
  let openSubagent: string | null = null
  let openSession: string | null = null
  let beating: PaneHost | null = null
  let timer: TimerPort | null = null

  const stopTimer = () => {
    timer?.cancel()
    timer = null
    beating = null
  }

  const settle = async (host: PaneHost): Promise<boolean> => {
    const isOpen = (await host.panes()).some(({ id }) => id === PANE_ID)

    if (!isOpen) {
      stopTimer()
    }

    return isOpen
  }

  const refresh = async (host: PaneHost) => {
    const read = readers[tab]

    if (read !== null) {
      await read()
      host.invalidate()
    }
  }

  const beat = () =>
    attempt(async () => {
      const host = beating

      if (host !== null && (await settle(host))) {
        await refresh(host)
      }
    })

  const startTimer = (host: PaneHost) => {
    beating = host
    timer ??= host.clock.every(BEAT_MS, () => {
      void beat()
    })
  }

  const show = (next: PaneTab) => {
    tab = next
    openSubagent = null
    openSession = null
  }

  const readCatalog = async (host: PaneHost) => {
    try {
      catalog = (await host.agents?.view()) ?? null
    } catch {
      catalog = null
    }
  }

  const enter = async (host: PaneHost) => {
    await readCatalog(host)
    host.invalidate()
    await attempt(() => refresh(host))
  }

  const select = async (host: PaneHost, next: PaneTab) => {
    show(next)
    host.invalidate()
    await enter(host)
  }

  const choose = async (host: PaneHost, name: string) => {
    const { agents } = host

    if (agents === undefined) {
      return
    }

    host.toast(await agents.use(name).catch(reasonOf))
    await readCatalog(host)
    host.invalidate()
  }

  const open = async (host: PaneHost, next: PaneTab): Promise<boolean> => {
    if ((await host.surfaces()).length === 0) {
      return false
    }

    show(next)
    await readCatalog(host)

    const result = await host.open({ id: PANE_ID, title: messages.PANE_TITLE, focus: true, closeOnEscape: true })

    if (!result.isPlaced) {
      await attempt(() => host.close(PANE_ID))

      return false
    }

    startTimer(host)
    await attempt(() => refresh(host))

    return true
  }

  const stop = async (host: PaneHost, line: SubagentLine) => {
    const outcome = await host.stopTask(line.id).catch(error => ({ isStopped: false, text: reasonOf(error) }))

    host.toast(
      outcome.isStopped ? messages.stopRequested(line.type, outcome.text) : messages.stopFailed(line.type, outcome.text),
    )
  }

  const drawTabs = ({ Box, Button }: PaneElements, host: PaneHost) => (
    <Box flexDirection="row" gap={2}>
      {TABS.map(number => (
        <Button
          key={`tab-${number}`}
          hotkey={String(number)}
          plain
          dimColor={number !== tab}
          label={messages.TAB_LABELS[number]}
          onPress={() => select(host, number)}
        />
      ))}
    </Box>
  )

  const drawThisSession = (elements: PaneElements, host: PaneHost, now: number) => {
    const lines = monitor.lines()
    const open = lines.find(({ id }) => id === openSubagent) ?? null

    openSubagent = open?.id ?? null

    return drawSession(
      elements,
      {
        agentStatus: messages.agentStatus(monitor.agentInForce()),
        activeAgent: monitor.agentInForce()?.name ?? null,
        catalog,
        lines,
        open,
        now,
      },
      {
        open: id => {
          openSubagent = id
          host.invalidate()
        },
        back: () => {
          openSubagent = null
          host.invalidate()
        },
        stop: line => stop(host, line),
        send: (line, text) => deliver(host, subagentRecipient(line), text),
        use: name => choose(host, name),
      },
    )
  }

  const drawOtherSessions = (elements: PaneElements, host: PaneHost, now: number) => {
    const sessions = monitor.lastOthers()
    const open = sessions.find(({ sessionId }) => sessionId === openSession) ?? null

    openSession = open?.sessionId ?? null

    return drawPeers(
      elements,
      { sessions, open, now },
      {
        open: sessionId => {
          openSession = sessionId
          host.invalidate()
        },
        back: () => {
          openSession = null
          host.invalidate()
        },
        send: (session, text) => deliver(host, sessionRecipient(session), text),
        status: session => deliver(host, sessionRecipient(session), messages.STATUS_REQUEST),
      },
    )
  }

  const drawAgents = (elements: PaneElements, host: PaneHost) =>
    drawCatalogTab(elements, { hasLauncher: host.agents !== undefined, catalog }, { use: name => choose(host, name) })

  const drawBody = (elements: PaneElements, host: PaneHost, now: number): RenderElement => {
    if (tab === 1) {
      return drawThisSession(elements, host, now)
    }

    return tab === 2 ? drawOtherSessions(elements, host, now) : drawAgents(elements, host)
  }

  return {
    open: (host, next = 1) => open(host, next).catch(() => false),
    command: async (host, args, asText) => {
      const next = TAB_OF_ARGUMENT.get(args.trim())

      if (next === undefined || !(await open(host, next).catch(() => false))) {
        return asText()
      }

      return next === 1 ? messages.panelOpened : messages.panelOpenedOnSessions
    },
    render: async (host, elements, columns) => {
      const { Box, Text } = elements
      const now = await host.clock.now()

      return (
        <Box flexDirection="column">
          {drawTabs(elements, host)}
          <Text dimColor>{'─'.repeat(columns)}</Text>
          <Box flexDirection="column" marginTop={1}>
            {drawBody(elements, host, now)}
          </Box>
        </Box>
      )
    },
    closed: host =>
      attempt(async () => {
        await settle(host)
      }),
  }
}
