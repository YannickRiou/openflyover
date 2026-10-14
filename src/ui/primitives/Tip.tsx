import { Tooltip } from '@heroui/react/tooltip'
import type { TooltipContentProps } from '@heroui/react/tooltip'
import { cloneElement, useEffect, useMemo, useState } from 'react'
import type { ReactElement, Ref, RefCallback } from 'react'

export type TipSide = 'top' | 'bottom' | 'left' | 'right'

export interface TipProps {
  /** The tooltip (already translated). Nothing is shown when empty. */
  text: string | undefined
  /** Where it opens: under the element by default; it flips and shifts to stay inside the window. */
  side?: TipSide
  /** With `top` or `bottom`: starts or ends with the element instead of being centred on it (an element near the edge of a column). */
  align?: 'start' | 'end'
  /** One sentence that wraps inside this width (px) instead of a single line (ⓘ, render weight). */
  wrap?: number
  /** A tap shows it too on a touch screen, until the focus leaves the element (it must take the focus: ⓘ). */
  tap?: boolean
  /** No tooltip now (the tab bar of a phone). */
  disabled?: boolean
  /** The one element it describes: a native element, or a primitive that forwards its `ref`. */
  children: ReactElement<{ ref?: Ref<HTMLElement> }>
}

/** The tooltip: the ink chrome in both themes (the overlay colours of theme.css), a short text, never in the way of the pointer. */
const TIP =
  'fade-in pointer-events-none rounded-sm border border-ink-soft bg-chrome-raised px-2 py-1 text-hint font-medium text-white shadow-pop'

/** Pause before it opens, on hover, keyboard focus and a held touch. */
const DELAY_MS = 450

function mergeRefs(...refs: (Ref<HTMLElement | null> | undefined)[]): RefCallback<HTMLElement> {
  return (node) => {
    const cleanups = refs.map((ref) => {
      if (typeof ref === 'function') return ref(node)
      if (ref) ref.current = node
      return undefined
    })
    return () => {
      refs.forEach((ref, i) => {
        const cleanup = cleanups[i]
        if (typeof cleanup === 'function') cleanup()
        else if (typeof ref === 'function') ref(null)
        else if (ref) ref.current = null
      })
    }
  }
}

/**
 * A tooltip on `children`, opened by the mouse after a short pause, by keyboard focus (not by a click's focus), by a
 * long press on a touch screen, and closed by leaving, pressing, blurring or any key (Escape is not taken: the app
 * closes what it closes). It does not wrap the element: its listeners sit on it and the text is portalled (into the
 * modal dialog that holds it, which would hide it otherwise).
 */
export function Tip({ text, side = 'bottom', align, wrap, tap, disabled, children }: TipProps) {
  const [node, setNode] = useState<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  // where the tooltip is portalled: the dialog that holds the element, else the page
  const [container, setContainer] = useState<Element | undefined>()
  const active = Boolean(text) && !disabled

  useEffect(() => {
    const el = node
    if (!el || !active) return
    let timer = 0
    const reveal = () => {
      setContainer(el.closest('[data-modal]') ?? undefined)
      setOpen(true)
    }
    const show = (delay: number) => {
      window.clearTimeout(timer)
      timer = window.setTimeout(reveal, delay)
    }
    const hide = () => {
      window.clearTimeout(timer)
      setOpen(false)
    }
    const touch = (e: PointerEvent) => e.pointerType === 'touch'
    const listeners: [string, (e: never) => void][] = [
      ['pointerenter', (e: PointerEvent) => !touch(e) && show(DELAY_MS)],
      ['pointerleave', (e: PointerEvent) => !touch(e) && hide()],
      ['pointerdown', (e: PointerEvent) => (touch(e) ? show(DELAY_MS) : hide())],
      ['pointerup', (e: PointerEvent) => touch(e) && (tap ? reveal() : hide())],
      ['pointercancel', hide],
      ['focusin', (e: FocusEvent) => e.target instanceof Element && e.target.matches(':focus-visible') && show(DELAY_MS)],
      ['focusout', hide],
      ['keydown', hide],
    ]
    for (const [type, listener] of listeners) el.addEventListener(type, listener as EventListener)
    return () => {
      for (const [type, listener] of listeners) el.removeEventListener(type, listener as EventListener)
      hide()
    }
  }, [node, active, tap])

  // (a null node, while a changed `ref` of the child is swapped, is ignored: it would close an open tooltip)
  const childRef = children.props.ref
  const ref = useMemo(
    () =>
      mergeRefs(childRef, (el) => {
        if (el) setNode(el)
      }),
    [childRef],
  )
  const triggerRef = useMemo(() => ({ current: node }), [node])

  const placement = (align && (side === 'top' || side === 'bottom') ? `${side} ${align}` : side) as TooltipContentProps['placement']
  return (
    <>
      {cloneElement(children, { ref })}
      {active && (
        <Tooltip isOpen={open} onOpenChange={setOpen}>
          <Tooltip.Content
            triggerRef={triggerRef}
            placement={placement}
            offset={side === 'left' || side === 'right' ? 10 : 8}
            containerPadding={8}
            UNSTABLE_portalContainer={container}
            className={wrap ? `${TIP} w-max whitespace-normal` : `${TIP} whitespace-nowrap`}
            style={wrap ? { maxWidth: wrap } : undefined}
          >
            {text}
          </Tooltip.Content>
        </Tooltip>
      )}
    </>
  )
}
