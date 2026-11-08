import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { StatusbarControls, type StatusbarItem } from '@/app/shell/statusbar-controls'
import { $narrowViewport } from '@/components/pane-shell/tree/store'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'

beforeAll(() => {
  stubResizeObserver()
  stubMenuDomApis()
})

afterEach(() => {
  cleanup()
  $narrowViewport.set(false)
  delete globalThis.document.documentElement.dataset.hermesDesktopHost
})

const items: StatusbarItem[] = ['Model', 'Context', 'Gateway', 'Usage', 'Git'].map(label => ({
  id: label.toLowerCase(),
  label,
  lockedVisible: true,
  variant: 'action'
}))

const rightCluster = () => {
  render(
    <MemoryRouter>
      <StatusbarControls items={items} />
    </MemoryRouter>
  )

  return screen.getByRole('contentinfo').querySelector<HTMLElement>('[data-statusbar-side="right"]')!
}

describe('status bar on a phone', () => {
  // The right cluster alone is wider than a phone. Clipped, its last items
  // could not be reached; on the narrow Webapp it swipes sideways instead.
  it('lets the Webapp swipe the right cluster on a narrow screen, and keeps native Desktop clipping', () => {
    globalThis.document.documentElement.dataset.hermesDesktopHost = 'browser'
    act(() => $narrowViewport.set(true))
    const narrow = rightCluster()

    expect(narrow.className).toContain('overflow-x-auto')
    expect(narrow.className).toContain('*:shrink-0')
    expect(narrow.className).toContain('[scrollbar-width:none]')
    expect(narrow.className).not.toContain('overflow-x-clip')
    expect(narrow.textContent).toContain('Git')

    cleanup()
    act(() => $narrowViewport.set(false))
    expect(rightCluster().className).toContain('overflow-x-clip')

    cleanup()
    delete globalThis.document.documentElement.dataset.hermesDesktopHost
    act(() => $narrowViewport.set(true))
    const native = rightCluster()

    expect(native.className).toContain('overflow-x-clip')
    expect(native.className).not.toContain('overflow-x-auto')
  })
})
