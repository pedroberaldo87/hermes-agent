/**
 * A full page (Capabilities/Messaging/Artifacts/a plugin page) replaces the
 * chat in the workspace pane. Two doors lead back to the chat it replaced:
 * the page's own close button, and a click on the sidebar's SESSIONS tab —
 * which used to only re-front the sidebar list and left the page on screen.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TreeGroup } from '@/components/pane-shell/tree/renderer/tree-group'
import { stubResizeObserver } from '@/test/jsdom'

import { PageSearchShell } from '../page-search-shell'
import {
  $lastChatRoute,
  $workspaceIsPage,
  CAPABILITIES_ROUTE,
  leaveWorkspacePage,
  NEW_CHAT_ROUTE,
  SETTINGS_ROUTE,
  syncWorkspaceRoute
} from '../routes'

import { ContribWiringContext } from './context'
import type { WiringApi } from './types'
import { WorkspacePageHeaderHostContext } from './workspace-page-header'

const { registry } = await import('@/contrib/registry')

await import('./controller')

const hashRoute = () => window.location.hash.replace(/^#/, '')

beforeEach(() => {
  window.location.hash = ''
  $lastChatRoute.set(NEW_CHAT_ROUTE)
  $workspaceIsPage.set(false)
})

afterEach(() => {
  cleanup()
  act(() => $workspaceIsPage.set(false))
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('last chat route', () => {
  it('remembers the session a page replaced and leaves the page back to it', () => {
    syncWorkspaceRoute('/20261106_163416_e7db13')
    syncWorkspaceRoute(`${CAPABILITIES_ROUTE}?tab=plugins`)

    const navigate = vi.fn()

    expect(leaveWorkspacePage(navigate)).toBe(true)
    expect(navigate).toHaveBeenCalledWith('/20261106_163416_e7db13')
  })

  it('ignores overlays and pages when remembering the chat', () => {
    syncWorkspaceRoute('/session-a')
    syncWorkspaceRoute(SETTINGS_ROUTE)
    syncWorkspaceRoute(CAPABILITIES_ROUTE)

    expect($lastChatRoute.get()).toBe('/session-a')
  })

  it('falls back to a new session when no chat was shown yet', () => {
    syncWorkspaceRoute(CAPABILITIES_ROUTE)

    const navigate = vi.fn()

    leaveWorkspacePage(navigate)
    expect(navigate).toHaveBeenCalledWith(NEW_CHAT_ROUTE)
  })

  it('never re-navigates when the workspace already shows a chat', () => {
    syncWorkspaceRoute('/session-a')

    const navigate = vi.fn()

    expect(leaveWorkspacePage(navigate)).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('SESSIONS tab', () => {
  const sidebarZone = () => (
    <ContribWiringContext.Provider value={{ sidebar: null } as unknown as WiringApi}>
      <TreeGroup
        leftEdge
        node={{ active: 'sessions', id: 'side-zone', panes: ['sessions', 'probe:bots'], type: 'group' }}
        rightEdge
      />
    </ContribWiringContext.Provider>
  )

  it('leaves a full page back to the last chat, even when the tab is already active', () => {
    vi.stubGlobal('CSS', { escape: (value: string) => value })
    stubResizeObserver()

    const dispose = registry.register({
      area: 'panes',
      data: { placement: 'left', hideOnly: true },
      id: 'probe:bots',
      render: () => null,
      title: 'Bots'
    })

    try {
      syncWorkspaceRoute('/session-a')
      act(() => syncWorkspaceRoute(CAPABILITIES_ROUTE))

      const { container } = render(sidebarZone())
      const tab = container.querySelector<HTMLElement>('[data-tree-tab="sessions"]')

      expect(tab).not.toBeNull()
      fireEvent.pointerDown(tab!, { button: 0, pointerId: 1 })
      fireEvent.pointerUp(window, { button: 0, pointerId: 1 })
      fireEvent.click(tab!)

      expect(hashRoute()).toBe('/session-a')
    } finally {
      dispose()
    }
  })
})

describe('page close button', () => {
  const page = (hosted: boolean, closable = true): ReactNode => (
    <WorkspacePageHeaderHostContext.Provider value={hosted}>
      <PageSearchShell closable={closable} searchHidden tabs={[{ id: 'plugins', label: 'Plugins' }]}>
        body
      </PageSearchShell>
    </WorkspacePageHeaderHostContext.Provider>
  )

  it('returns to the last chat from a page in the workspace', () => {
    syncWorkspaceRoute('/session-a')
    act(() => syncWorkspaceRoute(CAPABILITIES_ROUTE))

    render(page(true))
    fireEvent.click(screen.getByTestId('page-close'))

    expect(hashRoute()).toBe('/session-a')
  })

  it('is absent outside the workspace pane and on embedded copies', () => {
    act(() => syncWorkspaceRoute(CAPABILITIES_ROUTE))

    render(
      <>
        {page(false)}
        {page(true, false)}
      </>
    )

    expect(screen.queryByTestId('page-close')).toBeNull()
  })
})
