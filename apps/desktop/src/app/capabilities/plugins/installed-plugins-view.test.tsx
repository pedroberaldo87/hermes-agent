/**
 * The Plugins tab lands on what the user HAS installed: one row per package
 * with its switch, settings and uninstall on the row. The catalog used to be
 * the landing view, with the installed list two clicks deep behind
 * FILTERS ▸ Installed and Uninstall at the bottom of a detail dialog.
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $pluginRecords } from '@/contrib/plugins-store'
import { queryClient } from '@/lib/query-client'
import { $agentPlugins, $agentPluginsStatus, type AgentPluginRow } from '@/store/agent-plugins'
import { $confirmRequest, settleConfirm } from '@/store/confirm'
import { $gatewayState } from '@/store/session'

import { parseCatalog } from '../catalog/catalog-data'

import { PluginsTab } from './plugins-tab'

const requestGateway = vi.fn(async (_method: string, _params?: Record<string, unknown>): Promise<unknown> => ({
  plugins: $agentPlugins.get()
}))

vi.mock('@/app/gateway/hooks/use-gateway-request', () => ({
  useGatewayRequest: () => ({ requestGateway })
}))

const row = (key: string, extra: Partial<AgentPluginRow> = {}): AgentPluginRow => ({
  description: `${key} plugin`,
  key,
  name: key,
  source: 'user',
  status: 'enabled',
  version: '1.0.0',
  ...extra
})

function renderTab() {
  return render(
    <QueryClientProvider client={queryClient}>
      <PluginsTab profile="default" query="" />
    </QueryClientProvider>
  )
}

const installedRow = (key: string) => screen.getByTestId(`installed-plugin-${key}`)

beforeEach(() => {
  $gatewayState.set('open')
  $pluginRecords.set({})
  $agentPluginsStatus.set('ready')
  queryClient.setQueryData(
    ['public-catalog', 'plugins'],
    parseCatalog('plugins', [
      {
        category: 'weather',
        description: 'Local weather forecasts',
        name: 'weather-plugin',
        repo: 'https://github.com/example/weather-plugin',
        sha: 'a'.repeat(40),
        subdir: '',
        tier: 'community'
      }
    ])
  )
  requestGateway.mockReset()
  requestGateway.mockImplementation(async () => ({ plugins: $agentPlugins.get() }))
})

afterEach(() => {
  cleanup()
  settleConfirm(false)
  queryClient.clear()
})

describe('Plugins ▸ Installed', () => {
  it('lands on the installed list, not the catalog, with every user plugin listed', () => {
    $agentPlugins.set([row('honcho'), row('langfuse', { source: 'git' }), row('memory/builtin', { source: 'bundled' })])

    renderTab()

    const list = screen.getByTestId('installed-plugins')

    expect(
      within(list)
        .getAllByRole('listitem')
        .map(item => item.dataset.testid)
    ).toEqual(['installed-plugin-honcho', 'installed-plugin-langfuse'])
    expect(screen.queryByText('weather-plugin')).toBeNull()
  })

  it('puts Uninstall on the row for removable plugins only', () => {
    $agentPlugins.set([row('honcho'), row('pip-thing', { source: 'entrypoint' })])

    renderTab()

    expect(within(installedRow('honcho')).getByRole('button', { name: 'Uninstall: honcho' })).toBeTruthy()
    expect(within(installedRow('pip-thing')).queryByRole('button', { name: /Uninstall/ })).toBeNull()
  })

  it('uninstalls from the row through plugins.manage remove only after the confirm', async () => {
    $agentPlugins.set([row('honcho')])
    requestGateway.mockImplementation(async (_method, params) =>
      params?.action === 'remove' ? { name: 'honcho', ok: true } : { plugins: $agentPlugins.get() }
    )

    renderTab()
    fireEvent.click(within(installedRow('honcho')).getByRole('button', { name: 'Uninstall: honcho' }))

    await waitFor(() => expect($confirmRequest.get()?.title).toContain('honcho'))
    expect(requestGateway).not.toHaveBeenCalledWith('plugins.manage', expect.objectContaining({ action: 'remove' }))

    settleConfirm(true)

    await waitFor(() =>
      expect(requestGateway).toHaveBeenCalledWith(
        'plugins.manage',
        expect.objectContaining({ action: 'remove', name: 'honcho', profile: 'default' })
      )
    )
  })

  it('opens the plugin settings page from the row gear when the plugin has settings', () => {
    $agentPlugins.set([
      row('claude-sub', { settings_schema: [{ key: 'model', label: 'Model', type: 'string' }] as never }),
      row('honcho')
    ])

    renderTab()
    window.location.hash = ''

    expect(within(installedRow('honcho')).queryByRole('button', { name: 'Settings: honcho' })).toBeNull()
    fireEvent.click(within(installedRow('claude-sub')).getByRole('button', { name: 'Settings: claude-sub' }))

    expect(window.location.hash).toContain('settings')
    expect(window.location.hash).toContain('claude-sub')
  })

  it('switches a plugin off from the row', async () => {
    $agentPlugins.set([row('honcho')])

    renderTab()
    fireEvent.click(within(installedRow('honcho')).getByRole('switch'))

    await waitFor(() =>
      expect(requestGateway).toHaveBeenCalledWith(
        'plugins.manage',
        expect.objectContaining({ action: 'toggle', enable: false, key: 'honcho' })
      )
    )
  })

  it('expands a row into its full controls and reaches the catalog through Discover', () => {
    $agentPlugins.set([row('honcho')])

    const { container } = renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Details: honcho' }))
    expect(within(installedRow('honcho')).getByTestId('plugin-row-honcho')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Discover' }))
    expect(screen.queryByTestId('installed-plugins')).toBeNull()
    expect(container.querySelector('[data-catalog="plugins"]')).not.toBeNull()
  })
})
