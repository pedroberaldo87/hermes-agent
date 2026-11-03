/**
 * What a bot's canonical chat is CALLED wherever it shows up — the Sessions
 * sidebar row and any tab holding it, whichever surface opened it.
 *
 * Every bot's canonical chat is stored under the same identity title
 * ("Bot Chat", resolved by name on every Bot Mode open), so the stored title
 * names nothing. The bot's display name, keyed by the row's profile, does.
 * Bot Mode publishes the names with its roster; the last-known names persist
 * so a relaunch names the row before the Bots pane is ever opened. Without a
 * published name the profile name stands in, never the bare "Bot Chat".
 */

import { atom } from 'nanostores'

import { readJson, writeJson } from '@/lib/storage'

// `store/profile.ts`'s normalizeProfileKey, inlined: `sessionTitle` (lib) reads
// this module, and the profile store's import graph would cycle back into it.
function normalizeProfileKey(name: null | string | undefined): string {
  return (name ?? '').trim() || 'default'
}

/** The identity title every canonical Bot Chat is stored under. */
export const BOT_CHAT_TITLE = 'Bot Chat'

const LABELS_KEY = 'hermes.desktop.botChatLabels.v1'

function storedLabels(): Record<string, string> {
  const raw = readJson<unknown>(LABELS_KEY)

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '')
  )
}

/** Bot display name per normalized profile key. Presentation only. */
export const $botChatLabels = atom<Readonly<Record<string, string>>>(storedLabels())

export function setBotChatLabel(profile: string, label: string): void {
  const key = normalizeProfileKey(profile)
  const name = label.trim()

  if (!name || $botChatLabels.get()[key] === name) {
    return
  }

  const next = { ...$botChatLabels.get(), [key]: name }

  $botChatLabels.set(next)
  writeJson(LABELS_KEY, next)
}

/** The bot's name for a title that is the canonical identity title, else the
 *  title untouched. */
export function botChatCaption(title: string, profile: null | string | undefined): string {
  if (title.trim() !== BOT_CHAT_TITLE) {
    return title
  }

  const key = normalizeProfileKey(profile)
  const published = $botChatLabels.get()[key]

  if (published) {
    return published
  }

  return key && key !== 'default' ? key.charAt(0).toUpperCase() + key.slice(1) : title
}
