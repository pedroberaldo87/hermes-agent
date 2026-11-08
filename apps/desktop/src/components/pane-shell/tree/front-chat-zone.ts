/**
 * The phone's front chat zone. Its own leaf module so the store can note it
 * without the narrow-only derived stores (narrow-chat-zones.ts) living in the
 * store too.
 */

import { atom } from 'nanostores'

import { findGroup, type LayoutNode } from './model'

/** The CHAT zone (one hosting session-strip panes) the user last worked in or
 *  had a chat revealed into. A phone shows one chat zone per split and this is
 *  the one it picks (tree-split.tsx). Render-only and never persisted: the
 *  layout keeps its split, so a window widened past the breakpoint gets it
 *  back untouched. */
export const $frontChatZone = atom<null | string>(null)

/** Front `groupId` when it is a chat zone of `tree` — one holding a pane
 *  `isChatPane` accepts (the store passes `isSessionStripPane`). */
export function noteFrontChatZone(
  tree: LayoutNode | null,
  groupId: null | string,
  isChatPane: (paneId: string) => boolean
) {
  const group = tree && groupId ? findGroup(tree, groupId) : null

  if (group?.panes.some(isChatPane) && group.id !== $frontChatZone.get()) {
    $frontChatZone.set(group.id)
  }
}
