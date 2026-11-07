import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  _resetSessionOwnerHintsForTests,
  getSessionOwnerHints,
  setSessionOwnerHint
} from '@/store/session'
import { liveStoredSessionIdForQueueKey, pruneSessionOwnerHintsToConnections } from '@/store/session-queue-target'
import type { SessionInfo } from '@/types/hermes'

const HINTS_KEY = 'hermes.desktop.sessionOwnerHints.v1'

describe('pruneSessionOwnerHintsToConnections', () => {
  beforeEach(() => _resetSessionOwnerHintsForTests({ storage: true }))
  afterEach(() => _resetSessionOwnerHintsForTests({ storage: true }))

  it('drops hints naming a connection the registry no longer has, keeping live and local ones', () => {
    setSessionOwnerHint('root-old', { connectionId: '100-119-19-8-9119', profile: 'default' })
    setSessionOwnerHint('tip-new', { connectionId: 'mac-max-9443', profile: 'default' })
    setSessionOwnerHint('local-chat', { connectionId: 'local', profile: 'default' })

    expect(pruneSessionOwnerHintsToConnections(['mac-max-9443'])).toBe(1)

    expect(getSessionOwnerHints('root-old')).toEqual([])
    expect(getSessionOwnerHints('tip-new')).toHaveLength(1)
    expect(getSessionOwnerHints('local-chat')).toHaveLength(1)
    expect(window.localStorage.getItem(HINTS_KEY)).not.toContain('100-119-19-8-9119')
  })

  it('treats an empty registry snapshot as unproven and prunes nothing', () => {
    setSessionOwnerHint('root-old', { connectionId: 'old', profile: 'default' })

    expect(pruneSessionOwnerHintsToConnections([])).toBe(0)
    expect(getSessionOwnerHints('root-old')).toHaveLength(1)
  })
})

describe('liveStoredSessionIdForQueueKey', () => {
  const rows = [
    { id: 'tip-a', _lineage_root_id: 'root-a', _lineage_ids: ['root-a', 'mid-a', 'tip-a'] },
    { id: 'plain-b' }
  ] as SessionInfo[]

  it('maps a lineage root (or middle segment) to the live tip', () => {
    expect(liveStoredSessionIdForQueueKey('root-a', rows)).toBe('tip-a')
    expect(liveStoredSessionIdForQueueKey('mid-a', rows)).toBe('tip-a')
  })

  it('prefers the selected id when it is the same conversation', () => {
    expect(liveStoredSessionIdForQueueKey('root-a', rows, 'tip-a')).toBe('tip-a')
    expect(liveStoredSessionIdForQueueKey('root-a', rows, 'plain-b')).toBe('tip-a')
  })

  it('passes unknown and uncompressed keys through unchanged', () => {
    expect(liveStoredSessionIdForQueueKey('plain-b', rows)).toBe('plain-b')
    expect(liveStoredSessionIdForQueueKey('unknown', rows)).toBe('unknown')
  })
})
