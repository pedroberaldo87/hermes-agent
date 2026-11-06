/**
 * ⇧-click on a bot row is the context menu's "New chat with this bot": it
 * selects the bot, makes it the Bots workspace owner and starts a fresh side
 * chat, never opening the canonical Bot Chat. It wins over ⌘/⌃ (stacked tab).
 */

import type * as HermesSdk from '@hermes/plugin-sdk'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BotRow } from './bot-row'
import { translateBotsIn } from './i18n-test-helper'
import type { RosterRow } from './types'

const { newBotChat, openRosterBot, saveSelectedRosterBot, setBotsWorkspaceOwner } = vi.hoisted(() => ({
  newBotChat: vi.fn(),
  openRosterBot: vi.fn(),
  saveSelectedRosterBot: vi.fn(),
  setBotsWorkspaceOwner: vi.fn()
}))

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return { ...sdk, usePluginI18n: () => translateBotsIn('en') }
})

vi.mock('./data', async importOriginal => ({ ...(await importOriginal<object>()), newBotChat }))
vi.mock('./bot-state', async importOriginal => ({ ...(await importOriginal<object>()), saveSelectedRosterBot }))
vi.mock('./routing', async importOriginal => ({ ...(await importOriginal<object>()), setBotsWorkspaceOwner }))
vi.mock('./roster-actions', () => ({ openRosterBot }))

const noop = () => undefined

function renderRow(bot: RosterRow) {
  render(<BotRow bot={bot} onDelete={noop} onEdit={noop} onGroup={noop} onNewSection={noop} />)

  return screen.getByRole('button')
}

beforeEach(() => {
  vi.clearAllMocks()
  openRosterBot.mockResolvedValue(true)
})

describe('shift-click on a bot row', () => {
  it.each([{ shiftKey: true }, { metaKey: true, shiftKey: true }, { ctrlKey: true, shiftKey: true }])(
    '%j starts a new chat with the bot, like the menu item',
    modifiers => {
      const bot = { connectionId: 'local', name: 'research' } as RosterRow

      fireEvent.click(renderRow(bot), modifiers)

      expect(saveSelectedRosterBot).toHaveBeenCalledWith(bot)
      expect(setBotsWorkspaceOwner).toHaveBeenCalledWith(expect.any(String), bot)
      expect(newBotChat.mock.calls).toEqual([[bot]])
      expect(openRosterBot).not.toHaveBeenCalled()
    }
  )

  it('matches what "New chat with this bot" does', async () => {
    const bot = { connectionId: 'local', name: 'research' } as RosterRow
    const row = renderRow(bot)

    fireEvent.contextMenu(row)
    fireEvent.click(await screen.findByText('New chat with this bot'))
    const menuCalls = [saveSelectedRosterBot.mock.calls, setBotsWorkspaceOwner.mock.calls, newBotChat.mock.calls]

    vi.clearAllMocks()
    fireEvent.click(row, { shiftKey: true })

    expect([saveSelectedRosterBot.mock.calls, setBotsWorkspaceOwner.mock.calls, newBotChat.mock.calls]).toEqual(
      menuCalls
    )
  })

  it('a plain click still opens the canonical Bot Chat', () => {
    const bot = { connectionId: 'local', name: 'research' } as RosterRow

    fireEvent.click(renderRow(bot))

    expect(openRosterBot.mock.calls).toEqual([[bot, { intent: 'in-place' }]])
    expect(newBotChat).not.toHaveBeenCalled()
  })
})
