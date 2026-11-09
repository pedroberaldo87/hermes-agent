// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SidebarProvider } from '@/components/ui/sidebar'

import { $sidebarNavHeight, clampNavHeight, NAV_MIN_HEIGHT_PX, navLayoutMode, navListHeight } from './nav-resize'

import { ChatSidebar } from './index'

const noop = () => {}

const noopAsync = async () => {}

const renderSidebar = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <SidebarProvider>
        <ChatSidebar
          currentView="chat"
          onArchiveSession={noop}
          onBranchSession={noop}
          onDeleteSession={noop}
          onLoadMoreSessions={noop}
          onManageCronJob={noop}
          onNavigate={noop}
          onNewSessionInWorkspace={noop}
          onNewSessionSplit={noop}
          onResumeSession={noop}
          onRetrySessions={noopAsync}
          onTriggerCronJob={noopAsync}
        />
      </SidebarProvider>
    </MemoryRouter>
  )

const newSessionRow = () =>
  screen
    .getByText('New session', { selector: '[data-tour="sidebar-nav-new-session"]' })
    .closest('button') as HTMLButtonElement

const navMenu = () => newSessionRow().closest('ul') as HTMLUListElement
const navBody = () => navMenu().parentElement as HTMLDivElement

describe('sidebar nav height model', () => {
  it('maps a stored height to full, clipped list, or icon grid', () => {
    expect(navListHeight(9)).toBe(9 * 28 + 8)
    expect(navLayoutMode(null, 9)).toBe('full')
    expect(navLayoutMode(navListHeight(9), 9)).toBe('full')
    expect(navLayoutMode(navListHeight(9) - 1, 9)).toBe('list')
    expect(navLayoutMode(navListHeight(4), 9)).toBe('list')
    expect(navLayoutMode(navListHeight(4) - 1, 9)).toBe('grid')
  })

  it('clamps a drag: full list stores null, never below one grid row', () => {
    expect(clampNavHeight(10_000, 9)).toBeNull()
    expect(clampNavHeight(150.4, 9)).toBe(150)
    expect(clampNavHeight(-40, 9)).toBe(NAV_MIN_HEIGHT_PX)
  })
})

describe('ChatSidebar resizable nav', () => {
  beforeEach(() => $sidebarNavHeight.set(null))
  afterEach(() => {
    cleanup()
    $sidebarNavHeight.set(null)
  })

  it('renders the stock unclipped list by default', () => {
    renderSidebar()

    expect(navBody().style.maxHeight).toBe('')
    expect(navMenu().className).not.toContain('grid')
    expect(screen.getByRole('separator', { name: /resize navigation/i })).toBeTruthy()
  })

  it('clips the labelled list to the stored height and scrolls it', () => {
    $sidebarNavHeight.set(140)
    renderSidebar()

    expect(navBody().style.maxHeight).toBe('140px')
    expect(navBody().className).toContain('overflow-y-auto')
    expect(navMenu().className).not.toContain('grid')
  })

  it('switches to an icon grid below four rows, keeping names for tooltips and screen readers', () => {
    $sidebarNavHeight.set(70)
    renderSidebar()

    const newSession = newSessionRow()

    expect(navMenu().className).toContain('grid')
    expect(navBody().style.maxHeight).toBe('70px')
    expect(newSession.className).toContain('justify-center')
    expect(newSession.className).toContain('[&>[data-tour]]:sr-only')
  })

  it('drags the handle to resize and double-click resets', () => {
    renderSidebar()

    const handle = screen.getByRole('separator', { name: /resize navigation/i })

    // jsdom has no layout: seed the drag from a stored height.
    act(() => $sidebarNavHeight.set(200))
    fireEvent.pointerDown(handle, { button: 0, clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(window, { clientY: 180, pointerId: 1 })
    fireEvent.pointerUp(window, { clientY: 180, pointerId: 1 })

    expect($sidebarNavHeight.get()).toBe(80)
    expect(navMenu().className).toContain('grid')

    fireEvent.doubleClick(handle)

    expect($sidebarNavHeight.get()).toBeNull()
    expect(navMenu().className).not.toContain('grid')
  })
})
