import { atom } from 'nanostores'

import { readJson, writeJson } from '@/lib/storage'

import type { TileDock } from './session-states'

/**
 * Route (page) tiles — a full-page view (Capabilities / Messaging / Artifacts,
 * or any plugin route) rendered as its own layout-tree pane: a tab next to the
 * session in the main zone (`center`, how every page opens) or a split beside
 * it ("Open in split"). The page never takes over the session's tab. Persisted
 * by path so they re-open on boot.
 */
export interface RouteTile {
  /** The route path this tile renders, e.g. `/capabilities`. */
  path: string
  /** Where to dock against main on adoption (default right; `center` = a tab
   *  in main's zone). */
  dir?: TileDock
  /** The page's own query (`?tab=plugins`): a tile is not the router
   *  location, so its URL state lives here. */
  search?: string
}

/** Pane id of the tile rendering `path`. */
export const routeTilePaneId = (path: string) => `route-tile:${path}`

const TILES_KEY = 'hermes.desktop.routeTiles.v1'

function loadTiles(): RouteTile[] {
  const parsed = readJson<unknown>(TILES_KEY)

  return Array.isArray(parsed)
    ? parsed
        .filter((t): t is RouteTile => Boolean(t && typeof (t as RouteTile).path === 'string'))
        .map(t => ({ dir: t.dir, path: t.path, search: typeof t.search === 'string' ? t.search : undefined }))
    : []
}

export const $routeTiles = atom<RouteTile[]>(loadTiles())

function saveTiles(tiles: RouteTile[]) {
  $routeTiles.set(tiles)
  writeJson(TILES_KEY, tiles.length === 0 ? null : tiles)
}

/** Open a page tile for a route, docked on `dir` (default right). An
 *  already-open tile keeps its original dock; a given `search` replaces its
 *  query (a deep link into another Capabilities tab reuses the open tab). */
export function openRouteTile(path: string, dir: TileDock = 'right', search?: string) {
  const tiles = $routeTiles.get()
  const open = tiles.find(t => t.path === path)

  if (!open) {
    saveTiles([...tiles, { dir, path, ...(search ? { search } : {}) }])
  } else if (search !== undefined && (open.search ?? '') !== search) {
    saveTiles(tiles.map(t => (t === open ? { ...t, search: search || undefined } : t)))
  }
}

export function closeRouteTile(path: string) {
  saveTiles($routeTiles.get().filter(t => t.path !== path))
}
