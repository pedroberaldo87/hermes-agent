/**
 * A full page (Capabilities/Messaging/Artifacts/a contributed route) opens as
 * its own tab, which every door has to FRONT — otherwise a main zone parked on
 * a session tile keeps the tile on screen and the click looks dead (#72602).
 *
 * Three doors, all covered here: `syncWorkspaceRoute` (the router location,
 * every entry point), `navigateToWorkspacePage` (sidebar/keybinds/palette, and
 * the re-click, where the location doesn't change) and `host.navigate`.
 * page-tabs.test.tsx covers the tab itself on a real layout tree.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { registry } from '@/contrib/registry'
import { host } from '@/sdk'
import { $routeTiles, closeRouteTile, routeTilePaneId } from '@/store/route-tiles'

import {
  $workspaceIsPage,
  appViewForPath,
  ARTIFACTS_ROUTE,
  CAPABILITIES_ROUTE,
  MESSAGING_ROUTE,
  navigateToWorkspacePage,
  NEW_CHAT_ROUTE,
  routePathname,
  ROUTES_AREA,
  routeSessionId,
  sessionRoute,
  SETTINGS_ROUTE,
  syncWorkspaceRoute
} from './routes'

vi.mock('@/components/pane-shell/tree/store', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  noteActiveTreeGroup: vi.fn(),
  revealTreePane: vi.fn()
}))

const { noteActiveTreeGroup, revealTreePane } = await import('@/components/pane-shell/tree/store')

const CONTRIBUTED_ROUTE = '/kanban'

function contributeRoute(): () => void {
  return registry.register({
    area: ROUTES_AREA,
    data: { path: CONTRIBUTED_ROUTE },
    id: 'test-route',
    render: () => null
  })
}

/** Did the page's tab get fronted? Both calls, or the tab stays put. */
const fronted = (path: string) =>
  vi.mocked(revealTreePane).mock.calls.some(([pane]) => pane === routeTilePaneId(path)) &&
  vi.mocked(noteActiveTreeGroup).mock.calls.some(([group]) => group === null)

beforeEach(() => {
  vi.mocked(revealTreePane).mockClear()
  vi.mocked(noteActiveTreeGroup).mockClear()
  $workspaceIsPage.set(false)
})

afterEach(() => {
  $workspaceIsPage.set(false)

  for (const tile of $routeTiles.get()) {
    closeRouteTile(tile.path)
  }
})

describe('routePathname', () => {
  it('keeps a bare path and drops a query or hash', () => {
    expect(routePathname(CAPABILITIES_ROUTE)).toBe('/capabilities')
    expect(routePathname('/capabilities?tab=connectors')).toBe('/capabilities')
    expect(routePathname('/capabilities?tab=connectors&server=ctx7')).toBe('/capabilities')
    expect(routePathname('/settings#keys')).toBe('/settings')
  })

  it('leaves an encoded session id alone', () => {
    const route = sessionRoute('a?b#c')

    expect(routePathname(route)).toBe(route)
    expect(routeSessionId(route)).toBe('a?b#c')
  })
})

describe('classification of targets carrying a query', () => {
  // The palette navigates to every one of these (Capabilities tabs, MCP
  // servers), and Settings redirects old /settings?tab=mcp deep links to the
  // last one. Unstripped, they parsed as SESSION ids and read as 'chat'.
  it.each([
    [`${CAPABILITIES_ROUTE}?tab=skills`, 'capabilities'],
    [`${CAPABILITIES_ROUTE}?tab=connectors&server=ctx7`, 'capabilities'],
    [`${SETTINGS_ROUTE}?tab=keys`, 'settings']
  ])('%s is not a session route', (to, view) => {
    expect(routeSessionId(to)).toBeNull()
    expect(appViewForPath(to)).toBe(view)
  })
})

describe('syncWorkspaceRoute', () => {
  it('fronts the page tab and bounces the router to the chat', () => {
    syncWorkspaceRoute(sessionRoute('sess-a'))

    expect(syncWorkspaceRoute(CAPABILITIES_ROUTE)).toBe(sessionRoute('sess-a'))
    expect($workspaceIsPage.get()).toBe(false)
    expect(fronted(CAPABILITIES_ROUTE)).toBe(true)
  })

  it('carries the query into the tab', () => {
    syncWorkspaceRoute(CAPABILITIES_ROUTE, '?tab=connectors')

    expect(fronted(CAPABILITIES_ROUTE)).toBe(true)
    expect($routeTiles.get()).toEqual([{ dir: 'center', path: CAPABILITIES_ROUTE, search: '?tab=connectors' }])
  })

  it('fronts when moving between two pages', () => {
    syncWorkspaceRoute(ARTIFACTS_ROUTE)
    vi.mocked(revealTreePane).mockClear()
    vi.mocked(noteActiveTreeGroup).mockClear()

    syncWorkspaceRoute(MESSAGING_ROUTE)

    expect(fronted(MESSAGING_ROUTE)).toBe(true)
  })

  it('fronts on a contributed page route', () => {
    const dispose = contributeRoute()

    try {
      syncWorkspaceRoute(CONTRIBUTED_ROUTE)

      expect(appViewForPath(CONTRIBUTED_ROUTE)).toBe('extension')
      expect(fronted(CONTRIBUTED_ROUTE)).toBe(true)
    } finally {
      dispose()
    }
  })

  it.each([
    ['a session route', sessionRoute('sess-a')],
    ['the new-chat route', NEW_CHAT_ROUTE],
    ['an overlay', SETTINGS_ROUTE],
    ['an overlay with a query', `${SETTINGS_ROUTE}?tab=keys`]
  ])('leaves the tabs alone on %s', (_label, to) => {
    expect(syncWorkspaceRoute(to)).toBeNull()
    expect(revealTreePane).not.toHaveBeenCalled()
  })
})

describe('navigateToWorkspacePage', () => {
  it('fronts the page tab without moving the router, so a re-click still shows it', () => {
    const navigate = vi.fn()

    navigateToWorkspacePage(navigate, CAPABILITIES_ROUTE)
    navigateToWorkspacePage(navigate, CAPABILITIES_ROUTE)

    expect(navigate).not.toHaveBeenCalled()
    expect(fronted(CAPABILITIES_ROUTE)).toBe(true)
    expect($routeTiles.get()).toHaveLength(1)
  })

  it('navigates without fronting for chat and overlay targets', () => {
    const navigate = vi.fn()

    navigateToWorkspacePage(navigate, sessionRoute('sess-a'))
    navigateToWorkspacePage(navigate, SETTINGS_ROUTE)

    expect(navigate).toHaveBeenCalledTimes(2)
    expect(revealTreePane).not.toHaveBeenCalled()
  })
})

/**
 * `host.navigate` is the only nav door a plugin has (Kanban's ⌘K row, statusbar
 * count, ⌘⌥N). A page opens (or fronts) its tab without touching the hash.
 */
describe('host.navigate', () => {
  it('fronts the contributed page tab, even when it is already open', () => {
    const dispose = contributeRoute()

    try {
      window.location.hash = `#${sessionRoute('sess-a')}`
      host.navigate(CONTRIBUTED_ROUTE)
      vi.mocked(revealTreePane).mockClear()
      vi.mocked(noteActiveTreeGroup).mockClear()

      host.navigate(CONTRIBUTED_ROUTE)

      expect(window.location.hash).toBe(`#${sessionRoute('sess-a')}`)
      expect(fronted(CONTRIBUTED_ROUTE)).toBe(true)
    } finally {
      dispose()
    }
  })

  it('does not front anything for a chat route', () => {
    host.navigate(sessionRoute('sess-a'))

    expect(revealTreePane).not.toHaveBeenCalled()
  })
})
