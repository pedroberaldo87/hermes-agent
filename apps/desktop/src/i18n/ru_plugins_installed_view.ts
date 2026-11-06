import type { PluginsInstalledViewTranslations } from './types_plugins_installed_view'

/** Plugins tab: the Installed / Discover views and the installed list. */
export const ruPluginsInstalledView: PluginsInstalledViewTranslations = {
  viewInstalled: 'Установленные',
  viewDiscover: 'Обзор',
  noInstalledMatch: 'Нет установленных плагинов, подходящих под этот поиск.',
  detailsToggle: (name: string) => `Подробности: ${name}`
}
