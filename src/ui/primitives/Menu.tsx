import { Dropdown } from '@heroui/react/dropdown'
import { useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { openDialog, panelClass, useNoBrowserMenu } from './overlay'
import type { OverlayPlacement, OverlayPoint } from './overlay'

export interface MenuItem {
  /** unique in the menu */
  id: string
  /** The text (already translated): also what a typed letter jumps to. */
  label: string
  /** drawn before the text */
  icon?: ReactNode
  disabled?: boolean
  /** Called when it is picked (click, tap, Enter, Space); the menu closes after it. */
  onSelect(): void
}

export interface MenuProps {
  /** The name of the menu for a screen reader (already translated). */
  label: string
  items: readonly MenuItem[]
  /** What opens it, on a click, a tap or the arrow keys: a `Button`, or an element that forwards its `ref` and press. */
  trigger?: ReactElement
  /**
   * Or: it opens by itself at this point (the nearest positioned ancestor's pixels), as long as this is set, the first item
   * focused; `onClose` is called when it closes (Escape, a click elsewhere, an item picked).
   */
  point?: OverlayPoint | null
  onClose?(): void
  /** Under the trigger, aligned to its end, by default; it flips and shifts to stay inside the window. */
  placement?: OverlayPlacement
  /** On a phone (`COMPACT_QUERY` of the shell) a bottom sheet over the whole width instead of a panel next to its trigger. */
  sheet?: boolean
}

/**
 * A menu of actions: arrows, Home / End and typed letters move in it, Enter or Space picks, Escape closes it and gives the
 * focus back. Escape stays the menu's own while it is open (`data-local-escape`: the app's own Escape comes after).
 * It is portalled out of its container, so a scrolling panel does not clip it, into the open `Modal` if there is one.
 */
export function Menu({ label, items, trigger, point, onClose, placement = 'bottom end', sheet }: MenuProps) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [container, setContainer] = useState<Element | undefined>()
  useNoBrowserMenu(Boolean(point))
  if (!trigger && !point) return null

  const menu = (
    <Dropdown.Menu aria-label={label} autoFocus={point ? 'first' : undefined} className="menu" onAction={point ? () => onClose?.() : undefined}>
      {items.map((item) => (
        <Dropdown.Item key={item.id} id={item.id} textValue={item.label} isDisabled={item.disabled} className="menu__item" onAction={item.onSelect}>
          {item.icon}
          {item.label}
        </Dropdown.Item>
      ))}
    </Dropdown.Menu>
  )
  const popover = { placement, offset: 6, containerPadding: 8, className: panelClass('menu-panel', sheet), 'data-local-escape': '' }

  if (point) {
    return (
      <>
        <span ref={anchor} className="overlay-anchor" aria-hidden="true" style={{ left: point.x, top: point.y }} />
        <Dropdown.Popover {...popover} isOpen triggerRef={anchor} UNSTABLE_portalContainer={openDialog()} onOpenChange={(open) => !open && onClose?.()}>
          {menu}
        </Dropdown.Popover>
      </>
    )
  }
  return (
    <Dropdown onOpenChange={(open) => open && setContainer(openDialog())}>
      {trigger}
      <Dropdown.Popover {...popover} UNSTABLE_portalContainer={container}>
        {menu}
      </Dropdown.Popover>
    </Dropdown>
  )
}
