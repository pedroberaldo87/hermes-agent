/** Fit the browser app to the visible area when a keyboard leaves layout height
 * unchanged. `interactive-widget=resizes-content` handles supporting browsers;
 * VisualViewport covers the others. Pan/zoom stays with the browser: a pinch
 * must not turn its smaller visible area into a smaller application layout.
 */

/** How long a rotation keeps reporting in-between sizes before the re-sample. */
export const ROTATION_SETTLE_MS = 300

const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit'
])

const EDITABLE = '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'

/** A focused field that brings up the on-screen keyboard. Only then is a
 * visible area smaller than the layout the keyboard's doing. */
function editingText(): boolean {
  const active = document.activeElement

  if (active instanceof HTMLTextAreaElement) {
    return true
  }

  if (active instanceof HTMLInputElement) {
    return !NON_TEXT_INPUTS.has(active.type)
  }

  return active instanceof HTMLElement && (active.isContentEditable || active.closest(EDITABLE) !== null)
}

export function installBrowserViewport(): () => void {
  const viewport = window.visualViewport
  const root = document.getElementById('root')

  if (!viewport || !root || document.documentElement.dataset.hermesDesktopHost !== 'browser') {
    return () => {}
  }

  const orientation = window.screen?.orientation

  let frame = 0
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let settling = false
  let unzoomedTop = 0
  let lastWidth = window.innerWidth

  const reset = () => {
    root.removeAttribute('data-browser-viewport')
    root.style.removeProperty('--browser-viewport-height')
    root.style.removeProperty('--browser-viewport-top')
  }

  const update = () => {
    frame = 0

    // Remove pinch magnification from the height, so opening/closing the
    // keyboard still updates available space while zoomed. No focus(),
    // scrollIntoView(), or browser zoom changes here.
    const height = viewport.height * viewport.scale

    if (!Number.isFinite(height) || height <= 0) {
      return
    }

    // iOS Safari reports the visible area as innerHeight, zoomed or not, and
    // scrolls the focused field into view itself. Fitting the shell under that
    // scroll would shrink the app out of the visible area.
    // A visible area as tall as the layout, or taller (rotation reports those
    // in between), has no keyboard to fit. Nor is there one without a focused
    // text field: a smaller sample then is browser chrome or a rotation still
    // in flight, and pinning the shell to it leaves a black band above the
    // app or the composer below the screen.
    if (Math.abs(viewport.height - window.innerHeight) < 1 || height >= window.innerHeight - 1 || !editingText()) {
      unzoomedTop = 0
      reset()

      return
    }

    // Offset during a pinch belongs to the user's pan, not the app shell.
    if (Math.abs(viewport.scale - 1) < 0.01) {
      unzoomedTop = Math.max(0, viewport.offsetTop)
    }

    const top = Math.min(unzoomedTop, Math.max(0, window.innerHeight - height))

    // Hermes' UI scale is CSS zoom on <html>, separate from pinch zoom.
    const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1
    root.style.setProperty('--browser-viewport-height', `${height / zoom}px`)
    root.style.setProperty('--browser-viewport-top', `${top / zoom}px`)
    root.setAttribute('data-browser-viewport', '')
  }

  const schedule = () => {
    if (!frame && !settling) {
      frame = requestAnimationFrame(update)
    }
  }

  // A rotation invalidates the last fit at once, and the samples iOS reports
  // while it turns are in-between sizes. Drop the fit now, ignore samples
  // until two frames have painted the new orientation and it has had time to
  // settle, then measure again.
  const rotate = () => {
    lastWidth = window.innerWidth
    cancelAnimationFrame(frame)
    clearTimeout(settleTimer)
    settling = true
    unzoomedTop = 0
    reset()
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        frame = 0
        settleTimer = setTimeout(() => {
          settleTimer = undefined
          settling = false
          update()
        }, ROTATION_SETTLE_MS)
      })
    })
  }

  // A width change is a rotation (or a window resize, which re-measuring
  // handles the same way); a height-only change is the keyboard or chrome.
  const onWindowResize = () => {
    if (window.innerWidth !== lastWidth) {
      rotate()
    } else {
      schedule()
    }
  }

  viewport.addEventListener('resize', schedule)
  viewport.addEventListener('scroll', schedule)
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('orientationchange', rotate)
  orientation?.addEventListener?.('change', rotate)
  document.addEventListener('focusin', schedule)
  document.addEventListener('focusout', schedule)
  update()

  return () => {
    cancelAnimationFrame(frame)
    clearTimeout(settleTimer)
    viewport.removeEventListener('resize', schedule)
    viewport.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', onWindowResize)
    window.removeEventListener('orientationchange', rotate)
    orientation?.removeEventListener?.('change', rotate)
    document.removeEventListener('focusin', schedule)
    document.removeEventListener('focusout', schedule)
    reset()
  }
}
