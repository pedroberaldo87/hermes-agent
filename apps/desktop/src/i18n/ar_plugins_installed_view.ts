import type { PluginsInstalledViewTranslations } from './types_plugins_installed_view'

/** Plugins tab: the Installed / Discover views and the installed list. */
export const arPluginsInstalledView: PluginsInstalledViewTranslations = {
  viewInstalled: 'المثبتة',
  viewDiscover: 'استكشاف',
  noInstalledMatch: 'لا توجد إضافة مثبتة تطابق هذا البحث.',
  detailsToggle: (name: string) => `التفاصيل: ${name}`
}
