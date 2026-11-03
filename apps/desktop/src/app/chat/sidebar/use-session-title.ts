import { useStore } from '@nanostores/react'

import type { SessionInfo } from '@/hermes'
import { sessionTitle } from '@/lib/chat-runtime'
import { $botChatLabels } from '@/store/bot-chat-labels'

/** `sessionTitle` for a rendered row, repainting when Bot Mode publishes a
 *  bot's name (a Bot Chat row reads as its bot). */
export function useSessionTitle(session: SessionInfo): string {
  useStore($botChatLabels)

  return sessionTitle(session)
}
