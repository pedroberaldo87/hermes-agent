import { type ReactNode, useMemo } from 'react'

import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'

import { PanelEmpty } from '../../overlays/panel'
import { CapabilitySearch } from '../ui/capability-search'

import { packageRemoval, usePackageSettings } from './plugin-package-actions'
import type { PluginPackage } from './plugin-packages'

interface InstalledPluginsListProps {
  packages: readonly PluginPackage[]
  pending: boolean
  notice?: ReactNode
  headerActions?: ReactNode
  query?: string
  onQueryChange?: (value: string) => void
  scope: null | string
  expandedKey: null | string
  onExpandedChange: (key: null | string) => void
  busy: (pkg: PluginPackage) => boolean
  onUninstall: (pkg: PluginPackage) => void
  onDiscover: () => void
  renderSwitch: (pkg: PluginPackage) => ReactNode
  renderDetail: (pkg: PluginPackage) => ReactNode
}

const matches = (pkg: PluginPackage, needle: string) =>
  [pkg.name, pkg.key, pkg.description, pkg.agent?.key ?? ''].some(text => text.toLowerCase().includes(needle))

/** One installed package: open/close its full controls, and the three verbs a
 *  user looks for on an installed plugin (configure, uninstall, on/off) on the
 *  row itself instead of at the bottom of a detail dialog. */
function InstalledRow({
  pkg,
  scope,
  expanded,
  busy,
  onToggleExpanded,
  onUninstall,
  renderSwitch,
  renderDetail
}: {
  pkg: PluginPackage
  scope: null | string
  expanded: boolean
  busy: boolean
  onToggleExpanded: () => void
  onUninstall: () => void
  renderSwitch: (pkg: PluginPackage) => ReactNode
  renderDetail: (pkg: PluginPackage) => ReactNode
}) {
  const { t } = useI18n()
  const p = t.skills.plugins
  const openSettings = usePackageSettings(pkg, scope)
  const removable = packageRemoval(pkg) !== null
  const version = pkg.agent?.version

  return (
    <li className="border-b border-(--ui-stroke-tertiary) last:border-b-0" data-testid={`installed-plugin-${pkg.key}`}>
      <div className="flex min-h-12 items-center gap-2 px-3 py-2">
        <button
          aria-expanded={expanded}
          aria-label={p.detailsToggle(pkg.name)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={onToggleExpanded}
          type="button"
        >
          <Codicon className="shrink-0 text-(--ui-text-tertiary)" name={expanded ? 'chevron-down' : 'chevron-right'} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-[length:var(--conversation-text-font-size)] font-medium text-foreground">
              <span className="truncate">{pkg.name}</span>
              {version && <span className="shrink-0 text-(--ui-text-quaternary)">v{version}</span>}
            </span>
            {pkg.description && (
              <span className="block truncate text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
                {pkg.description}
              </span>
            )}
          </span>
        </button>
        {openSettings && (
          <Tip label={p.settingsToggle(pkg.name)}>
            <Button aria-label={p.settingsToggle(pkg.name)} onClick={openSettings} size="icon-xs" variant="ghost">
              <Codicon name="settings-gear" />
            </Button>
          </Tip>
        )}
        {removable && (
          <Tip label={`${p.uninstall}: ${pkg.name}`}>
            <Button
              aria-label={`${p.uninstall}: ${pkg.name}`}
              className="text-destructive hover:text-destructive"
              disabled={busy}
              onClick={onUninstall}
              size="icon-xs"
              variant="ghost"
            >
              <Codicon name="trash" />
            </Button>
          </Tip>
        )}
        <span className="shrink-0">{renderSwitch(pkg)}</span>
      </div>
      {expanded && <div className="border-t border-(--ui-stroke-tertiary) px-4 py-4">{renderDetail(pkg)}</div>}
    </li>
  )
}

/** The Plugins tab's default view: every installed package for the selected
 *  profile (plus app-level desktop plugins), each with its switch, settings
 *  and uninstall on the row. The catalog lives in the Discover view. */
export function InstalledPluginsList({
  packages,
  pending,
  notice,
  headerActions,
  query,
  onQueryChange,
  scope,
  expandedKey,
  onExpandedChange,
  busy,
  onUninstall,
  onDiscover,
  renderSwitch,
  renderDetail
}: InstalledPluginsListProps) {
  const { t } = useI18n()
  const p = t.skills.plugins
  const needle = (query ?? '').trim().toLowerCase()

  const shown = useMemo(
    () =>
      [...packages]
        .filter(pkg => !needle || matches(pkg, needle))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [needle, packages]
  )

  const body =
    pending && packages.length === 0 ? (
      <PageLoader label={t.skills.loading} />
    ) : packages.length === 0 ? (
      <PanelEmpty
        action={
          <Button onClick={onDiscover} size="sm" variant="secondary">
            {p.viewDiscover}
          </Button>
        }
        description={p.emptyHint}
        icon="extensions"
        title={p.empty}
      />
    ) : shown.length === 0 ? (
      <PanelEmpty icon="search" title={p.noInstalledMatch} />
    ) : (
      <ul
        className="grid overflow-hidden rounded-lg border border-(--ui-stroke-tertiary)"
        data-testid="installed-plugins"
      >
        {shown.map(pkg => (
          <InstalledRow
            busy={busy(pkg)}
            expanded={expandedKey === pkg.key}
            key={pkg.key}
            onToggleExpanded={() => onExpandedChange(expandedKey === pkg.key ? null : pkg.key)}
            onUninstall={() => onUninstall(pkg)}
            pkg={pkg}
            renderDetail={renderDetail}
            renderSwitch={renderSwitch}
            scope={scope}
          />
        ))}
      </ul>
    )

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col" data-installed-plugins>
      <header className="catalog-search-header shrink-0">
        <CapabilitySearch
          actions={headerActions}
          onChange={value => onQueryChange?.(value)}
          placeholder={t.catalog.searchPlugins}
          scope={t.skills.tabPlugins}
          value={query ?? ''}
        />
      </header>
      {notice}
      <div className="capabilities-scroll">
        <div className="capabilities-page pt-(--capabilities-gap-controls) pb-6">{body}</div>
      </div>
    </div>
  )
}
