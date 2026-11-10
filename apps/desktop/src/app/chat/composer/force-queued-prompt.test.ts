import { afterEach, describe, expect, it } from 'vitest'

import { $queuedPromptsBySession, type QueuedPromptEntry, writeSessionQueue } from '@/store/composer-queue'
import { trackPendingSubmission } from '@/store/pending-submissions'

import { forceBlock, forceQueuedPrompt, type OwnedCall, serverRowIds, waitForNewServerRow } from './force-queued-prompt'

const KEY = 'stored-session'

const row = (id: string, extra: Partial<QueuedPromptEntry> = {}): QueuedPromptEntry => ({
  attachments: [],
  id,
  queuedAt: 0,
  serverControls: ['steer', 'replace'],
  serverStatus: 'queued',
  text: `text ${id}`,
  ...extra
})

const refusal = (reason: string) => Object.assign(new Error(reason), { data: { reason } })

/** A fake owner: records every call; `running` is the generation of the turn the journal names. */
function owner({ running = 7, refuse = {} as Record<string, Error> } = {}) {
  const calls: { method: string; params: Record<string, unknown> }[] = []

  const call: OwnedCall = async (method, params) => {
    calls.push({ method, params })
    const key = `${method}:${String(params.admission_id ?? '')}`

    if (refuse[key] || refuse[method]) {
      throw refuse[key] ?? refuse[method]
    }

    if (method === 'prompt.receipt') {
      return params.admission_id === 'running'
        ? { status: 'started', execution_generation: running }
        : { status: 'queued', execution_generation: null }
    }

    return { status: 'queued' }
  }

  return {
    call,
    calls,
    methods: () => calls.map(c => `${c.method}${c.params.admission_id ? `:${c.params.admission_id}` : ''}`)
  }
}

const journalRunning = () => trackPendingSubmission(KEY, { id: 'running', status: 'started', text: 'live turn' })

afterEach(() => {
  window.localStorage.clear()
  $queuedPromptsBySession.set({})
})

describe('forceQueuedPrompt', () => {
  it('forcing the head only stops the running turn, at the generation it had', async () => {
    journalRunning()
    const fake = owner({ running: 7 })

    const outcome = await forceQueuedPrompt({
      call: fake.call,
      entries: [row('a'), row('b')],
      id: 'a',
      queueSessionKey: KEY,
      sessionId: 'sid'
    })

    expect(outcome).toEqual({ status: 'forced' })
    expect(fake.methods()).toEqual(['prompt.receipt:running', 'session.interrupt'])
    expect(fake.calls.at(-1)?.params).toEqual({ session_id: 'sid', execution_generation: 7 })
  })

  it('moves every other row behind the forced one, keeping their order, then stops the turn', async () => {
    journalRunning()
    const fake = owner()

    await forceQueuedPrompt({
      call: fake.call,
      entries: [row('a'), row('b'), row('c'), row('d')],
      id: 'c',
      queueSessionKey: KEY,
      sessionId: 'sid'
    })

    expect(fake.methods()).toEqual([
      'prompt.receipt:running',
      'prompt.replace_queued:a',
      'prompt.replace_queued:b',
      'prompt.replace_queued:d',
      'session.interrupt'
    ])
    // Same words, a fresh identity per re-admission: the owner never reads it as a retry.
    const replaced = fake.calls.filter(c => c.method === 'prompt.replace_queued')
    expect(replaced.map(c => c.params.text)).toEqual(['text a', 'text b', 'text d'])
    expect(new Set(replaced.map(c => c.params.submission_id)).size).toBe(3)
  })

  it('a fixed row behind stays put; only the rows ahead move', async () => {
    journalRunning()
    const fake = owner()

    await forceQueuedPrompt({
      call: fake.call,
      entries: [row('a'), row('b'), row('c', { serverControls: [] })],
      id: 'b',
      queueSessionKey: KEY,
      sessionId: 'sid'
    })

    expect(fake.methods()).toEqual(['prompt.receipt:running', 'prompt.replace_queued:a', 'session.interrupt'])
  })

  it('refuses without any call when a row ahead cannot be moved', async () => {
    const fake = owner()
    const entries = [row('photo', { serverControls: [] }), row('b')]

    expect(forceBlock(entries, 'b')).toBe('fixed-ahead')
    expect(
      await forceQueuedPrompt({ call: fake.call, entries, id: 'b', queueSessionKey: KEY, sessionId: 'sid' })
    ).toEqual({
      status: 'refused',
      reason: 'fixed-ahead'
    })
    expect(fake.calls).toEqual([])
  })

  it('refuses while a lost turn pauses the FIFO', async () => {
    const fake = owner()
    const entries = [row('lost', { serverStatus: 'unknown' }), row('b')]

    expect(forceBlock(entries, 'b')).toBe('lost')
    expect(
      (await forceQueuedPrompt({ call: fake.call, entries, id: 'b', queueSessionKey: KEY, sessionId: 'sid' })).status
    ).toBe('refused')
    expect(fake.calls).toEqual([])
  })

  it('a turn that ended before the Stop is not an error: the forced row is first', async () => {
    journalRunning()
    const fake = owner({ refuse: { 'session.interrupt': refusal('stale_generation') } })

    expect(
      await forceQueuedPrompt({ call: fake.call, entries: [row('a')], id: 'a', queueSessionKey: KEY, sessionId: 'sid' })
    ).toEqual({
      status: 'forced'
    })
  })

  it('stops nothing when the FIFO moved under the force (a row ahead started)', async () => {
    journalRunning()
    const fake = owner({ refuse: { 'prompt.replace_queued:a': refusal('admission_started') } })

    const outcome = await forceQueuedPrompt({
      call: fake.call,
      entries: [row('a'), row('b')],
      id: 'b',
      queueSessionKey: KEY,
      sessionId: 'sid'
    })

    expect(outcome).toEqual({ status: 'refused', reason: 'moved' })
    expect(fake.methods()).not.toContain('session.interrupt')
  })

  it('without a journaled running turn, stops only while the forced row is still queued', async () => {
    const queued = owner()
    await forceQueuedPrompt({ call: queued.call, entries: [row('a')], id: 'a', queueSessionKey: KEY, sessionId: 'sid' })
    expect(queued.methods()).toEqual(['prompt.receipt:a', 'session.interrupt'])
    expect(queued.calls.at(-1)?.params).toEqual({ session_id: 'sid' })

    const claimed = owner()

    const started: OwnedCall = async (method, params) =>
      method === 'prompt.receipt'
        ? (claimed.calls.push({ method, params }), { status: 'started' })
        : claimed.call(method, params)

    await forceQueuedPrompt({ call: started, entries: [row('a')], id: 'a', queueSessionKey: KEY, sessionId: 'sid' })
    expect(claimed.methods()).toEqual(['prompt.receipt:a'])
  })

  it('a local row is not forced here (the panel keeps its own send-next)', async () => {
    const fake = owner()

    expect(
      await forceQueuedPrompt({
        call: fake.call,
        entries: [row('a', { serverStatus: undefined })],
        id: 'a',
        queueSessionKey: KEY,
        sessionId: 'sid'
      })
    ).toEqual({ status: 'refused', reason: 'not-queued' })
    expect(fake.calls).toEqual([])
  })
})

describe('waitForNewServerRow', () => {
  it('finds the row the force-send admitted: new, queued, same text', async () => {
    writeSessionQueue(KEY, [row('old', { text: 'same words' })])
    const before = serverRowIds(KEY)
    const found = waitForNewServerRow(KEY, before, 'same words', 1000)

    writeSessionQueue(KEY, [row('old', { text: 'same words' }), row('other', { text: 'not mine' })])
    writeSessionQueue(KEY, [
      row('old', { text: 'same words' }),
      row('other', { text: 'not mine' }),
      row('mine', { text: 'same words' })
    ])

    expect((await found)?.id).toBe('mine')
  })

  it('gives up when the row never shows (an idle owner already ran it)', async () => {
    expect(await waitForNewServerRow(KEY, new Set(), 'never', 20)).toBeNull()
  })
})
