/**
 * A bot's cover is not only for its canonical Bot Chat: every new session
 * opened for the bot (tab-strip "+" / ⌘T in Bot Mode, "New chat with this
 * bot") names the bot's workspace owner, and the cover resolves the bot from
 * that key. A session owned by no bot still gets no cover.
 */

import { render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { BotChatEmpty } from './chat-empty'
import { $lastRoster } from './data'
import { botWorkspaceOwnerKey } from './routing'
import type { RosterRow } from './types'

const OPS = { connectionId: 'local', name: 'ops' } as RosterRow
const SALES = { connectionId: 'local', name: 'sales' } as RosterRow

afterEach(() => {
  $lastRoster.set([])
})

describe('the bot cover follows the owner a new session was opened for', () => {
  it('renders for a side session of the bot, not only its canonical chat', () => {
    $lastRoster.set([SALES, OPS])

    const { container } = render(
      <BotChatEmpty sessionId="runtime-1" storedSessionId="side-1" workspaceOwnerKey={botWorkspaceOwnerKey(OPS)} />
    )

    const cover = container.querySelector('[data-slot="bot_chat_empty"]')

    expect(cover).not.toBeNull()
  })

  it('stays out of a session no bot owns', () => {
    $lastRoster.set([SALES, OPS])

    const { container } = render(<BotChatEmpty sessionId="runtime-1" storedSessionId="plain-1" />)

    expect(container.querySelector('[data-slot="bot_chat_empty"]')).toBeNull()
  })
})
