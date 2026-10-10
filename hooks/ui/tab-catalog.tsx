import type { RenderElement } from 'claude-code'

import type { CatalogAgent, CatalogView, ModelSwitch } from '../../types'
import * as messages from '../messages'
import type { PaneElements } from './pane'
import { drawActionRow } from './row'

export type CatalogTabView = {
  hasLauncher: boolean
  catalog: CatalogView | null
  pendingUse: string | null
}

export type CatalogTabActions = {
  use: (name: string) => void
}

const rowOf = (agent: CatalogAgent, pending: ModelSwitch | undefined) => {
  const parts = messages.catalogRow(agent)

  return pending === undefined ? parts : { ...parts, description: messages.modelChanges(pending.from, pending.to) }
}

const drawAgent = (
  elements: PaneElements,
  agent: CatalogAgent,
  canUse: boolean,
  pendingUse: string | null,
  actions: CatalogTabActions,
) => {
  const { Box, Button } = elements
  const pending = pendingUse === agent.name ? agent.modelSwitch : undefined
  const use = canUse ? (
    <Button
      key={`use-${agent.name}`}
      label={pending === undefined ? messages.USE_LABEL : messages.CONFIRM_LABEL}
      onPress={() => actions.use(agent.name)}
    />
  ) : undefined

  return <Box marginTop={1}>{drawActionRow(elements, rowOf(agent, pending), use)}</Box>
}

const drawCatalog = (
  elements: PaneElements,
  { agents, skipped, native }: CatalogView,
  pendingUse: string | null,
  actions: CatalogTabActions,
): RenderElement => {
  const { Box, Text } = elements
  const canUse = native === null

  return (
    <Box flexDirection="column">
      {canUse ? null : <Text>{messages.nativeSession(native)}</Text>}
      {agents.length === 0 ? (
        <Text>{messages.noAgentsFound}</Text>
      ) : (
        <Box flexDirection="column">
          <Text bold>{messages.catalogHeading(agents.length)}</Text>
          {agents.map(agent => drawAgent(elements, agent, canUse, pendingUse, actions))}
        </Box>
      )}
      {skipped === 0 ? null : (
        <Box marginTop={1}>
          <Text dimColor>{messages.catalogSkipped(skipped)}</Text>
        </Box>
      )}
    </Box>
  )
}

export const drawCatalogTab = (elements: PaneElements, view: CatalogTabView, actions: CatalogTabActions): RenderElement => {
  const { Text } = elements

  if (!view.hasLauncher) {
    return <Text>{messages.launcherOff}</Text>
  }

  return view.catalog === null ? <Text>{messages.catalogUnreadable}</Text> : drawCatalog(elements, view.catalog, view.pendingUse, actions)
}
