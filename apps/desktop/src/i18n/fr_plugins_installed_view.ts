import type { PluginsInstalledViewTranslations } from './types_plugins_installed_view'

/** Plugins tab: the Installed / Discover views and the installed list. */
export const frPluginsInstalledView: PluginsInstalledViewTranslations = {
  viewInstalled: 'Installés',
  viewDiscover: 'Découvrir',
  noInstalledMatch: 'Aucun plugin installé ne correspond à cette recherche.',
  detailsToggle: (name: string) => `Détails : ${name}`
}
