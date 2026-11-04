import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { VIDEO_ASPECTS } from '../export/schedule'
import { isExportBusy, useExportStore } from '../export/store'
import { useT } from '../i18n'
import { useHandViewStore } from '../scene/handView'
import { create } from 'zustand'
import { useAppStore } from '../state/store'
import { Icon } from './icons'
import { SafeZones, useSafeZonesStore } from './SafeZones'
import { BOTTOM_SHEET_QUERY, frameRect, matchesQuery, phonePreviewHeight } from './shell'
import { withShortcut } from './shortcuts'
import { Button, Tip } from './primitives'

// the 3D scene (three.js, atmosphere, clouds, terrain) is its own chunk: the shell and the welcome card paint first
const FlyoverCanvas = lazy(() => import('../scene/FlyoverCanvas').then((m) => ({ default: m.FlyoverCanvas })))
const OverlayCanvas = lazy(() => import('../overlay/OverlayCanvas').then((m) => ({ default: m.OverlayCanvas })))

/** Pale sky behind the transparent canvas of a view that fills the stage. */
const SKY = 'bg-[linear-gradient(180deg,var(--color-glacier)_0%,var(--color-paper)_100%)]'
/** A phone on its side (the `phone-landscape` variant). */
const LANDSCAPE_QUERY = '(max-height: 499px) and (min-aspect-ratio: 1/1)'

/**
 * The view over the whole screen, on a phone (Safari on an iPhone has no full screen for a page, only for a video): the stage
 * covers the screen, play or pause and a ✕ on it. `auto`: it came with a turn of the phone while the film played, and goes
 * with the turn back.
 */
export const useViewFull = create<{ full: boolean; auto: boolean }>(() => ({ full: false, auto: false }))

/** A button floating over the view, at its right edge (the top is set per button, 3.5 rem apart, 4 rem on a touch screen). */
const FLOAT = 'btn-float absolute right-3 z-4'

/**
 * Centre of the shell: the 3D view and its overlay framed to the output format (letterbox in ink, the export
 * renders exactly this area), or filling the stage with « Libre » or without a track; the « Recadrer », « Zones de
 * sécurité », « Capturer cette image » and « Revenir à la vue du film » buttons, the welcome card and the messages
 * (`children`) float over it.
 */
export function Stage({ children }: { children?: ReactNode }) {
  const t = useT()
  const aspect = useAppStore((s) => {
    // nothing to frame before the first track: the welcome card sits on the whole stage
    if (s.freeFraming || s.tracks.length === 0) return null
    const a = VIDEO_ASPECTS.find((v) => v.id === s.settings.video.aspect)
    return a ? a.x / a.y : null
  })
  const aspectId = useAppStore((s) => s.settings.video.aspect)
  const safeZones = useSafeZonesStore((s) => s.visible)
  const hasTracks = useAppStore((s) => s.tracks.length > 0)
  // the 3D view and its WebGL context (on the high-performance GPU) are created with the first track, then kept: the
  // home screen keeps the GPU asleep. Its code still loads at once, so the first track does not wait for it.
  const [viewStarted, setViewStarted] = useState(hasTracks)
  if (hasTracks && !viewStarted) setViewStarted(true)
  useEffect(() => {
    void import('../scene/FlyoverCanvas')
  }, [])
  const exporting = useExportStore((s) => isExportBusy(s.phase))
  // the view was moved away from the film's (orbited while paused): the way back
  const away = useHandViewStore((s) => s.away)
  const viewport = useRef<HTMLDivElement>(null)
  // portrait phone: the capture and the safe zones fold behind one button (four buttons took 176 px of a 219 px view)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const full = useViewFull((s) => s.full)
  const playing = useAppStore((s) => s.playback.playing)
  const setPlaying = useAppStore((s) => s.setPlaying)
  // full screen: Escape leaves it; a phone turned on its side while the film plays takes it, turned back leaves it
  useEffect(() => {
    if (!full) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useViewFull.setState({ full: false, auto: false })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [full])
  useEffect(() => {
    const query = window.matchMedia?.(LANDSCAPE_QUERY)
    if (!query) return undefined
    const onTurn = () => {
      if (query.matches && useAppStore.getState().playback.playing && useAppStore.getState().tracks.length > 0) useViewFull.setState({ full: true, auto: true })
      else if (!query.matches && useViewFull.getState().auto) useViewFull.setState({ full: false, auto: false })
    }
    query.addEventListener('change', onTurn)
    return () => query.removeEventListener('change', onTurn)
  }, [])

  useLayoutEffect(() => {
    const el = viewport.current
    if (!el) return
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const rect = size && aspect !== null ? frameRect(size.width, size.height, aspect) : null

  // portrait phone: the preview is as tall as the frame of the format at the screen's width (the sheets start under it), not a fixed share with black bands
  useLayoutEffect(() => {
    if (!hasTracks) return undefined
    const root = document.documentElement
    const apply = () => {
      if (matchesQuery(BOTTOM_SHEET_QUERY)) root.style.setProperty('--phone-preview-h', `${phonePreviewHeight(window.innerWidth, window.innerHeight, aspect)}px`)
      else root.style.removeProperty('--phone-preview-h')
    }
    apply()
    window.addEventListener('resize', apply)
    return () => {
      window.removeEventListener('resize', apply)
      root.style.removeProperty('--phone-preview-h')
    }
  }, [hasTracks, aspect])

  return (
    <div
      ref={viewport}
      className={`relative min-h-0 flex-1 overflow-hidden ${aspect === null ? SKY : 'bg-chrome'} ${hasTracks ? 'phone:h-(--phone-preview-h) phone:flex-none' : ''}${full ? ' fixed! inset-0 z-60 h-auto! bg-black!' : ''}`}
      role="region"
      aria-label={t('stage.view')}
    >
      {/* `data-stage`: what the thumbnail looks for; its canvases and overlays fill it (`stage-frame`) */}
      <div className="stage-frame" data-stage="" style={rect ?? undefined}>
        {viewStarted && (
          <Suspense>
            <FlyoverCanvas />
          </Suspense>
        )}
        <Suspense>
          <OverlayCanvas />
        </Suspense>
        {rect && safeZones && <SafeZones aspect={aspectId} />}
      </div>
      {full && (
        <>
          <Button
            variant="icon"
            className="btn-float absolute top-[calc(env(safe-area-inset-top)+0.75rem)] right-[calc(env(safe-area-inset-right)+0.75rem)] z-5"
            onClick={() => useViewFull.setState({ full: false, auto: false })}
            aria-label={t('stage.fullExit')}
          >
            <Icon name="x" />
          </Button>
          <Button
            variant="icon"
            className="btn-float absolute bottom-[calc(env(safe-area-inset-bottom)+1rem)] left-1/2 z-5 -translate-x-1/2"
            onClick={() => setPlaying(!playing)}
            aria-label={playing ? t('timeline.bar.pause') : t('timeline.bar.play')}
          >
            <Icon name={playing ? 'pause' : 'play'} />
          </Button>
        </>
      )}
      {/* a phone: the view over the whole screen (bottom left, clear of the source credits at the right) */}
      {hasTracks && !full && (
        <Tip text={t('stage.full')} side="right">
          <Button
            variant="icon"
            className="btn-float absolute bottom-3 left-3 z-4 hidden phone-any:inline-flex"
            onClick={() => useViewFull.setState({ full: true, auto: false })}
            aria-label={t('stage.full')}
          >
            <Icon name="maximize" />
          </Button>
        </Tip>
      )}
      {hasTracks && !full && (
        <Tip text={withShortcut(t('stage.fit'), 'fit')} side="left">
          <Button
            variant="icon"
            className={`${FLOAT} top-3`}
            onClick={() => useAppStore.getState().requestFit()}
            disabled={exporting}
            aria-label={t('stage.fit')}
          >
            <Icon name="crosshair" />
          </Button>
        </Tip>
      )}
      {aspect !== null && !full && (
        <Tip text={t('stage.tools')} side="left">
          <Button
            variant="icon"
            className={`${FLOAT} hidden top-14 touch:top-16 phone:inline-flex`}
            onClick={() => setToolsOpen((open) => !open)}
            aria-pressed={toolsOpen}
            aria-label={t('stage.tools')}
          >
            <Icon name="sliders-horizontal" />
          </Button>
        </Tip>
      )}
      {aspect !== null && !full && (
        <Tip text={withShortcut(t('stage.safeZonesTip'), 'safe-zones')} side="left">
          <Button
            variant="icon"
            className={`${FLOAT} top-14 touch:top-16 phone:top-25 phone:touch:top-29 ${toolsOpen ? '' : 'phone:hidden'}`}
            onClick={() => useSafeZonesStore.getState().toggle()}
            aria-pressed={safeZones}
            aria-label={t('stage.safeZones')}
          >
            <Icon name="square-dashed" />
          </Button>
        </Tip>
      )}
      {aspect !== null && !full && (
        <Tip text={t('stage.capture')} side="left">
          {/* none in « Libre »: its view is not the picture of the film. The view as it is now, once moved by hand. */}
          <Button
            variant="icon"
            className={`${FLOAT} top-25 touch:top-29 phone:top-36 phone:touch:top-42 ${toolsOpen ? '' : 'phone:hidden'}`}
            onClick={() => void import('../poster/export').then((m) => m.startStill(away))}
            disabled={exporting}
            aria-label={t('stage.capture')}
          >
            <Icon name="image" />
          </Button>
        </Tip>
      )}
      {hasTracks && away && !full && (
        <Tip text={t('stage.filmView')} side="left">
          <Button
            variant="icon"
            className={`${FLOAT} ${aspect === null ? 'top-14 touch:top-16' : `top-36 touch:top-42 ${toolsOpen ? 'phone:top-47 phone:touch:top-55' : 'phone:top-25 phone:touch:top-29'}`}`}
            onClick={() => useHandViewStore.getState().returnToFilm()}
            disabled={exporting}
            aria-label={t('stage.filmView')}
          >
            <Icon name="clapperboard" />
          </Button>
        </Tip>
      )}
      {children}
    </div>
  )
}
