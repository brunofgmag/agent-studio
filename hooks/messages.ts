import type { AgentSource, SkippedFile } from '../types'

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
  tools: readonly string[] | undefined
  disallowedTools: readonly string[] | undefined
}

const DESCRIPTION_LIMIT = 80

const PROMPT_SWAP = 'depois de um /clear ou de uma compactação'

const SOURCE_LABEL: Record<AgentSource, string> = { project: 'projeto', user: 'usuário' }

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

const cut = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length <= DESCRIPTION_LIMIT ? flat : `${flat.slice(0, DESCRIPTION_LIMIT - 1).trimEnd()}…`
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

export const catalogList = (agents: readonly ListedAgent[], skipped: readonly SkippedFile[]): string => {
  if (agents.length === 0) {
    return ['Nenhum agente encontrado em .claude/agents.', ...skippedLines(skipped)].join('\n')
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
