import type { PluginsInstalledViewTranslations } from './types_plugins_installed_view'

/** Plugins tab: the Installed / Discover views and the installed list. */
export const zhHantPluginsInstalledView: PluginsInstalledViewTranslations = {
  viewInstalled: '已安裝',
  viewDiscover: '探索',
  noInstalledMatch: '沒有符合此搜尋的已安裝外掛程式。',
  detailsToggle: (name: string) => `詳細資料：${name}`
}
