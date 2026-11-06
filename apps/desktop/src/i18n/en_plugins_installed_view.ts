import type { PluginsInstalledViewTranslations } from './types_plugins_installed_view'

/** Plugins tab: the Installed / Discover views and the installed list. */
export const enPluginsInstalledView: PluginsInstalledViewTranslations = {
  viewInstalled: 'Installed',
  viewDiscover: 'Discover',
  noInstalledMatch: 'No installed plugin matches this search.',
  detailsToggle: (name: string) => `Details: ${name}`
}
