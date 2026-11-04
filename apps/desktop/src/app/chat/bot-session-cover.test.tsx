/**
 * A new session opened FOR a bot (strip "+" / ⌘T in Bot Mode, "New chat with
 * this bot") shows that bot's cover — its face and name, the same empty state
 * its canonical Bot Chat has — instead of Hermes' generic splash.
 *
 * Core keeps the splash for generic drafts; a tab whose scope names a Bot Mode
 * owner hands its empty state to the `chat.empty` slot, which now tells the
 * contributor which owner the tab was opened for. Nothing here is keyed on a
 * bot's name: the owner is the opaque key the tab carries.
 */

import { render, screen } from '@testing-library/react'
import { atom } from 'nanostores'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { ChatEmptySlot } from '@/components/assistant-ui/chat-empty-slot'
import { registry } from '@/contrib'
import { CHAT_EMPTY_AREA, type ChatEmptyContribution } from '@/lib/chat-empty'
import { $botChatScopes } from '@/store/bot-chat-scope'
import { $sessionTiles } from '@/store/session-states'

import { shouldShowIntro } from './intro-visibility'
import { PRIMARY_SESSION_VIEW, SessionViewProvider } from './session-view'
import { workspaceOwnerKeyFor } from './workspace-owner'

const BLANK_TAB = {
  activeSessionId: null,
  auxiliaryWindow: false,
  enabled: true,
  freshDraftReady: false,
  messagesEmpty: true,
  primary: false,
  routedSessionView: false,
  selectedSessionId: null,
  tileDraft: true
}

const disposers: (() => void)[] = []

afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    dispose()
  }

  $sessionTiles.set([])
  $botChatScopes.set({})
})

function tileView(storedId: string) {
  return ({ children }: { children: ReactNode }) => (
    <SessionViewProvider value={{ ...PRIMARY_SESSION_VIEW, $storedId: atom<null | string>(storedId), kind: 'tile' }}>
      {children}
    </SessionViewProvider>
  )
}

describe('a bot-owned new session shows its bot, not the generic splash', () => {
  it('the splash stands down for a tab opened for a workspace owner', () => {
    expect(shouldShowIntro({ ...BLANK_TAB, ownerScoped: true })).toBe(false)
    expect(shouldShowIntro({ ...BLANK_TAB, ownerScoped: false })).toBe(true)
  })

  it('reads the owner from the tab, else from the main-tab bot scope', () => {
    const tiles = [{ storedSessionId: 't-1', workspaceMode: 'bots' as const, workspaceOwnerKey: 'bot:x' }]
    const scopes = { 'm-1': { workspaceMode: 'bots' as const, workspaceOwnerKey: 'bot:y' } }

    expect(workspaceOwnerKeyFor('t-1', tiles, scopes)).toBe('bot:x')
    expect(workspaceOwnerKeyFor('m-1', tiles, scopes)).toBe('bot:y')
    expect(workspaceOwnerKeyFor('s-1', [{ storedSessionId: 's-1', workspaceMode: 'sessions' }], {})).toBeUndefined()
    expect(workspaceOwnerKeyFor(null, tiles, scopes)).toBeUndefined()
  })

  it('the empty slot tells its contributor which owner the tab belongs to', () => {
    $sessionTiles.set([{ storedSessionId: 'stored-1', workspaceMode: 'bots', workspaceOwnerKey: 'bot:local::ops' }])
    const seen: unknown[] = []

    const renderEmpty: ChatEmptyContribution['render'] = props => {
      seen.push(props)

      return <span data-testid="cover">{props.workspaceOwnerKey}</span>
    }

    disposers.push(registry.register({ area: CHAT_EMPTY_AREA, data: { render: renderEmpty }, id: 'owner-probe' }))

    render(<ChatEmptySlot sessionId="runtime-1" />, { wrapper: tileView('stored-1') })

    expect(screen.getByTestId('cover').textContent).toBe('bot:local::ops')
    expect(seen.at(-1)).toEqual({
      sessionId: 'runtime-1',
      storedSessionId: 'stored-1',
      workspaceOwnerKey: 'bot:local::ops'
    })
  })
})
