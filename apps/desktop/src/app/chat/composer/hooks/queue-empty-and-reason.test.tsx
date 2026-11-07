// Three queue failure modes found on a real MacBook (2026-11-06):
// 1. ↑/↓ out of a queued edit saved an EMPTY entry (no text, no attachment) — the explicit Save
//    refuses that, the step did not.
// 2. An empty entry can never send: submit refused it silently, the drains retried it forever and
//    no button could move it.
// 3. "Queued message not sent" never said why.
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { useBackgroundQueueDrain } from '@/app/session/hooks/use-background-queue-drain'
import {
  $parkedQueueSessions,
  $queuedPromptsBySession,
  enqueueQueuedPrompt,
  getQueuedPrompts,
  logQueuedSubmitFailure,
  MAX_AUTO_DRAIN_ATTEMPTS
} from '@/store/composer-queue'
import { $notifications, clearNotifications } from '@/store/notifications'
import { setSessionsLoading } from '@/store/session'
import { clearAllSessionStates } from '@/store/session-states'

import type { QueueEditState } from '../composer-utils'

import { useComposerQueue } from './use-composer-queue'

const KEY = 'stored-empty-and-reason'
const IMAGE = { id: 'image:/x/print.png', kind: 'image', label: 'print.png', path: '/x/print.png' } as never

function renderQueue(onSubmit = vi.fn(async () => true), busy = false) {
  const draftRef = { current: '' }
  const queueEditRef: { current: QueueEditState | null } = { current: null }

  const hook = renderHook(
    ({ busy: isBusy }: { busy: boolean }) =>
      useComposerQueue({
        activeQueueSessionKey: KEY,
        attachments: [],
        busy: isBusy,
        clearDraft: () => {
          draftRef.current = ''
        },
        draftRef,
        focusInput: () => undefined,
        loadIntoComposer: (text: string) => {
          draftRef.current = text
        },
        onCancel: vi.fn(),
        onSteer: undefined,
        onSubmit,
        queueEditRef,
        queueSessionKey: KEY,
        sessionId: 'rt-empty-and-reason'
      }),
    { initialProps: { busy } }
  )

  return { draftRef, hook, onSubmit }
}

beforeEach(() => {
  window.localStorage.clear()
  $queuedPromptsBySession.set({})
  $parkedQueueSessions.set({})
  clearNotifications()
  clearAllSessionStates()
  setSessionsLoading(false)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  $queuedPromptsBySession.set({})
  clearNotifications()
  setSessionsLoading(true)
})

it('stepping out of a queued edit with an empty composer keeps the entry intact', () => {
  enqueueQueuedPrompt(KEY, { attachments: [], text: 'first' })
  enqueueQueuedPrompt(KEY, { attachments: [IMAGE], text: '' })
  const { hook } = renderQueue(
    vi.fn(async () => true),
    true
  )
  const second = getQueuedPrompts(KEY)[1]!

  act(() => hook.result.current.beginQueuedEdit(second))
  act(() => {
    hook.result.current.stepQueuedEdit(-1)
  })

  const after = getQueuedPrompts(KEY).find(entry => entry.id === second.id)!
  expect(after.attachments).toHaveLength(1)
})

it('the foreground drain removes an empty entry with a notice instead of retrying it', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  enqueueQueuedPrompt(KEY, { attachments: [], text: '' })
  enqueueQueuedPrompt(KEY, { attachments: [], text: 'next' })
  const { onSubmit } = renderQueue()

  await waitFor(() => expect(getQueuedPrompts(KEY)).toEqual([]))
  expect(onSubmit).toHaveBeenCalledTimes(1)
  expect(onSubmit).toHaveBeenCalledWith('next', expect.anything())
  expect($notifications.get().some(n => n.title === 'Empty queued message removed')).toBe(true)
})

function BackgroundHarness({ submitText }: { submitText: () => Promise<boolean> }) {
  useBackgroundQueueDrain({
    enabled: true,
    runtimeIdByStoredSessionIdRef: { current: new Map() },
    selectedStoredSessionId: 'another-session',
    submitText
  })

  return null
}

it('the background drain removes an empty entry with a notice instead of retrying it', async () => {
  enqueueQueuedPrompt(KEY, { attachments: [], text: '   ' })
  const submitText = vi.fn(async () => true)

  render(<BackgroundHarness submitText={submitText} />)

  await waitFor(() => expect(getQueuedPrompts(KEY)).toEqual([]))
  expect(submitText).not.toHaveBeenCalled()
  expect($notifications.get().some(n => n.title === 'Empty queued message removed')).toBe(true)
})

it('the background drain removes an empty entry even after its retry budget was spent', async () => {
  enqueueQueuedPrompt(KEY, { attachments: [], text: '' })
  const [entry] = getQueuedPrompts(KEY)
  $queuedPromptsBySession.set({ [KEY]: [{ ...entry!, drainFailures: MAX_AUTO_DRAIN_ATTEMPTS }] })
  const submitText = vi.fn(async () => true)

  render(<BackgroundHarness submitText={submitText} />)

  await waitFor(() => expect(getQueuedPrompts(KEY)).toEqual([]))
  expect(submitText).not.toHaveBeenCalled()
})

it('the give-up notice says why the queued message failed', async () => {
  vi.useFakeTimers()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  enqueueQueuedPrompt(KEY, { attachments: [], text: 'with a pdf' })

  const onSubmit = vi.fn(async () => {
    logQueuedSubmitFailure('submit-error', { message: 'Could not read board.pdf' })

    return false
  })

  renderQueue(onSubmit)

  await act(async () => {
    await Promise.resolve()
  })

  for (let attempt = 1; attempt < MAX_AUTO_DRAIN_ATTEMPTS; attempt++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
  }

  expect(onSubmit).toHaveBeenCalledTimes(MAX_AUTO_DRAIN_ATTEMPTS)
  const stuck = $notifications.get().find(n => n.title === 'Queued message not sent')
  expect(stuck?.message).toContain('Could not read board.pdf')
})
