import type { Contribution } from '@/contrib/types'

import { isSessionStripPane } from '../store'

import { paneChrome } from './track-model'

export interface ZoneNewTab {
  label: string
  onSelect: () => void
}

interface ZoneNewTabInput {
  activeId: string
  labels: { newSessionTab: string; newTab: string }
  newSessionTabAction: (() => void) | null
  paneFor: (id: string) => Contribution | undefined
  shown: readonly string[]
}

/** What a zone strip's "+" makes. The pane you are LOOKING AT answers first (a
 *  Browser tab makes another Browser, even stacked into the chat strip), then
 *  the chat "+" for any zone holding session tabs, then any other tenant that
 *  can mint its own kind — that last rung is what keeps the button from
 *  blinking out when you click a file tab sitting beside a Browser. */
export function zoneNewTab({ activeId, labels, newSessionTabAction, paneFor, shown }: ZoneNewTabInput): null | ZoneNewTab {
  const ownNewTab = (id: string) => {
    const mint = paneChrome(paneFor(id)).newTab

    return mint ? { label: labels.newTab, onSelect: mint } : null
  }

  return (
    ownNewTab(activeId) ??
    (shown.some(isSessionStripPane) && newSessionTabAction
      ? { label: labels.newSessionTab, onSelect: newSessionTabAction }
      : null) ??
    shown.map(ownNewTab).find(Boolean) ??
    null
  )
}
