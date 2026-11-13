'use client'

import { MessageTextContent } from '@/components/assistant-ui/markdown-text'

/** The clarify call's `context`: the explanation the user decides on, rendered
 *  as the assistant's own markdown above the questions (live and settled). */
export function ClarifyContext({ text }: { text?: string }) {
  if (!text) {
    return null
  }

  return (
    <div className="min-w-0 wrap-anywhere" data-clarify-context="">
      <MessageTextContent text={text} />
    </div>
  )
}
