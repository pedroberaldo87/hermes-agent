import { afterEach, describe, expect, it, vi } from 'vitest'

// An iPhone in landscape is ~844px wide but only ~390px tall. On the 640px
// width breakpoint alone the Webapp gave it the desktop layout there: docked
// rails, side-by-side chat zones, in a few hundred pixels of height. The
// browser host is narrow on a phone in either orientation; native Desktop
// keeps its 640px window breakpoint.

interface Screen {
  height: number
  pointer: 'coarse' | 'fine'
  width: number
}

/** A tiny media-query evaluator for the features these breakpoints use. */
function evaluate(query: string, screen: Screen): boolean {
  return query.split(',').some(part =>
    part
      .trim()
      .split(/\s+and\s+/)
      .every(feature => {
        const match = /^\(\s*([a-z-]+)\s*:\s*([^)]+?)\s*\)$/.exec(feature.trim())

        if (!match) {
          throw new Error(`unsupported media feature: ${feature}`)
        }

        const [, name, value] = match

        switch (name) {
          case 'max-width':
            return screen.width <= parseFloat(value)

          case 'max-height':
            return screen.height <= parseFloat(value)

          case 'pointer':
            return screen.pointer === value

          default:
            throw new Error(`unsupported media feature: ${name}`)
        }
      })
  )
}

async function narrowOn(screen: Screen, host: 'browser' | 'native'): Promise<boolean> {
  vi.resetModules()

  if (host === 'browser') {
    document.documentElement.dataset.hermesDesktopHost = 'browser'
  } else {
    delete document.documentElement.dataset.hermesDesktopHost
  }

  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      addEventListener: vi.fn(),
      matches: evaluate(query, screen),
      media: query,
      removeEventListener: vi.fn()
    }))
  )

  const { $narrowViewport } = await import('./store')

  return $narrowViewport.get()
}

const IPHONE_LANDSCAPE: Screen = { height: 390, pointer: 'coarse', width: 844 }
const IPHONE_PORTRAIT: Screen = { height: 844, pointer: 'coarse', width: 390 }
const IPAD_LANDSCAPE: Screen = { height: 820, pointer: 'coarse', width: 1180 }
const SMALL_BROWSER_WINDOW: Screen = { height: 900, pointer: 'fine', width: 700 }
const NARROW_WINDOW: Screen = { height: 900, pointer: 'fine', width: 600 }

afterEach(() => {
  delete document.documentElement.dataset.hermesDesktopHost
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('narrow viewport breakpoint', () => {
  it('gives the Webapp on a phone the phone layout in landscape too, and leaves native Desktop on 640px', async () => {
    expect(await narrowOn(IPHONE_LANDSCAPE, 'browser')).toBe(true)
    expect(await narrowOn(IPHONE_PORTRAIT, 'browser')).toBe(true)
    // Same width as the floating-sidebar breakpoint (useIsMobile, 768px).
    expect(await narrowOn(SMALL_BROWSER_WINDOW, 'browser')).toBe(true)
    // A tablet is tall enough for the desktop layout.
    expect(await narrowOn(IPAD_LANDSCAPE, 'browser')).toBe(false)

    expect(await narrowOn(IPHONE_LANDSCAPE, 'native')).toBe(false)
    expect(await narrowOn(SMALL_BROWSER_WINDOW, 'native')).toBe(false)
    expect(await narrowOn(NARROW_WINDOW, 'native')).toBe(true)
  })
})
