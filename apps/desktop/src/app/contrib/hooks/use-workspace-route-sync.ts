import { useStore } from '@nanostores/react'
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { $routesVersion, syncWorkspaceRoute } from '../../routes'

/**
 * Point the workspace at the router location. A page route (Capabilities,
 * Messaging, Artifacts, a plugin page) opens as its own tab next to the
 * session and the router goes back to the chat, so a page never takes the
 * session's tab. A passive effect, not a layout one: on the first mount a
 * child's layout effect runs before the router subscribes to its history, and
 * a navigate issued there is lost (cold start on `#/capabilities` would stay
 * on the page). The nav doors (sidebar, keybinds, palette, `host.navigate`)
 * open the tab without touching the router, so only links and a page writing
 * its own URL state come through here.
 *
 * `$routesVersion` re-runs it when a plugin route registers after boot: a
 * cold start on `#/kanban` reads as a chat until the kanban route exists.
 */
export function useWorkspaceRouteSync(): void {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const routesVersion = useStore($routesVersion)

  useEffect(() => {
    const bounceTo = syncWorkspaceRoute(pathname, search)

    if (bounceTo !== null) {
      navigate(bounceTo, { replace: true })
    }
  }, [navigate, pathname, routesVersion, search])
}
