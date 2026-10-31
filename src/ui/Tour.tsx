import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { Button, isModalOpen } from './primitives'
import { placeBubble, startTour, stopTour, tourSeen, useTour } from './tour'
import type { Box, TourStep } from './tour'

/** The bubble's width (px): it shrinks on a narrow window. */
const BUBBLE_WIDTH = 320
/** Wait before the first launch's tour starts: the window has its screen by then. */
const START_DELAY_MS = 1500
/** Try again this often while a dialog is open. */
const RETRY_MS = 2000

function boxOf(step: TourStep | undefined): Box | null {
  const element = step?.selector ? document.querySelector(step.selector) : null
  if (!element) return null
  const r = element.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/**
 * The guided tour: a bubble that points at one part of the screen after the other. It starts by itself at the first launch
 * (never in an automated browser), « Arrêter la visite » or Escape stops it at any step, and the help can start it again.
 */
export function Tour() {
  const t = useT()
  const { open, step, steps } = useTour()
  const [box, setBox] = useState<Box | null>(null)
  const [spot, setSpot] = useState<{ left: number; top: number }>({ left: 0, top: 0 })
  const bubble = useRef<HTMLDivElement>(null)

  // first launch
  useEffect(() => {
    if (tourSeen() || navigator.webdriver) return
    let timer: ReturnType<typeof setTimeout>
    const attempt = () => {
      if (tourSeen()) return
      if (isModalOpen()) timer = setTimeout(attempt, RETRY_MS)
      else startTour()
    }
    timer = setTimeout(attempt, START_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  const current = steps[step]
  useLayoutEffect(() => {
    if (!open || !current) return
    const place = () => {
      const target = boxOf(current)
      setBox(target)
      const size = { width: bubble.current?.offsetWidth ?? BUBBLE_WIDTH, height: bubble.current?.offsetHeight ?? 160 }
      setSpot(placeBubble(target, size, { width: window.innerWidth, height: window.innerHeight }))
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, current])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isModalOpen()) stopTour()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open || !current) return null
  const last = step === steps.length - 1
  return (
    <>
      {box && <div className="tour-ring" style={{ left: box.left - 4, top: box.top - 4, width: box.width + 8, height: box.height + 8 }} aria-hidden="true" />}
      <div
        ref={bubble}
        role="dialog"
        aria-label={t('shell.tour.aria')}
        className="tour-bubble"
        style={{ left: spot.left, top: spot.top, width: `min(${BUBBLE_WIDTH}px, calc(100vw - 24px))` }}
        data-testid="tour"
      >
        <p className="type-hint">{t('shell.tour.step', { n: step + 1, total: steps.length })}</p>
        <h2 className="mt-1 font-heading text-title font-semibold">{t(current.title)}</h2>
        <p className="mt-2 text-body">{t(current.body)}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button variant="icon" size="sm" onClick={stopTour}>
            {t('shell.tour.stop')}
          </Button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="secondary" size="sm" onClick={() => useTour.setState({ step: step - 1 })}>
                {t('shell.tour.back')}
              </Button>
            )}
            <Button variant="primary" size="sm" autoFocus onClick={() => (last ? stopTour() : useTour.setState({ step: step + 1 }))}>
              {t(last ? 'shell.tour.done' : 'shell.tour.next')}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
