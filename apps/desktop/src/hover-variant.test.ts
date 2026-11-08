// @vitest-environment node
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { compile } from '@tailwindcss/node'
import postcss, { type AtRule } from 'postcss'
import { describe, expect, it } from 'vitest'

const SRC = dirname(fileURLToPath(import.meta.url))

const CANDIDATES = ['hover:opacity-100', 'group-hover/attachment:opacity-100', 'group-hover/code:opacity-100']

const BROWSER_HOST = "html[data-hermes-desktop-host='browser']"
const NATIVE_HOST = "html:not([data-hermes-desktop-host='browser'])"

async function utilitiesFor(css: string): Promise<string> {
  const { build } = await compile(css, { base: SRC, onDependency() {} })
  const out = build(CANDIDATES)
  const start = out.indexOf('@layer utilities {')
  expect(start).toBeGreaterThanOrEqual(0)

  return out.slice(start)
}

function gatesHoverOnCapabilityQuery(css: string): boolean {
  return /@media\s*\(\s*hover\s*:\s*hover\s*\)/.test(css)
}

interface HoverRule {
  media: string[]
  selector: string
}

/** Every rule that styles a `:hover`, with the @media queries around it. */
function hoverRules(css: string): HoverRule[] {
  const rules: HoverRule[] = []

  postcss.parse(css).walkRules(rule => {
    // Only the built utilities: the slice also holds the stylesheet's own rules.
    if (!rule.selector.includes(':hover') || !/^\.(?:group-)?hover/.test(rule.selector)) {
      return
    }

    const media: string[] = []

    for (let node = rule.parent; node && node.type !== 'root'; node = node.parent) {
      if (node.type === 'atrule' && (node as AtRule).name === 'media') {
        media.push((node as AtRule).params.replace(/\s+/g, ''))
      }
    }

    rules.push({ media, selector: rule.selector })
  })

  return rules
}

describe('hover variant (Windows hover-reveal, phone sticky hover)', () => {
  it('still wraps hover utilities in the capability query without an override', async () => {
    const utilities = await utilitiesFor('@import "tailwindcss";\n')

    expect(utilities).toContain('group-hover')
    expect(gatesHoverOnCapabilityQuery(utilities)).toBe(true)
  })

  it('does not wrap the app stylesheet hover utilities in the capability query', async () => {
    const utilities = await utilitiesFor('@import "./styles.css";\n')

    expect(utilities).toContain('.group-hover\\/attachment\\:opacity-100')
    expect(utilities).toContain('.group-hover\\/code\\:opacity-100')
    expect(utilities).toContain('.hover\\:opacity-100')
    expect(gatesHoverOnCapabilityQuery(utilities)).toBe(false)
  })

  // Native Desktop: a Windows digitizer host answers (hover: none) with a mouse
  // attached, so every hover utility there stays plain, ungated :hover.
  it('keeps native Desktop hover utilities as plain :hover with no media gate', async () => {
    const rules = hoverRules(await utilitiesFor('@import "./styles.css";\n'))
    const native = rules.filter(rule => rule.selector.includes(NATIVE_HOST))

    expect(native).toHaveLength(CANDIDATES.length)
    expect(native.every(rule => rule.media.length === 0)).toBe(true)
  })

  // The Webapp on an iPhone: iOS leaves :hover on the last tapped element, so
  // a tapped row or button stays highlighted. Its hover needs a pointer that
  // can hover (`any-hover`, so a digitizer laptop with a mouse still hovers).
  it('gates browser-host hover on any-hover so a tap on a phone does not stick', async () => {
    const rules = hoverRules(await utilitiesFor('@import "./styles.css";\n'))
    const browser = rules.filter(rule => rule.selector.includes(BROWSER_HOST))

    expect(browser).toHaveLength(CANDIDATES.length)
    expect(browser.every(rule => rule.media.includes('(any-hover:hover)'))).toBe(true)
    // No hover utility applies to both hosts: each names exactly one side.
    expect(rules.every(rule => rule.selector.includes(BROWSER_HOST) !== rule.selector.includes(NATIVE_HOST))).toBe(
      true
    )
  })
})
