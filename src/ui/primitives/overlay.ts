import { useEffect } from 'react'

/** Where an overlay opens relative to what opens it. */
export type OverlayPlacement = 'top' | 'bottom' | 'top start' | 'top end' | 'bottom start' | 'bottom end'

/** The point (px, in the nearest positioned ancestor) an overlay opens at when nothing is there to open it: a right click, a long press. */
export interface OverlayPoint {
  x: number
  y: number
}

/** The modal dialog (`Modal`) that is open: an overlay is portalled into it, else the page's inert state would hide it behind. */
export const openDialog = (): Element | undefined => document.querySelector('[data-modal]') ?? undefined

/** A modal dialog is open: it takes the keyboard (the application's own shortcuts wait). */
export const isModalOpen = (): boolean => document.querySelector('[data-modal]') !== null

/** The classes of the panel of an overlay: the frame they share (`overlay-frame`, `overlay-sheet`: utilities.css) and the panel's own `kind`. */
export const panelClass = (kind: string, sheet?: boolean) => ['overlay-frame', kind, sheet && 'overlay-sheet'].filter(Boolean).join(' ')

/** While a point overlay is open, a right click elsewhere closes it without the browser's own menu opening over the page. */
export function useNoBrowserMenu(active: boolean) {
  useEffect(() => {
    if (!active) return
    const stop = (e: Event) => e.preventDefault()
    document.addEventListener('contextmenu', stop, true)
    return () => document.removeEventListener('contextmenu', stop, true)
  }, [active])
}
