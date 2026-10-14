import { useRef } from 'react'
import type { PointerEvent } from 'react'
import { useT } from '../i18n'
import { Icon } from './icons'
import { dismissSheet } from './shell'
import { Button, Tip } from './primitives'

/** Travel (CSS pixels) beyond which a press on the head is a drag, not a tap. */
const DRAG_SLOP_PX = 6

interface Drag {
  sheet: HTMLElement
  y0: number
  y: number
  t: number
  /** px per second, down positive */
  velocity: number
  moved: boolean
}

/**
 * Head of a half sheet (portrait phone only, hidden by shell.css otherwise): grip, optional title and « Terminé » (✓),
 * which closes it; dragging the head down past a third of the sheet (or a flick down) closes it too.
 */
export function SheetHandle({ title, onClose }: { title?: string; onClose(): void }) {
  const t = useT()
  const drag = useRef<Drag | null>(null)

  const release = (sheet: HTMLElement) => {
    sheet.style.transform = ''
    sheet.style.transition = ''
  }
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const sheet = e.currentTarget.parentElement
    // the ✓ button keeps its own click
    if (!sheet || e.button !== 0 || (e.target instanceof Element && e.target.closest('button'))) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { sheet, y0: e.clientY, y: e.clientY, t: e.timeStamp, velocity: 0, moved: false }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const dt = (e.timeStamp - d.t) / 1000
    if (dt > 0) d.velocity = (e.clientY - d.y) / dt
    d.y = e.clientY
    d.t = e.timeStamp
    if (!d.moved && Math.abs(e.clientY - d.y0) < DRAG_SLOP_PX) return
    d.moved = true
    d.sheet.style.transition = 'none'
    d.sheet.style.transform = `translateY(${Math.max(0, e.clientY - d.y0)}px)`
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (!d?.moved) return
    // a pause before the release is no flick
    const velocity = e.timeStamp - d.t > 100 ? 0 : d.velocity
    const close = dismissSheet(e.clientY - d.y0, d.sheet.offsetHeight, velocity)
    release(d.sheet)
    if (close) onClose()
  }
  const onPointerCancel = () => {
    const d = drag.current
    drag.current = null
    if (d) release(d.sheet)
  }

  return (
    <div className="sheet-handle" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
      <span className="sheet-handle__bar" aria-hidden="true" />
      {title && <span className="sheet-handle__title">{title}</span>}
      <Tip text={t('common.done')} align="end">
        <Button variant="icon" className="sheet-handle__done" onClick={onClose} aria-label={t('common.done')}>
          <Icon name="check" size={22} />
        </Button>
      </Tip>
    </div>
  )
}
