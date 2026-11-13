import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { clearClarifyRequest } from '@/store/clarify'
import { $gateway } from '@/store/gateway'
import { $activeSessionId } from '@/store/session'

import { readClarifyArgs } from './parse'

import { ClarifyTool } from './index'

// The clarify call's `context` is the only explanation the user gets: models
// write it there instead of a text block, so the card must show it.
vi.mock('@assistant-ui/react', async importActual => ({
  ...(await importActual<Record<string, unknown>>()),
  useAuiState: () => true
}))

const CONTEXT = 'Found **two** stale entries.\n\n1. drop the legacy row\n2. keep the live one'

function props(result?: unknown): ToolCallMessagePartProps {
  const args = { context: CONTEXT, questions: [{ choices: ['Yes', 'No'], question: 'Apply the fix?' }] }

  return {
    addResult: vi.fn(),
    args,
    argsText: JSON.stringify(args),
    isError: false,
    respondToApproval: vi.fn(),
    result,
    resume: vi.fn(),
    status: { type: result === undefined ? 'running' : 'complete' },
    toolCallId: 'clarify-context',
    toolName: 'clarify',
    type: 'tool-call'
  } as ToolCallMessagePartProps
}

function tree(ui: ReactNode) {
  return (
    <I18nProvider configClient={null} initialLocale="en">
      {ui}
    </I18nProvider>
  )
}

afterEach(() => {
  cleanup()
  clearClarifyRequest()
  $activeSessionId.set(null)
  $gateway.set(null)
})

describe('clarify context', () => {
  it('reads the context from the tool args', () => {
    expect(readClarifyArgs({ context: '  Found X.  ', questions: [{ question: 'Q?' }] }).context).toBe('Found X.')
    expect(readClarifyArgs({ questions: [{ question: 'Q?' }] }).context).toBeUndefined()
  })

  it('renders the context as markdown above the live questions', async () => {
    $activeSessionId.set('session-1')
    $gateway.set({ request: vi.fn() } as never)
    const { container } = render(tree(<ClarifyTool {...props()} />))
    const context = container.querySelector('[data-clarify-context]')

    expect(context?.textContent).toContain('drop the legacy row')
    // The assistant's own markdown surface: emphasis and the list render, not raw `**`.
    await waitFor(() => expect(context?.querySelector('[data-streamdown="strong"]')?.textContent).toBe('two'))
    expect(context?.querySelectorAll('li')).toHaveLength(2)
    const question = screen.getByText('Apply the fix?')

    expect(context!.compareDocumentPosition(question) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the context above the answered questions once settled', () => {
    const result = JSON.stringify({
      outcome: 'submitted',
      responses: [{ question: 'Apply the fix?', status: 'answered', user_response: 'Yes' }]
    })

    const { container } = render(tree(<ClarifyTool {...props(result)} />))

    expect(container.querySelector('[data-clarify-context]')?.textContent).toContain('keep the live one')
    expect(container.querySelector('[data-clarify-answer]')?.textContent).toBe('Yes')
  })
})
