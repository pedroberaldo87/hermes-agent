import type { PluginsInstalledViewTranslations } from './types_plugins_installed_view'

/** Plugins tab: the Installed / Discover views and the installed list. */
export const dePluginsInstalledView: PluginsInstalledViewTranslations = {
  viewInstalled: 'Installiert',
  viewDiscover: 'Entdecken',
  noInstalledMatch: 'Kein installiertes Plugin passt zu dieser Suche.',
  detailsToggle: (name: string) => `Details: ${name}`
}
