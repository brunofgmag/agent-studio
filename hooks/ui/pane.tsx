import type { Elements, PaneOpenArgs, RenderElement, SessionSendResult, UiOpenResult, UiPane } from 'claude-code'

import type { CatalogView, OtherSession, PaneTab, SubagentLine } from '../../types'
import type { Messages } from '../messages'
import { SESSIONS_ARGUMENT, type Monitor } from '../monitor/index'
import type { ClockPort, TimerPort } from '../monitor/registry'
import { type Room, SIDE_ROOM } from './row'
import { drawCatalogTab } from './tab-catalog'
import { drawPeers } from './tab-peers'
import { drawSession } from './tab-session'

export type PaneElements = Pick<Elements['mobile'], 'Box' | 'Text' | 'Button' | 'Markdown'> &
  Partial<Pick<Elements['terminal'], 'Input' | 'Select' | 'Client'>>

export type StopOutcome = { isStopped: boolean; text: string }

export type Destination = { agentId: string } | { sessionId: string }

type Recipient = { to: Destination; label: string; record?: (text: string, at: number) => void }

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
  focus: (key: string) => Promise<boolean>
  toast: (text: string) => void
  stopTask: (agentId: string) => Promise<StopOutcome>
  send: (to: Destination, text: string) => Promise<SessionSendResult>
  submit: (text: string) => void
  agents?: AgentsPort
  clock: ClockPort
}

export type PaneMonitor = Pick<
  Monitor,
  'lines' | 'agentInForce' | 'checkAgainstEngine' | 'lastOthers' | 'readOthers' | 'sent'
>

export type PaneFrame = Room & { isFocused: boolean }

export type Pane = {
  open: (host: PaneHost, tab?: PaneTab) => Promise<boolean>
  command: (host: PaneHost, args: string, asText: () => Promise<string>) => Promise<string>
  render: (host: PaneHost, elements: PaneElements, frame: PaneFrame) => Promise<RenderElement>
  takeover: (element: string | undefined, by: 'person' | 'plugin') => (() => void) | undefined
  closed: (host: PaneHost) => Promise<void>
  changed: (host: PaneHost) => Promise<void>
}

export const PANE_ID = 'agent-studio'

export const BEAT_MS = 2000

export const TICK_MS = 5000

const BACK_KEY = 'back'

const TABS: readonly PaneTab[] = [1, 2, 3]

const TAB_OF_ARGUMENT = new Map<string, PaneTab>([
  ['', 1],
  [SESSIONS_ARGUMENT, 2],
])

type Faces = { structure: string; ticking: string }

const structureOfLine = ({ tokens, tool, ...rest }: SubagentLine) => rest

const structureOfSession = ({ updatedAt, turnStartedAt, ...rest }: OtherSession) => rest

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

const remember = async (host: PaneHost, { record }: Recipient, text: string) => {
  if (record === undefined) {
    return
  }

  record(text, await host.clock.now())
  host.invalidate()
}

const deliver = async (host: PaneHost, messages: Messages, recipient: Recipient, text: string) => {
  if (text.trim() === '') {
    return
  }

  const { to, label } = recipient
  const delivery = await sendOnce(host, to, text)

  if (delivery.kind === 'refused') {
    host.toast(messages.messageFailed(label, delivery.reason))

    return
  }

  const isRelayed = delivery.kind === 'auto-mode'

  if (isRelayed) {
    host.submit(relayRequest(to, text))
  }

  host.toast(isRelayed ? messages.messageRelayed(label) : messages.messageSent(label))
  await remember(host, recipient, text)
}

const subagentRecipient = (messages: Messages, line: SubagentLine, record: Recipient['record']): Recipient => ({
  to: { agentId: line.id },
  label: messages.subagentTarget(line.type),
  record,
})

const sessionRecipient = (messages: Messages, session: OtherSession): Recipient => ({
  to: { sessionId: session.sessionId },
  label: messages.sessionTarget(session),
})

const trackingPresses = (elements: PaneElements, drawn: Map<string, () => void>): PaneElements => ({
  ...elements,
  Button: props => {
    const { key, onPress } = props as { key?: unknown; onPress?: () => void }

    if (typeof key === 'string' && onPress !== undefined) {
      drawn.set(key, onPress)
    }

    return elements.Button(props)
  },
})

export const createPane = (monitor: PaneMonitor, messages: Messages): Pane => {
  const readers: Record<PaneTab, (() => Promise<void>) | null> = {
    1: monitor.checkAgainstEngine,
    2: monitor.readOthers,
    3: null,
  }
  let tab: PaneTab = 1
  let catalog: CatalogView | null = null
  let pendingUse: string | null = null
  let openSubagent: string | null = null
  let openSession: string | null = null
  let isPromptOpen = false
  let areEarlierOpen = false
  const sentCounts = new Map<string, number>()
  let beating: PaneHost | null = null
  let timer: TimerPort | null = null
  let holdsKeyboard = true
  let drawn: Faces | null = null
  let askedAt: number | null = null
  let presses = new Map<string, () => void>()

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

  const facesAt = (now: number): Faces | null => {
    if (tab === 1) {
      const lines = monitor.lines()

      return {
        structure: JSON.stringify(
          lines.map(line => [structureOfLine(line), messages.subagentRow(line, now).ticking?.clock]),
        ),
        ticking: JSON.stringify(lines.map(({ tokens, tool }) => [tokens, tool])),
      }
    }

    if (tab === 2) {
      const sessions = monitor.lastOthers()

      return {
        structure: JSON.stringify(
          sessions.map(session => [structureOfSession(session), messages.sessionRow(session, now).ticking?.clock]),
        ),
        ticking: '',
      }
    }

    return null
  }

  const redrawIfChanged = (host: PaneHost, now: number) => {
    const faces = facesAt(now)

    if (faces === null) {
      return
    }

    const isStructureNew = faces.structure !== drawn?.structure
    const isTickDue = faces.ticking !== drawn?.ticking && (askedAt === null || now - askedAt >= TICK_MS)

    if (isStructureNew || isTickDue) {
      drawn = faces
      askedAt = now
      host.invalidate()
    }
  }

  const refresh = async (host: PaneHost) => {
    const read = readers[tab]

    if (read === null) {
      return
    }

    await read()
    redrawIfChanged(host, await host.clock.now())
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

  const setOpenSubagent = (id: string | null) => {
    if (id !== openSubagent) {
      isPromptOpen = false
      areEarlierOpen = false
    }

    openSubagent = id
  }

  const show = (next: PaneTab) => {
    drawn = null
    askedAt = null
    tab = next
    pendingUse = null
    setOpenSubagent(null)
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

  const showAndFocus = (host: PaneHost, ...keys: readonly string[]) => {
    host.invalidate()

    void attempt(async () => {
      for (const key of keys) {
        if (await host.focus(key)) {
          return
        }
      }
    })
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

  const needsConfirmation = (name: string) =>
    pendingUse !== name && catalog?.agents.find(agent => agent.name === name)?.modelSwitch !== undefined

  const useAgent = async (host: PaneHost, name: string) => {
    await readCatalog(host)

    if (needsConfirmation(name)) {
      pendingUse = name
      host.invalidate()

      return
    }

    pendingUse = null
    await choose(host, name)
  }

  const isListed = (host: PaneHost): Promise<boolean> =>
    host.panes().then(
      panes => panes.some(({ id }) => id === PANE_ID),
      () => false,
    )

  const switchTo = async (host: PaneHost) => {
    host.invalidate()
    startTimer(host)
    await attempt(() => refresh(host))
  }

  const open = async (host: PaneHost, next: PaneTab): Promise<boolean> => {
    if ((await host.surfaces()).length === 0) {
      return false
    }

    show(next)
    await readCatalog(host)

    if (await isListed(host)) {
      await switchTo(host)

      return true
    }

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
    <Box flexDirection="row" gap={1} marginTop={1}>
      {TABS.map(number => (
        <Button
          key={`tab-${number}`}
          hotkey={String(number)}
          dimColor={number !== tab}
          label={messages.TAB_LABELS[number]}
          onPress={() => select(host, number)}
        />
      ))}
    </Box>
  )

  const recorderOf = (id: string) => (text: string, at: number) => {
    monitor.sent(id, text, at)
    sentCounts.set(id, (sentCounts.get(id) ?? 0) + 1)
  }

  const drawThisSession = (elements: PaneElements, host: PaneHost, now: number, room: Room) => {
    const lines = monitor.lines()
    const open = lines.find(({ id }) => id === openSubagent) ?? null

    setOpenSubagent(open?.id ?? null)

    return drawSession(
      elements,
      messages,
      {
        agentStatus: messages.agentStatus(monitor.agentInForce()),
        activeAgent: monitor.agentInForce()?.name ?? null,
        catalog,
        lines,
        open,
        isPromptOpen,
        areEarlierOpen,
        sentCount: sentCounts.get(open?.id ?? '') ?? 0,
        now,
        room,
      },
      {
        open: id => {
          setOpenSubagent(id)
          showAndFocus(host, BACK_KEY)
        },
        back: () => {
          const left = openSubagent

          setOpenSubagent(null)
          showAndFocus(host, `sub-${left}`, `tab-${tab}`)
        },
        stop: line => stop(host, line),
        send: (line, text) => deliver(host, messages, subagentRecipient(messages, line, recorderOf(line.id)), text),
        togglePrompt: () => {
          isPromptOpen = !isPromptOpen
          host.invalidate()
        },
        toggleEarlier: () => {
          areEarlierOpen = !areEarlierOpen
          host.invalidate()
        },
        use: name => choose(host, name),
      },
    )
  }

  const drawOtherSessions = (elements: PaneElements, host: PaneHost, now: number, room: Room) => {
    const sessions = monitor.lastOthers()
    const open = sessions.find(({ sessionId }) => sessionId === openSession) ?? null

    openSession = open?.sessionId ?? null

    return drawPeers(
      elements,
      messages,
      { sessions, open, now, room },
      {
        open: sessionId => {
          openSession = sessionId
          showAndFocus(host, BACK_KEY)
        },
        back: () => {
          const left = openSession

          openSession = null
          showAndFocus(host, `sess-${left}`, `tab-${tab}`)
        },
        send: (session, text) => deliver(host, messages, sessionRecipient(messages, session), text),
        status: session => deliver(host, messages, sessionRecipient(messages, session), messages.STATUS_REQUEST),
      },
    )
  }

  const drawAgents = (elements: PaneElements, host: PaneHost, room: Room) =>
    drawCatalogTab(
      elements,
      messages,
      { hasLauncher: host.agents !== undefined, catalog, pendingUse, room },
      { use: name => useAgent(host, name) },
    )

  const drawBody = (elements: PaneElements, host: PaneHost, now: number, room: Room): RenderElement => {
    if (tab === 1) {
      return drawThisSession(elements, host, now, room)
    }

    return tab === 2 ? drawOtherSessions(elements, host, now, room) : drawAgents(elements, host, room)
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
    render: async (host, elements, { columns, surface, isFocused }) => {
      const drawn = new Map<string, () => void>()
      const tracked = trackingPresses(elements, drawn)
      const { Box, Text } = tracked
      const now = await host.clock.now()
      const tree = (
        <Box flexDirection="column" paddingX={SIDE_ROOM} paddingBottom={1}>
          {drawTabs(tracked, host)}
          <Text dimColor wrap="truncate">
            {'─'.repeat(Math.max(columns - 2 * SIDE_ROOM, 0))}
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {drawBody(tracked, host, now, { columns, surface })}
          </Box>
        </Box>
      )

      holdsKeyboard = isFocused
      presses = drawn

      return tree
    },
    takeover: (element, by) =>
      by === 'person' && element !== undefined && !holdsKeyboard ? presses.get(element) : undefined,
    closed: host =>
      attempt(async () => {
        pendingUse = null
        await settle(host)
      }),
    changed: host =>
      attempt(async () => {
        if (timer !== null) {
          redrawIfChanged(host, await host.clock.now())
        }
      }),
  }
}
