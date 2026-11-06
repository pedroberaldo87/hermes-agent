// @vitest-environment jsdom
// Opening the dashboard root without ?profile= must land on the redirect
// target with the scope in the URL. A plain <Navigate> there raced
// ProfileProvider's ?profile= stamp: the URL went back to /?profile=X and the
// page rendered empty.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'

vi.mock('@/lib/api', () => ({
  api: {
    getProfiles: () => new Promise(() => {}),
    getActiveProfile: () => new Promise(() => {})
  },
  setManagementProfile: () => {}
}))

import { ProfileProvider } from '@/contexts/ProfileProvider'
import { ScopedRedirect } from './ScopedRedirect'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

function Page() {
  const { pathname, search } = useLocation()
  return <p data-url={pathname + search}>page</p>
}

function seenUrl() {
  return container.querySelector('p')?.dataset.url ?? '(nothing rendered)'
}

async function mount(initialEntry: string) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <ProfileProvider>
          <Routes>
            <Route path="/" element={<ScopedRedirect to="/sessions" />} />
            <Route path="/sessions" element={<Page />} />
            <Route path="*" element={<ScopedRedirect to="/sessions" />} />
          </Routes>
        </ProfileProvider>
      </MemoryRouter>
    )
  )
}

beforeEach(() => {
  window.__HERMES_INITIAL_PROFILE__ = 'default'
})

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  delete window.__HERMES_INITIAL_PROFILE__
})

describe('ScopedRedirect', () => {
  it('lands on the target with the scope when the root has no ?profile=', async () => {
    await mount('/')
    expect(seenUrl()).toBe('/sessions?profile=default')
  })

  it('keeps an explicit ?profile= from the root URL', async () => {
    await mount('/?profile=infra')
    expect(seenUrl()).toBe('/sessions?profile=infra')
  })

  it('redirects an unknown path without losing the scope', async () => {
    await mount('/no-such-page')
    expect(seenUrl()).toBe('/sessions?profile=default')
  })

  it('redirects at once when no profile is in scope', async () => {
    delete window.__HERMES_INITIAL_PROFILE__
    await mount('/')
    expect(seenUrl()).toBe('/sessions')
  })
})
