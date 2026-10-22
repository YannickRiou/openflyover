/**
 * FlyoverCanvas — the React Three Fiber root of the viewer (layers and lighting: ARCHITECTURE.md "Atmosphere").
 *
 * Without the atmosphere the canvas is transparent over a CSS sky gradient, lit by a fixed hemisphere + a sun from
 * the south-east, and tone mapping is disabled (`flat`): orthophotos are display-referred already, a filmic curve
 * would only remap their colours. The intensities keep the lit terrain close to the texture brightness: three.js
 * shades Lambert as albedo x irradiance / pi, so a flat tile gets (1.2 + 2.0 x 0.79) / pi = 0.88 of its albedo and a
 * slope facing the sun peaks just under 1.0 (nothing clips).
 *
 * Shadow maps are enabled (PCF) but only the atmosphere's sun casts them (terrainShadow.ts). Frames are drawn on
 * demand only (`renderOnDemand.ts`).
 */
import { Suspense, lazy, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Canvas, addAfterEffect, useThree } from '@react-three/fiber'
import type { RootState } from '@react-three/fiber'
import { canvasAntialias, deviceBudget } from '../core/deviceBudget'
import { useAppStore } from '../state/store'
import { dismissToast, showToast } from '../ui/toast'
import { ExportController } from '../export/ExportController'
import { readGpuInfo, setGpuProbe } from '../export/diagnostic'
import { setBreadcrumbProbe, writeBreadcrumb } from '../export/guard'
import { isExportBusy, useExportStore } from '../export/store'
import { hasGradingKeys } from '../film/paramKeys'
import { CAMERA_FOV_DEG } from '../flyover/filmCamera'
import { createOverlayDrawer } from '../overlay/exportOverlay'
import { CameraRig } from './CameraRig'
import { FlyoverRig } from './FlyoverRig'
import { isIdentityGrading } from './grading'
import { lensActive } from './lens'
import { Labels } from './Labels'
import { RaceMarkers } from './RaceMarkers'
import { RegionHighlight } from './RegionHighlight'
import { setPerfProbe } from './perfProbe'
import { useRenderOnDemand } from './renderOnDemand'
import {
  HEMISPHERE_GROUND,
  HEMISPHERE_INTENSITY,
  HEMISPHERE_SKY,
  SKY_HORIZON_COLOR,
  SKY_TOP_COLOR,
  SUN_INTENSITY,
  SUN_POSITION,
} from './sceneLighting'
import { watchTouchGesture } from './touchGesture'
import { TerrainLayer } from './TerrainLayer'
import { TrackLines } from './TrackLines'
import { SnowLayer } from './SnowLayer'
import { ForestLayer } from './ForestLayer'
import { WaterLayer } from './WaterLayer'
import { TrackMenu, TrackPicker } from './TrackPicker'
import { t } from '../i18n'

// sky, clouds, post-processing and the geoid grid (~550 KB): loaded with the first track, not at startup
const AtmosphereLayer = lazy(() => import('./AtmosphereLayer').then((m) => ({ default: m.AtmosphereLayer })))
// post-processing without the atmosphere: only once a colour grading other than « Naturel » or a lens effect is chosen
const GradingComposer = lazy(() => import('./GradingComposer').then((m) => ({ default: m.GradingComposer })))

/** Camera spot before the first fit (the rig snaps to the tracks as soon as they exist). */
const CAMERA = { fov: CAMERA_FOV_DEG, near: 1, far: 5e6, position: [0, 2000, 3000] as [number, number, number] }
/** `high-performance`: on a machine with two GPUs (laptops), ask for the discrete one for the scene and the export. */
const GL = { logarithmicDepthBuffer: true, alpha: true, powerPreference: 'high-performance' as const }

const wrapperStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  background: `linear-gradient(180deg, ${SKY_TOP_COLOR} 0%, ${SKY_HORIZON_COLOR} 100%)`,
}

const canvasStyle: CSSProperties = { position: 'absolute', inset: 0 }

export interface FlyoverCanvasProps {
  className?: string
  style?: CSSProperties
}

/** Pixel ratio caps of this device: [1, 2] on a computer, lower while the view moves on a phone (core/deviceBudget.ts). */
const BUDGET = deviceBudget()

/** Phones and tablets: the lower pixel ratio while the film plays or fingers move the view; the export sets its own. */
function MovingPixelRatio() {
  const playing = useAppStore((s) => s.playback.playing)
  const exporting = useExportStore((s) => isExportBusy(s.phase))
  const setDpr = useThree((s) => s.setDpr)
  // the orbit controls listen there too, and capture the pointer there
  const surface = useThree((s) => (s.events.connected as EventTarget | undefined) ?? s.gl.domElement)
  const [touching, setTouching] = useState(false)
  useEffect(() => watchTouchGesture(surface, setTouching), [surface])
  const moving = playing || touching
  useEffect(() => {
    if (!exporting) setDpr([1, moving ? BUDGET.movingPixelRatio : BUDGET.maxPixelRatio])
  }, [moving, exporting, setDpr])
  return null
}

/** Frames only while something moves (see renderOnDemand.ts). */
function RenderOnDemand() {
  useRenderOnDemand()
  return null
}

let webgl2: boolean | undefined

/** Whether a WebGL 2 context can be created here (checked once). */
function webgl2Supported(): boolean {
  webgl2 ??= !!document.createElement('canvas').getContext('webgl2')
  return webgl2
}

/** The GPU context can be lost (driver reset, too many contexts): keep the page, say so, redraw once it is back. */
function watchContextLoss({ gl, invalidate }: RootState) {
  let toast = 0
  // memory counters of the breadcrumb left on pagehide / freeze / context loss (export/guard.ts)
  setBreadcrumbProbe(() => ({
    textures: gl.info.memory.textures,
    geometries: gl.info.memory.geometries,
    tiles: useAppStore.getState().terrainStats.loadedTiles,
    pending: useAppStore.getState().terrainStats.pendingTiles,
  }))
  // frame counter and renderer memory of the status bar's performance readout (ui/StatusBar.tsx)
  setPerfProbe({ onFrame: (count) => addAfterEffect(count), memory: () => gl.info.memory })
  // GPU of the diagnostic report (export/diagnostic.ts)
  setGpuProbe(() => readGpuInfo(gl.getContext()))
  gl.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault() // lets the browser restore it
    writeBreadcrumb('webglcontextlost')
    toast = showToast({ kind: 'info', text: t('scene.canvas.contextLost') })
  })
  gl.domElement.addEventListener('webglcontextrestored', () => {
    dismissToast(toast)
    invalidate()
  })
}

export function FlyoverCanvas({ className, style }: FlyoverCanvasProps) {
  const hasTracks = useAppStore((s) => s.tracks.length > 0)
  const atmosphere = useAppStore((s) => s.settings.atmosphere)
  // fixed with the context: a phone that starts with the atmosphere keeps its default framebuffer without MSAA
  const [gl] = useState(() => ({ ...GL, antialias: canvasAntialias(BUDGET, useAppStore.getState().settings.atmosphere) }))
  const postProcessed = useAppStore(
    (s) => !isIdentityGrading(s.settings.grading) || hasGradingKeys(s.settings.film) || lensActive(s.settings.lens, false),
  )
  // the video export draws the film overlay through the same code as the preview
  const overlayDrawer = useMemo(() => createOverlayDrawer(), [])
  useEffect(() => () => overlayDrawer.dispose(), [overlayDrawer])

  if (!webgl2Supported()) {
    return (
      <div className={className} style={style ? { ...wrapperStyle, ...style } : wrapperStyle} role="alert">
        <p style={{ margin: 0, padding: 24, textAlign: 'center', color: 'var(--text-1)' }}>
          {t('scene.canvas.noWebgl')}
        </p>
      </div>
    )
  }

  return (
    <div className={className} style={style ? { ...wrapperStyle, ...style } : wrapperStyle}>
      <Canvas gl={gl} camera={CAMERA} dpr={[1, BUDGET.maxPixelRatio]} frameloop="demand" flat shadows="percentage" style={canvasStyle} onCreated={watchContextLoss}>
        {!atmosphere && (
          <>
            <hemisphereLight color={HEMISPHERE_SKY} groundColor={HEMISPHERE_GROUND} intensity={HEMISPHERE_INTENSITY} />
            <directionalLight position={SUN_POSITION} intensity={SUN_INTENSITY} />
          </>
        )}
        {BUDGET.movingPixelRatio !== BUDGET.maxPixelRatio && <MovingPixelRatio />}
        {hasTracks && (
          <TerrainLayer>
            <RenderOnDemand />
            <TrackLines />
            <WaterLayer />
            <SnowLayer />
            <ForestLayer />
            <RegionHighlight />
            <FlyoverRig />
            <RaceMarkers />
            <CameraRig />
            <Labels />
            <TrackPicker />
            {atmosphere && (
              // its own boundary: the rest of the scene is drawn while it loads
              <Suspense fallback={null}>
                <AtmosphereLayer />
              </Suspense>
            )}
            {!atmosphere && postProcessed && (
              <Suspense fallback={null}>
                <GradingComposer skyTop={SKY_TOP_COLOR} skyHorizon={SKY_HORIZON_COLOR} />
              </Suspense>
            )}
            <ExportController drawOverlay={overlayDrawer.draw} />
          </TerrainLayer>
        )}
      </Canvas>
      {hasTracks && <TrackMenu />}
    </div>
  )
}
