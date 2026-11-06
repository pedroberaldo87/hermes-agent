/**
 * Pages (Capabilities/Plugins, Messaging, Artifacts, plugin pages) open as
 * their OWN tab in the main zone, next to the session. They used to render
 * inside the session's tab and take it over: the session vanished until you
 * found a way back, and clicking SESSIONS left the page on screen.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { RouteTilePane, watchRouteTiles } from '@/app/chat/route-tile'
import { findGroupOfPane, group } from '@/components/pane-shell/tree/model'
import { TreeGroup } from '@/components/pane-shell/tree/renderer/tree-group'
import * as tree from '@/components/pane-shell/tree/store'
import { registry } from '@/contrib/registry'
import { host } from '@/sdk'
import { $routeTiles, closeRouteTile, routeTilePaneId } from '@/store/route-tiles'
import { stubResizeObserver } from '@/test/jsdom'

import {
  $lastChatRoute,
  CAPABILITIES_ROUTE,
  navigateToWorkspacePage,
  NEW_CHAT_ROUTE,
  ROUTES_AREA,
  sessionRoute,
  SETTINGS_ROUTE,
  syncWorkspaceRoute
} from '../routes'

import { ContribWiringContext } from './context'
import { useWorkspaceRouteSync } from './hooks/use-workspace-route-sync'
import type { WiringApi } from './types'

await import('./controller')

const CAPS_TAB = routeTilePaneId(CAPABILITIES_ROUTE)

const mainZone = () => {
  const root = tree.$layoutTree.get()

  return root ? findGroupOfPane(root, 'workspace') : null
}

const activeInMain = () => mainZone()?.active
const tileSearch = (path: string) => $routeTiles.get().find(t => t.path === path)?.search ?? ''

beforeAll(() => {
  const dispose = registry.register({
    area: 'panes',
    data: { placement: 'main', uncloseable: true },
    id: 'workspace',
    render: () => null,
    title: 'Chat'
  })

  tree.watchContributedPanes()
  watchRouteTiles()

  return dispose
})

beforeEach(() => {
  window.localStorage.clear()
  window.location.hash = ''
  tree.declareDefaultTree(group(['workspace'], { active: 'workspace', id: 'main' }))
  tree.$layoutTree.set(group(['workspace'], { active: 'workspace', id: 'main' }))
  $lastChatRoute.set(NEW_CHAT_ROUTE)
  syncWorkspaceRoute(sessionRoute('session-a'))
})

afterEach(() => {
  cleanup()

  for (const tile of $routeTiles.get()) {
    closeRouteTile(tile.path)
  }

  vi.unstubAllGlobals()
})

describe('a page route', () => {
  it('opens as its own tab beside the session and sends the router back to the session', () => {
    const bounceTo = syncWorkspaceRoute(CAPABILITIES_ROUTE, '?tab=plugins')

    expect(bounceTo).toBe(sessionRoute('session-a'))
    expect(mainZone()?.panes).toEqual(expect.arrayContaining(['workspace', CAPS_TAB]))
    expect(activeInMain()).toBe(CAPS_TAB)
    expect(tileSearch(CAPABILITIES_ROUTE)).toBe('?tab=plugins')
  })

  it('fronts the tab it already has, taking the new query, instead of opening a second one', () => {
    syncWorkspaceRoute(CAPABILITIES_ROUTE, '?tab=plugins')
    act(() => tree.revealTreePane('workspace'))

    syncWorkspaceRoute(CAPABILITIES_ROUTE, '?tab=connectors')

    expect($routeTiles.get()).toHaveLength(1)
    expect(activeInMain()).toBe(CAPS_TAB)
    expect(tileSearch(CAPABILITIES_ROUTE)).toBe('?tab=connectors')
  })

  it('leaves the router alone on chat and overlay routes', () => {
    expect(syncWorkspaceRoute(sessionRoute('session-b'))).toBeNull()
    expect(syncWorkspaceRoute(SETTINGS_ROUTE)).toBeNull()
    expect($routeTiles.get()).toEqual([])
    expect($lastChatRoute.get()).toBe(sessionRoute('session-b'))
  })

  it('bounces the real router back to the session, with the page in its tab', async () => {
    let at = ''

    function Probe() {
      useWorkspaceRouteSync()
      const location = useLocation()
      at = `${location.pathname}${location.search}`

      return null
    }

    render(
      <MemoryRouter initialEntries={[`${CAPABILITIES_ROUTE}?tab=plugins`]}>
        <Probe />
      </MemoryRouter>
    )

    await waitFor(() => expect(at).toBe(sessionRoute('session-a')))
    expect(activeInMain()).toBe(CAPS_TAB)
    expect(tileSearch(CAPABILITIES_ROUTE)).toBe('?tab=plugins')
  })
})

describe('nav doors open the tab without touching the router', () => {
  it('navigateToWorkspacePage (sidebar, keybinds, palette)', () => {
    const navigate = vi.fn()

    navigateToWorkspacePage(navigate, `${CAPABILITIES_ROUTE}?tab=plugins`)

    expect(navigate).not.toHaveBeenCalled()
    expect(activeInMain()).toBe(CAPS_TAB)
    expect(tileSearch(CAPABILITIES_ROUTE)).toBe('?tab=plugins')
  })

  it('host.navigate (plugins)', () => {
    const dispose = registry.register({
      area: ROUTES_AREA,
      data: { path: '/kanban' },
      id: 'kanban',
      render: () => null
    })

    try {
      window.location.hash = `#${sessionRoute('session-a')}`
      host.navigate('/kanban')

      expect(window.location.hash).toBe(`#${sessionRoute('session-a')}`)
      expect(activeInMain()).toBe(routeTilePaneId('/kanban'))
    } finally {
      dispose()
    }
  })

  it('still navigates chat targets', () => {
    const navigate = vi.fn()

    navigateToWorkspacePage(navigate, sessionRoute('session-b'))

    expect(navigate).toHaveBeenCalledWith(sessionRoute('session-b'), undefined)
    expect($routeTiles.get()).toEqual([])
  })
})

describe('the page in its tab', () => {
  it('reads its own query, not the session route the router is on', () => {
    function Page() {
      const { pathname, search } = useLocation()

      return <span data-testid="page-location">{`${pathname}${search}`}</span>
    }

    const dispose = registry.register({
      area: ROUTES_AREA,
      data: { path: '/atlas' },
      id: 'atlas',
      render: () => <Page />
    })

    try {
      syncWorkspaceRoute('/atlas', '?view=map')

      render(
        <MemoryRouter initialEntries={[sessionRoute('session-a')]}>
          <RouteTilePane path="/atlas" />
        </MemoryRouter>
      )

      expect(screen.getByTestId('page-location').textContent).toBe('/atlas?view=map')
    } finally {
      dispose()
    }
  })
})

describe('SESSIONS tab', () => {
  const clickSessions = () => {
    vi.stubGlobal('CSS', { escape: (value: string) => value })
    stubResizeObserver()

    const disposeBots = registry.register({
      area: 'panes',
      data: { placement: 'left', hideOnly: true },
      id: 'probe:bots',
      render: () => null,
      title: 'Bots'
    })

    try {
      const { container } = render(
        <ContribWiringContext.Provider value={{ sidebar: null } as unknown as WiringApi}>
          <TreeGroup
            leftEdge
            node={{ active: 'sessions', id: 'side-zone', panes: ['sessions', 'probe:bots'], type: 'group' }}
            rightEdge
          />
        </ContribWiringContext.Provider>
      )

      const tab = container.querySelector<HTMLElement>('[data-tree-tab="sessions"]')

      expect(tab).not.toBeNull()
      fireEvent.pointerDown(tab!, { button: 0, pointerId: 1 })
      fireEvent.pointerUp(window, { button: 0, pointerId: 1 })
      fireEvent.click(tab!)
    } finally {
      disposeBots()
    }
  }

  it('brings the session back to the front when a page tab covers it, even if SESSIONS is already active', () => {
    syncWorkspaceRoute(CAPABILITIES_ROUTE, '?tab=plugins')
    expect(activeInMain()).toBe(CAPS_TAB)

    clickSessions()

    expect(activeInMain()).toBe('workspace')
    expect($routeTiles.get()).toHaveLength(1)
  })

  it('leaves the main zone alone when it already shows the session', () => {
    syncWorkspaceRoute(CAPABILITIES_ROUTE, '?tab=plugins')
    act(() => tree.revealTreePane('workspace'))
    const spy = vi.spyOn(tree, 'revealTreePane')

    clickSessions()

    expect(spy).not.toHaveBeenCalled()
    expect(activeInMain()).toBe('workspace')
  })
})
