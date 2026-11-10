import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { HermesGateway } from '@/hermes'
import { I18nProvider } from '@/i18n/context'
import { en } from '@/i18n/en'
import { $queuedPromptsBySession, enqueueQueuedPrompt, getQueuedPrompts } from '@/store/composer-queue'
import { reconcilePendingSubmissions } from '@/store/pending-submissions'

import { renderComposerQueueSlot } from './queue-slot'

afterEach(() => { cleanup(); $queuedPromptsBySession.set({}); localStorage.clear() })

function renderSlot(
  request = vi.fn(async () => ({})),
  overrides: Partial<Parameters<typeof renderComposerQueueSlot>[0]> = {}
) {
  const inputs = {
    activeQueueSessionKey: 'stored',
    beginQueuedEdit: vi.fn(),
    busy: true,
    drainNextQueued: vi.fn(async () => undefined),
    exitQueuedEdit: vi.fn(),
    gateway: { request } as unknown as HermesGateway,
    queueEdit: null,
    queueParked: false,
    queuedPrompts: getQueuedPrompts('stored'),
    sendQueuedNow: vi.fn(),
    sessionId: 'runtime-1',
    steerQueuedNow: vi.fn(),
    t: en,
    ...overrides
  }

  render(
    <I18nProvider configClient={{ getConfig: async () => ({}), saveConfig: async () => ({ ok: true }) }}>
      {renderComposerQueueSlot(inputs)}
    </I18nProvider>
  )

  return inputs
}

async function expand() {
  fireEvent.click(await screen.findByRole('button', { name: /queued/i }))
}

function rowButtons(text: string) {
  let row: HTMLElement | null = screen.getByText(text)

  while (row && !row.querySelector(`[aria-label="${en.composer.queueDelete}"]`)) {
    row = row.parentElement
  }

  return within(row as HTMLElement)
}

const labels = (row: ReturnType<typeof within>) =>
  row
    .queryAllByRole('button')
    .map((button: HTMLElement) => button.getAttribute('aria-label'))
    .filter(Boolean)

it('Delete on a server-queued card cancels its admission at the authority', async () => {
  reconcilePendingSubmissions('stored', [{ admission_id: 'adm-1', status: 'queued', user: 'later please' }])
  const request = vi.fn(async () => ({ admission_id: 'adm-1', status: 'terminal', outcome: 'cancelled' }))
  renderSlot(request)

  fireEvent.click(await screen.findByRole('button', { name: /queued/i }))
  fireEvent.click(screen.getByRole('button', { name: en.composer.queueDelete }))

  await vi.waitFor(() => expect(request).toHaveBeenCalledWith('prompt.cancel', { session_id: 'runtime-1', admission_id: 'adm-1' }))
})

it('a server-queued card shows the Steer and Edit its owner serves, Force, and never Next (RT-35)', async () => {
  reconcilePendingSubmissions('stored', [
    { admission_id: 'adm-1', status: 'queued', user: 'later please', controls: ['steer', 'replace'] }
  ])
  enqueueQueuedPrompt('stored', { text: 'local words', attachments: [] })
  renderSlot()

  await expand()
  expect(labels(rowButtons('later please')).sort()).toEqual(
    [en.composer.queueDelete, en.composer.queueEdit, en.composer.queueForce, en.composer.queueSteer].sort()
  )
  // The local row keeps its own controls, Next included.
  expect(labels(rowButtons('local words'))).toContain(en.composer.queueSendNext)
})

it('a server-queued card from an owner without the queued-row verbs keeps Delete and Force', async () => {
  reconcilePendingSubmissions('stored', [{ admission_id: 'adm-1', status: 'queued', user: 'later please' }])
  renderSlot()
  await expand()

  // Force on the head needs no queued-row verb: only a Stop, which every owner serves.
  expect(labels(rowButtons('later please')).sort()).toEqual([en.composer.queueDelete, en.composer.queueForce].sort())
})

it('Force on a server-queued card moves the rows ahead behind it, then stops the running turn', async () => {
  reconcilePendingSubmissions('stored', [
    { admission_id: 'adm-run', status: 'started', user: 'running', execution_generation: 5 },
    { admission_id: 'adm-1', status: 'queued', user: 'first', controls: ['steer', 'replace'] },
    { admission_id: 'adm-2', status: 'queued', user: 'urgent', controls: ['steer', 'replace'] }
  ])

  const request = vi.fn(async (method: string, params: Record<string, unknown>) =>
    method === 'prompt.receipt' && params.admission_id === 'adm-run'
      ? { admission_id: 'adm-run', status: 'started', execution_generation: 5 }
      : { status: 'queued' }
  )

  renderSlot(request as never)
  await expand()

  fireEvent.click(rowButtons('urgent').getByRole('button', { name: en.composer.queueForce }))

  await vi.waitFor(() =>
    expect(request.mock.calls.map(([method]) => method)).toEqual([
      'prompt.receipt',
      'prompt.replace_queued',
      'session.interrupt'
    ])
  )
  expect(request.mock.calls[1][1]).toMatchObject({ admission_id: 'adm-1', text: 'first' })
  expect(request.mock.calls[2][1]).toEqual({ session_id: 'runtime-1', execution_generation: 5 })
})

it('Steer on a server-queued card asks the authority to steer that admission', async () => {
  reconcilePendingSubmissions('stored', [
    { admission_id: 'adm-1', status: 'queued', user: 'later please', controls: ['steer', 'replace'] }
  ])
  const request = vi.fn(async () => ({ admission_id: 'adm-1', status: 'terminal', outcome: 'steered' }))
  const inputs = renderSlot(request)
  await expand()

  fireEvent.click(rowButtons('later please').getByRole('button', { name: en.composer.queueSteer }))

  await vi.waitFor(() =>
    expect(request).toHaveBeenCalledWith('prompt.steer_queued', { session_id: 'runtime-1', admission_id: 'adm-1' })
  )
  expect(inputs.steerQueuedNow).not.toHaveBeenCalled()
})

it('Edit on a server-queued card opens it in the composer', async () => {
  reconcilePendingSubmissions('stored', [
    { admission_id: 'adm-1', status: 'queued', user: 'later please', controls: ['steer', 'replace'] }
  ])
  const inputs = renderSlot()
  await expand()

  fireEvent.click(rowButtons('later please').getByRole('button', { name: en.composer.queueEdit }))

  expect(inputs.beginQueuedEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'adm-1', serverStatus: 'queued' }))
})
