import { useContributions } from '@/contrib/react/use-contributions'
import { pluginSettingsRouteHref, SETTINGS_PLUGINS_AREA } from '@/contrib/settings-pages'

import type { PluginPackage } from './plugin-packages'

/** Settings live in Settings ▸ Plugins: a manifest `config_schema` gets an
 *  automatic page there, a desktop half may register its own (#46600,
 *  #87934). Returns the opener for this package's page, or null when it has
 *  none. The link carries `scope`: Settings keeps its own profile scope, and
 *  without the hand-off the page would open (and save) that one instead. */
export function usePackageSettings(pkg: PluginPackage, scope: null | string): (() => void) | null {
  const settingsPages = useContributions(SETTINGS_PLUGINS_AREA)
  const { agent, desktop } = pkg
  const desktopSettings = Boolean(desktop && settingsPages.some(page => page.source === `plugin:${desktop.id}`))
  const agentKey = agent?.settings_schema?.length ? agent.key : undefined

  if (!desktopSettings && !agentKey) {
    return null
  }

  // A desktop page absorbs the package's schema form as a sub-page, so its
  // plugin id is the one entry that covers both halves.
  const route = desktopSettings ? { plugin: desktop!.id } : { agent: agentKey! }

  return () => {
    window.location.hash = `#${pluginSettingsRouteHref(route, scope)}`
  }
}

/** Which half Uninstall removes, or null when the package can't be removed
 *  from here. Only what lives under the profile's plugins dir ("user", or
 *  "git" when it was cloned there) can go: bundled plugins are refused by the
 *  backend and entrypoint (pip-installed) ones go with their package. A
 *  STANDALONE desktop plugin (a folder in desktop-plugins with no agent
 *  package behind it) is deleted by Electron; a unified package's desktop half
 *  is pruned with its agent half. */
export function packageRemoval(pkg: PluginPackage): 'agent' | 'desktop' | null {
  const { agent, desktop } = pkg

  if (agent) {
    return agent.source === 'user' || agent.source === 'git' ? 'agent' : null
  }

  return desktop?.kind === 'disk' && !desktop.packageName ? 'desktop' : null
}
