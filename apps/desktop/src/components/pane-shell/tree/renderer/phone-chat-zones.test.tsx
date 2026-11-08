import { useStore } from '@nanostores/react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { registry } from '@/contrib/registry'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'

import { group, split } from '../model'
import { $activeTreeGroup, $layoutTree, $narrowViewport, revealTreePane } from '../store'

import { TreeSplit } from './tree-split'

// A phone (390pt portrait) that inherits a layout splitting two chat zones
// side by side drew both, the second clipped off the right edge with its own
// composer. On a narrow viewport a split shows ONE chat zone at full width;
// the rest stay mounted (drafts, streams) behind the visible zone's picker.

const disposers: (() => void)[] = []

const tree = () =>
  split(
    'row',
    [
      group(['workspace'], { active: 'workspace', id: 'grp-a', tabStrip: 'always' }),
      group(['session-tile:b'], { active: 'session-tile:b', id: 'grp-b', tabStrip: 'always' })
    ],
    [1, 1],
    'spl-root'
  )

/** The split-child wrapper the renderer sizes; `display:none` hides a zone. */
const wrapper = (groupId: string) =>
  globalThis.document.querySelector<HTMLElement>(`[data-tree-group="${groupId}"]`)?.parentElement ?? null

const shownZones = () => ['grp-a', 'grp-b'].filter(id => wrapper(id)?.style.display !== 'none')

/** iPhone portrait width. Content wider than this makes iOS Safari widen the
 *  layout viewport and keep that zoom across rotations. */
const PHONE_PX = 390

const cssPx = (css: string) =>
  css.endsWith('rem') ? parseFloat(css) * 16 : css.endsWith('vw') ? (parseFloat(css) * PHONE_PX) / 100 : parseFloat(css) || 0

/** Elements under the split that still take part in layout (no display:none
 *  on them or any ancestor below the split). */
function laidOut(): HTMLElement[] {
  const root = globalThis.document.querySelector<HTMLElement>('[data-tree-split="spl-root"]')!

  return [root, ...root.querySelectorAll<HTMLElement>('*')].filter(el => {
    for (let node: HTMLElement | null = el; node && node !== root.parentElement; node = node.parentElement) {
      if (node.style.display === 'none') {
        return false
      }
    }

    return true
  })
}

/** The row's width floor: the summed min-widths of its laid-out children, and
 *  no laid-out element's own min-width/width past the phone. */
function expectFitsPhone() {
  const root = globalThis.document.querySelector<HTMLElement>('[data-tree-split="spl-root"]')!
  const kids = [...root.children].filter(kid => (kid as HTMLElement).style.display !== 'none') as HTMLElement[]

  expect(kids.reduce((sum, kid) => sum + cssPx(kid.style.minWidth), 0)).toBeLessThanOrEqual(PHONE_PX)

  for (const el of laidOut()) {
    expect(cssPx(el.style.minWidth)).toBeLessThanOrEqual(PHONE_PX)
    expect(cssPx(el.style.width)).toBeLessThanOrEqual(PHONE_PX)
  }
}

function Host() {
  const node = useStore($layoutTree)

  return <MemoryRouter>{node?.type === 'split' && <TreeSplit node={node} root rootRow topEdge />}</MemoryRouter>
}

beforeEach(() => {
  stubResizeObserver()
  stubMenuDomApis()
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  globalThis.document.documentElement.dataset.hermesDesktopHost = 'browser'
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  )

  // The real floors: the workspace's 22vw and a session tile's 20rem.
  for (const [id, title, draft, minWidth] of [
    ['workspace', 'Business - GPU rental', 'Draft A', '22vw'],
    ['session-tile:b', 'Hermes plans', 'Draft B', '20rem']
  ] as const) {
    disposers.push(
      registry.register({
        area: 'panes',
        data: { minWidth, placement: 'main' },
        id,
        render: () => <input aria-label={draft} defaultValue="" />,
        title
      })
    )
  }

  $layoutTree.set(tree())
  $narrowViewport.set(true)
})

afterEach(() => {
  cleanup()
  disposers.splice(0).forEach(dispose => dispose())
  $layoutTree.set(null)
  $narrowViewport.set(false)
  $activeTreeGroup.set(null)
  delete globalThis.document.documentElement.dataset.hermesDesktopHost
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('shows one chat zone at a time on a phone and switches from the picker without touching the layout', () => {
  const before = JSON.stringify($layoutTree.get())

  render(<Host />)

  // The workspace's zone is the front by default; the other chat zone is
  // hidden but MOUNTED (its draft survives the switch).
  expect(shownZones()).toEqual(['grp-a'])
  expect(screen.getByRole('textbox', { name: 'Draft B', hidden: true })).toBeTruthy()
  // A hidden zone keeps no floor that could still widen the row.
  expect(wrapper('grp-b')?.style.minWidth).toBe('')
  expectFitsPhone()
  fireEvent.change(screen.getByRole('textbox', { name: 'Draft A' }), { target: { value: 'keep me' } })

  // The visible zone's picker lists the hidden chat zone's tab.
  fireEvent.pointerDown(screen.getByRole('button', { name: '1 tab Business - GPU rental' }), {
    button: 0,
    ctrlKey: false,
    pointerType: 'mouse'
  })
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Hermes plans' }))

  expect(shownZones()).toEqual(['grp-b'])
  expect(wrapper('grp-a')?.style.minWidth).toBe('')
  expectFitsPhone()
  expect(JSON.stringify($layoutTree.get())).toBe(before)

  // Opening a chat elsewhere (sidebar → revealTreePane) fronts its zone.
  act(() => revealTreePane('workspace'))
  expect(shownZones()).toEqual(['grp-a'])
  expect((screen.getByRole('textbox', { name: 'Draft A' }) as HTMLInputElement).value).toBe('keep me')

  // Wider than a phone: the split is back, nothing was rewritten.
  act(() => $narrowViewport.set(false))
  expect(shownZones()).toEqual(['grp-a', 'grp-b'])
  expect(JSON.stringify($layoutTree.get())).toBe(before)
})
