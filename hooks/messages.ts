import type { AgentSource, CatalogAgent, OtherSession, PaneTab, PublishedSubagent, SkippedFile, SubagentLine, SubagentStatus } from '../types'

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

const DESCRIPTION_LIMIT = 80

const PROMPT_SWAP = 'depois de um /clear ou de uma compactação'

const SOURCE_LABEL: Record<AgentSource, string> = { project: 'projeto', user: 'usuário' }

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

const cut = (text: string, limit = DESCRIPTION_LIMIT): string => {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1).trimEnd()}…`
}

const SKIP_REASON: Record<SkippedFile['reason'], string> = {
  'no-opening-fence': 'a primeira linha não é ---',
  'no-closing-fence': 'falta o --- que fecha o cabeçalho',
  'no-name': 'falta o campo name',
  'no-description': 'falta o campo description',
  unreadable: 'não foi possível ler o arquivo',
}

const skippedLines = (skipped: readonly SkippedFile[]): string[] =>
  skipped.length === 0
    ? []
    : [
        `${skipped.length} ${plural(skipped.length, 'arquivo ignorado', 'arquivos ignorados')}:`,
        ...skipped.map(file => `  ${file.path}: ${SKIP_REASON[file.reason]}`),
      ]

export const COMMAND_DESCRIPTION = 'Faz a sessão atuar como um agente de .claude/agents'

export const COMMAND_ARGUMENT_HINT = '[agente|off]'

export const noAgentsFound = 'Nenhum agente encontrado em .claude/agents.'

export const catalogList = (agents: readonly ListedAgent[], skipped: readonly SkippedFile[]): string => {
  if (agents.length === 0) {
    return [noAgentsFound, ...skippedLines(skipped)].join('\n')
  }

  const rows = agents.map(
    agent => `${agent.isActive ? '* ' : '  '}${agent.name} (${SOURCE_LABEL[agent.source]}): ${cut(agent.description)}`,
  )

  return [`Agentes disponíveis (${agents.length}):`, ...rows, ...skippedLines(skipped)].join('\n')
}

export const activeSummary = (active: ActiveSummary | null): string => {
  if (active === null) {
    return 'Nenhum agente ativo. A sessão segue o comportamento padrão.'
  }

  return [
    `Agente ativo: ${active.name} (${SOURCE_LABEL[active.source]})`,
    `Arquivo: ${active.path}`,
    `Modelo: ${active.model ?? 'o da sessão'}`,
    `Effort: ${active.effort ?? 'o da sessão'}`,
    `Ferramentas permitidas: ${active.tools === undefined ? 'todas' : active.tools.join(', ')}`,
    `Ferramentas proibidas: ${active.disallowedTools === undefined ? 'nenhuma' : active.disallowedTools.join(', ')}`,
  ].join('\n')
}

export const reloaded = (count: number, skipped: readonly SkippedFile[]): string =>
  [`${count} ${plural(count, 'agente encontrado', 'agentes encontrados')}.`, ...skippedLines(skipped)].join('\n')

export const activeFileGone = (name: string): string =>
  `O arquivo do agente ${name} não está mais no catálogo. Ele continua ativo como foi carregado; para desativar, use /as off.`

export const unknownAgent = (name: string, names: readonly string[]): string =>
  names.length === 0
    ? `Não há agente chamado "${name}", e nenhum agente foi encontrado em .claude/agents.`
    : `Não há agente chamado "${name}". Agentes disponíveis: ${names.join(', ')}.`

export const activatedBeforeStart = (name: string): string => `Agente ${name} ativo.`

export const activatedAfterStart = (name: string): string =>
  `Agente ${name} ativo. O modelo e as ferramentas já valem. O system prompt só troca ${PROMPT_SWAP}.`

export const activatedWithoutNotice = (name: string): string =>
  `Agente ${name} ativo. O modelo e as ferramentas já valem, mas as instruções do agente não entraram na conversa, porque a sessão recusou a mensagem. Elas só chegam com o system prompt, ${PROMPT_SWAP}.`

export const deactivatedBeforeStart = (name: string): string => `Agente ${name} desativado.`

export const deactivatedAfterStart = (name: string): string =>
  `Agente ${name} desativado. O system prompt só volta ao padrão ${PROMPT_SWAP}.`

export const deactivatedWithoutNotice = (name: string): string =>
  `Agente ${name} desativado. O modelo e as ferramentas já voltaram ao padrão, mas o aviso de que o papel acabou não entrou na conversa, porque a sessão recusou a mensagem. O system prompt só volta ao padrão ${PROMPT_SWAP}.`

export const alreadyOff = 'Nenhum agente está ativo.'

export const nativeSession = (agent: string): string =>
  agent === ''
    ? 'Esta sessão já roda como um agente nativo (claude --agent). Para trocar, abra outra sessão.'
    : `Esta sessão já roda como o agente ${agent} (claude --agent). Para trocar, abra outra sessão.`

export const droppedForNative = (name: string): string =>
  `Esta sessão já roda como um agente nativo (claude --agent), então o agente ${name} do /as foi desativado.`

export const unresolvedModel = (alias: string): string =>
  `O modelo "${alias}" não tem apelido configurado, então a sessão mantém o modelo atual. Defina o apelido na opção "Apelidos de modelo" do plugin.`

export const unappliedField = (field: string): string =>
  `O /as não aplica o campo ${field} deste agente.`

export const unknownEffort = (value: string, accepted: readonly string[]): string =>
  `O effort "${value}" não é um dos valores aceitos (${accepted.join(', ')}), então os passos mantêm o effort da sessão.`

export const unknownDefaultAgent = (name: string): string =>
  `O agente "${name}", definido na chave agent do settings, não existe em .claude/agents. A sessão começa sem agente.`

export const statusLine = (name: string, model: string | undefined, effort: string | undefined): string =>
  [`@${name}`, model, effort].filter(part => part !== undefined).join(' · ')

export const agentStatus = (agent: { name: string; model?: string; effort?: string } | null): string | null =>
  agent === null ? null : statusLine(agent.name, agent.model, agent.effort)

export const AGENTS_COMMAND_DESCRIPTION = 'Mostra os subagentes desta sessão e as outras sessões abertas'

export const AGENTS_ARGUMENT_HINT = '[sessoes]'

const STATUS_ICON: Record<SubagentStatus, string> = { running: '●', completed: '✓', failed: '✗', stopped: '■' }

const STATUS_WORD: Record<SubagentStatus, string> = {
  running: 'rodando',
  completed: 'concluído',
  failed: 'falhou',
  stopped: 'parado',
}

const NO_TOOL = '—'

const TASK_LIMIT = 60

const ANSWER_ROW_LIMIT = 60

const TOAST_DETAIL_LIMIT = 120

const pad = (value: number) => String(value).padStart(2, '0')

const clock = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000))

  return `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`
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

const since = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000))

  if (seconds < 60) {
    return `há ${seconds} s`
  }

  return seconds < 3600 ? `há ${Math.floor(seconds / 60)} min` : `há ${Math.floor(seconds / 3600)} h`
}

const statusLabel = (status: SubagentStatus): string => `${STATUS_ICON[status]} ${STATUS_WORD[status]}`

export const subagentRowText = (line: SubagentLine, now: number): string => {
  const duration = line.durationMs ?? now - line.startedAt

  return [
    statusLabel(line.status),
    line.type,
    cut(line.task, TASK_LIMIT),
    line.tool ?? NO_TOOL,
    clock(duration),
    abbreviated(line.tokens),
  ].join('  ')
}

const subagentLine = (line: SubagentLine, now: number): string =>
  `${'  '.repeat(line.depth)}${subagentRowText(line, now)}`

export const noSubagents = 'Nenhum subagente nesta sessão.'

export const agentInForce = (statusText: string): string => `Agente em vigor: ${statusText}`

export const subagentTree = (header: string | null, lines: readonly SubagentLine[], now: number): string =>
  [...(header === null ? [] : [header]), ...lines.map(line => subagentLine(line, now))].join('\n')

export const noOtherSessions = 'Nenhuma outra sessão registrada.'

const sessionAgent = (session: OtherSession): string =>
  session.agent === null ? 'sem agente' : `@${session.agent}`

const sessionSubagentCount = (session: OtherSession): string =>
  `${session.subagents.length} ${plural(session.subagents.length, 'subagente', 'subagentes')}`

const sessionLine = (session: OtherSession, now: number): string =>
  [
    session.cwd,
    sessionAgent(session),
    session.presence,
    sessionSubagentCount(session),
    since(now - session.updatedAt),
  ].join('  ')

export const sessionRowText = (session: OtherSession, now: number): string =>
  [sessionLine(session, now), cut(session.lastAnswer ?? '', ANSWER_ROW_LIMIT)].filter(part => part !== '').join('  ')

export const otherSessions = (sessions: readonly OtherSession[], now: number): string =>
  [
    `Outras sessões (${sessions.length}):`,
    ...sessions.map(session => `  ${sessionLine(session, now)}`),
  ].join('\n')

export const agentsUsage = 'Uso: /agentes para os subagentes desta sessão, /agentes sessoes para as outras sessões.'

export const PANE_TITLE = 'Agentes'

export const panelOpened = 'Painel de agentes aberto.'

export const panelOpenedOnSessions = 'Painel de agentes aberto na aba Outras sessões.'

export const TAB_LABELS: Record<PaneTab, string> = { 1: 'Esta sessão', 2: 'Outras sessões', 3: 'Agentes' }

export const sessionHeader = (agentStatus: string | null): string =>
  agentStatus === null ? 'Sessão sem agente' : `Sessão como ${agentStatus}`

export const panelOpenedOnAgents = 'Painel de agentes aberto na aba Agentes.'

export const catalogUnreadable = 'Não foi possível ler o catálogo de agentes.'

export const launcherOff =
  'O Launcher está desligado. Ligue a opção "Launcher" nas opções do plugin para listar e usar agentes.'

export const catalogHeading = (count: number): string => `Agentes disponíveis (${count})`

export const catalogRowText = (agent: CatalogAgent): string =>
  [
    `${agent.name} (${SOURCE_LABEL[agent.source]})`,
    agent.isActive ? 'ativo' : '',
    cut(agent.description),
    agent.model === undefined ? 'modelo da sessão' : `modelo: ${agent.model}`,
    `ferramentas: ${agent.tools === undefined ? 'todas' : agent.tools.join(', ')}`,
  ]
    .filter(part => part !== '')
    .join('  ')

export const USE_LABEL = 'Usar nesta sessão'

export const catalogSkipped = (count: number): string =>
  `${count} ${plural(count, 'arquivo ignorado', 'arquivos ignorados')}. Os motivos aparecem em /as --reload.`

export const SWITCH_LABEL = 'Trocar agente'

export const OFF_OPTION_LABEL = 'desligar'

export const listHint = 'Tab escolhe uma linha, Enter abre o detalhe e Esc fecha o painel.'

export const detailHint = 'Esc fecha o painel.'

export const BACK_LABEL = 'Voltar'

export const STOP_LABEL = 'Parar'

export const promptHeading = 'Prompt dado'

export const answerHeading = 'Resposta'

export const noAnswerYet = 'Sem resposta ainda.'

export const noPrompt = 'Prompt não registrado.'

export const subagentDetailFields = (line: SubagentLine): string[] => [
  `Tipo: ${line.type}`,
  `Tarefa: ${line.task}`,
  `Status: ${statusLabel(line.status)}`,
  `Modelo: ${line.model ?? NO_TOOL}`,
]

const toastDetail = (detail: string): string => {
  const flat = cut(detail, TOAST_DETAIL_LIMIT)

  return flat === '' ? '.' : `: ${flat}`
}

export const stopRequested = (type: string, detail: string): string =>
  `Pedido de parada enviado a ${type}${toastDetail(detail)}`

export const stopFailed = (type: string, reason: string): string =>
  `Não foi possível parar ${type}${toastDetail(reason)}`

export const sessionDetailFields = (session: OtherSession, now: number): string[] => [
  `Pasta: ${session.cwd}`,
  `Agente: ${sessionAgent(session)}`,
  `Estado: ${session.presence}`,
  `Subagentes: ${session.subagents.length}`,
  `Última atividade: ${since(now - session.updatedAt)}`,
]

export const lastAnswerHeading = 'Última resposta'

export const noSharedAnswer = 'Nenhuma resposta publicada.'

export const peerSubagentsHeading = (count: number): string => `Subagentes desta sessão (${count})`

export const noPeerSubagents = 'Nenhum subagente publicado.'

export const MESSAGE_PLACEHOLDER_SUBAGENT = 'Mensagem para este subagente'

export const MESSAGE_PLACEHOLDER_SESSION = 'Mensagem para esta sessão'

export const SEND_LABEL = 'enviar'

export const STATUS_LABEL = 'Status'

export const STATUS_REQUEST = 'Responda em uma linha o que você está fazendo agora.'

export const subagentTarget = (type: string): string => `o subagente ${type}`

export const sessionTarget = (session: OtherSession): string => `a sessão em ${session.cwd}`

export const messageSent = (target: string): string => `Mensagem enviada para ${target}.`

export const messageRelayed = (target: string): string =>
  `O modo auto recusou o envio direto. A mensagem para ${target} virou um pedido na conversa.`

export const messageFailed = (target: string, reason: string): string =>
  `Não foi possível enviar a mensagem para ${target}${toastDetail(reason)}`

export const publishedSubagentText = (subagent: PublishedSubagent): string =>
  [
    statusLabel(subagent.status),
    subagent.type,
    cut(subagent.task, TASK_LIMIT),
    subagent.tool ?? NO_TOOL,
    abbreviated(subagent.tokens),
  ].join('  ')

export const timelineAlt = (bars: readonly { type: string; status: SubagentStatus }[]): string =>
  `Linha do tempo de ${bars.length} ${plural(bars.length, 'subagente', 'subagentes')}: ${bars.map(({ type, status }) => `${type} ${STATUS_WORD[status]}`).join(', ')}.`

export const OPEN_PANEL_LABEL = 'abrir painel'

const BAND_SEPARATOR = ' · '

export type BandFacts = { agent: string | null; running: number; peers: number }

export const bandText = ({ agent, running, peers }: BandFacts): string =>
  [
    agent === null ? '' : `@${agent}`,
    running === 0 ? '' : `${running} ${plural(running, 'subagente rodando', 'subagentes rodando')}`,
    peers === 0 ? '' : `${peers} ${plural(peers, 'sessão ativa', 'sessões ativas')}`,
  ]
    .filter(part => part !== '')
    .join(BAND_SEPARATOR)
