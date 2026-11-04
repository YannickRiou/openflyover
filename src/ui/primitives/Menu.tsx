import { Dropdown } from '@heroui/react/dropdown'
import { Separator } from '@heroui/react/separator'
import { useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Icon } from '../icons'
import { openDialog, panelClass, useNoBrowserMenu } from './overlay'
import type { OverlayPlacement, OverlayPoint } from './overlay'

/** The panel of the menu: a width to read the rows in, and a scroll when the window is shorter. */
const PANEL = 'min-w-50 overflow-auto overscroll-contain'

export interface MenuItem {
  /** unique in the menu */
  id: string
  /** The text (already translated): also what a typed letter jumps to. */
  label: string
  /** drawn before the text */
  icon?: ReactNode
  disabled?: boolean
  /** A line under the row, to set the rows after it apart (a group of the menu). */
  separator?: boolean
  /** The chosen one of a list of choices: the row is lit and ends with a check. Set it on every row of such a menu. */
  selected?: boolean
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

  const choices = items.some((item) => item.selected !== undefined)
  const menu = (
    <Dropdown.Menu
      aria-label={label}
      autoFocus={point ? 'first' : undefined}
      className="flex flex-col p-1 outline-none"
      selectionMode={choices ? 'single' : undefined}
      selectedKeys={choices ? items.filter((item) => item.selected).map((item) => item.id) : undefined}
      onAction={point ? () => onClose?.() : undefined}
    >
      {items.flatMap((item) => [
        <Dropdown.Item key={item.id} id={item.id} textValue={item.label} isDisabled={item.disabled} className="overlay-item" onAction={item.onSelect}>
          {item.icon}
          {item.label}
          {item.selected && (
            <span className="ml-auto flex" aria-hidden="true">
              <Icon name="check" size={18} />
            </span>
          )}
        </Dropdown.Item>,
        item.separator && <Separator key={`${item.id}-line`} className="my-1 h-px flex-none bg-white/15" />,
      ])}
    </Dropdown.Menu>
  )
  const popover = { placement, offset: 6, containerPadding: 8, className: panelClass(PANEL, sheet), 'data-local-escape': '' }

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
