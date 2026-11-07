// A queued send that THROWS (instead of returning false) was swallowed by the drain's `.catch`:
// desktop.log got only `attempt-failed`, never the cause. Both drains now log `submit-threw`.
import { cleanup, render, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { useBackgroundQueueDrain } from '@/app/session/hooks/use-background-queue-drain'
import { $parkedQueueSessions, $queuedPromptsBySession, enqueueQueuedPrompt } from '@/store/composer-queue'
import { setSessionsLoading } from '@/store/session'
import { clearAllSessionStates } from '@/store/session-states'

import { useComposerQueue } from './use-composer-queue'

const KEY = 'stored-throw-log'

const queueLines = (spy: { mock: { calls: unknown[][] } }): string[] =>
  spy.mock.calls.map(call => String(call[0])).filter(line => line.startsWith('[queue-drain]'))

const boom = () => Promise.reject(new TypeError('cannot read previewUrl of undefined'))

function BackgroundHarness({ submitText }: { submitText: () => Promise<boolean> }) {
  useBackgroundQueueDrain({
    enabled: true,
    runtimeIdByStoredSessionIdRef: { current: new Map() },
    selectedStoredSessionId: 'another-session',
    submitText
  })

  return null
}

beforeEach(() => {
  window.localStorage.clear()
  $queuedPromptsBySession.set({})
  $parkedQueueSessions.set({})
  clearAllSessionStates()
  setSessionsLoading(false)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  $queuedPromptsBySession.set({})
  setSessionsLoading(true)
})

it('logs the thrown cause of a foreground drain, without the queued words', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  enqueueQueuedPrompt(KEY, { attachments: [], text: 'private queued words' })
  const draftRef = { current: '' }

  renderHook(() =>
    useComposerQueue({
      activeQueueSessionKey: KEY,
      attachments: [],
      busy: false,
      clearDraft: () => undefined,
      draftRef,
      focusInput: () => undefined,
      loadIntoComposer: () => undefined,
      onCancel: vi.fn(),
      onSteer: undefined,
      onSubmit: boom,
      queueEditRef: { current: null },
      queueSessionKey: KEY,
      sessionId: 'rt-throw-log'
    })
  )

  await waitFor(() => expect(queueLines(errors).some(line => line.includes('submit-threw'))).toBe(true))
  const line = queueLines(errors).find(l => l.includes('submit-threw'))!
  expect(line).toContain('"where":"foreground"')
  expect(line).toContain('cannot read previewUrl of undefined')
  expect(queueLines(errors).join('\n')).not.toContain('private queued words')
})

it('logs the thrown cause of a background drain', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  enqueueQueuedPrompt(KEY, { attachments: [], text: 'private queued words' })

  render(<BackgroundHarness submitText={boom} />)

  await waitFor(() => expect(queueLines(errors).some(line => line.includes('"where":"background"'))).toBe(true))
  expect(queueLines(errors).join('\n')).not.toContain('private queued words')
})
