import { useStore } from '@nanostores/react'

import { KbdGroup } from '@/components/ui/kbd'
import { $touchPointer } from '@/lib/touch-interaction'
import { cn } from '@/lib/utils'

/** The New session row's shortcut chip, lit while `flash` echoes a press. A
 *  phone has no keyboard to press it on: the Webapp's touch layout drops it. */
export function NewSessionShortcut({ flash, keys }: { flash: boolean; keys: string[] }) {
  const touchPointer = useStore($touchPointer)

  if (touchPointer) {
    return null
  }

  return <KbdGroup className={cn('ml-auto opacity-55', flash && 'opacity-100!')} keys={keys} size="sm" />
}
