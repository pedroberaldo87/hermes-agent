import { afterEach, describe, expect, it, vi } from 'vitest'

import { sessionTitle } from '@/lib/chat-runtime'
import type { SessionInfo } from '@/types/hermes'

import { $botChatLabels, botChatCaption, setBotChatLabel } from './bot-chat-labels'

// Every bot's canonical chat is stored as "Bot Chat"; listed in the Sessions
// sidebar or opened from there, it must read as its bot, the same name its
// Bot Mode tab shows, never as the shared identity title.

function row(overrides: Partial<SessionInfo>): SessionInfo {
  return {
    cwd: null,
    ended_at: null,
    id: 'tip',
    input_tokens: 0,
    is_active: true,
    last_active: 1,
    message_count: 3,
    model: null,
    output_tokens: 0,
    parent_session_id: null,
    preview: 'hello',
    source: 'tui',
    started_at: 1,
    title: 'Bot Chat',
    tool_call_count: 0,
    ...overrides
  }
}

afterEach(() => {
  $botChatLabels.set({})
  window.localStorage.clear()
})

describe('a canonical Bot Chat reads as its bot', () => {
  it("names the sidebar row with the bot's published name", () => {
    setBotChatLabel('sylar', 'Sylar')

    expect(sessionTitle(row({ profile: 'sylar' }))).toBe('Sylar')
  })

  it('falls back to the profile name before Bot Mode has published one', () => {
    expect(sessionTitle(row({ profile: 'metatron' }))).toBe('Metatron')
  })

  it('keeps the published names across a relaunch', async () => {
    setBotChatLabel('saude', 'Saúde')
    vi.resetModules()
    const fresh = await import('./bot-chat-labels')

    expect(fresh.botChatCaption('Bot Chat', 'saude')).toBe('Saúde')
  })

  it('leaves every other title alone', () => {
    setBotChatLabel('sylar', 'Sylar')

    expect(sessionTitle(row({ profile: 'sylar', title: 'Plan the launch' }))).toBe('Plan the launch')
    expect(botChatCaption('Bot Chat notes', 'sylar')).toBe('Bot Chat notes')
    expect(botChatCaption('Bot Chat', undefined)).toBe('Bot Chat')
  })
})
