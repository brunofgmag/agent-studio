import type { RenderElement } from 'claude-code'

import type { CatalogAgent, CatalogView, ModelSwitch } from '../../types'
import type { Messages } from '../messages'
import type { PaneElements } from './pane'
import { type Room, type RowAction, drawActionRow } from './row'

export type CatalogTabView = {
  hasLauncher: boolean
  catalog: CatalogView | null
  pendingUse: string | null
  room: Room
}

export type CatalogTabActions = {
  use: (name: string) => void
}

const rowOf = (messages: Messages, agent: CatalogAgent, pending: ModelSwitch | undefined) => {
  const parts = messages.catalogRow(agent)

  return pending === undefined
    ? parts
    : { ...parts, description: messages.modelChanges(pending.from, pending.to), isNotice: true }
}

const drawAgent = (
  elements: PaneElements,
  messages: Messages,
  agent: CatalogAgent,
  canUse: boolean,
  pendingUse: string | null,
  room: Room,
  actions: CatalogTabActions,
) => {
  const { Box, Button } = elements
  const pending = pendingUse === agent.name ? agent.modelSwitch : undefined
  const label = pending === undefined ? messages.USE_LABEL : messages.CONFIRM_LABEL
  const use: RowAction | undefined = canUse
    ? { label, element: <Button key={`use-${agent.name}`} label={label} onPress={() => actions.use(agent.name)} /> }
    : undefined

  return <Box marginTop={1}>{drawActionRow(elements, rowOf(messages, agent, pending), room, use)}</Box>
}

const drawCatalog = (
  elements: PaneElements,
  messages: Messages,
  { agents, skipped, native }: CatalogView,
  pendingUse: string | null,
  room: Room,
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
          {agents.map(agent => drawAgent(elements, messages, agent, canUse, pendingUse, room, actions))}
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

export const drawCatalogTab = (
  elements: PaneElements,
  messages: Messages,
  view: CatalogTabView,
  actions: CatalogTabActions,
): RenderElement => {
  const { Text } = elements

  if (!view.hasLauncher) {
    return <Text>{messages.launcherOff}</Text>
  }

  return view.catalog === null ? <Text>{messages.catalogUnreadable}</Text> : drawCatalog(elements, messages, view.catalog, view.pendingUse, view.room, actions)
}
