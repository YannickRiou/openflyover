/**
 * A row that scrolls sideways with its scrollbar hidden (the rail on a phone, the timeline tools): `data-more-start` and
 * `data-more-end` mark the sides where some of it is hidden, and `scroll-fade-x` (utilities.css) fades those edges, so the
 * controls past the edge are not taken for missing.
 */
import { useEffect, useState } from 'react'

/** Sets the two marks of `el` from its scroll position. */
export function markScrollEdges(el: Pick<HTMLElement, 'scrollLeft' | 'clientWidth' | 'scrollWidth' | 'toggleAttribute'>): void {
  el.toggleAttribute('data-more-start', el.scrollLeft > 1)
  el.toggleAttribute('data-more-end', el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
}

/**
 * Keeps the marks of a row up to date while `enabled`: on scroll, on resize, when its content changes. Returns the ref
 * to give the row (a callback: the row may appear after the component, a timeline before its track).
 */
export function useScrollEdges(enabled = true): (el: HTMLElement | null) => void {
  const [el, setEl] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!el || !enabled) return
    const update = () => markScrollEdges(el)
    update()
    el.addEventListener('scroll', update, { passive: true })
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    resized?.observe(el)
    const changed = typeof MutationObserver === 'undefined' ? null : new MutationObserver(update)
    changed?.observe(el, { childList: true, subtree: true })
    return () => {
      el.removeEventListener('scroll', update)
      resized?.disconnect()
      changed?.disconnect()
      el.removeAttribute('data-more-start')
      el.removeAttribute('data-more-end')
    }
  }, [el, enabled])
  return setEl
}
