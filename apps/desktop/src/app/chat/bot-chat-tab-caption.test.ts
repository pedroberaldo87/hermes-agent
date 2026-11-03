import { afterEach, describe, expect, it } from 'vitest'

import type { SessionInfo } from '@/hermes'
import { $botChatLabels, setBotChatLabel } from '@/store/bot-chat-labels'
import { $sessions } from '@/store/session'
import { $sessionTiles } from '@/store/session-states'

import { tileCaption } from './session-tile'

// A Bot Chat opened from the Sessions sidebar lands in a tab with no bot
// workspace scope; its caption must still read as the bot, never "Bot Chat".

const ROW: SessionInfo = {
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
  profile: 'sylar',
  source: 'tui',
  started_at: 1,
  title: 'Bot Chat',
  tool_call_count: 0
}

afterEach(() => {
  $sessions.set([])
  $sessionTiles.set([])
  $botChatLabels.set({})
  window.localStorage.clear()
})

describe('a Bot Chat tab opened outside Bot Mode', () => {
  it('is captioned by its bot', () => {
    setBotChatLabel('sylar', 'Sylar')
    $sessions.set([ROW])
    $sessionTiles.set([{ dir: 'center', storedSessionId: 'tip' } as never])

    expect(tileCaption('tip')).toBe('Sylar')
  })
})
