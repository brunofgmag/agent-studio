import type {
  AgentSource,
  CatalogAgent,
  Exchange,
  OtherSession,
  PublishedSubagent,
  SessionPresence,
  SkippedFile,
  SubagentLine,
  SubagentStatus,
} from '../types'
import { type ClockProps, agoBucket, clock } from './timing'
import { type Words, en } from './words/en'
import { ptBr } from './words/pt-br'

export type ListedAgent = {
  name: string
  description: string
  source: AgentSource
  isActive: boolean
}

export type ActiveSummary = {
  name: string
  source: AgentSource
  path: string
  model: string | undefined
  effort: string | undefined
  tools: readonly string[] | undefined
  disallowedTools: readonly string[] | undefined
}

export type TickingMeta = { before: string; clock: ClockProps; after: string }

export type RowParts = {
  mark: string
  markColor: string
  name: string
  meta: string
  ticking?: TickingMeta
  description: string
  isDim?: boolean
}

export type SubagentGroup = { heading: string; lines: readonly SubagentLine[] }

export type SessionGroup = { heading: string; sessions: readonly OtherSession[] }

export type FooterFacts = {
  agent: { name: string; model?: string; effort?: string } | null
  running: number
  peers: number
}

const DESCRIPTION_LIMIT = 80

const PROMPT_PREVIEW_LIMIT = 300

const NEWLINE = /\r?\n/

const NO_TOOL = '—'

const TASK_LIMIT = 60

const ROW_DESCRIPTION_LIMIT = 200

const META_SEPARATOR = ' · '

const META_MARK = META_SEPARATOR.trim()

const TOAST_DETAIL_LIMIT = 120

const FOOTER_SEPARATOR = ' · '

const STATUS_ICON: Record<SubagentStatus, string> = { running: '●', completed: '✓', failed: '✗', stopped: '■' }

const SUBAGENT_COLOR: Record<SubagentStatus, string> = {
  running: 'suggestion',
  completed: 'success',
  failed: 'error',
  stopped: 'inactive',
}

const SUMMARY_ORDER: readonly SubagentStatus[] = ['running', 'completed', 'failed', 'stopped']

const PRESENCE_COLOR: Record<SessionPresence, string> = {
  working: 'success',
  idle: 'warning',
  stale: 'inactive',
  ended: 'inactive',
}

const PRESENCE_ORDER: readonly SessionPresence[] = ['working', 'idle', 'stale', 'ended']

const PATH_SEPARATOR = /[\\/]/

const MARKDOWN_MARKS = /[*`]+|^#+\s+/gm

const AGENT_COLORS = new Map([
  ['red', '#d1242f'],
  ['blue', '#3b82f6'],
  ['green', '#22a06b'],
  ['yellow', '#d4a72c'],
  ['purple', '#8250df'],
  ['orange', '#e16f24'],
  ['pink', '#db61a2'],
  ['cyan', '#1b9aaa'],
])

const NO_AGENT_COLOR = 'subtle'

const PORTUGUESE_TAGS: readonly string[] = ['pt-br', 'pt']

const cut = (text: string, limit = DESCRIPTION_LIMIT): string => {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1).trimEnd()}…`
}

const abbreviated = (tokens: number): string => {
  if (tokens < 1000) {
    return String(tokens)
  }

  if (tokens < 10_000) {
    return `${(tokens / 1000).toFixed(1)}k`
  }

  return tokens < 1_000_000 ? `${Math.round(tokens / 1000)}k` : `${(tokens / 1_000_000).toFixed(1)}M`
}

const durationOf = (line: SubagentLine, now: number): number => line.durationMs ?? now - line.startedAt

const metaOf = (parts: readonly (string | null)[]): string =>
  parts.filter(part => part !== null && part !== '').join(META_SEPARATOR)

type Timed = { text: string; props: ClockProps | null }

const timedMeta = (
  head: readonly (string | null)[],
  timed: Timed | null,
  tail: readonly (string | null)[],
): Pick<RowParts, 'meta' | 'ticking'> => {
  const meta = metaOf([...head, timed?.text ?? null, ...tail])

  if (timed?.props == null) {
    return { meta }
  }

  const before = metaOf(head)
  const after = metaOf(tail)

  return {
    meta,
    ticking: {
      before: before === '' ? '' : `${before} ${META_MARK}`,
      clock: timed.props,
      after: after === '' ? '' : `${META_MARK} ${after}`,
    },
  }
}

const treesOf = (lines: readonly SubagentLine[]): SubagentLine[][] =>
  lines.reduce<SubagentLine[][]>((trees, line) => {
    const current = trees.at(-1)

    if (line.depth === 0 || current === undefined) {
      trees.push([line])
    } else {
      current.push(line)
    }

    return trees
  }, [])

const isRunning = ({ status }: SubagentLine): boolean => status === 'running'

const isEnded = ({ presence }: OtherSession): boolean => presence === 'ended'

const folderName = (cwd: string): string => cwd.split(PATH_SEPARATOR).findLast(part => part !== '') ?? cwd

const unmarked = (text: string): string => text.replace(MARKDOWN_MARKS, '')

const byPresenceThenNewest = (a: OtherSession, b: OtherSession): number =>
  PRESENCE_ORDER.indexOf(a.presence) - PRESENCE_ORDER.indexOf(b.presence) || b.updatedAt - a.updatedAt

const toastDetail = (detail: string): string => {
  const flat = cut(detail, TOAST_DETAIL_LIMIT)

  return flat === '' ? '.' : `: ${flat}`
}

const statusLine = (name: string, model: string | undefined, effort: string | undefined): string =>
  [`@${name}`, model, effort].filter(part => part !== undefined).join(' · ')

const agentStatus = (agent: { name: string; model?: string; effort?: string } | null): string | null =>
  agent === null ? null : statusLine(agent.name, agent.model, agent.effort)

const sessionName = (session: OtherSession): string =>
  session.title === undefined || session.title.trim() === '' ? folderName(session.cwd) : session.title.trim()

const agentColor = (color: string | undefined): string => AGENT_COLORS.get(color ?? '') ?? NO_AGENT_COLOR

const promptPreview = (prompt: string): string => cut(prompt, PROMPT_PREVIEW_LIMIT)

const messagesOver = (words: Words) => {
  const skippedLines = (skipped: readonly SkippedFile[]): string[] =>
    skipped.length === 0
      ? []
      : [
          words.skippedHeading(skipped.length),
          ...skipped.map(file => `  ${file.path}: ${words.skipReason[file.reason]}`),
        ]

  const catalogList = (agents: readonly ListedAgent[], skipped: readonly SkippedFile[]): string => {
    if (agents.length === 0) {
      return [words.noAgentsFound, ...skippedLines(skipped)].join('\n')
    }

    const rows = agents.map(
      agent =>
        `${agent.isActive ? '* ' : '  '}${agent.name} (${words.sourceLabel[agent.source]}): ${cut(agent.description)}`,
    )

    return [words.catalogListHeading(agents.length), ...rows, ...skippedLines(skipped)].join('\n')
  }

  const activeSummary = (active: ActiveSummary | null): string => {
    if (active === null) {
      return words.noActiveAgent
    }

    return [
      words.activeAgentLine(active.name, words.sourceLabel[active.source]),
      words.fileLine(active.path),
      words.modelLine(active.model ?? words.sessionDefault),
      words.effortLine(active.effort ?? words.sessionDefault),
      words.allowedToolsLine(active.tools === undefined ? words.allTools : active.tools.join(', ')),
      words.disallowedToolsLine(
        active.disallowedTools === undefined ? words.noTools : active.disallowedTools.join(', '),
      ),
    ].join('\n')
  }

  const reloaded = (count: number, skipped: readonly SkippedFile[]): string =>
    [words.reloadedCount(count), ...skippedLines(skipped)].join('\n')

  const unknownAgent = (name: string, names: readonly string[]): string =>
    names.length === 0 ? words.unknownAgentNoCatalog(name) : words.unknownAgent(name, names.join(', '))

  const nativeSession = (agent: string): string =>
    agent === '' ? words.nativeSessionUnnamed : words.nativeSessionNamed(agent)

  const unknownEffort = (value: string, accepted: readonly string[]): string =>
    words.unknownEffort(value, accepted.join(', '))

  const AGO_WORDS = { seconds: words.secondsAgo, minutes: words.minutesAgo, hours: words.hoursAgo }

  const since = (ms: number): string => {
    const { unit, amount } = agoBucket(ms)

    return AGO_WORDS[unit](amount)
  }

  const timeText = (props: ClockProps, now: number): string =>
    props.kind === 'elapsed' ? clock(now - props.since) : since(now - props.since)

  const agoFrom = (at: number): ClockProps => ({ kind: 'ago', since: at, templates: words.ago })

  const statusLabel = (status: SubagentStatus): string => `${STATUS_ICON[status]} ${words.statusWord[status]}`

  const subagentRowText = (line: SubagentLine, now: number): string =>
    [
      statusLabel(line.status),
      line.type,
      cut(line.task, TASK_LIMIT),
      line.tool ?? NO_TOOL,
      clock(durationOf(line, now)),
      abbreviated(line.tokens),
    ].join('  ')

  const lineTime = (line: SubagentLine, now: number): Timed => ({
    text: clock(durationOf(line, now)),
    props: line.status === 'running' && line.durationMs === null ? { kind: 'elapsed', since: line.startedAt } : null,
  })

  const subagentRow = (line: SubagentLine, now: number): RowParts => ({
    mark: STATUS_ICON[line.status],
    markColor: SUBAGENT_COLOR[line.status],
    name: line.type,
    ...timedMeta([words.statusWord[line.status], line.tool], lineTime(line, now), [abbreviated(line.tokens)]),
    description: cut(line.task, ROW_DESCRIPTION_LIMIT),
  })

  const tokensWithCache = (line: SubagentLine): string =>
    words.tokensWithCache(abbreviated(line.tokens + line.cachedTokens))

  const subagentLine = (line: SubagentLine, now: number): string =>
    `${'  '.repeat(line.depth)}${subagentRowText(line, now)}`

  const subagentSummary = (lines: readonly SubagentLine[]): string => {
    if (lines.length === 0) {
      return ''
    }

    const counts = SUMMARY_ORDER.map(status => {
      const count = lines.filter(line => line.status === status).length

      return count === 0 ? null : words.statusCount[status](count)
    })
    const tokens = lines.reduce((total, line) => total + line.tokens, 0)

    return metaOf([...counts, words.tokensTotal(abbreviated(tokens))])
  }

  const subagentGroups = (lines: readonly SubagentLine[]): SubagentGroup[] => {
    const trees = treesOf(lines)
    const active = trees.filter(tree => tree.some(isRunning)).flat()
    const finished = trees.filter(tree => !tree.some(isRunning)).flat()

    return [
      { heading: words.inProgressHeading(active.length), lines: active },
      { heading: words.finishedHeading(finished.length), lines: finished },
    ].filter(({ lines: group }) => group.length > 0)
  }

  const subagentTree = (header: string | null, lines: readonly SubagentLine[], now: number): string =>
    [...(header === null ? [] : [header]), ...lines.map(line => subagentLine(line, now))].join('\n')

  const sessionAgent = (session: OtherSession): string =>
    session.agent === null ? words.noAgentLabel : `@${session.agent}`

  const sessionSubagentCount = (session: OtherSession): string => words.subagentCount(session.subagents.length)

  const sessionClock = (session: OtherSession): ClockProps | null => {
    if (session.presence === 'working') {
      return session.turnStartedAt === null ? null : { kind: 'elapsed', since: session.turnStartedAt }
    }

    if (session.presence === 'idle') {
      return session.idleSince === undefined ? null : agoFrom(session.idleSince)
    }

    return agoFrom(session.updatedAt)
  }

  const sessionTime = (session: OtherSession, now: number): Timed | null => {
    const props = sessionClock(session)

    return props === null ? null : { text: timeText(props, now), props }
  }

  const sessionLine = (session: OtherSession, now: number): string =>
    [
      session.cwd,
      sessionAgent(session),
      words.presenceWord[session.presence],
      sessionSubagentCount(session),
      sessionTime(session, now)?.text ?? null,
    ]
      .filter(part => part !== null)
      .join('  ')

  const sessionSummary = (session: OtherSession): string => {
    const answer = cut(unmarked(session.lastAnswer ?? ''), ROW_DESCRIPTION_LIMIT)

    return [session.subagents.length === 0 ? null : sessionSubagentCount(session), answer === '' ? session.cwd : answer]
      .filter(part => part !== null)
      .join(META_SEPARATOR)
  }

  const sessionRow = (session: OtherSession, now: number): RowParts => ({
    mark: '●',
    markColor: PRESENCE_COLOR[session.presence],
    name: sessionName(session),
    ...timedMeta([sessionAgent(session), words.presenceWord[session.presence]], sessionTime(session, now), []),
    description: sessionSummary(session),
    isDim: isEnded(session),
  })

  const sessionGroups = (sessions: readonly OtherSession[]): SessionGroup[] => {
    const sorted = [...sessions].sort(byPresenceThenNewest)
    const open = sorted.filter(session => !isEnded(session))
    const ended = sorted.filter(isEnded)

    return [
      { heading: words.openHeading(open.length), sessions: open },
      { heading: words.endedHeading(ended.length), sessions: ended },
    ].filter(({ sessions: group }) => group.length > 0)
  }

  const otherSessions = (sessions: readonly OtherSession[], now: number): string =>
    [words.otherSessionsHeading(sessions.length), ...sessions.map(session => `  ${sessionLine(session, now)}`)].join(
      '\n',
    )

  const sessionHeader = (status: string | null): string =>
    status === null ? words.sessionWithoutAgent : words.sessionAsAgent(status)

  const catalogRow = (agent: CatalogAgent): RowParts => ({
    mark: '●',
    markColor: agentColor(agent.color),
    name: agent.name,
    meta: metaOf([
      words.sourceLabel[agent.source],
      agent.model === undefined ? words.sessionModel : words.modelLabel(agent.model),
      agent.tools === undefined ? null : words.toolCount(agent.tools.length),
      agent.isActive ? words.activeLabel : null,
    ]),
    description: cut(agent.description),
  })

  const promptLines = (prompt: string): string => words.promptLines(prompt.trimEnd().split(NEWLINE).length)

  const earlierLabel = (earlier: readonly Exchange[]): string => {
    const answers = earlier.filter(({ kind }) => kind === 'answer').length

    return answers === 0 ? words.earlierMessages(earlier.length) : words.earlierAnswers(answers)
  }

  const stopRequested = (type: string, detail: string): string => words.stopRequested(type, toastDetail(detail))

  const stopFailed = (type: string, reason: string): string => words.stopFailed(type, toastDetail(reason))

  const sessionTarget = (session: OtherSession): string => words.sessionTarget(session.cwd)

  const messageFailed = (target: string, reason: string): string => words.messageFailed(target, toastDetail(reason))

  const publishedSubagentText = (subagent: PublishedSubagent): string =>
    [
      statusLabel(subagent.status),
      subagent.type,
      cut(subagent.task, TASK_LIMIT),
      subagent.tool ?? NO_TOOL,
      abbreviated(subagent.tokens),
    ].join('  ')

  const footerSummary = ({ agent, running, peers }: FooterFacts): string =>
    [
      agentStatus(agent) ?? '',
      running === 0 ? '' : words.footerRunning(running),
      peers === 0 ? '' : words.footerPeers(peers),
    ]
      .filter(part => part !== '')
      .join(FOOTER_SEPARATOR)

  return {
    COMMAND_DESCRIPTION: words.commandDescription,
    COMMAND_ARGUMENT_HINT: words.commandArgumentHint,
    noAgentsFound: words.noAgentsFound,
    catalogList,
    activeSummary,
    reloaded,
    activeFileGone: words.activeFileGone,
    unknownAgent,
    activatedBeforeStart: words.activatedBeforeStart,
    activatedAfterStart: words.activatedAfterStart,
    activatedWithoutNotice: words.activatedWithoutNotice,
    deactivatedBeforeStart: words.deactivatedBeforeStart,
    deactivatedAfterStart: words.deactivatedAfterStart,
    deactivatedWithoutNotice: words.deactivatedWithoutNotice,
    modelChanges: words.modelChanges,
    modelReturns: words.modelReturns,
    alreadyOff: words.alreadyOff,
    nativeSession,
    droppedForNative: words.droppedForNative,
    unresolvedModel: words.unresolvedModel,
    unappliedField: words.unappliedField,
    unknownEffort,
    unknownDefaultAgent: words.unknownDefaultAgent,
    statusLine,
    agentStatus,
    AGENTS_COMMAND_DESCRIPTION: words.agentsCommandDescription,
    AGENTS_ARGUMENT_HINT: words.agentsArgumentHint,
    subagentRowText,
    subagentRow,
    tokensWithCache,
    noSubagents: words.noSubagents,
    subagentSummary,
    subagentGroups,
    agentInForce: words.agentInForce,
    subagentTree,
    noOtherSessions: words.noOtherSessions,
    sessionName,
    sessionRow,
    sessionGroups,
    otherSessions,
    agentsUsage: words.agentsUsage,
    PANE_TITLE: words.paneTitle,
    panelOpened: words.panelOpened,
    panelOpenedOnSessions: words.panelOpenedOnSessions,
    TAB_LABELS: words.tabLabels,
    sessionHeader,
    panelOpenedOnAgents: words.panelOpenedOnAgents,
    catalogUnreadable: words.catalogUnreadable,
    launcherOff: words.launcherOff,
    catalogHeading: words.catalogHeading,
    agentColor,
    catalogRow,
    USE_LABEL: words.useLabel,
    CONFIRM_LABEL: words.confirmLabel,
    catalogSkipped: words.skippedNotice,
    SWITCH_LABEL: words.switchLabel,
    OFF_OPTION_LABEL: words.offOptionLabel,
    listHint: words.listHint,
    detailHint: words.detailHint,
    BACK_LABEL: words.backLabel,
    STOP_LABEL: words.stopLabel,
    promptHeading: words.promptHeading,
    answerHeading: words.answerHeading,
    noAnswerYet: words.noAnswerYet,
    noPrompt: words.noPrompt,
    PROMPT_SHOW_LABEL: words.promptShowLabel,
    PROMPT_HIDE_LABEL: words.promptHideLabel,
    promptLines,
    promptPreview,
    earlierLabel,
    youSaid: words.youSaid,
    stopRequested,
    stopFailed,
    lastAnswerHeading: words.lastAnswerHeading,
    noSharedAnswer: words.noSharedAnswer,
    peerSubagentsHeading: words.peerSubagentsHeading,
    noPeerSubagents: words.noPeerSubagents,
    MESSAGE_PLACEHOLDER_SUBAGENT: words.messagePlaceholderSubagent,
    MESSAGE_PLACEHOLDER_SESSION: words.messagePlaceholderSession,
    SEND_LABEL: words.sendLabel,
    STATUS_LABEL: words.statusLabel,
    STATUS_REQUEST: words.statusRequest,
    subagentTarget: words.subagentTarget,
    sessionTarget,
    messageSent: words.messageSent,
    messageRelayed: words.messageRelayed,
    messageFailed,
    publishedSubagentText,
    FOOTER_PANEL_LABEL: words.footerPanelLabel,
    footerSummary,
  }
}

export type Messages = ReturnType<typeof messagesOver>

const ENGLISH = messagesOver(en)

const PORTUGUESE = messagesOver(ptBr)

const isPortuguese = (language: unknown): boolean =>
  typeof language === 'string' && PORTUGUESE_TAGS.includes(language.trim().toLowerCase())

export const messagesIn = (language: unknown): Messages => (isPortuguese(language) ? PORTUGUESE : ENGLISH)
