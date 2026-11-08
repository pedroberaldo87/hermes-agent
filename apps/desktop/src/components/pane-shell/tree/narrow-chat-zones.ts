/**
 * Narrow-only views of the chat zones, for the renderer: a phone shows one
 * chat zone per split (tree-split.tsx) and reaches the others from the visible
 * zone's tab picker (tree-group.tsx). Both read empty/null when wide.
 */

import { computed } from 'nanostores'

import { $frontChatZone } from './front-chat-zone'
import type { LayoutNode } from './model'
import { $layoutTree, $narrowViewport, isSessionStripPane } from './store'

/** `$frontChatZone` while narrow, else null — a wide window never re-renders
 *  its splits when focus moves between chat zones. */
export const $narrowFrontChatZone = computed([$narrowViewport, $frontChatZone], (narrow, front) =>
  narrow ? front : null
)

export interface ChatZoneTabs {
  id: string
  panes: readonly string[]
}

const NO_CHAT_ZONES: readonly ChatZoneTabs[] = []
let chatZonesMemo: { key: string; zones: readonly ChatZoneTabs[] } = { key: '', zones: NO_CHAT_ZONES }

/** Every chat zone and its tabs while narrow (empty when wide). A phone hides
 *  all but one chat zone per split, so the visible zone's tab picker lists the
 *  others' tabs. Same reference until a chat zone's tab set changes, so zones
 *  re-render on that alone, not on every tree commit. */
export const $narrowChatZones = computed([$narrowViewport, $layoutTree], (narrow, tree) => {
  const zones = narrow && tree ? chatZonesOf(tree) : NO_CHAT_ZONES
  const key = zones.map(zone => `${zone.id}:${zone.panes.join(',')}`).join('|')

  if (key !== chatZonesMemo.key) {
    chatZonesMemo = { key, zones }
  }

  return chatZonesMemo.zones
})

function chatZonesOf(node: LayoutNode): ChatZoneTabs[] {
  if (node.type === 'group') {
    return node.panes.some(isSessionStripPane) ? [{ id: node.id, panes: node.panes }] : []
  }

  return node.children.flatMap(chatZonesOf)
}
