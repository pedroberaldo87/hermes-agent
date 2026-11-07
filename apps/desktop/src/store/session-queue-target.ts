import type { SessionInfo } from '@/types/hermes'

import {
  forgetSessionOwnerHintsForConnection,
  idsShareLineage,
  sessionMatchesStoredId,
  sessionOwnerHintConnectionIds
} from './session'

// Queued-prompt routing kept out of session.ts (already at its size budget).

/**
 * The live stored id a queued prompt should be SENT to.
 *
 * A queue is keyed on the lineage root ({@link resolveComposerSessionKey}) so
 * compression never strands it, but the root is a frozen snapshot: sending
 * there re-resumes the original segment, misses the tip's runtime binding, and
 * resolves the root's owner — which may name a connection that no longer
 * exists. Every drain re-targets the root onto the conversation's current tip:
 * the selected id when it is the same conversation, else the listed row's live
 * id. Unknown keys pass through unchanged.
 */
export function liveStoredSessionIdForQueueKey(
  queueKey: string,
  sessions: readonly Pick<SessionInfo, '_lineage_ids' | '_lineage_root_id' | 'id'>[],
  selectedStoredSessionId?: null | string
): string {
  if (selectedStoredSessionId && idsShareLineage(queueKey, selectedStoredSessionId, sessions)) {
    return selectedStoredSessionId
  }

  return sessions.find(session => sessionMatchesStoredId(session, queueKey))?.id ?? queueKey
}

/** Drop every hint whose connection is absent from a fresh registry snapshot.
 *  `forgetSessionOwnerHintsForConnection` only runs on a live removal event;
 *  a connection removed while the app was closed (connections.json edited, a
 *  source replaced by another URL) left its hints behind, and every session
 *  they name then fails to resume with "No connection with id" — including a
 *  queued prompt's drain, which aborts silently. An empty snapshot proves
 *  nothing and is ignored; the built-in `local` source is never pruned. */
export function pruneSessionOwnerHintsToConnections(connectionIds: readonly string[]): number {
  const known = new Set(connectionIds.map(id => id.trim()).filter(Boolean))

  if (known.size === 0) {
    return 0
  }

  known.add('local')

  const stale = sessionOwnerHintConnectionIds().filter(id => !known.has(id))

  for (const id of new Set(stale)) {
    forgetSessionOwnerHintsForConnection(id)
  }

  return stale.length
}
