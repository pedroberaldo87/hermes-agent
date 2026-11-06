/**
 * ROUTE (PAGE) TILES — a full-page view rendered as a layout-tree pane BESIDE
 * the main thread, the page analog of session tiles. Built-in pages
 * (Capabilities / Messaging / Artifacts) render their view; plugin pages render
 * their `ROUTES_AREA` contribution. Lifecycle mirrors session tiles:
 * `openRouteTile(path)` -> `watchRouteTiles` registers a pane docked beside
 * main (or as a tab in main's zone) -> tree adoption lands it; closing removes
 * it. Every page opens this way (`openWorkspacePage`), so a page never
 * replaces the session in the main tab.
 */

import { useStore } from '@nanostores/react'
import { lazy, type ReactNode, Suspense, useMemo } from 'react'
import { Route, Routes, useInRouterContext } from 'react-router'

import { ContribBoundary, ContribRender } from '@/contrib/react/boundary'
import { useContributions } from '@/contrib/react/use-contributions'
import { $routeTiles, closeRouteTile, type RouteTile } from '@/store/route-tiles'

import {
  $routesVersion,
  ARTIFACTS_ROUTE,
  CAPABILITIES_ROUTE,
  contributedRoutes,
  MESSAGING_ROUTE,
  ROUTES_AREA
} from '../routes'

import { paneMirror } from './pane-mirror'

const CapabilitiesView = lazy(async () => ({ default: (await import('../capabilities')).CapabilitiesView }))
const MessagingView = lazy(async () => ({ default: (await import('../messaging')).MessagingView }))
const ArtifactsView = lazy(async () => ({ default: (await import('../artifacts')).ArtifactsView }))

// Built-in page views + their pane titles, keyed by route.
const BUILTIN_PAGES: Record<string, { render: () => ReactNode; title: string }> = {
  [ARTIFACTS_ROUTE]: { render: () => <ArtifactsView />, title: 'Artifacts' },
  [MESSAGING_ROUTE]: { render: () => <MessagingView />, title: 'Messaging' },
  [CAPABILITIES_ROUTE]: { render: () => <CapabilitiesView />, title: 'Capabilities' }
}

/** Humanize a route path into a tab title: `/my-atlas` → `My Atlas`. */
const humanizePath = (path: string): string =>
  path
    .replace(/^\/+/, '')
    .split(/[/-]/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ') || path

/** Title for a route tile: the built-in name, the contribution's own `title`,
 *  else a humanized path — never the internal `${source}:${id}` key. */
function routeTitle(path: string): string {
  if (BUILTIN_PAGES[path]) {
    return BUILTIN_PAGES[path].title
  }

  return contributedRoutes().find(r => r.path === path)?.title ?? humanizePath(path)
}

/** Render a page against the TILE's location (`path` + its own query), not
 *  the app router's, which stays on the session: `useLocation` / route params
 *  inside the page read the tile. A page writing its URL state navigates the
 *  app router to `path?…`; the wiring turns that back into this tile's query
 *  (see `syncWorkspaceRoute`). */
function TileLocation({ children, path }: { children: ReactNode; path: string }) {
  const search = useStore($routeTiles).find(t => t.path === path)?.search ?? ''
  const location = useMemo(
    () => ({ hash: '', key: `tile:${path}`, pathname: path, search, state: null }),
    [path, search]
  )

  // Outside a router (an isolated mount) there is no location to override.
  if (!useInRouterContext()) {
    return children
  }

  return (
    <Routes location={location}>
      <Route element={children} path="*" />
    </Routes>
  )
}

export function RouteTilePane({ path }: { path: string }) {
  return (
    <TileLocation path={path}>
      <RouteTileBody path={path} />
    </TileLocation>
  )
}

function RouteTileBody({ path }: { path: string }) {
  const builtin = BUILTIN_PAGES[path]

  // Subscribe so a plugin page tile appears the moment its route registers.
  // The snapshot feeds the lookup: under React Compiler an independently
  // called contributedRoutes() can stay memoized across that registration.
  const contributions = useContributions(ROUTES_AREA)
  const contrib = builtin ? null : contributedRoutes(contributions).find(r => r.path === path)

  if (builtin) {
    return (
      <ContribBoundary id={path}>
        <Suspense fallback={null}>
          <ContribRender render={builtin.render} />
        </Suspense>
      </ContribBoundary>
    )
  }

  if (contrib) {
    return (
      <ContribBoundary id={path}>
        <ContribRender render={contrib.render} />
      </ContribBoundary>
    )
  }

  return (
    <div className="grid h-full place-items-center font-mono text-[11px] text-(--ui-text-quaternary)">
      no page at {path}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Route tile -> pane contribution sync (call once from the app root).
// ---------------------------------------------------------------------------

/** Keep pane contributions mirroring `$routeTiles`. Call once from the root. */
export const watchRouteTiles = paneMirror<RouteTile>({
  source: $routeTiles,
  // A tile restored before its plugin route registers must pick up the
  // contribution's title once it lands, not keep the humanized-path fallback.
  also: [$routesVersion],
  key: t => t.path,
  prefix: 'route-tile',
  dir: t => t.dir,
  minWidth: '22rem',
  title: routeTitle,
  render: path => <RouteTilePane path={path} />,
  close: closeRouteTile
})
