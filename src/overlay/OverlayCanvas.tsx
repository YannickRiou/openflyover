import { useEffect, useRef } from 'react'
import { deviceBudget } from '../core/deviceBudget'
import { isExportBusy, useExportStore } from '../export/store'
import { useMusicPreview } from '../film/audio'
import { getMediaBitmaps, mediaToLoad } from '../film/media'
import type { FilmMedia } from '../film/model'
import { clipRateAt } from '../film/timeline'
import { getPreviewVideos } from '../film/video'
import { useRegionStore } from '../osm/region'
import { useForestStore, useGlacierStore, useLandmarkStore, useWaterStore } from '../osm/store'
import { useFilmClock } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { useWeatherStore } from '../weather/store'
import { createCardImages, createLogos, loadOverlayFonts } from './assets'
import { overlayFilmFrameAt } from './data'
import { drawOverlay, overlayTime } from './draw'
import { createOverlayFilmCache, overlayExtras, photoAssets } from './exportOverlay'

/**
 * Preview of the film overlay: a 2D canvas stacked over the 3D view, redrawn by `drawOverlay` on the next animation
 * frame after any change of what it reads (store subscriptions, no React render per frame). Video clips are video
 * elements playing along during the playback, seeked to the film time when scrubbing (none during an export, which
 * decodes its own frames). Rendered while there is a track.
 * Frozen during an export (the progress changes every frame there, and the export composes its own overlay).
 */
export function OverlayCanvas() {
  // the full credits close every film: there is always something to draw
  const enabled = useAppStore((s) => s.tracks.length > 0)
  return enabled ? <OverlayPreview /> : null
}

/** Photos decoded this long before they appear (seconds of film time). */
const PHOTO_AHEAD_S = 2

function OverlayPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const clock = useFilmClock()
  const clockRef = useRef(clock)
  const scheduleRef = useRef<() => void>(() => {})
  useEffect(() => {
    clockRef.current = clock
    scheduleRef.current()
  }, [clock])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    let raf = 0
    let disposed = false
    let fontsReady = false
    const film = createOverlayFilmCache()
    const logos = createLogos(() => schedule())
    const bitmaps = getMediaBitmaps()
    const videos = getPreviewVideos()
    const cardImage = createCardImages(() => schedule())

    const draw = () => {
      raf = 0
      const { tracks, playback, settings } = useAppStore.getState()
      const overlay = settings.overlay
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      // the 3D view's ratio at most: an iPhone's 3 would make 4× the pixels of its 3D view (1.5 while moving)
      const dpr = Math.min(window.devicePixelRatio || 1, deviceBudget().maxPixelRatio)
      const pixelW = Math.max(1, Math.round(width * dpr))
      const pixelH = Math.max(1, Math.round(height * dpr))
      if (canvas.width !== pixelW || canvas.height !== pixelH) {
        canvas.width = pixelW
        canvas.height = pixelH
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      // first frame only once the fonts are there: no flash of fallback faces
      const data = tracks.length > 0 ? film() : null
      if (!fontsReady || !data || width === 0 || height === 0) return

      const frame = overlayFilmFrameAt(data, playback.progress)
      logos.sync(overlay.logos.map((logo) => logo.image))
      ctx.setTransform(pixelW / width, 0, 0, pixelH / height, 0, 0)
      const time = overlayTime(clockRef.current, playback.progress, playback.timeS)
      // decode the photos coming up before they fade in
      for (const id of mediaToLoad(settings.film.media, time.timeS, PHOTO_AHEAD_S)) bitmaps.get(id)
      const sound = { ...playback, muted: useMusicPreview.getState().muted }
      const video = isExportBusy(useExportStore.getState().phase)
        ? undefined
        : (item: FilmMedia, clipS: number) => videos.frame(item, clipS, sound, clipRateAt(item, data.whole.path, clockRef.current, time.timeS))
      drawOverlay(ctx, frame, overlay, { width, height }, { logos: logos.logos(), ...photoAssets(), video, cardImage }, overlayExtras(time, playback.progress))
      // clips not drawn by this frame are paused
      videos.settle()
    }
    // frozen during an export, which draws its own overlay frame by frame: the preview is redrawn once it ends
    const schedule = () => {
      if (!raf && !disposed && !isExportBusy(useExportStore.getState().phase)) raf = requestAnimationFrame(draw)
    }

    scheduleRef.current = schedule

    const unsubscribe = useAppStore.subscribe((state, prev) => {
      if (
        state.playback.progress !== prev.playback.progress ||
        state.playback.timeS !== prev.playback.timeS ||
        state.playback.playing !== prev.playback.playing ||
        state.playback.speed !== prev.playback.speed ||
        state.settings !== prev.settings ||
        state.tracks !== prev.tracks
      ) {
        schedule()
      }
    })
    const unsubscribeWeather = useWeatherStore.subscribe((state, prev) => {
      if (state.series !== prev.series || state.status !== prev.status || state.stages !== prev.stages) schedule()
    })
    const unsubscribeLandmarks = useLandmarkStore.subscribe((state, prev) => {
      if (state.landmarks !== prev.landmarks) schedule()
    })
    // the OpenStreetMap credit also follows the water, forest and glacier polygons and the highlighted region
    const unsubscribeWater = useWaterStore.subscribe((state, prev) => {
      if (state.polygons !== prev.polygons) schedule()
    })
    const unsubscribeForest = useForestStore.subscribe((state, prev) => {
      if (state.polygons !== prev.polygons) schedule()
    })
    const unsubscribeGlacier = useGlacierStore.subscribe((state, prev) => {
      if (state.polygons !== prev.polygons) schedule()
    })
    const unsubscribeRegion = useRegionStore.subscribe((state, prev) => {
      if (state.region !== prev.region) schedule()
    })
    const unsubscribeExport = useExportStore.subscribe((state, prev) => {
      if (isExportBusy(state.phase) !== isExportBusy(prev.phase)) schedule()
    })
    const unsubscribeSound = useMusicPreview.subscribe(schedule)
    const unsubscribePhotos = bitmaps.subscribe(schedule)
    const unsubscribeVideos = videos.subscribe(schedule)
    // size changes, including a devicePixelRatio change (browser zoom, moving to another screen)
    const observer = new ResizeObserver(schedule)
    observer.observe(canvas)
    window.addEventListener('resize', schedule)
    loadOverlayFonts().then(() => {
      fontsReady = true
      schedule()
    })
    schedule()

    return () => {
      logos.dispose()
      disposed = true
      cancelAnimationFrame(raf)
      scheduleRef.current = () => {}
      unsubscribe()
      unsubscribeWeather()
      unsubscribeLandmarks()
      unsubscribeWater()
      unsubscribeForest()
      unsubscribeGlacier()
      unsubscribeRegion()
      unsubscribeExport()
      unsubscribeSound()
      unsubscribePhotos()
      unsubscribeVideos()
      videos.settle()
      observer.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [])

  return <canvas ref={canvasRef} className="pointer-events-none size-full" aria-hidden="true" />
}
