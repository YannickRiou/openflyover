import { useEffect } from 'react'

/** Where an overlay opens relative to what opens it. */
export type OverlayPlacement = 'top' | 'bottom' | 'top start' | 'top end' | 'bottom start' | 'bottom end'

/** The point (px, in the nearest positioned ancestor) an overlay opens at when nothing is there to open it: a right click, a long press. */
export interface OverlayPoint {
  x: number
  y: number
}

/** The `<dialog>` that is open (it holds the page's top layer): an overlay is portalled into it, else it would be hidden behind. */
export const openDialog = (): Element | undefined => document.querySelector('dialog[open]') ?? undefined

/** The classes of the panel of an overlay (`overlay.css`). */
export const panelClass = (kind: string, sheet?: boolean) => ['overlay', kind, sheet && 'overlay--sheet'].filter(Boolean).join(' ')

/** While a point overlay is open, a right click elsewhere closes it without the browser's own menu opening over the page. */
export function useNoBrowserMenu(active: boolean) {
  useEffect(() => {
    if (!active) return
    const stop = (e: Event) => e.preventDefault()
    document.addEventListener('contextmenu', stop, true)
    return () => document.removeEventListener('contextmenu', stop, true)
  }, [active])
}
