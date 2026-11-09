import { useStore } from '@nanostores/react'
import type { CSSProperties, ReactNode, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { useCallback, useRef } from 'react'

import { SidebarGroup, SidebarGroupContent, SidebarMenu } from '@/components/ui/sidebar'
import { TipKeybindLabel } from '@/components/ui/tooltip'
import { Codecs, persistentAtom } from '@/lib/persisted'
import { cn } from '@/lib/utils'

// The sidebar's nav block (New session … Kanban) is user-resizable on the
// vertical axis so the session list below can take the room. Three layouts,
// picked from the height the user dragged to:
//   null (default) or ≥ the full list → every row, no scroller (stock look);
//   ≥ NAV_LIST_MIN_ROWS rows          → the labelled list, clipped, scrolls;
//   below that                        → an icon grid (labels move to tooltips),
//                                       clipped and scrolling only if the
//                                       height is shorter than the grid itself.
// Double-clicking the handle goes back to the full list.

export const NAV_ROW_PX = 28 // h-7
export const NAV_ROW_GAP_PX = 1 // gap-px
export const NAV_LIST_MIN_ROWS = 4
export const NAV_MIN_HEIGHT_PX = 32 // one grid row (h-8)

const STORAGE_KEY = 'hermes.desktop.sidebarNavHeight'

const sanitizeHeight = (value: unknown): null | number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null

export const $sidebarNavHeight = persistentAtom<null | number>(STORAGE_KEY, null, Codecs.json(sanitizeHeight))

export type NavLayoutMode = 'full' | 'grid' | 'list'

/** Pixel height of `rows` stacked nav rows (row heights + the gaps between). */
export function navListHeight(rows: number): number {
  return rows <= 0 ? 0 : rows * NAV_ROW_PX + (rows - 1) * NAV_ROW_GAP_PX
}

/** Which layout a stored height asks for, given how many rows the nav has. */
export function navLayoutMode(height: null | number, rows: number): NavLayoutMode {
  if (height === null || height >= navListHeight(rows)) {
    return 'full'
  }

  return height >= navListHeight(Math.min(rows, NAV_LIST_MIN_ROWS)) ? 'list' : 'grid'
}

/** Clamp a dragged height. Reaching the full list stores null (= follow the
 *  row count, so a plugin adding a row later is not clipped by an old value). */
export function clampNavHeight(height: number, rows: number): null | number {
  if (height >= navListHeight(rows)) {
    return null
  }

  return Math.max(NAV_MIN_HEIGHT_PX, Math.round(height))
}

const GRID_BUTTON = 'h-8 justify-center px-0 [&>:not(svg):not([data-tour])]:hidden [&>[data-tour]]:sr-only'

export interface SidebarNavLayout {
  bodyRef: RefObject<HTMLDivElement | null>
  bodyClassName: string | undefined
  bodyStyle: CSSProperties | undefined
  buttonClassName: string | undefined
  menuClassName: string
  mode: NavLayoutMode
  /** A row tooltip (keybind hint when the row has one): the stock one in list
   *  modes, forced visible in the grid (where the label is gone; the sidebar
   *  primitive only shows tips when the whole sidebar is collapsed). */
  tooltip: (keybindActionId: string | undefined, text: string) => { children: ReactNode; hidden?: boolean }
}

export function useSidebarNavLayout(rows: number): SidebarNavLayout {
  const height = useStore($sidebarNavHeight)
  const mode = navLayoutMode(height, rows)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const clipped = mode !== 'full' && height !== null

  return {
    bodyRef,
    bodyClassName: clipped ? 'overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-fade' : undefined,
    bodyStyle: clipped ? { maxHeight: height } : undefined,
    buttonClassName: mode === 'grid' ? GRID_BUTTON : undefined,
    menuClassName: mode === 'grid' ? 'grid grid-cols-[repeat(auto-fill,minmax(2rem,1fr))] gap-0.5' : 'gap-px',
    mode,
    tooltip: (keybindActionId, text) => {
      const children = keybindActionId ? <TipKeybindLabel actionId={keybindActionId} text={text} /> : text

      return mode === 'grid' ? { children, hidden: false } : { children }
    }
  }
}

interface SidebarNavResizeHandleProps {
  bodyRef: RefObject<HTMLDivElement | null>
  label: string
  rows: number
}

/** The drag strip under the nav block. Drag up to shrink, down to grow. */
export function SidebarNavResizeHandle({ bodyRef, label, rows }: SidebarNavResizeHandleProps) {
  const start = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return
      }

      event.preventDefault()

      const handle = event.currentTarget
      const pointerId = event.pointerId
      const startY = event.clientY
      // From the stored value when there is one, so the pointer→height mapping
      // stays continuous across the list→grid switch (the grid is shorter than
      // the height that produced it); from the rendered body otherwise.
      const startHeight = $sidebarNavHeight.get() ?? bodyRef.current?.getBoundingClientRect().height ?? 0
      const previousCursor = document.body.style.cursor
      const previousUserSelect = document.body.style.userSelect

      handle.setPointerCapture?.(pointerId)
      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'

      const move = (moveEvent: PointerEvent) => {
        $sidebarNavHeight.set(clampNavHeight(startHeight + moveEvent.clientY - startY, rows))
      }

      const finish = () => {
        window.removeEventListener('pointermove', move, true)
        window.removeEventListener('pointerup', finish, true)
        window.removeEventListener('pointercancel', finish, true)
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = previousUserSelect
        handle.releasePointerCapture?.(pointerId)

        // Settle a grid that is shorter than the stored height onto what it
        // actually shows, so the next drag starts under the pointer.
        const body = bodyRef.current
        const stored = $sidebarNavHeight.get()

        if (body && stored !== null && navLayoutMode(stored, rows) === 'grid' && body.scrollHeight > 0) {
          $sidebarNavHeight.set(clampNavHeight(Math.min(stored, body.scrollHeight), rows))
        }
      }

      window.addEventListener('pointermove', move, true)
      window.addEventListener('pointerup', finish, true)
      window.addEventListener('pointercancel', finish, true)
    },
    [bodyRef, rows]
  )

  return (
    <div
      aria-label={label}
      aria-orientation="horizontal"
      className={cn('group/nav-resize relative -mt-1.5 h-2 shrink-0 cursor-row-resize [-webkit-app-region:no-drag]')}
      data-testid="sidebar-nav-resize"
      onDoubleClick={() => $sidebarNavHeight.set(null)}
      onPointerDown={start}
      role="separator"
    >
      <span className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-(--ui-stroke-tertiary) opacity-0 transition-opacity duration-100 group-hover/nav-resize:opacity-100" />
    </div>
  )
}

interface SidebarNavBlockProps {
  children: ReactNode
  label: string
  layout: SidebarNavLayout
  rows: number
}

/** The nav group (titlebar clearance, scroll body, list/grid menu) plus its
 *  resize handle. The rows are the caller's. */
export function SidebarNavBlock({ children, label, layout, rows }: SidebarNavBlockProps) {
  return (
    <>
      <SidebarGroup className="shrink-0 p-0 pb-2 pt-[calc(var(--titlebar-height)+0.375rem)]">
        <SidebarGroupContent className={layout.bodyClassName} ref={layout.bodyRef} style={layout.bodyStyle}>
          <SidebarMenu className={layout.menuClassName}>{children}</SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarNavResizeHandle bodyRef={layout.bodyRef} label={label} rows={rows} />
    </>
  )
}
