import { act, cleanup, render, waitFor } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { requestGatewayForAgent } from '@/store/gateway'
import { ensureGatewayAgent } from '@/store/profile'

import type { ClientSessionState } from '../../types'

import { useSessionActions } from './use-session-actions'

vi.mock('@/hermes', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deleteSession: vi.fn(),
  getSession: vi.fn(),
  getAllSessionMessages: vi.fn(),
  getLatestSessionMessages: vi.fn(),
  listAllProfileSessions: vi.fn(),
  setApiRequestProfile: vi.fn(),
  setSessionArchived: vi.fn()
}))

vi.mock('@/store/profile', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ensureGatewayAgent: vi.fn().mockResolvedValue(undefined),
  ensureGatewayProfile: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/store/gateway', async importOriginal => {
  const original = await importOriginal<Record<string, unknown>>()

  return {
    ...original,
    activeGatewayConnectionId: vi.fn(original.activeGatewayConnectionId as () => null | string),
    requestGatewayForAgent: vi.fn(),
    requestGatewayForProfile: vi.fn(),
    retainGatewayForAgent: vi.fn(async () => () => undefined)
  }
})

vi.mock('@/components/pane-shell/tree/store', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  noteActiveTreeGroup: vi.fn(),
  revealTreePane: vi.fn()
}))

type OpenNewSessionTile = ReturnType<typeof useSessionActions>['openNewSessionTile']

function TileHarness({
  onReady,
  requestGateway
}: {
  onReady: (open: OpenNewSessionTile) => void
  requestGateway: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
}) {
  const ref = <T,>(value: T): MutableRefObject<T> => ({ current: value })

  const actions = useSessionActions({
    activeSessionId: null,
    activeSessionIdRef: ref<null | string>(null),
    busyRef: ref(false),
    creatingSessionRef: ref(false),
    ensureSessionState: () => ({}) as ClientSessionState,
    getRouteToken: () => 'token',
    getRoutedStoredSessionId: () => null,
    navigate: vi.fn() as never,
    requestGateway,
    resetViewSync: vi.fn(),
    routedSessionId: null,
    runtimeIdByStoredSessionIdRef: ref(new Map<string, string>()),
    selectedStoredSessionId: null,
    selectedStoredSessionIdRef: ref<null | string>(null),
    sessionStateByRuntimeIdRef: ref(new Map<string, ClientSessionState>()),
    syncSessionStateToView: vi.fn(),
    updateSessionState: () => ({}) as ClientSessionState
  })

  useEffect(() => {
    onReady(actions.openNewSessionTile)
  }, [actions, onReady])

  return null
}

// The Bot Mode tab-strip "+" / ⌘T opens a side chat in the selected bot's
// profile. The create already rides that bot's route (retainGatewayForAgent +
// requestGatewayForAgent), so it must not also switch the WINDOW to the bot:
// that switch republished the active profile, the whole window refetched its
// catalogs (~50 RPCs), and session.create answered only after that burst —
// seconds per new tab. An ordinary (Sessions) routed tile keeps activating.
describe('routed tile create and the window profile', () => {
  const route = { connectionId: 'local', mode: 'local' as const, profile: 'writer', targetProfile: 'writer' }

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  const openRoutedTile = async (workspaceMode: 'bots' | 'sessions') => {
    const sent: Array<[unknown, unknown, unknown]> = []

    vi.mocked(requestGatewayForAgent).mockImplementation(async (connectionId, profile, method) => {
      if (method === 'session.create') {
        sent.push([connectionId, profile, method])

        return {
          info: { cwd: '', model: 'profile-default-model', tools: {}, skills: {} },
          session_id: 'runtime-routed-tile',
          stored_session_id: `stored-${workspaceMode}-routed-tile`
        } as never
      }

      return {} as never
    })

    const requestGateway = vi.fn(async () => ({}) as never)
    let open: OpenNewSessionTile | null = null
    render(<TileHarness onReady={value => (open = value)} requestGateway={requestGateway} />)
    await waitFor(() => expect(open).not.toBeNull())

    await act(async () => {
      await open!('center', {
        listed: false,
        route,
        workspaceScope:
          workspaceMode === 'bots'
            ? { ownerRoute: route, workspaceMode: 'bots', workspaceOwnerKey: 'bot:local::writer' }
            : { workspaceMode: 'sessions' }
      })
    })

    return { requestGateway, sent }
  }

  it('creates a Bot Mode tab on the bot route without switching the window to the bot', async () => {
    const { requestGateway, sent } = await openRoutedTile('bots')

    expect(sent).toEqual([['local', 'writer', 'session.create']])
    expect(ensureGatewayAgent).not.toHaveBeenCalled()
    expect(requestGateway).not.toHaveBeenCalledWith('session.create', expect.anything())
  })

  it('still activates the route for an ordinary routed tile', async () => {
    const { sent } = await openRoutedTile('sessions')

    expect(sent).toEqual([['local', 'writer', 'session.create']])
    expect(ensureGatewayAgent).toHaveBeenCalledWith('local', 'writer')
  })
})
