import { useStore } from '@nanostores/react'

import { $narrowChatZones } from '../narrow-chat-zones'

/** The chat zones a phone keeps off screen beside zone `groupId`, each with
 *  its shown tabs: a phone shows one chat zone per split (tree-split.tsx), so
 *  this zone's compact picker reaches the others' tabs. Empty without the
 *  compact picker; `$narrowChatZones` is empty unless narrow, so wide windows
 *  never re-render on it. */
export function useOtherChatZones(groupId: string, compactTabs: boolean, paneShown: (id: string) => boolean) {
  const chatZones = useStore($narrowChatZones)

  return compactTabs
    ? chatZones
        .filter(zone => zone.id !== groupId)
        .map(zone => ({ id: zone.id, panes: zone.panes.filter(paneShown) }))
        .filter(zone => zone.panes.length > 0)
    : []
}
