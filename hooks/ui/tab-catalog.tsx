import type { RenderElement } from 'claude-code'

import type { CatalogAgent, CatalogView } from '../../types'
import * as messages from '../messages'
import type { PaneElements } from './pane'

export type CatalogTabView = {
  hasLauncher: boolean
  catalog: CatalogView | null
}

export type CatalogTabActions = {
  use: (name: string) => void
}

const drawAgent = (
  { Box, Text, Button }: PaneElements,
  agent: CatalogAgent,
  canUse: boolean,
  actions: CatalogTabActions,
) => (
  <Box flexDirection="column" marginTop={1}>
    <Text>{messages.catalogRowText(agent)}</Text>
    {canUse ? <Button key={`use-${agent.name}`} label={messages.USE_LABEL} onPress={() => actions.use(agent.name)} /> : null}
  </Box>
)

const drawCatalog = (
  elements: PaneElements,
  { agents, skipped, native }: CatalogView,
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
          {agents.map(agent => drawAgent(elements, agent, canUse, actions))}
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

  return view.catalog === null ? <Text>{messages.catalogUnreadable}</Text> : drawCatalog(elements, view.catalog, actions)
}
