import { Popover as HeroPopover } from '@heroui/react/popover'
import { useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { openDialog, panelClass, useNoBrowserMenu } from './overlay'
import type { OverlayPlacement, OverlayPoint } from './overlay'

/** The panel: scrolls when the window is shorter; its dialog takes no focus ring of its own. */
const PANEL = 'overflow-auto overscroll-contain [&_[role=dialog]]:outline-none'

export interface PopoverProps {
  /** The name of the panel for a screen reader (already translated). */
  label: string
  /** What opens it, on a click, a tap or Enter: a `Button`, or an element that forwards its `ref` and press. */
  trigger?: ReactElement
  /** Or: it opens by itself at this point (the nearest positioned ancestor's pixels), as long as this is set; `onClose` is called when it closes. */
  point?: OverlayPoint | null
  onClose?(): void
  /** Above or under the trigger, aligned to its end, by default under; it flips and shifts to stay inside the window. */
  placement?: OverlayPlacement
  /** On a phone (`COMPACT_QUERY` of the shell) a bottom sheet over the whole width instead of a panel next to its trigger. */
  sheet?: boolean
  /** Width of the panel (px) instead of its content's. */
  width?: number
  /** The content; a function is given `close`, to shut the panel after an action. */
  children: ReactNode | ((close: () => void) => ReactNode)
}

/**
 * A small panel over the screen with its own controls: Tab moves in it, Escape closes it and gives the focus back (it stays the
 * panel's own while it is open, `data-local-escape`: the app's own Escape comes after), a click or tap outside closes it. It is
 * portalled out of its container, so a scrolling panel does not clip it, into the open `Modal` if there is one.
 */
export function Popover({ label, trigger, point, onClose, placement = 'bottom end', sheet, width, children }: PopoverProps) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [container, setContainer] = useState<Element | undefined>()
  useNoBrowserMenu(Boolean(point))
  if (!trigger && !point) return null

  const close = () => (point ? onClose?.() : setOpen(false))
  const content = (
    <HeroPopover.Dialog aria-label={label}>{typeof children === 'function' ? children(close) : children}</HeroPopover.Dialog>
  )
  const panel = {
    placement,
    offset: 6,
    containerPadding: 8,
    className: panelClass(PANEL, sheet),
    style: width ? { width } : undefined,
    'data-local-escape': '',
  }

  if (point) {
    return (
      <>
        <span ref={anchor} className="overlay-anchor" aria-hidden="true" style={{ left: point.x, top: point.y }} />
        <HeroPopover.Content {...panel} isOpen triggerRef={anchor} UNSTABLE_portalContainer={openDialog()} onOpenChange={(next) => !next && onClose?.()}>
          {content}
        </HeroPopover.Content>
      </>
    )
  }
  return (
    <HeroPopover
      isOpen={open}
      onOpenChange={(next) => {
        if (next) setContainer(openDialog())
        setOpen(next)
      }}
    >
      {trigger}
      <HeroPopover.Content {...panel} UNSTABLE_portalContainer={container}>
        {content}
      </HeroPopover.Content>
    </HeroPopover>
  )
}
