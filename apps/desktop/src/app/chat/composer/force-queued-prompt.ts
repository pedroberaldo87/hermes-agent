import { randomUuid } from '@hermes/shared'

import { $queuedPromptsBySession, getQueuedPrompts, type QueuedPromptEntry } from '@/store/composer-queue'
import { readPendingSubmissions } from '@/store/pending-submissions'

/** One owner-routed RPC of the queue's session (already bound to its owner and request transport). */
export type OwnedCall = (method: string, params: Record<string, unknown>) => Promise<unknown>

/**
 * Why a server row cannot be forced right now. `lost`: an `unknown` turn pauses the owner's FIFO
 * until it is discarded, so nothing behind it runs. `fixed-ahead`: a row ahead of it carries what a
 * replacement cannot (attachments, hidden notes), so it cannot be moved behind the forced row.
 */
export type ForceBlock = 'fixed-ahead' | 'lost' | null

export type ForceOutcome =
  | { status: 'forced' }
  | { status: 'refused'; reason: 'fixed-ahead' | 'lost' | 'moved' | 'not-queued' }
  | { status: 'failed'; error: unknown }

const serverRows = (entries: QueuedPromptEntry[]) => entries.filter(entry => Boolean(entry.serverStatus))

const movable = (entry: QueuedPromptEntry) => Boolean(entry.serverControls?.includes('replace'))

/** Whether `id` can be forced, and the rows that must move behind it (in their current order). */
function forcePlan(entries: QueuedPromptEntry[], id: string): { block: ForceBlock; move: QueuedPromptEntry[] } {
  const rows = serverRows(entries)

  if (rows.some(entry => entry.serverStatus === 'unknown')) {
    return { block: 'lost', move: [] }
  }

  const queued = rows.filter(entry => entry.serverStatus === 'queued')
  const index = queued.findIndex(entry => entry.id === id)
  const ahead = queued.slice(0, Math.max(0, index))
  const behind = queued.slice(index + 1)

  if (ahead.some(entry => !movable(entry))) {
    return { block: 'fixed-ahead', move: [] }
  }

  // The rows ahead go behind the forced one. The rows behind it follow them when every one can move,
  // so the others keep their order; a fixed row behind stays put and the movable ones go after it.
  // Already first: nothing moves.
  if (ahead.length === 0) {
    return { block: null, move: [] }
  }

  return { block: null, move: behind.every(movable) ? [...ahead, ...behind] : ahead }
}

export const forceBlock = (entries: QueuedPromptEntry[], id: string): ForceBlock => forcePlan(entries, id).block

const refusalReason = (error: unknown): string | undefined => {
  const data = (error as { data?: { reason?: unknown } } | null)?.data

  return typeof data?.reason === 'string' ? data.reason : undefined
}

interface Receipt {
  execution_generation?: unknown
  status?: unknown
}

/** The generation of the turn running now, read from the owner: the one Stop may end. The pending
 *  journal names the admissions last seen `started`; the owner's receipt says which still runs. */
async function runningGeneration(call: OwnedCall, sessionId: string, queueSessionKey: string): Promise<null | number> {
  const started = Object.values(readPendingSubmissions(queueSessionKey)).filter(entry => entry.status === 'started')

  for (const entry of started) {
    const receipt = (await call('prompt.receipt', { session_id: sessionId, admission_id: entry.id }).catch(
      () => null
    )) as null | Receipt

    if (receipt?.status === 'started' && typeof receipt.execution_generation === 'number') {
      return receipt.execution_generation
    }
  }

  return null
}

/**
 * Make a server-queued row the next thing the agent reads, now. The owner keeps one FIFO and has no
 * reorder verb, so the rows ahead are re-admitted behind it (`prompt.replace_queued`: cancel + admit
 * at the tail in one owner write, same text), then the running turn is stopped. The owner's drain
 * then claims the forced row. No text ever leaves the owner, so nothing can be lost on the way.
 *
 * The Stop names the generation running when the force began: if that turn ended meanwhile the
 * owner refuses it as `stale_generation`, and the forced row (already first) is never the one cut.
 */
export async function forceQueuedPrompt({
  call,
  entries,
  id,
  queueSessionKey,
  sessionId
}: {
  call: OwnedCall
  entries: QueuedPromptEntry[]
  id: string
  queueSessionKey: string
  sessionId: string
}): Promise<ForceOutcome> {
  const target = entries.find(entry => entry.id === id)

  if (target?.serverStatus !== 'queued') {
    return { status: 'refused', reason: 'not-queued' }
  }

  const { block, move } = forcePlan(entries, id)

  if (block) {
    return { status: 'refused', reason: block }
  }

  const generation = await runningGeneration(call, sessionId, queueSessionKey)

  for (const entry of move) {
    try {
      await call('prompt.replace_queued', {
        session_id: sessionId,
        admission_id: entry.id,
        submission_id: randomUuid(),
        text: entry.text
      })
    } catch (error) {
      // The FIFO moved under the force (a row ahead started): stopping now would cut that row, not
      // make room for this one. Nothing is lost: every row is still queued or running.
      return refusalReason(error) === 'admission_started'
        ? { status: 'refused', reason: 'moved' }
        : { status: 'failed', error }
    }
  }

  if (generation === null) {
    // No running turn found: re-check the forced row before the bare Stop (the protocol then names the
    // newest generation it saw), so an idle owner that already claimed it is never stopped.
    const receipt = (await call('prompt.receipt', { session_id: sessionId, admission_id: id }).catch(
      () => null
    )) as null | Receipt

    if (receipt?.status !== 'queued') {
      return { status: 'forced' }
    }
  }

  try {
    await call('session.interrupt', {
      session_id: sessionId,
      ...(generation === null ? {} : { execution_generation: generation })
    })
  } catch (error) {
    // The turn ended between the read and the Stop: the forced row is first, so it runs next.
    if (refusalReason(error) !== 'stale_generation') {
      return { status: 'failed', error }
    }
  }

  return { status: 'forced' }
}

/** Server rows of a queue now: the baseline a force-send compares against to find its own row. */
export const serverRowIds = (queueSessionKey: string): Set<string> =>
  new Set(getQueuedPrompts(queueSessionKey).flatMap(entry => (entry.serverStatus ? [entry.id] : [])))

/**
 * The server row a just-confirmed force-send admitted. The owner names an admission by its own id
 * (not the submission id the composer chose), so the row is the new queued one carrying the sent
 * text that was not there before the send. Resolves null when it never shows up (already claimed
 * by an idle owner, or the listing never arrived): then there is nothing left to force.
 */
export function waitForNewServerRow(
  queueSessionKey: string,
  before: Set<string>,
  text: string,
  timeoutMs = 10_000
): Promise<null | QueuedPromptEntry> {
  const find = () =>
    getQueuedPrompts(queueSessionKey).find(
      entry => entry.serverStatus === 'queued' && !before.has(entry.id) && entry.text === text
    ) ?? null

  const found = find()

  if (found) {
    return Promise.resolve(found)
  }

  return new Promise(resolve => {
    const timer = setTimeout(() => {
      unsubscribe()
      resolve(null)
    }, timeoutMs)

    const unsubscribe = $queuedPromptsBySession.listen(() => {
      const row = find()

      if (row) {
        clearTimeout(timer)
        unsubscribe()
        resolve(row)
      }
    })
  })
}
