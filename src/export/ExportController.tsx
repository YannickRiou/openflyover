/**
 * ExportController — renders the film offline, frame by frame, when the export store receives a request.
 * Mounted inside the R3F canvas, inside TerrainLayer (it needs the terrain engine). See ARCHITECTURE.md "Video export".
 *
 * During an export: playback paused, frameloop 'never' (frames are drawn by `advance` only), renderer and camera at
 * the video size with a pixel ratio of 1, pointer events off. Each frame is rendered until the view has its tiles
 * (capture.ts), composed with the overlay into an OffscreenCanvas and encoded. A frame whose tiles cannot be had (given
 * up on, or still loading at the timeout) stops the export with the tiles named. Everything is restored afterwards, on
 * success, error or cancel.
 *
 * Motion blur (`settings.lens.shutter`): one render per sub-frame of the open shutter, averaged by the composer's
 * shutter effect. `overlayOnly` skips the scene and encodes the overlay with its transparency, frame for frame.
 */
import { deviceBudget, type DeviceBudget } from '../core/deviceBudget'
import { errorMessage } from '../core/errors'
import { useEffect, useRef } from 'react'
import { useThree, type RootState } from '@react-three/fiber'
import { PerspectiveCamera, Vector3 } from 'three'
import type { LocalFrame, TerrainEngine } from '../core/types'
import { mixFilmAudio } from '../film/audio'
import type { FilmClock } from '../film/clock'
import { useMediaStore } from '../film/media'
import { CAMERA_FOV_DEG, filmViewMovesWithTime, overviewView } from '../flyover/filmCamera'
import { filmTrackOf } from '../flyover/sequence'
import { smoothedTrackPath } from '../flyover/smooth'
import { nightAt } from '../flyover/sun'
import { loadOverlayFonts } from '../overlay/assets'
import { filmTextOpacity, overlayTime, overlayTimedState } from '../overlay/draw'
import { loadFrameMedia, overlayExtras, releaseFrameMedia } from '../overlay/exportOverlay'
import { filmViewAt } from '../scene/filmView'
import { adaptiveShutterSamples, sameShot, setShutterSubFrame, shutterSamples } from '../scene/lens'
import { markerKeysMoveWithTime } from '../film/markerKeys'
import { lastShadowPass, resetShadowPass } from '../scene/terrainShadow'
import { useTerrainContext } from '../scene/TerrainLayer'
import type { HeightSampler } from '../scene/trackLineSet'
import { useFilmClock } from '../scene/usePacing'
import { holdRegion } from '../osm/region'
import { useWaterStore } from '../osm/store'
import { useAppStore } from '../state/store'
import { viewTileFailures } from '../terrain/engine'
import {
  DEFAULT_SETTLE,
  REPLACE_EPSILON,
  composeFrame,
  composeOverlayFrame,
  renderSettledFrame,
  tileFailureMessage,
  wait,
  yieldToEventLoop,
  type DrawOverlay,
  type FrameOutcome,
} from './capture'
import { noEncodingTest } from './diagnostic'
import { ExportCanceledError, type VideoEncodeSession } from './encoder'
import { createGpuTimer } from './gpuTimer'
import { shadowSummary, timingsSummary } from './history'
import { compositorAttributes, createExportEncoder } from './nativeEncoder'
import { isExportStep, setExportProbe, writeBreadcrumb } from './guard'
import { effectiveRender } from './qualityTier'
import { buildFrameSchedule, buildFrameTimes, exportLodHeight } from './schedule'
import {
  EMPTY_TIMINGS,
  REPORT_INTERVAL_MS,
  exportHasClouds,
  exportRenderScale,
  flushDrapes,
  setSkipClouds,
  throttledReporter,
  useExportStore,
  videoFileName,
  type ExportRequest,
  type ExportTimings,
} from './store'

export interface ExportControllerProps {
  /** 2D overlay drawn over every frame (titles, widgets) */
  drawOverlay?: DrawOverlay
}

/** Upcoming frames are prefetched (offsets in the device budget) every PREFETCH_EVERY rendered frames. */
const PREFETCH_EVERY = 5
/**
 * And at most this often (ms) while a frame waits for its tiles: the network is mostly idle then, and each prefetch
 * only reaches one level deeper (the children of a tile are selected once it is loaded).
 */
const PREFETCH_WAIT_MS = 100
/** JPEG quality of still images (PNG is lossless) */
const STILL_JPEG_QUALITY = 0.92
/** Overview still (poster): the whole track seen from the south, north up like a map. */
const FROM_SOUTH = { target: new Vector3(0, 0, 0), position: new Vector3(0, 0, 1) }
/** Layer no camera renders: hides the progress marker on an overview still. */
const HIDDEN_LAYER = 31
/** Tasks waited at the end for the GPU timings of the last renders. */
const GPU_TIMER_FLUSH_POLLS = 8

interface RunDeps {
  get: () => RootState
  engine: () => TerrainEngine | null
  frame: () => LocalFrame | null
  overlay: () => DrawOverlay | undefined
  /** film clock of the preview (the request's schedule was built from it) */
  clock: () => FilmClock
  signal: AbortSignal
  /** memory budget of the device (default: this one) */
  budget?: Pick<DeviceBudget, 'exportTileKeepFrames' | 'exportPrefetchAhead'>
}

const direction = new Vector3()
const toTarget = new Vector3()

/** End of a failed or canceled export: nothing written is kept (the destination file is removed). */
async function abandon(error: unknown, request: ExportRequest, session: VideoEncodeSession | null, canceled: boolean): Promise<void> {
  await session?.cancel().catch(() => undefined)
  // also when failing before the encoder existed
  await request.destination?.discard().catch(() => undefined)
  if (error instanceof ExportCanceledError || canceled) useExportStore.getState().canceled()
  else useExportStore.getState().fail(errorMessage(error))
}

type Still = NonNullable<ExportRequest['still']>

/** Encodes the still image (composed by the poster when it has `compose`) and hands the result to the store. */
async function finishStill(request: ExportRequest, still: Still, view: OffscreenCanvas, missingTiles = 0): Promise<void> {
  useExportStore.getState().finalizing()
  const output = still.compose ? await still.compose(view) : view
  const blob = await output.convertToBlob({ type: still.type, quality: STILL_JPEG_QUALITY })
  // a browser without a JPEG encoder answers PNG
  const jpeg = blob.type === 'image/jpeg'
  useExportStore.getState().complete({
    url: URL.createObjectURL(blob),
    fileName: videoFileName(request.baseName, jpeg ? '.jpg' : '.png'),
    mimeType: blob.type,
    sizeBytes: blob.size,
    codec: jpeg ? 'jpeg' : 'png',
    incompleteFrames: 0,
    ...(missingTiles > 0 && { missingTiles }),
  })
}

/** A still whose view is drawn without the scene (`drawView`, flat map poster): no WebGL frame, nothing to restore. */
async function runDrawnStill(request: ExportRequest, still: Still, drawView: NonNullable<Still['drawView']>, signal: AbortSignal): Promise<void> {
  const abort = new AbortController()
  const isCanceled = () => signal.aborted || useExportStore.getState().cancelRequested
  const stop = useExportStore.subscribe(() => {
    if (isCanceled()) abort.abort()
  })
  signal.addEventListener('abort', () => abort.abort(), { once: true })
  try {
    const { view, missingTiles } = await drawView(abort.signal, (done, total) => useExportStore.getState().reportTiles(done, total))
    useExportStore.getState().reportFrame(1, performance.now())
    await finishStill(request, still, view, missingTiles)
  } catch (error) {
    await abandon(error, request, null, isCanceled())
  } finally {
    stop()
  }
}

/**
 * The overlay alone over a transparent background, at the frames of the film (`schedule`, `times`): nothing waits
 * for the terrain, no WebGL frame, no sound. Each frame is drawn anew (cheap in 2D), at the film time of the frame.
 */
async function runOverlayOnly(request: ExportRequest, deps: RunDeps, schedule: number[], times: number[]): Promise<void> {
  const exportStore = useExportStore.getState
  const { width, height } = request
  const clock = deps.clock()
  const drawOverlay = deps.overlay()
  const isCanceled = () => deps.signal.aborted || exportStore().cancelRequested
  const report = throttledReporter()
  let session: VideoEncodeSession | null = null
  try {
    useAppStore.getState().setPlaying(false)
    const compositor = new OffscreenCanvas(width, height)
    const ctx = compositor.getContext('2d', compositorAttributes())
    if (!ctx) throw new Error("Impossible de créer l'image de composition.")
    if (drawOverlay) await loadOverlayFonts()
    session = await createExportEncoder(compositor, { ...request, transparent: true })
    for (let i = 0; i < schedule.length; i++) {
      if (isCanceled()) throw new ExportCanceledError()
      // the page answers between two frames (the frames themselves are a few ms of 2D drawing)
      await yieldToEventLoop()
      const progress = schedule[i]
      await loadFrameMedia(times[i], progress)
      composeOverlayFrame(ctx, { progress, time: overlayTime(clock, progress, times[i]) }, width, height, drawOverlay)
      await session.addFrame(i)
      report(i + 1, performance.now(), undefined, i === schedule.length - 1)
    }
    exportStore().finalizing()
    writeBreadcrumb('export : finalisation du fichier')
    const { blob, sizeBytes } = await session.finish()
    exportStore().complete({
      url: blob && URL.createObjectURL(blob),
      fileName: request.destination?.fileName ?? videoFileName(request.baseName, session.extension),
      mimeType: session.mimeType,
      sizeBytes,
      codec: `${session.codec.container}/${session.codec.codec}`,
      hardware: session.codec.hardware,
      incompleteFrames: 0,
      note: 'fond transparent, sans le son',
    })
  } catch (error) {
    await abandon(error, request, session, isCanceled())
  } finally {
    releaseFrameMedia()
  }
}

/** « Export de test sans encodage »: no encoder, frames dropped, and the end is an error with the frames rendered. */
function noEncodingSession(rendered: () => number): VideoEncodeSession {
  return {
    codec: { container: 'mp4', codec: 'avc' },
    audioCodec: null,
    bitrate: 0,
    mimeType: '',
    extension: '',
    addFrame: async () => undefined,
    finish: async () => {
      throw new Error(`Export de test terminé sans fichier (${rendered()} images rendues)`)
    },
    cancel: async () => undefined,
  }
}

// oxlint-disable-next-line react/only-export-components -- exported for its tests
export async function runExport(request: ExportRequest, deps: RunDeps): Promise<void> {
  const exportStore = useExportStore.getState
  // « Export de test sans encodage » (Projet › Diagnostic): is the encoder or the render what a phone dies of?
  const noEncoding = noEncodingTest()
  let schedule: number[]
  try {
    // the rig only places the camera when the progress changes: a still starts a hair away from the current one
    const still = request.still?.progress
    schedule =
      still === undefined ? buildFrameSchedule(request) : [still < 1 ? still + REPLACE_EPSILON : still - REPLACE_EPSILON]
  } catch (error) {
    await request.destination?.discard().catch(() => undefined)
    if (exportStore().begin(request.id, 0, performance.now())) exportStore().fail(errorMessage(error))
    return
  }
  if (!exportStore().begin(request.id, schedule.length, performance.now())) return
  // film time of every frame: the shots, the orbiting stops and the time-based styles move while the progress holds
  const times = request.still ? [] : buildFrameTimes(request)
  if (request.overlayOnly) return runOverlayOnly(request, deps, schedule, times)
  const drawView = request.still?.drawView
  if (request.still && drawView) return runDrawnStill(request, request.still, drawView, deps.signal)

  const { width, height, fps } = request
  const { exportTileKeepFrames, exportPrefetchAhead } = deps.budget ?? deviceBudget()
  const lodHeight = exportLodHeight(height)
  const filmClock = deps.clock()
  const three = deps.get()
  const canvas = three.gl.domElement
  const saved = {
    frameloop: three.frameloop,
    size: { ...three.size },
    dpr: three.viewport.dpr,
    progress: useAppStore.getState().playback.progress,
    timeS: useAppStore.getState().playback.timeS,
    pointerEvents: canvas.style.pointerEvents,
    objectFit: canvas.style.objectFit,
  }
  const isCanceled = () => deps.signal.aborted || exportStore().cancelRequested
  const { tracks, settings: { race } } = useAppStore.getState()
  const track = filmTrackOf(tracks, race)
  // the path FlyoverRig places the camera on
  const path = track ? smoothedTrackPath(track, useAppStore.getState().settings.trackStyle.smoothingM) : null
  const timings: ExportTimings = { ...EMPTY_TIMINGS }
  const startedAt = performance.now()
  const report = throttledReporter()
  // GPU time of the renders, where the browser has timer queries (diagnostic, gpuTimer.ts)
  const gl = three.gl as { getContext?: () => unknown }
  const gpuTimer = typeof gl.getContext === 'function' ? createGpuTimer(gl.getContext()) : null
  const readGpuTimer = () => {
    if (!gpuTimer) return
    gpuTimer.poll()
    timings.gpuMs = gpuTimer.totalMs
    timings.gpuRenders = gpuTimer.measured
  }

  // Stills of a fixed view: the overview (poster) or the camera as it is now. The progress, hence the rig, stays put;
  // the camera is placed here before every render and put back afterwards, the progress marker hidden meanwhile.
  const overview = request.still?.overview === true
  const fixedView = overview || request.still?.camera === true
  const controlsTarget = () => (deps.get().controls as unknown as { target?: Vector3 } | null)?.target
  const savedView = fixedView
    ? { position: three.camera.position.clone(), quaternion: three.camera.quaternion.clone(), target: controlsTarget()?.clone() }
    : null
  const marker = fixedView ? three.scene.getObjectByName('flyover-marker') : undefined
  const markerLayers = marker?.layers.mask
  const framing = request.still?.framing ?? path
  const placeFixedView = () => {
    const { camera } = deps.get()
    if (!overview) {
      if (savedView) {
        camera.position.copy(savedView.position)
        camera.quaternion.copy(savedView.quaternion)
      }
      return
    }
    const frame = deps.frame()
    const engine = deps.engine()
    if (!framing || framing.count === 0 || !frame) return
    const sampler: HeightSampler | null = engine ? (lon, lat) => engine.sampleHeight(lon, lat) : null
    const view = overviewView(framing, frame, sampler, useAppStore.getState().settings.exaggeration, width / height, FROM_SOUTH)
    camera.position.copy(view.position)
    camera.lookAt(view.target)
    controlsTarget()?.copy(view.target)
  }

  // Video size, re-applied before every render: a window resize or a re-render of <Canvas> resets them.
  const applyVideoSize = () => {
    const state = deps.get()
    if (state.viewport.dpr !== 1) state.setDpr(1)
    if (state.size.width !== width || state.size.height !== height) {
      state.setSize(width, height, saved.size.top, saved.size.left)
    }
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.objectFit = 'contain'
  }

  let clock = 0
  const advance = (final: boolean) => {
    const t0 = performance.now()
    const app = useAppStore.getState()
    if (app.playback.playing) app.setPlaying(false)
    applyVideoSize()
    clock += 1 / fps
    if (fixedView) placeFixedView()
    setSkipClouds(!final)
    readGpuTimer()
    gpuTimer?.begin()
    resetShadowPass()
    try {
      deps.get().advance(clock)
    } finally {
      gpuTimer?.end()
      setSkipClouds(false)
    }
    timings.renders++
    timings.shadowTiles += lastShadowPass.tiles
    timings.shadowTriangles += lastShadowPass.triangles
    timings.shadowOffscreenTiles += lastShadowPass.offscreenTiles
    timings.shadowOffscreenTriangles += lastShadowPass.offscreenTriangles
    timings.renderMs += performance.now() - t0
  }

  /** waits of the current export (a frame that waited for none lets the next one try its final render first) */
  let waits = 0
  /** a still reports its tiles: the most pending seen, and how many of them came */
  let peakPending = 0
  let tilesReportedAt = -Infinity
  /** frame whose tiles are waited for: the prefetches of its waits look ahead of it */
  let waitingFrame = 0
  let prefetchedAt = -Infinity
  const timedWait = async (ms: number) => {
    const t0 = performance.now()
    waits++
    if (t0 - prefetchedAt >= PREFETCH_WAIT_MS) {
      prefetchedAt = t0
      prefetchAhead(waitingFrame)
    }
    if (request.still && t0 - tilesReportedAt >= REPORT_INTERVAL_MS) {
      tilesReportedAt = t0
      const pending = frameDeps.pendingTiles()
      peakPending = Math.max(peakPending, pending)
      exportStore().reportTiles(peakPending - pending, peakPending)
    }
    await wait(ms)
    timings.waitMs += performance.now() - t0
  }

  // Distance between the camera in use and the placement the rig would compute with the terrain loaded now.
  const cameraDrift = () => {
    // a fixed view is placed again before every render
    if (fixedView) return 0
    const frame = deps.frame()
    if (!path || path.count === 0 || !frame) return 0
    const camera = deps.get().camera
    const { progress, timeS } = useAppStore.getState().playback
    const view = filmViewAt(path, filmClock, progress, timeS, frame, deps.engine(), width / height)
    camera.getWorldDirection(direction)
    toTarget.subVectors(view.target, camera.position)
    const offAxis = toTarget.addScaledVector(direction, -toTarget.dot(direction)).length()
    return Math.max(camera.position.distanceTo(view.position), offAxis)
  }

  // Ask the engine for the tiles of upcoming frames, after the current view's (bounded by the engine).
  const prefetchCamera = new PerspectiveCamera()
  const prefetchAhead = (i: number) => {
    const engine = deps.engine()
    const frame = deps.frame()
    const camera = deps.get().camera as PerspectiveCamera
    if (!engine?.prefetch || !path || path.count === 0 || !frame || !camera.isPerspectiveCamera) return
    prefetchCamera.copy(camera, false)
    for (const ahead of exportPrefetchAhead) {
      const j = i + ahead
      if (j >= schedule.length) break
      const view = filmViewAt(path, filmClock, schedule[j], times[j], frame, engine, width / height)
      prefetchCamera.position.copy(view.position)
      prefetchCamera.lookAt(view.target)
      engine.prefetch(prefetchCamera, lodHeight)
    }
  }

  /** film time set with every progress (a still keeps the current one) */
  let frameTimeS = saved.timeS
  /** re-drapes that ran since the last breadcrumb */
  let drapes = 0
  const frameDeps = {
    advance,
    separateFinal: exportHasClouds,
    // what TerrainLayer does in a render (the only data requested per view), for the camera of the last render
    updateTiles: () => {
      const camera = deps.get().camera as PerspectiveCamera
      if (camera.isPerspectiveCamera) deps.engine()?.update(camera, lodHeight)
    },
    pendingTiles: () => {
      const stats = deps.engine()?.stats
      return stats ? (stats.pendingVisibleTiles ?? stats.pendingTiles) : 0
    },
    missingTiles: () => deps.engine()?.stats.missingVisibleTiles ?? 0,
    flushDrapes: () => {
      const ran = flushDrapes()
      if (ran) drapes++
      return ran
    },
    now: () => performance.now(),
    wait: timedWait,
    isCanceled,
    setProgress: (p: number) => {
      if (!fixedView) useAppStore.getState().setProgress(p, frameTimeS)
    },
    cameraDrift,
  }

  /** A frame (1-based `frame`) without its terrain: counted, logged with its tiles, and the export stops (#36). */
  const tilesFailed = (outcome: Exclude<FrameOutcome, 'complete'>, frame: number): Error => {
    if (outcome === 'timeout') timings.timeouts++
    else timings.givenUp++
    const failures = viewTileFailures(deps.engine())
    const message = tileFailureMessage(outcome, frame, failures, frameDeps.pendingTiles(), DEFAULT_SETTLE.timeoutMs)
    console.error(`[export] ${message}`, failures)
    writeBreadcrumb(`export : tuiles ${outcome === 'timeout' ? 'en retard' : 'abandonnées'} à l'image ${frame}`)
    return new Error(message)
  }

  let session: VideoEncodeSession | null = null
  /** the frame being encoded while the next one renders (`addFrame` reads the canvas before it awaits anything) */
  let encoding: Promise<void> | null = null
  /** wait for the frame being encoded: the encoder's back-pressure, counted apart */
  const encoded = async () => {
    if (!encoding) return
    const t0 = performance.now()
    try {
      await encoding
    } finally {
      encoding = null
      const spent = performance.now() - t0
      timings.encodeWaitMs += spent
      timings.encodeMs += spent
    }
  }
  try {
    useAppStore.getState().setPlaying(false)
    // a region arriving now would change the framing mid-film (camera and highlight): it waits for the end
    holdRegion(true)
    three.setFrameloop('never')
    // the view waits for the retries of its failed tiles, longer and longer (engine.ts)
    deps.engine()?.setExporting?.(true)
    canvas.style.pointerEvents = 'none'
    exportStore().setRenderScale(exportRenderScale(width, height))
    applyVideoSize()
    writeBreadcrumb(`export : taille ${width}×${height} appliquée`)
    marker?.layers.set(HIDDEN_LAYER)

    const compositor = new OffscreenCanvas(width, height)
    const ctx = compositor.getContext('2d', { alpha: false, ...compositorAttributes() })
    if (!ctx) throw new Error("Impossible de créer l'image de composition.")
    // a canvas never downloads web fonts by itself: the overlay faces must be ready before the first frame
    if (deps.overlay()) await loadOverlayFonts()

    if (request.still) {
      const { progress, compose } = request.still
      const time = overlayTime(filmClock, progress, saved.timeS)
      // pictures and video frames decoded before the render: composing must follow it in the same task
      if (!compose) await loadFrameMedia(time.timeS, progress)
      const outcome = await renderSettledFrame(schedule[0], frameDeps)
      if (outcome !== 'complete') throw tilesFailed(outcome, 1)
      // a composed still (poster) draws its own text instead of the film overlay
      composeFrame(ctx, canvas, { progress, time }, width, height, compose ? undefined : deps.overlay())
      exportStore().reportTiles(peakPending, peakPending)
      exportStore().reportFrame(1, performance.now())
      await finishStill(request, request.still, compositor)
      return
    }

    const settings = useAppStore.getState().settings
    // the soundtrack from the first frame: film time 0 comes after the frames held at the start
    const audio = await mixFilmAudio(settings.film, (id) => useMediaStore.getState().table[id], {
      offsetS: Math.round(request.holdStartS * fps) / fps,
      lengthS: schedule.length / fps,
    })
    if (isCanceled()) throw new ExportCanceledError()
    // WebCodecs, else the system's ffmpeg (desktop app on Linux); the test without encoding ends on its message
    session = noEncoding ? noEncodingSession(() => timings.rendered) : await createExportEncoder(compositor, { ...request, audio })
    writeBreadcrumb(
      noEncoding
        ? 'export : test sans encodage'
        : `export : encodeur prêt (${session.codec.container}/${session.codec.codec}${session.codec.hardware ? ' matériel' : ''}, ${(session.bitrate / 1e6).toFixed(1)} Mbit/s)`,
    )
    // the counters of the breadcrumbs written while it runs (pagehide included)
    const encoder = session
    setExportProbe(() => {
      const engine = deps.engine()
      const caches = engine?.caches?.()
      const counters = encoder.counters?.()
      const counts = {
        ...(engine && { tiles: engine.stats.loadedTiles, pending: engine.stats.pendingTiles, lod: engine.stats.lodFactor }),
        ...(caches && { bitmaps: caches.bitmaps, grids: caches.heightGrids }),
        ...(caches?.bitmapBytes !== undefined && { bitmapMb: Math.round(caches.bitmapBytes / 1e6) }),
        ...(counters && { inFlight: counters.inFlight }),
        ...(counters?.queue !== undefined && { queue: counters.queue }),
        drapes,
      }
      drapes = 0
      return counts
    })
    /** opacities of the timed overlay (cards, timeline texts, photos and clips, dips, stage card) at a frame, '' without overlay */
    const overlayKey = (progress: number, timeS: number) => {
      if (!deps.overlay()) return ''
      const time = overlayTime(filmClock, progress, timeS)
      const { dip, stage } = overlayExtras(time, progress)
      const card = stage ? filmTextOpacity(stage, timeS) : 0
      return [...overlayTimedState(settings.overlay, settings.film.texts, time, settings.film.media, dip?.alpha), card].join()
    }
    /** progress of the renders of the last rendered frame (one, or one per sub-frame of the open shutter) */
    let previous = ''
    const shutter = settings.lens.shutter
    const sceneMovesWithTime =
      markerKeysMoveWithTime(settings.film, settings.marker) ||
      (settings.atmosphere && settings.clouds.mode !== 'aucun') ||
      (settings.water.enabled && useWaterStore.getState().polygons > 0)
    const localFrame = deps.frame()
    const aspect = width / height
    // most renders per frame: lowered by the quality (qualityTier.ts)
    const { maxSubFrames } = effectiveRender(request.quality, settings.clouds)
    /** the view of the last rendered frame moved with time */
    let previousTimed = false
    let previousOverlay = ''
    /** the last (sub-)frame rendered waited for no tile: the next one tries its final render first (capture.ts) */
    let settledAtOnce = false
    // a phone: tiles are kept for a number of film frames, not seconds (the engine also caps them, deviceBudget.ts)
    const retention = {
      frame: 0,
      keepFrames: exportTileKeepFrames,
      prefetchKeepFrames: Math.max(0, ...exportPrefetchAhead) + 2 * PREFETCH_EVERY,
    }
    for (let i = 0; i < schedule.length; i++) {
      if (isCanceled()) throw new ExportCanceledError()
      // once per frame the page handles its input and paints (the export never waits otherwise when tiles are cached)
      await yieldToEventLoop()
      if (exportTileKeepFrames > 0) {
        retention.frame = i
        deps.engine()?.setRetention?.(retention)
      }
      const progress = schedule[i]
      const state = filmClock.stateAt(times[i])
      // the renders of an open shutter stay in the shot of the frame: no blend across a cut
      const keep = (t: number) => sameShot(filmClock, t, times[i])
      // fewer renders when the view barely moves over the shutter (ARCHITECTURE.md, « Objectif »); the placements are
      // computed without the terrain (null) so that the count is the same on every run
      const renders =
        path && path.count > 0 && localFrame
          ? adaptiveShutterSamples(
              times,
              schedule,
              i,
              shutter,
              (r) => filmViewAt(path, filmClock, r.progress, r.timeS, localFrame, null, aspect),
              { heightPx: height, aspect, fovDeg: CAMERA_FOV_DEG },
              keep,
              maxSubFrames,
            )
          : shutterSamples(times, schedule, i, shutter, maxSubFrames, keep)
      const rendered = renders.map((r) => r.progress).join()
      // held frames (holds, stops) repeat the composed image as is, unless the view, the scene (animated figurine,
      // drifting clouds, rippling water), the sun (a night pause) or the overlay moves with time
      const timed = sceneMovesWithTime || filmViewMovesWithTime(state, settings.camera) || nightAt(filmClock, times[i]) !== null
      const overlayNow = overlayKey(progress, times[i])
      if (rendered !== previous || ((timed || previousTimed) && times[i] !== frameTimeS) || overlayNow !== previousOverlay) {
        frameTimeS = times[i]
        previousTimed = timed
        previousOverlay = overlayNow
        // a tab killed for memory leaves no page event: the last step tells where
        if (isExportStep(timings.rendered)) writeBreadcrumb(`export : image ${i + 1} / ${schedule.length}`)
        // pictures and video frames decoded before the render: composing must follow it in the same task
        await loadFrameMedia(frameTimeS, progress)
        waitingFrame = i
        for (let j = 0; j < renders.length; j++) {
          setShutterSubFrame(j, renders.length)
          frameTimeS = renders[j].timeS
          const waitsBefore = waits
          const outcome = await renderSettledFrame(renders[j].progress, frameDeps, DEFAULT_SETTLE, settledAtOnce)
          settledAtOnce = waits === waitsBefore
          if (outcome !== 'complete') throw tilesFailed(outcome, i + 1)
        }
        frameTimeS = times[i]
        // same task as the last render: the drawing buffer still holds the frame
        const t0 = performance.now()
        composeFrame(ctx, canvas, { progress, time: overlayTime(filmClock, progress, frameTimeS) }, width, height, deps.overlay())
        const composed = performance.now() - t0
        timings.composeMs += composed
        timings.encodeMs += composed
        timings.rendered++
        if ((timings.rendered - 1) % PREFETCH_EVERY === 0) prefetchAhead(i)
        previous = rendered
      }
      // the previous frame out of the way, this one handed over: its canvas is read now, its encoding goes on while
      // the next frame renders
      await encoded()
      const t0 = performance.now()
      encoding = session.addFrame(i)
      const taken = performance.now() - t0
      timings.frameMs += taken
      timings.encodeMs += taken
      report(i + 1, performance.now(), timings, i === schedule.length - 1)
    }
    await encoded()

    exportStore().finalizing()
    const { blob, sizeBytes } = await session.finish()
    const { container, codec, hardware } = session.codec
    for (let k = 0; gpuTimer && gpuTimer.pending > 0 && k < GPU_TIMER_FLUSH_POLLS; k++) {
      await wait(16)
      readGpuTimer()
    }
    report(schedule.length, performance.now(), timings, true)
    const s = (ms: number) => (ms / 1000).toFixed(1)
    console.info(
      `[export] ${schedule.length} images (${timings.rendered} rendues) en ${s(performance.now() - startedAt)} s : ${timingsSummary(timings)}` +
        `${shadowSummary(timings) ? ` ; ${shadowSummary(timings)}` : ''}` +
        `${timings.gpuRenders === 0 ? ' (GPU non mesuré : la composition attend la fin du rendu)' : ''} ; ` +
        `encodeur ${container}/${codec}${hardware ? ' matériel' : ''} ; ` +
        `${timings.timeouts} image(s) au délai, ${timings.givenUp} image(s) aux tuiles abandonnées`,
    )
    exportStore().complete({
      // null: already written to the chosen file
      url: blob && URL.createObjectURL(blob),
      fileName: request.destination?.fileName ?? videoFileName(request.baseName, session.extension),
      mimeType: session.mimeType,
      sizeBytes,
      codec: `${container}/${codec}`,
      hardware,
      incompleteFrames: timings.timeouts + timings.givenUp,
      note: audio ? (session.audioCodec ? `avec le son (${session.audioCodec === 'aac' ? 'AAC' : 'Opus'})` : 'sans le son : ce navigateur ne sait pas l’encoder') : undefined,
    })
  } catch (error) {
    // the frame in flight is dropped with the session; the history reads the timings of the store
    encoding?.catch(() => undefined)
    readGpuTimer()
    report(exportStore().frame, performance.now(), timings, true)
    await abandon(error, request, session, isCanceled())
  } finally {
    gpuTimer?.dispose()
    setExportProbe(null)
    deps.engine()?.setRetention?.(null)
    deps.engine()?.setExporting?.(false)
    releaseFrameMedia()
    setShutterSubFrame(0, 1)
    holdRegion(false)
    // the layout size may have changed meanwhile: measure the canvas container again
    const box = canvas.parentElement?.getBoundingClientRect()
    const restoreWidth = box && box.width > 0 ? box.width : saved.size.width
    const restoreHeight = box && box.height > 0 ? box.height : saved.size.height
    const state = deps.get()
    exportStore().setRenderScale(1)
    state.setDpr(saved.dpr)
    state.setSize(restoreWidth, restoreHeight, saved.size.top, saved.size.left)
    canvas.style.width = `${restoreWidth}px`
    canvas.style.height = `${restoreHeight}px`
    canvas.style.objectFit = saved.objectFit
    canvas.style.pointerEvents = saved.pointerEvents
    state.setFrameloop(saved.frameloop)
    useAppStore.getState().setProgress(saved.progress, saved.timeS)
    if (marker && markerLayers !== undefined) marker.layers.mask = markerLayers
    if (savedView) {
      state.camera.position.copy(savedView.position)
      state.camera.quaternion.copy(savedView.quaternion)
      if (savedView.target) controlsTarget()?.copy(savedView.target)
    }
  }
}

export function ExportController({ drawOverlay }: ExportControllerProps) {
  const { engine, frame } = useTerrainContext()
  const get = useThree((s) => s.get)
  const requestId = useExportStore((s) => s.request?.id)

  const clock = useFilmClock()

  const engineRef = useRef(engine)
  const frameRef = useRef(frame)
  const overlayRef = useRef(drawOverlay)
  const clockRef = useRef(clock)
  useEffect(() => {
    engineRef.current = engine
    frameRef.current = frame
    overlayRef.current = drawOverlay
    clockRef.current = clock
  })

  useEffect(() => {
    const request = useExportStore.getState().request
    if (requestId === undefined || !request || request.id !== requestId) return undefined
    const abort = new AbortController()
    // deferred so a StrictMode mount / unmount / mount runs the export once
    const timer = setTimeout(() => {
      void runExport(request, {
        get,
        engine: () => engineRef.current,
        frame: () => frameRef.current,
        overlay: () => overlayRef.current,
        clock: () => clockRef.current,
        signal: abort.signal,
      })
    }, 0)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [requestId, get])

  return null
}
