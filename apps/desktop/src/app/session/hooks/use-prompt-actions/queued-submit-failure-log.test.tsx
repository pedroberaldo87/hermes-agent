// A queue drain swallows most refusals as a bare `false`, and desktop.log keeps only renderer
// `console.error` lines. Without a `[queue-drain]` line, "Queued message not sent" has no
// recorded cause on disk.
import { JsonRpcGatewayError } from '@hermes/shared'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { en } from '@/i18n/en'
import { logQueuedSubmitFailure } from '@/store/composer-queue'
import {
  $connection,
  setActiveSessionId,
  setAwaitingResponse,
  setBusy,
  setMessages,
  setSelectedStoredSessionId,
  setSessions
} from '@/store/session'
import { clearAllSessionStates } from '@/store/session-states'
import { makeSessionInfo } from '@/test/session-info'

import { useSessionStateCache } from '../use-session-state-cache'

import { useSubmitPrompt } from './submit'
import { clearSubmitInFlight } from './utils'

const STORED = '20261106_163416_e7db13'
const RUNTIME = 'runtime-1'

function mount(promptSubmit: () => Promise<unknown>) {
  const request = vi.fn(async (method: string) => (method === 'prompt.submit' ? promptSubmit() : {}))

  const hook = renderHook(() => {
    const busyRef = useRef(false)

    const cache = useSessionStateCache({
      activeSessionId: RUNTIME,
      selectedStoredSessionId: STORED,
      busyRef,
      setMessages,
      setBusy,
      setAwaitingResponse
    })

    const submit = useSubmitPrompt({
      ...cache,
      busyRef,
      copy: en.desktop,
      createBackendSessionForSend: async () => null,
      getRoutedStoredSessionId: () => STORED,
      getRouteToken: () => `/${STORED}`,
      requestGateway: request as Parameters<typeof useSubmitPrompt>[0]['requestGateway'],
      resumeStoredSession: async () => undefined,
      syncAttachmentsForSubmit: async (sessionId, attachments) => ({ sessionId, attachments })
    })

    return { cache, submit }
  })

  act(() => {
    hook.result.current.cache.updateSessionState(RUNTIME, state => state, STORED)
  })

  return hook
}

const refused = () =>
  Promise.reject(
    new JsonRpcGatewayError('The gateway is running a turn in this chat', { code: 4090, data: { reason: 'x' } })
  )

const queueLines = (spy: { mock: { calls: unknown[][] } }): string[] =>
  spy.mock.calls.map(call => String(call[0])).filter(line => line.startsWith('[queue-drain]'))

beforeEach(() => {
  window.localStorage.clear()
  clearAllSessionStates()
  clearSubmitInFlight()
  setMessages([])
  setBusy(false)
  setAwaitingResponse(false)
  setActiveSessionId(RUNTIME)
  setSelectedStoredSessionId(STORED)
  setSessions([makeSessionInfo({ id: STORED, source: 'gui', message_count: 4 })])
  $connection.set({
    mode: 'local',
    connectionId: 'local',
    profile: 'default',
    baseUrl: 'http://127.0.0.1:1',
    wsUrl: 'ws://127.0.0.1:1/api/ws?native_dial=1',
    token: '',
    logs: [],
    isFullscreen: false,
    nativeOverlayWidth: 0,
    windowButtonPosition: null
  })
})

afterEach(() => {
  cleanup()
  clearAllSessionStates()
  setSessions([])
  $connection.set(null)
  vi.restoreAllMocks()
})

it('logs why a queued send was refused, without the queued words', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const hook = mount(refused)
  let ok: boolean | undefined

  await act(async () => {
    ok = await hook.result.current.submit('my private words', {
      fromQueue: true,
      sessionId: RUNTIME,
      storedSessionId: STORED,
      submission_id: 'sub-1'
    })
  })

  expect(ok).toBe(false)
  const [line, ...rest] = queueLines(errors)
  expect(rest).toEqual([])
  expect(line).toContain('submit-error')
  expect(line).toContain('4090')
  expect(line).not.toContain('my private words')
})

it('keeps a typed (non-queued) send out of the queue log', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const hook = mount(refused)

  await act(async () => {
    await hook.result.current.submit('typed words')
  })

  expect(queueLines(errors)).toEqual([])
})

it('logs a queued send dropped by the per-session submit lock', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const pending: ((value: unknown) => void)[] = []
  const release = (value: unknown) => pending.splice(0).forEach(resolve => resolve(value))
  const hook = mount(() => new Promise(resolve => pending.push(resolve)))
  let first: Promise<boolean> | undefined
  let second: boolean | undefined

  await act(async () => {
    first = hook.result.current.submit('one', {
      fromQueue: true,
      sessionId: RUNTIME,
      storedSessionId: STORED,
      submission_id: 'a'
    })
    // The lock is taken before prompt.submit goes out: once it is in flight, the lock is held.
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    second = await hook.result.current.submit('two', {
      fromQueue: true,
      sessionId: RUNTIME,
      storedSessionId: STORED,
      submission_id: 'b'
    })
    release({ submission_id: 'a', session_id: RUNTIME, status: 'started' })
    await first
  })

  expect(second).toBe(false)
  expect(queueLines(errors).some(line => line.includes('submit-in-flight'))).toBe(true)
})

it('formats one parseable line', () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  logQueuedSubmitFailure('attempt-failed', { attempt: 2, max: 4 })
  expect(errors).toHaveBeenCalledWith('[queue-drain] attempt-failed {"attempt":2,"max":4}')
})
