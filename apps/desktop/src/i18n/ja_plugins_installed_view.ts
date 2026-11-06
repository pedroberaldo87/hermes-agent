import type { PluginsInstalledViewTranslations } from './types_plugins_installed_view'

/** Plugins tab: the Installed / Discover views and the installed list. */
export const jaPluginsInstalledView: PluginsInstalledViewTranslations = {
  viewInstalled: 'インストール済み',
  viewDiscover: '見つける',
  noInstalledMatch: 'この検索に一致するインストール済みプラグインはありません。',
  detailsToggle: (name: string) => `詳細: ${name}`
}
