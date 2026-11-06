import { atom, onMount } from 'nanostores'
import type { ReactNode } from 'react'

import { findGroupOfPane } from '@/components/pane-shell/tree/model'
import { $layoutTree, noteActiveTreeGroup, revealTreePane } from '@/components/pane-shell/tree/store'
import { registry } from '@/contrib/registry'
import type { Contribution } from '@/contrib/types'
import type { InterfaceTier } from '@/store/interface-mode'
import { openRouteTile, routeTilePaneId } from '@/store/route-tiles'

type NavigateLike = (to: string, options?: { replace?: boolean }) => void

export const SESSION_ROUTE_PREFIX = '/'
export const NEW_CHAT_ROUTE = '/'
export const SETTINGS_ROUTE = '/settings'
export const COMMAND_CENTER_ROUTE = '/command-center'
export const SESSION_IMPORT_ROUTE = '/session-import'
export const CAPABILITIES_ROUTE = '/capabilities'
export const MESSAGING_ROUTE = '/messaging'
export const WEBHOOKS_ROUTE = '/webhooks'
export const ARTIFACTS_ROUTE = '/artifacts'
export const CRON_ROUTE = '/cron'
export const PROFILES_ROUTE = '/profiles'
export const AGENTS_ROUTE = '/agents'
export const STARMAP_ROUTE = '/starmap'

export type AppView =
  | 'session-import'
  | 'agents'
  | 'artifacts'
  | 'capabilities'
  | 'chat'
  | 'command-center'
  | 'cron'
  // A contributed (plugin) full page at its own route — NOT chat. Without this
  // distinction contributed paths fell through appViewForPath's 'chat' default,
  // so the sidebar kept a session highlighted and the titlebar kept the
  // session-title dropdown while a plugin page was showing.
  | 'extension'
  | 'messaging'
  | 'profiles'
  | 'settings'
  | 'starmap'
  | 'webhooks'

export type AppRouteId =
  | 'session-import'
  | 'agents'
  | 'artifacts'
  | 'capabilities'
  | 'command-center'
  | 'cron'
  | 'messaging'
  | 'new'
  | 'profiles'
  | 'settings'
  | 'starmap'
  | 'webhooks'

export interface AppRoute {
  id: AppRouteId
  path: string
  view: AppView
}

export const APP_ROUTES = [
  { id: 'session-import', path: SESSION_IMPORT_ROUTE, view: 'session-import' },
  { id: 'new', path: NEW_CHAT_ROUTE, view: 'chat' },
  { id: 'settings', path: SETTINGS_ROUTE, view: 'settings' },
  { id: 'command-center', path: COMMAND_CENTER_ROUTE, view: 'command-center' },
  { id: 'capabilities', path: CAPABILITIES_ROUTE, view: 'capabilities' },
  { id: 'messaging', path: MESSAGING_ROUTE, view: 'messaging' },
  { id: 'webhooks', path: WEBHOOKS_ROUTE, view: 'webhooks' },
  { id: 'artifacts', path: ARTIFACTS_ROUTE, view: 'artifacts' },
  { id: 'cron', path: CRON_ROUTE, view: 'cron' },
  { id: 'profiles', path: PROFILES_ROUTE, view: 'profiles' },
  { id: 'agents', path: AGENTS_ROUTE, view: 'agents' },
  { id: 'starmap', path: STARMAP_ROUTE, view: 'starmap' }
] as const satisfies readonly AppRoute[]

const APP_VIEW_BY_PATH = new Map<string, AppView>(APP_ROUTES.map(route => [route.path, route.view]))
const RESERVED_PATHS: ReadonlySet<string> = new Set(APP_ROUTES.map(route => route.path))

// ── Contributed routes — the `routes` registry area ─────────────────────────
// A contribution mounts a FULL PAGE in the workspace pane at `data.path`
// (`render` on the contribution itself, like every other area). Contributed
// paths are reserved exactly like APP_ROUTES so the session-id parser never
// mistakes them for a session route. Navigate with `host.navigate(path)`.

export const ROUTES_AREA = 'routes'

/** Payload of a `routes` contribution's `data`. */
export interface RouteContribution {
  /** Absolute path, e.g. `/kanban`. One segment; no params. */
  path: string
}

/** Bumps whenever the `routes` area mutates. For non-React consumers that
 *  derive from `contributedRoutes()` outside a render (paneMirror titles):
 *  hand it to `also` so a plugin route registering after its tile opened
 *  re-syncs the tab title. Subscribes to the registry only while listened to. */
export const $routesVersion = atom(0)
onMount($routesVersion, () => registry.subscribeArea(ROUTES_AREA, () => $routesVersion.set($routesVersion.get() + 1)))

// React consumers must pass their `useContributions(ROUTES_AREA)` snapshot in:
// with React Compiler enabled, an independently-called `contributedRoutes()`
// can stay memoized across a late registration the subscription DID deliver.
export function contributedRoutes(
  contributions: readonly Contribution[] = registry.getArea(ROUTES_AREA)
): Array<{ key: string; path: string; title?: string; render: () => ReactNode }> {
  return contributions
    .map(c => ({
      key: `${c.source ?? 'core'}:${c.id}`,
      path: (c.data as RouteContribution | undefined)?.path ?? '',
      title: c.title,
      render: c.render!
    }))
    .filter(route => Boolean(route.path.startsWith('/') && route.render) && !RESERVED_PATHS.has(route.path))
}

function isContributedPath(pathname: string): boolean {
  return contributedRoutes().some(route => route.path === pathname)
}

// ── Contributed sidebar nav — the `sidebar.nav` registry area ────────────────
// A DATA contribution adds a row to the sidebar's top nav (below Artifacts).
// Pair with a ROUTES_AREA page: the row navigates to `path` and lights up
// while the app is there.

export const SIDEBAR_NAV_AREA = 'sidebar.nav'

/** Payload of a `sidebar.nav` data contribution. */
export interface SidebarNavContribution {
  /** Codicon name, e.g. `'project'`. */
  codicon: string
  label: string
  /** Route to navigate to (usually a contributed page's path). */
  path: string
  /** `'advanced'` keeps the row out of Simple mode; unset shows it everywhere. */
  tier?: InterfaceTier
}

// ── Contributed profile-group header — the `sidebar.profileGroup.header` area ─
// A RENDER contribution mounted at the top of each gateway/profile group in the
// Sessions sidebar (above its session rows) while the group is expanded. The
// contribution's `data` is a `ProfileGroupHeaderContribution`; core calls
// `render(route)` with the group's connection + profile so one contribution
// serves every group. First consumer: the Bots plugin's Screen portal.

export const SIDEBAR_PROFILE_GROUP_HEADER_AREA = 'sidebar.profileGroup.header'

export interface ProfileGroupRoute {
  connectionId: null | string
  profile: string
}

/** Payload of a `sidebar.profileGroup.header` data contribution. */
export interface ProfileGroupHeaderContribution {
  render: (route: ProfileGroupRoute) => ReactNode
}

// Views that render as a full-screen modal card (OverlayView) over the shell.
// While one is open the app's titlebar control clusters must hide so they don't
// bleed over the overlay (they sit at a higher z-index than the overlay card).
export const OVERLAY_VIEWS: ReadonlySet<AppView> = new Set([
  'session-import',
  'agents',
  'command-center',
  'cron',
  'profiles',
  'settings',
  'starmap',
  'webhooks'
])

export function isOverlayView(view: AppView): boolean {
  return OVERLAY_VIEWS.has(view)
}

/** True when TitlebarControls may hide the app's fixed tool clusters.
 *  Overlays already own the window (clusters AND titleBar slots unmount).
 *  Contributed full pages (`extension`) hide the app clusters only while the
 *  page actually mounts `titleBar.*` chrome — those slots are mount-scoped, so
 *  a plugin page with no titlebar contribution keeps the app controls.
 *  First-party workspace pages (capabilities/messaging/artifacts) keep the clusters. */
export function hidesFixedTitlebarClusters(view: AppView): boolean {
  return isOverlayView(view) || view === 'extension'
}

/** The pathname of a router target. Every classifier below reasons about a
 *  PATH, but callers navigate to full targets (`/capabilities?tab=connectors`), and an
 *  unstripped query reaches the session-id parser — `/capabilities?tab=connectors` reads
 *  as the session `skills?tab=connectors`, so Capabilities classifies as a chat.
 *  `sessionRoute` percent-encodes ids, so `?`/`#` can only start a query or a
 *  hash. */
export function routePathname(to: string): string {
  const cut = to.search(/[?#]/)

  return cut === -1 ? to : to.slice(0, cut)
}

export function isNewChatRoute(pathname: string): boolean {
  return routePathname(pathname) === NEW_CHAT_ROUTE
}

export function routeSessionId(pathname: string): string | null {
  const path = routePathname(pathname)

  if (!path.startsWith(SESSION_ROUTE_PREFIX) || RESERVED_PATHS.has(path) || isContributedPath(path)) {
    return null
  }

  const id = path.slice(SESSION_ROUTE_PREFIX.length)

  return id && !id.includes('/') ? decodeURIComponent(id) : null
}

/**
 * The primary composer's durable scope key candidate: the route is the source
 * of truth for which chat is on screen, so prefer its (stable) stored session
 * id over a store selection that can be momentarily null/stale mid-switch
 * (#59305). A genuine new-chat route always wins with `null`, never falling
 * back to a leftover selection from the chat just left. A non-chat route
 * (settings, an overlay) has no session opinion, so the store selection passes
 * through unchanged.
 */
export function primaryRouteSelectedSessionId(pathname: string, storeSelectedSessionId: string | null): string | null {
  if (isNewChatRoute(pathname)) {
    return null
  }

  return routeSessionId(pathname) ?? storeSelectedSessionId
}

export function sessionRoute(sessionId: string): string {
  return `${SESSION_ROUTE_PREFIX}${encodeURIComponent(sessionId)}`
}

export function appViewForPath(pathname: string): AppView {
  const path = routePathname(pathname)

  if (isNewChatRoute(path) || routeSessionId(path)) {
    return 'chat'
  }

  if (isContributedPath(path)) {
    return 'extension'
  }

  return APP_VIEW_BY_PATH.get(path) ?? 'chat'
}

/** Does `to` land on a full page rendered INSIDE the workspace pane
 *  (skills/messaging/artifacts/contributed routes)? Overlays don't count —
 *  they float over whatever the workspace is already showing. */
export function isWorkspacePageRoute(to: string): boolean {
  const view = appViewForPath(to)

  return view !== 'chat' && !isOverlayView(view)
}

/** True while the workspace pane shows a FULL PAGE instead of the chat.
 *  Pages now open as their own tab (`openWorkspacePage`) and the router is
 *  bounced back to the chat, so this stays false; its readers (headerVeto,
 *  close-tab, focus keys) keep their chat behaviour. Overlays never count. */
export const $workspaceIsPage = atom(false)

function revealWorkspacePane(): void {
  noteActiveTreeGroup(null)
  revealTreePane('workspace')
}

/** The chat route the workspace showed last (a session, or `/` for a draft).
 *  Pages open as their own tab and never replace the chat, so a navigation
 *  that lands the router on a page bounces it back here (see
 *  `syncWorkspaceRoute`). Overlays and pages never write it. */
export const $lastChatRoute = atom<string>(NEW_CHAT_ROUTE)

/** Page-owned controls (kanban's board switcher) projected into the workspace
 *  panel's tab-header space while `$workspaceIsPage` holds — the page's title
 *  row, not the native band. Distinct from `titleBar.*`, whose slots stay
 *  mounted on every route so plugin components never remount on navigation. */
export const WORKSPACE_PAGE_HEADER_AREA = 'workspace.pageHeader'

/**
 * Open the page at `to` (a page route, optionally with its query) as its OWN
 * tab in the main zone, next to the session, and front it. A page used to
 * render inside the `workspace` pane and take over the session's tab; now the
 * session stays where it was and the page is a tab you close with its ×.
 * Already open: the tab is fronted and takes `to`'s query (a deep link into
 * another Capabilities tab reuses it).
 */
export function openWorkspacePage(to: string): void {
  const path = routePathname(to)
  const query = to.slice(path.length).split('#')[0] ?? ''

  noteActiveTreeGroup(null)
  openRouteTile(path, 'center', query)
  revealTreePane(routeTilePaneId(path))
}

/**
 * Point the workspace at the router location. Returns the chat route to
 * bounce the router back to when the location is a PAGE (Capabilities,
 * Messaging, Artifacts, a contributed route): the page opens as its own tab
 * (`openWorkspacePage`) and the session keeps the main tab. Null otherwise.
 *
 * The router location drives this, so every entry point gets it without opting
 * in: sidebar, keybinds, command palette, Command Center, contributed
 * statusbar/titlebar `to` targets, `#/capabilities?…` links, back/forward,
 * cold-start restore — and a page in a tab writing its own URL state, which
 * lands here as `path?query` and becomes that tab's query.
 */
export function syncWorkspaceRoute(pathname: string, search = ''): null | string {
  if (isWorkspacePageRoute(pathname)) {
    openWorkspacePage(`${routePathname(pathname)}${search}`)

    return $lastChatRoute.get() || NEW_CHAT_ROUTE
  }

  if ($workspaceIsPage.get()) {
    $workspaceIsPage.set(false)
  }

  if (appViewForPath(pathname) === 'chat') {
    $lastChatRoute.set(routePathname(pathname))
  }

  return null
}

/**
 * Front the session tab of the main zone when a page tab covers it. The
 * sidebar's SESSIONS tab uses this: clicking it while Plugins is on screen
 * used to leave Plugins there. False (no-op) when the zone already shows a
 * session, so a click never moves a tab the user is reading.
 */
export function showSessionTab(): boolean {
  const tree = $layoutTree.get()
  const zone = tree ? findGroupOfPane(tree, 'workspace') : null

  if (!zone?.active?.startsWith(routeTilePaneId(''))) {
    return false
  }

  revealWorkspacePane()

  return true
}

/**
 * Navigate to `to`; a page route opens (or fronts) its own tab instead and
 * leaves the router on the session. Use it wherever a nav affordance can be
 * triggered from the page it targets: the re-click changes no location, so
 * only this imperative open fronts the tab.
 */
export function navigateToWorkspacePage(navigate: NavigateLike, to: string, options?: { replace?: boolean }): void {
  if (isWorkspacePageRoute(to)) {
    openWorkspacePage(to)

    return
  }

  navigate(to, options)
}
