import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { LonLatBounds, TileFetcher, Track } from '../core/types'
import { elevationProfile, samplePath, trackPathOf } from '../flyover/path'
import type { ElevationProfile, TrackPath } from '../flyover/path'
import { MODE_LABELS } from '../osm/landmarks'
import type { Landmark, LandmarkMode } from '../osm/landmarks'
import { FLAT_MAP_MARGIN, planFlatMap } from '../poster/view'
import { createTileFetcher, isAbortError } from '../terrain/fetch'
import { buildTileUrl, getImagerySource } from '../terrain/sources'
import { t, useT } from '../i18n'
import { Icon } from './icons'
import { formatDistance, formatNumber } from './format'
import { Button, Modal, Tip } from './primitives'

/** A landmark of the track as the map and the profile show it: where it is, and what the user decided for it. */
export interface MapLandmark {
  landmark: Landmark
  mode: LandmarkMode
  /** found since the user's last choice (« nouveau ») */
  fresh: boolean
}

/** The map is made of the tiles of this source: a topographic map drawn from OpenStreetMap data, already used by the app. */
const MAP_SOURCE_ID = 'opentopomap'
/** Tiles of one view at most: a viewer, not a bulk download (the source is run by volunteers). */
const MAP_MAX_TILES = 30
const MAP_HEIGHT_PX = 340
/** Width assumed until the map is measured (tests, first frame). */
const DEFAULT_MAP_WIDTH_PX = 640
const ZOOM_STEP = 2
const MISSING_TILE = '#8A8F94'
/** Profile resolution (samples over the track) and drawing box (viewBox units). */
const PROFILE_SAMPLES = 300
const PROFILE_W = 1000
const PROFILE_H = 100
const PROFILE_MIN_SPAN_M = 100

/** Tiles of the maps, kept from one opening to the next (a few at low zoom). */
let tileFetcher: TileFetcher | null = null

/** The marker of a landmark: filled in the accent colour for « Toujours », in the chrome colour for « Auto », an empty dashed ring for « Jamais ». */
function markerClass(mode: LandmarkMode, selected: boolean): string {
  const look =
    mode === 'always'
      ? 'bg-accent-fill border-edge-strong'
      : mode === 'never'
        ? 'border-dashed border-text-2 bg-surface-panel/70'
        : 'bg-chrome border-edge-strong'
  return `absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border-2 p-0 ${look} ${selected ? 'z-10 size-5 ring-2 ring-brand' : 'size-3.5'}`
}

function markerLabel(landmark: Landmark, mode: LandmarkMode): string {
  return t('landmarks.map.marker', {
    name: landmark.name,
    mode: MODE_LABELS[mode],
    km: formatNumber(landmark.alongM / 1000, 1),
    distance: formatDistance(landmark.distanceM),
  })
}

/** Closed SVG area under the profile, one sub-path per run of known elevations. */
function areaPath({ ele, minEle, maxEle }: ElevationProfile): string {
  const span = Math.max(maxEle - minEle, PROFILE_MIN_SPAN_M)
  const last = ele.length - 1
  let d = ''
  let run = -1
  for (let i = 0; i <= last; i++) {
    if (Number.isNaN(ele[i])) {
      if (run >= 0) d += `L${(((i - 1) / last) * PROFILE_W).toFixed(1)} ${PROFILE_H}Z`
      run = -1
      continue
    }
    const x = ((i / last) * PROFILE_W).toFixed(1)
    const y = (PROFILE_H * (1 - 0.9 * ((ele[i] - minEle) / span))).toFixed(1)
    d += run < 0 ? `M${x} ${PROFILE_H}L${x} ${y}` : `L${x} ${y}`
    run = i
  }
  if (run >= 0) d += `L${PROFILE_W} ${PROFILE_H}Z`
  return d
}

interface ViewProps {
  track: Track
  path: TrackPath
  items: readonly MapLandmark[]
  progress: number
  selectedId: string | null
  onSelect(id: string | null): void
}

/**
 * The altitude profile of the track: click it to take the flyover there; each landmark is a marker at its position along the
 * track and at the elevation of the track there.
 */
function Profile({ path, items, progress, selectedId, onSelect, onSeek }: Omit<ViewProps, 'track'> & { onSeek(progress: number): void }) {
  const t = useT()
  const profile = useMemo(() => elevationProfile(path, PROFILE_SAMPLES), [path])
  const area = useMemo(() => (profile ? areaPath(profile) : ''), [profile])
  const span = profile ? Math.max(profile.maxEle - profile.minEle, PROFILE_MIN_SPAN_M) : 1
  /** height of a marker in the box, in % (the track's elevation under it; mid-height without a recorded elevation) */
  const topOf = (landmark: Landmark): number => {
    if (!profile || path.lengthM <= 0) return 50
    const ele = samplePath(path, landmark.alongM).ele ?? landmark.ele
    return ele === undefined ? 50 : 100 * (1 - 0.9 * ((ele - profile.minEle) / span))
  }
  const along = (m: number) => (path.lengthM > 0 ? (100 * m) / path.lengthM : 0)
  return (
    <div className="field">
      <span className="type-label">{t('landmarks.map.profile')}</span>
      <div
        className="relative h-28 cursor-crosshair rounded-sm bg-surface-control"
        data-testid="landmark-profile"
        role="presentation"
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect()
          if (box.width > 0) onSeek(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)))
        }}
      >
        <svg className="absolute inset-0 size-full" viewBox={`0 0 ${PROFILE_W} ${PROFILE_H}`} preserveAspectRatio="none" aria-hidden="true">
          <path d={area} className="fill-edge-strong" />
        </svg>
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-brand" style={{ left: `${progress * 100}%` }} />
        {items.map(({ landmark, mode }) => (
          <button
            key={landmark.id}
            type="button"
            className={markerClass(mode, landmark.id === selectedId)}
            style={{ left: `${along(landmark.alongM)}%`, top: `${topOf(landmark)}%` }}
            title={landmark.text}
            aria-label={markerLabel(landmark, mode)}
            aria-pressed={landmark.id === selectedId}
            data-testid="profile-marker"
            data-mode={mode}
            onClick={(e) => {
              e.stopPropagation()
              onSelect(landmark.id === selectedId ? null : landmark.id)
            }}
          />
        ))}
      </div>
      {profile && (
        <p className="type-hint flex justify-between tabular-nums">
          <span>{formatDistance(0)}</span>
          <span>
            {formatNumber(profile.minEle, 0)} – {formatNumber(profile.maxEle, 0)} m
          </span>
          <span>{formatDistance(path.lengthM)}</span>
        </p>
      )}
    </div>
  )
}

/** The box of the track and of every landmark listed: what the map first shows. */
function mapBounds(track: Track, items: readonly MapLandmark[]): LonLatBounds {
  const b = { ...track.bounds }
  for (const { landmark } of items) {
    b.west = Math.min(b.west, landmark.lon)
    b.east = Math.max(b.east, landmark.lon)
    b.south = Math.min(b.south, landmark.lat)
    b.north = Math.max(b.north, landmark.lat)
  }
  // a track that is a point: a few hundred metres around it
  const pad = 0.003
  if (b.east - b.west < pad) {
    b.west -= pad
    b.east += pad
  }
  if (b.north - b.south < pad) {
    b.south -= pad
    b.north += pad
  }
  return b
}

/**
 * The map of the track and of the landmarks fetched: tiles of a topographic map, the track, a light band as wide as the
 * distance asked from the track « Distance à la trace » and a marker per landmark. Drag to move, wheel or the buttons to zoom.
 */
function TileMap({ track, path, items, progress, selectedId, onSelect, maxDistanceM }: ViewProps & { maxDistanceM: number }) {
  const t = useT()
  const source = useMemo(() => getImagerySource(MAP_SOURCE_ID), [])
  const hostRef = useRef<HTMLDivElement>(null)
  const tilesRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(DEFAULT_MAP_WIDTH_PX)
  const height = MAP_HEIGHT_PX
  /** the view once moved or zoomed (exactly the box of the map); null: the whole track and landmarks, with a margin */
  const [view, setView] = useState<LonLatBounds | null>(null)
  const [tilesFailed, setTilesFailed] = useState(false)
  // the same box while its numbers are: a landmark whose mode changes must not redraw the tiles
  const { west, south, east, north } = mapBounds(track, items)
  const fit = useMemo(() => ({ west, south, east, north }), [west, south, east, north])
  const plan = useMemo(
    () => planFlatMap(view ?? fit, width, height, source, MAP_MAX_TILES, view ? 0 : FLAT_MAP_MARGIN),
    [view, fit, width, height, source],
  )
  const planRef = useRef(plan)
  useEffect(() => {
    planRef.current = plan
  })

  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => host.clientWidth > 0 && setWidth(host.clientWidth))
    observer.observe(host)
    if (host.clientWidth > 0) setWidth(host.clientWidth)
    return () => observer.disconnect()
  }, [])

  // the tiles, as they come
  useEffect(() => {
    const ctx = tilesRef.current?.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = MISSING_TILE
    ctx.fillRect(0, 0, width, height)
    tileFetcher ??= createTileFetcher({ concurrency: 4, maxEntries: 96 })
    const fetcher = tileFetcher
    const controller = new AbortController()
    let failed = 0
    setTilesFailed(false)
    for (const tile of plan.tiles) {
      fetcher.fetchBitmap(buildTileUrl(source, tile.key), { signal: controller.signal }).then(
        (bitmap) => ctx.drawImage(bitmap, tile.x, tile.y, tile.w, tile.h),
        (error: unknown) => {
          if (isAbortError(error)) return
          if (++failed === plan.tiles.length) setTilesFailed(true)
        },
      )
    }
    return () => controller.abort()
  }, [plan, width, height, source])

  // the track and the band of the distance
  useEffect(() => {
    const ctx = overlayRef.current?.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, width, height)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    const centre = plan.unproject(width / 2, height / 2)
    const pxPerDegree = (plan.project(centre.lon + 0.001, centre.lat).x - plan.project(centre.lon, centre.lat).x) / 0.001
    const metresPerPx = (111_320 * Math.cos((centre.lat * Math.PI) / 180)) / pxPerDegree
    const stroke = (color: string, lineWidth: number, alpha: number) => {
      ctx.strokeStyle = color
      ctx.lineWidth = lineWidth
      ctx.globalAlpha = alpha
      for (const segment of track.segments) {
        ctx.beginPath()
        segment.points.forEach((p, i) => {
          const { x, y } = plan.project(p.lon, p.lat)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.stroke()
      }
    }
    if (Number.isFinite(metresPerPx) && metresPerPx > 0) stroke(track.color, (2 * maxDistanceM) / metresPerPx, 0.22)
    stroke('#FFFFFF', 6, 1)
    stroke(track.color, 3, 1)
    ctx.globalAlpha = 1
  }, [plan, width, height, track, maxDistanceM])

  const zoom = (factor: number, ax = width / 2, ay = height / 2) => {
    const p = planRef.current
    const a = p.unproject(ax - ax / factor, ay - ay / factor)
    const b = p.unproject(ax + (width - ax) / factor, ay + (height - ay) / factor)
    setView({ west: a.lon, north: a.lat, east: b.lon, south: b.lat })
  }
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // the page must not scroll or zoom under the wheel: a passive React listener could not prevent it
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const box = host.getBoundingClientRect()
      zoom(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, e.clientX - box.left, e.clientY - box.top)
    }
    host.addEventListener('wheel', onWheel, { passive: false })
    return () => host.removeEventListener('wheel', onWheel)
  })

  /** the plan and the pointer when a drag began: the map follows the pointer from there */
  const drag = useRef<{ plan: typeof plan; x: number; y: number } | null>(null)
  /** the pointer moved while pressed: the click that ends a drag is not a click on the map */
  const dragged = useRef(false)
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    drag.current = { plan: planRef.current, x: e.clientX, y: e.clientY }
    dragged.current = false
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) < 4 && !dragged.current) return
    dragged.current = true
    const a = d.plan.unproject(-dx, -dy)
    const b = d.plan.unproject(width - dx, height - dy)
    setView({ west: a.lon, north: a.lat, east: b.lon, south: b.lat })
  }

  const at = path.count > 0 ? samplePath(path, progress * path.lengthM) : null
  const here = at ? plan.project(at.lon, at.lat) : null
  return (
    <div className="field">
      <span className="type-label">{t('landmarks.map.map')}</span>
      <div
        ref={hostRef}
        className="relative w-full touch-none overflow-hidden rounded-sm bg-surface-control"
        style={{ height }}
        data-testid="landmark-map"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onClick={() => !dragged.current && onSelect(null)}
      >
        <canvas ref={tilesRef} width={width} height={height} className="absolute inset-0" aria-hidden="true" />
        <canvas ref={overlayRef} width={width} height={height} className="pointer-events-none absolute inset-0" aria-hidden="true" />
        {here && <span className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-brand bg-white" style={{ left: here.x, top: here.y }} />}
        {items.map(({ landmark, mode }) => {
          const { x, y } = plan.project(landmark.lon, landmark.lat)
          if (x < -10 || y < -10 || x > width + 10 || y > height + 10) return null
          return (
            <button
              key={landmark.id}
              type="button"
              className={markerClass(mode, landmark.id === selectedId)}
              style={{ left: x, top: y }}
              title={landmark.text}
              aria-label={markerLabel(landmark, mode)}
              aria-pressed={landmark.id === selectedId}
              data-testid="map-marker"
              data-mode={mode}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onSelect(landmark.id === selectedId ? null : landmark.id)
              }}
            />
          )
        })}
        <div className="absolute top-2 right-2 flex flex-col gap-1" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <Tip text={t('landmarks.map.zoomIn')} side="left">
            <Button variant="secondary" size="sm" aria-label={t('landmarks.map.zoomIn')} onClick={() => zoom(ZOOM_STEP)}>
              <Icon name="zoom-in" size={16} />
            </Button>
          </Tip>
          <Tip text={t('landmarks.map.zoomOut')} side="left">
            <Button variant="secondary" size="sm" aria-label={t('landmarks.map.zoomOut')} onClick={() => zoom(1 / ZOOM_STEP)}>
              <Icon name="zoom-out" size={16} />
            </Button>
          </Tip>
          <Tip text={t('landmarks.map.fit')} side="left">
            <Button variant="secondary" size="sm" aria-label={t('landmarks.map.fit')} disabled={view === null} onClick={() => setView(null)}>
              <Icon name="maximize" size={16} />
            </Button>
          </Tip>
        </div>
      </div>
      <p className="type-hint">
        {tilesFailed ? t('landmarks.map.tilesFailed') : t('landmarks.map.corridor', { distance: formatDistance(maxDistanceM) })} · {source.attribution}
      </p>
    </div>
  )
}

/** « Légende »: what a marker's look means. */
function Legend() {
  return (
    <p className="type-hint flex flex-wrap gap-x-4 gap-y-1" data-testid="landmark-legend">
      {(['always', 'auto', 'never'] as const).map((mode) => (
        <span key={mode} className="flex items-center gap-1.5">
          <span className={`inline-block size-3 rounded-full border-2 ${mode === 'always' ? 'border-edge-strong bg-accent-fill' : mode === 'never' ? 'border-dashed border-text-2' : 'border-edge-strong bg-chrome'}`} />
          {MODE_LABELS[mode]}
        </span>
      ))}
    </p>
  )
}

export interface LandmarkMapProps {
  open: boolean
  onClose(): void
  track: Track
  items: readonly MapLandmark[]
  maxDistanceM: number
  /** progress of the flyover (0..1) */
  progress: number
  onSeek(progress: number): void
  selectedId: string | null
  onSelect(id: string | null): void
  /** the controls of the landmark selected (or a hint when none is) */
  children: ReactNode
}

/**
 * « Repères sur la trace », a window over the page: the altitude profile and the map of the track with the landmarks that
 * OpenStreetMap returned, to choose them by their place, their distance from the track and what was found. A click on a
 * marker (profile or map) selects the landmark; `children` are its controls.
 */
export function LandmarkMap({ open, onClose, track, items, maxDistanceM, progress, onSeek, selectedId, onSelect, children }: LandmarkMapProps) {
  const t = useT()
  const path = trackPathOf(track)
  return (
    <Modal open={open} onClose={onClose} title={t('landmarks.map.title')} closeLabel={t('common.close')} closeTip={t('common.closeEsc')} width={900}>
      <div className="flex flex-col gap-3">
        <Profile path={path} items={items} progress={progress} selectedId={selectedId} onSelect={onSelect} onSeek={onSeek} />
        <TileMap track={track} path={path} items={items} progress={progress} selectedId={selectedId} onSelect={onSelect} maxDistanceM={maxDistanceM} />
        <Legend />
        {children}
      </div>
    </Modal>
  )
}
