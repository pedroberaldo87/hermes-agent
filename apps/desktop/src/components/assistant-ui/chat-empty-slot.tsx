import { useStore } from '@nanostores/react'
import type { FC } from 'react'
import { useMemo } from 'react'

import { useSessionView } from '@/app/chat/session-view'
import { useWorkspaceOwnerKey } from '@/app/chat/workspace-owner'
import { useContributions } from '@/contrib'
import { ContribBoundary, ContribRender } from '@/contrib/react/boundary'
import { CHAT_EMPTY_AREA, type ChatEmptyContribution, type ChatEmptyProps } from '@/lib/chat-empty'

/**
 * The empty transcript's contributed slot. Mounts every registration and lets
 * each decide — it renders the session's empty state, or nothing at all if the
 * session isn't one it owns.
 *
 * Deliberately a mount rather than a claim the transcript resolves up front:
 * whether a session has an empty state depends on data the plugin loads on its
 * own clock (a bot chat's roster lands after the transcript), and only a
 * mounted component can subscribe and appear when it arrives.
 *
 * That same asynchrony is why the slot cannot mount only the first
 * registration. Ownership is per session and is not known until each has
 * loaded, so first-wins would let a plugin that DECLINES a session suppress the
 * one that owns it, permanently and silently, purely on registration order.
 * Mounting all of them means disjoint owners each work; two claiming the same
 * session render both, which is a visible conflict rather than a silent drop.
 */
const ChatEmptyEntry: FC<{ id: string; props: ChatEmptyProps; render: ChatEmptyContribution['render'] }> = ({
  id,
  props,
  render
}) => {
  // Stable component identity: ContribRender mounts this AS a component, so a
  // fresh closure per render would remount the empty state on every tick.
  const renderEmpty = useMemo(() => () => render(props), [render, props])

  return (
    <ContribBoundary id={id}>
      <ContribRender render={renderEmpty} />
    </ContribBoundary>
  )
}

export const ChatEmptySlot: FC<{ sessionId: string }> = ({ sessionId }) => {
  const contributions = useContributions(CHAT_EMPTY_AREA)
  const storedSessionId = useStore(useSessionView().$storedId) ?? undefined
  const workspaceOwnerKey = useWorkspaceOwnerKey(storedSessionId)

  // Only defined keys: a contributor written against `{ sessionId }` sees the
  // same shape it always did on a plain session.
  const props = useMemo<ChatEmptyProps>(
    () => ({
      sessionId,
      ...(storedSessionId ? { storedSessionId } : {}),
      ...(workspaceOwnerKey ? { workspaceOwnerKey } : {})
    }),
    [sessionId, storedSessionId, workspaceOwnerKey]
  )

  return (
    <>
      {contributions.map(contribution => {
        const render = (contribution.data as ChatEmptyContribution | undefined)?.render

        return render ? (
          <ChatEmptyEntry id={contribution.id} key={contribution.id} props={props} render={render} />
        ) : null
      })}
    </>
  )
}
