import { type AgoTemplates, filled } from '../timing'

const PROMPT_SWAP = 'after a /clear or a compaction'

const UNCACHED_NEXT_TURN = 'The next turn rereads the whole conversation without cache.'

const AGO: AgoTemplates = { seconds: '{n} s ago', minutes: '{n} min ago', hours: '{n} h ago' }

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

export const en = {
  sourceLabel: { project: 'project', user: 'user' },
  skipReason: {
    'no-opening-fence': 'the first line is not ---',
    'no-closing-fence': 'the --- that closes the header is missing',
    'no-name': 'the name field is missing',
    'no-description': 'the description field is missing',
    unreadable: 'the file could not be read',
  },
  skippedHeading: (count: number) => `${count} ${plural(count, 'file', 'files')} skipped:`,
  skippedNotice: (count: number) =>
    `${count} ${plural(count, 'file', 'files')} skipped. The reasons appear in /as --reload.`,
  commandDescription: 'Run this session as an agent from .claude/agents',
  commandArgumentHint: '[agent|off]',
  noAgentsFound: 'No agents found in .claude/agents.',
  catalogListHeading: (count: number) => `Available agents (${count}):`,
  noActiveAgent: 'No active agent. The session follows its default behavior.',
  activeAgentLine: (name: string, source: string) => `Active agent: ${name} (${source})`,
  fileLine: (path: string) => `File: ${path}`,
  modelLine: (model: string) => `Model: ${model}`,
  effortLine: (effort: string) => `Effort: ${effort}`,
  allowedToolsLine: (tools: string) => `Allowed tools: ${tools}`,
  disallowedToolsLine: (tools: string) => `Disallowed tools: ${tools}`,
  sessionDefault: 'session default',
  allTools: 'all',
  noTools: 'none',
  reloadedCount: (count: number) => `${count} ${plural(count, 'agent', 'agents')} found.`,
  activeFileGone: (name: string) =>
    `The file for agent ${name} is no longer in the catalog. It stays active as loaded; to deactivate it, use /as off.`,
  unknownAgentNoCatalog: (name: string) =>
    `There is no agent named "${name}", and no agents were found in .claude/agents.`,
  unknownAgent: (name: string, names: string) => `There is no agent named "${name}". Available agents: ${names}.`,
  activatedBeforeStart: (name: string) => `Agent ${name} is active.`,
  activatedAfterStart: (name: string) =>
    `Agent ${name} is active. The model and tools apply now. The system prompt only changes ${PROMPT_SWAP}.`,
  activatedWithoutNotice: (name: string) =>
    `Agent ${name} is active. The model and tools apply now, but the agent's instructions did not enter the conversation because the session refused the message. They only arrive with the system prompt, ${PROMPT_SWAP}.`,
  deactivatedBeforeStart: (name: string) => `Agent ${name} deactivated.`,
  deactivatedAfterStart: (name: string) =>
    `Agent ${name} deactivated. The system prompt only goes back to the default ${PROMPT_SWAP}.`,
  deactivatedWithoutNotice: (name: string) =>
    `Agent ${name} deactivated. The model and tools are back to the default, but the notice that the role ended did not enter the conversation because the session refused the message. The system prompt only goes back to the default ${PROMPT_SWAP}.`,
  modelChanges: (from: string, to: string) => `The model changes from ${from} to ${to}. ${UNCACHED_NEXT_TURN}`,
  modelReturns: (from: string, to: string) => `The model goes back from ${from} to ${to}. ${UNCACHED_NEXT_TURN}`,
  alreadyOff: 'No agent is active.',
  nativeSessionUnnamed: 'This session already runs as a native agent (claude --agent). To switch, open another session.',
  nativeSessionNamed: (agent: string) =>
    `This session already runs as the agent ${agent} (claude --agent). To switch, open another session.`,
  droppedForNative: (name: string) =>
    `This session already runs as a native agent (claude --agent), so the /as agent ${name} was deactivated.`,
  unresolvedModel: (alias: string) =>
    `The model "${alias}" has no alias set, so the session keeps its current model. Set the alias in the plugin's "Model aliases" option.`,
  unappliedField: (field: string) => `/as does not apply the ${field} field of this agent.`,
  unknownEffort: (value: string, accepted: string) =>
    `The effort "${value}" is not one of the accepted values (${accepted}), so the steps keep the session's effort.`,
  unknownDefaultAgent: (name: string) =>
    `The agent "${name}", set by the agent key in settings, does not exist in .claude/agents. The session starts without an agent.`,
  agentsCommandDescription: "Show this session's subagents and the other open sessions",
  agentsArgumentHint: '[sessions]',
  statusWord: { running: 'running', completed: 'completed', failed: 'failed', stopped: 'stopped' },
  statusCount: {
    running: (count: number) => `${count} running`,
    completed: (count: number) => `${count} completed`,
    failed: (count: number) => `${count} failed`,
    stopped: (count: number) => `${count} stopped`,
  },
  tokensTotal: (amount: string) => `${amount} tokens`,
  tokensWithCache: (amount: string) => `${amount} tokens with cache reads`,
  ago: AGO,
  secondsAgo: (seconds: number) => filled(AGO.seconds, seconds),
  minutesAgo: (minutes: number) => filled(AGO.minutes, minutes),
  hoursAgo: (hours: number) => filled(AGO.hours, hours),
  noSubagents: 'No subagents in this session.',
  inProgressHeading: (count: number) => `In progress (${count})`,
  finishedHeading: (count: number) => `Finished (${count})`,
  agentInForce: (status: string) => `Agent in effect: ${status}`,
  noOtherSessions: 'No other sessions registered.',
  noAgentLabel: 'no agent',
  subagentCount: (count: number) => `${count} ${plural(count, 'subagent', 'subagents')}`,
  presenceWord: { working: 'working', idle: 'idle', stale: 'inactive', ended: 'ended' },
  openHeading: (count: number) => `Open (${count})`,
  endedHeading: (count: number) => `Ended (${count})`,
  otherSessionsHeading: (count: number) => `Other sessions (${count}):`,
  agentsUsage: "Usage: /agent-panel for this session's subagents, /agent-panel sessions for the other sessions.",
  paneTitle: 'Agents',
  panelOpened: 'Agent panel opened.',
  panelOpenedOnSessions: 'Agent panel opened on the Other sessions tab.',
  panelOpenedOnAgents: 'Agent panel opened on the Agents tab.',
  tabLabels: { 1: 'This session', 2: 'Other sessions', 3: 'Agents' },
  sessionWithoutAgent: 'Session with no agent',
  sessionAsAgent: (status: string) => `Session as ${status}`,
  catalogUnreadable: 'Could not read the agent catalog.',
  launcherOff: 'The Launcher is off. Turn on the "Launcher" option in the plugin options to list and use agents.',
  catalogHeading: (count: number) => `Available agents (${count})`,
  sessionModel: 'session model',
  modelLabel: (model: string) => `model: ${model}`,
  activeLabel: 'active',
  toolCount: (count: number) => `${count} ${plural(count, 'tool', 'tools')}`,
  useLabel: 'Use',
  confirmLabel: 'Confirm',
  switchLabel: 'Switch agent',
  offOptionLabel: 'off',
  listHint: 'Tab picks a row, Enter opens its detail and Esc closes the panel.',
  detailHint: 'Esc closes the panel.',
  backLabel: 'Back',
  stopLabel: 'Stop',
  promptHeading: 'Prompt given',
  answerHeading: 'Answer',
  noAnswerYet: 'No answer yet.',
  noPrompt: 'Prompt not recorded.',
  promptShowLabel: 'show all',
  promptHideLabel: 'collapse',
  promptLines: (count: number) => `${count} ${plural(count, 'line', 'lines')}`,
  earlierMessages: (count: number) => `Earlier messages (${count})`,
  earlierAnswers: (count: number) => `Earlier answers (${count})`,
  youSaid: (text: string) => `You: ${text}`,
  stopRequested: (type: string, tail: string) => `Stop request sent to ${type}${tail}`,
  stopFailed: (type: string, tail: string) => `Could not stop ${type}${tail}`,
  lastAnswerHeading: 'Last answer',
  noSharedAnswer: 'No answer published.',
  peerSubagentsHeading: (count: number) => `Subagents in this session (${count})`,
  noPeerSubagents: 'No subagents published.',
  messagePlaceholderSubagent: 'Message for this subagent',
  messagePlaceholderSession: 'Message for this session',
  sendLabel: 'send',
  statusLabel: 'Status',
  statusRequest: 'Reply in one line with what you are doing now.',
  subagentTarget: (type: string) => `the subagent ${type}`,
  sessionTarget: (cwd: string) => `the session in ${cwd}`,
  messageSent: (target: string) => `Message sent to ${target}.`,
  messageRelayed: (target: string) =>
    `Auto mode refused the direct send. The message for ${target} became a request in the conversation.`,
  messageFailed: (target: string, tail: string) => `Could not send the message to ${target}${tail}`,
  footerPanelLabel: 'Panel',
  footerRunning: (count: number) => `${count} ${plural(count, 'subagent running', 'subagents running')}`,
  footerPeers: (count: number) => `${count} ${plural(count, 'session working', 'sessions working')}`,
}

export type Words = typeof en
