import { useStore } from '@nanostores/react'

import { $botChatScopes } from '@/store/bot-chat-scope'
import { $sessionTiles, type SessionTile, type SessionTileWorkspaceScope } from '@/store/session-states'

/**
 * The Bot Mode owner a session was opened for, if any: the tab's own scope,
 * else the scope main remembers for it (main has no tile to carry one). A
 * Sessions-scope tab has no owner. The key is opaque — nothing reads a name
 * out of it.
 */
export function workspaceOwnerKeyFor(
  storedSessionId: null | string | undefined,
  tiles: readonly Pick<SessionTile, 'storedSessionId' | 'workspaceMode' | 'workspaceOwnerKey'>[],
  botChatScopes: Readonly<Record<string, Pick<SessionTileWorkspaceScope, 'workspaceMode' | 'workspaceOwnerKey'>>>
): string | undefined {
  if (!storedSessionId) {
    return undefined
  }

  const scope = tiles.find(tile => tile.storedSessionId === storedSessionId) ?? botChatScopes[storedSessionId]

  return scope?.workspaceMode === 'bots' ? scope.workspaceOwnerKey || undefined : undefined
}

export function useWorkspaceOwnerKey(storedSessionId: null | string | undefined): string | undefined {
  return workspaceOwnerKeyFor(storedSessionId, useStore($sessionTiles), useStore($botChatScopes))
}
