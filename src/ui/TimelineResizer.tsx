import { useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { useT } from '../i18n'
import { getPlatform } from '../platform'
import { TIMELINE_HEIGHT_KEY, TIMELINE_STEP_LARGE_PX, TIMELINE_STEP_PX, clampTimelineHeight, parseTimelineHeight, timelineHeightRange } from './layoutSize'
import './timelineResizer.css'

function load(): number | null {
  try {
    return parseTimelineHeight(getPlatform().storage.get(TIMELINE_HEIGHT_KEY))
  } catch {
    return null
  }
}

function save(height: number | null): void {
  try {
    const storage = getPlatform().storage
    if (height === null) storage.remove(TIMELINE_HEIGHT_KEY)
    else storage.set(TIMELINE_HEIGHT_KEY, JSON.stringify({ timelineH: height }))
  } catch {
    // storage unavailable: the height lasts for the session
  }
}

interface Drag {
  y0: number
  height0: number
  moved: boolean
}

/**
 * Separator between the 3D view and the timeline (wide layouts only, shown by `timelineResizer.css`): drag it, or use
 * Up / Down (Shift: larger steps), Home / End (smallest / largest), double-click to go back to the default layout. Must
 * be a child of `.view`, just above the timeline; the view carries the height (`--timeline-h`, only once sized). The
 * height is remembered on this device, not in the project, and kept within the window again when it is resized.
 */
export function TimelineResizer({ disabled = false }: { disabled?: boolean }) {
  const t = useT()
  const handle = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  /** the chosen height, null = the timeline's own height (default) */
  const [chosen, setChosen] = useState<number | null>(load)
  const [dragging, setDragging] = useState(false)
  const [shown, setShown] = useState({ now: 0, min: 0, max: 0 })

  // apply the height to the view, and keep it within the space the window leaves (also when the window is resized)
  useLayoutEffect(() => {
    const view = handle.current?.parentElement
    if (!view) return
    const apply = () => {
      const barPx = view.querySelector<HTMLElement>('.film-tl__bar')?.offsetHeight
      const { min, max } = timelineHeightRange(view.clientHeight, barPx)
      const height = chosen === null ? null : clampTimelineHeight(chosen, view.clientHeight, barPx)
      if (height === null) {
        view.removeAttribute('data-timeline-sized')
        view.style.removeProperty('--timeline-h')
      } else {
        view.setAttribute('data-timeline-sized', '')
        view.style.setProperty('--timeline-h', `${height}px`)
      }
      const now = height ?? view.querySelector<HTMLElement>('.film-tl')?.offsetHeight ?? min
      setShown((s) => (s.now === now && s.min === min && s.max === max ? s : { now, min, max }))
    }
    apply()
    window.addEventListener('resize', apply)
    return () => {
      window.removeEventListener('resize', apply)
      view.removeAttribute('data-timeline-sized')
      view.style.removeProperty('--timeline-h')
    }
  }, [chosen])

  const choose = (height: number | null, remember = true) => {
    setChosen(height)
    if (remember) save(height)
  }
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return
    e.preventDefault()
    e.currentTarget.focus()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { y0: e.clientY, height0: shown.now, moved: false }
    setDragging(true)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    const view = handle.current?.parentElement
    if (!d || !view) return
    d.moved = true
    // the handle goes up: the timeline grows
    choose(clampTimelineHeight(d.height0 + d.y0 - e.clientY, view.clientHeight), false)
  }
  const onPointerEnd = () => {
    const d = drag.current
    drag.current = null
    setDragging(false)
    if (d?.moved) save(chosen)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || e.altKey || e.ctrlKey || e.metaKey) return
    const step = e.shiftKey ? TIMELINE_STEP_LARGE_PX : TIMELINE_STEP_PX
    const next =
      e.key === 'ArrowUp' ? shown.now + step : e.key === 'ArrowDown' ? shown.now - step : e.key === 'Home' ? shown.min : e.key === 'End' ? shown.max : null
    if (next === null) return
    // the seek shortcuts (← → Home End) leave a key that something else already handled
    e.preventDefault()
    choose(Math.min(shown.max, Math.max(shown.min, next)))
  }

  return (
    <div
      ref={handle}
      className={dragging ? 'timeline-resizer timeline-resizer--dragging' : 'timeline-resizer'}
      role="separator"
      aria-orientation="horizontal"
      aria-label={t('timeline.resizer.label')}
      aria-valuenow={shown.now}
      aria-valuemin={shown.min}
      aria-valuemax={shown.max}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        if (!disabled) choose(null)
      }}
    />
  )
}
