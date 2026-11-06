import type { PluginsInstalledViewTranslations } from './types_plugins_installed_view'

/** Plugins tab: the Installed / Discover views and the installed list. */
export const esPluginsInstalledView: PluginsInstalledViewTranslations = {
  viewInstalled: 'Instalados',
  viewDiscover: 'Descubrir',
  noInstalledMatch: 'Ningún plugin instalado coincide con esta búsqueda.',
  detailsToggle: (name: string) => `Detalles: ${name}`
}
