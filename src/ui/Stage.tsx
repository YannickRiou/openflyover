import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { VIDEO_ASPECTS } from '../export/schedule'
import { isExportBusy, useExportStore } from '../export/store'
import { useT } from '../i18n'
import { useHandViewStore } from '../scene/handView'
import { useAppStore } from '../state/store'
import { Icon } from './icons'
import { SafeZones, useSafeZonesStore } from './SafeZones'
import { frameRect } from './shell'
import { withShortcut } from './shortcuts'
import { Button, Tip } from './primitives'

// the 3D scene (three.js, atmosphere, clouds, terrain) is its own chunk: the shell and the welcome card paint first
const FlyoverCanvas = lazy(() => import('../scene/FlyoverCanvas').then((m) => ({ default: m.FlyoverCanvas })))
const OverlayCanvas = lazy(() => import('../overlay/OverlayCanvas').then((m) => ({ default: m.OverlayCanvas })))

/** Pale sky behind the transparent canvas of a view that fills the stage. */
const SKY = 'bg-[linear-gradient(180deg,var(--color-glacier)_0%,var(--color-paper)_100%)]'
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
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

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

  return (
    <div
      ref={viewport}
      className={`relative min-h-0 flex-1 overflow-hidden ${aspect === null ? SKY : 'bg-chrome'} ${hasTracks ? 'phone:h-(--phone-preview-h) phone:flex-none' : ''}`}
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
      {hasTracks && (
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
      {aspect !== null && (
        <Tip text={withShortcut(t('stage.safeZonesTip'), 'safe-zones')} side="left">
          <Button
            variant="icon"
            className={`${FLOAT} top-14 touch:top-16`}
            onClick={() => useSafeZonesStore.getState().toggle()}
            aria-pressed={safeZones}
            aria-label={t('stage.safeZones')}
          >
            <Icon name="square-dashed" />
          </Button>
        </Tip>
      )}
      {aspect !== null && (
        <Tip text={t('stage.capture')} side="left">
          {/* none in « Libre »: its view is not the picture of the film. The view as it is now, once moved by hand. */}
          <Button
            variant="icon"
            className={`${FLOAT} top-25 touch:top-29`}
            onClick={() => void import('../poster/export').then((m) => m.startStill(away))}
            disabled={exporting}
            aria-label={t('stage.capture')}
          >
            <Icon name="image" />
          </Button>
        </Tip>
      )}
      {hasTracks && away && (
        <Tip text={t('stage.filmView')} side="left">
          <Button
            variant="icon"
            className={`${FLOAT} ${aspect === null ? 'top-14 touch:top-16' : 'top-36 touch:top-42'}`}
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
