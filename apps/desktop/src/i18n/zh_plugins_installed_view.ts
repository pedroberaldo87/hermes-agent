import type { PluginsInstalledViewTranslations } from './types_plugins_installed_view'

/** Plugins tab: the Installed / Discover views and the installed list. */
export const zhPluginsInstalledView: PluginsInstalledViewTranslations = {
  viewInstalled: '已安装',
  viewDiscover: '发现',
  noInstalledMatch: '没有与此搜索匹配的已安装插件。',
  detailsToggle: (name: string) => `详情：${name}`
}
