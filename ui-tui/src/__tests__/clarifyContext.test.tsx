import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { renderSync } from '@hermes/ink'
import React from 'react'
import stripAnsi from 'strip-ansi'
import { afterEach, expect, it, vi } from 'vitest'

import { createServerRequestHandler } from '../app/createServerRequestHandler.js'
import { $overlayState, resetOverlayState } from '../app/overlayStore.js'
import { resetServerRequestsForTests } from '../app/serverRequestStore.js'
import { patchUiState, resetUiState } from '../app/uiStore.js'
import { ClarifyPrompt } from '../components/prompts.js'
import { DEFAULT_THEME } from '../theme.js'

// The clarify call's `context` is the only explanation the user gets (models
// write it there, not in a text block): the card shows it above the questions.

class FakeInput extends EventEmitter {
  isRaw = false
  isTTY = true
  readableLength = 0
  ref = vi.fn()
  setEncoding = vi.fn()
  unref = vi.fn()
  setRawMode = vi.fn((enabled: boolean) => {
    this.isRaw = enabled
  })

  read() {
    return null
  }
}

const CONTEXT = 'Found two stale entries: 1. drop the legacy row 2. keep the live one'

afterEach(() => {
  resetOverlayState()
  resetServerRequestsForTests()
  resetUiState()
})

it('the clarify request carries its context into the overlay', () => {
  patchUiState({ sid: 's1' })
  const handle = createServerRequestHandler({ ringPromptBell: () => {}, setStatus: () => {} })

  handle({
    fail: vi.fn(),
    id: 'srq-1',
    method: 'clarify',
    params: {
      context: `  ${CONTEXT} `,
      questions: [{ choices: ['Yes', 'No'], qid: 'q0', question: 'Apply?' }],
      session_id: 's1'
    },
    respond: vi.fn()
  } as never)

  expect($overlayState.get().clarify?.context).toBe(CONTEXT)
})

it('renders the context above the questions', async () => {
  const stdout = Object.assign(new PassThrough(), { columns: 120, isTTY: false, rows: 40 })
  const frames: string[] = []
  stdout.on('data', chunk => frames.push(chunk.toString()))

  const instance = renderSync(
    <ClarifyPrompt
      cols={120}
      onCancel={vi.fn()}
      onQuestionAnswer={vi.fn()}
      req={{
        context: CONTEXT,
        questions: [{ choices: ['Yes', 'No'], qid: 'q0', question: 'Apply?' }],
        requestId: 'r1'
      }}
      t={DEFAULT_THEME}
    />,
    {
      patchConsole: false,
      stdin: new FakeInput() as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream
    }
  )

  await new Promise(resolve => setTimeout(resolve, 25))
  const text = stripAnsi(frames.join(''))

  expect(text).toContain('drop the legacy row')
  expect(text.indexOf('drop the legacy row')).toBeLessThan(text.indexOf('Apply?'))
  instance.unmount()
  instance.cleanup()
})
