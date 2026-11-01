/**
 * « Tracer sur la carte »: an outing drawn by hand. Each click lays a point; the line between two points follows the
 * paths of the map (IGN in France, OpenStreetMap elsewhere, `import/routing.ts`) or runs straight. « Créer la trace »
 * imports the line like a GPX route without times: its elevation is read from the terrain, the planned outing takes it from there.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { LonLat, LonLatBounds, TileFetcher } from '../core/types'
import { cumulativeDistances } from '../geo/lonLat'
import { assignColors } from '../import'
import { joinLegs, routeLeg } from '../import/routing'
import type { FetchJson, LegMode } from '../import/routing'
import { buildTrack } from '../import/stats'
import { useT } from '../i18n'
import { FLAT_MAP_MARGIN, planFlatMap } from '../poster/view'
import { useAppStore } from '../state/store'
import { createTileFetcher, isAbortError } from '../terrain/fetch'
import { buildTileUrl, getImagerySource } from '../terrain/sources'
import { formatDistance } from './format'
import { Icon } from './icons'
import { Button, Modal, TextField, Tip, ToggleButton, ToggleButtonGroup } from './primitives'
import { runImport } from './projectActions'

/** Activities of the dialog: the figure of the film follows, the profile decides which paths are walked or ridden. */
const ACTIVITIES = [
  { id: 'hiking', profile: 'foot', label: 'strava.sport.Hike' },
  { id: 'trail_running', profile: 'foot', label: 'strava.sport.TrailRun' },
  { id: 'cycling', profile: 'bike', label: 'strava.sport.Ride' },
] as const
type ActivityId = (typeof ACTIVITIES)[number]['id']

/** The map of the landmarks' window: a topographic map drawn from OpenStreetMap data, with the paths on it. */
const MAP_SOURCE_ID = 'opentopomap'
const MAP_MAX_TILES = 30
const MAP_HEIGHT_PX = 380
const DEFAULT_MAP_WIDTH_PX = 640
const ZOOM_STEP = 2
const MISSING_TILE = '#8A8F94'
const ROUTE_COLOR = '#B9391F'
/** Where the map opens when the project has no track yet: France. */
const FRANCE: LonLatBounds = { west: -5.5, south: 41.2, east: 9.8, north: 51.2 }

/** Tiles of the map, kept from one opening to the next. */
let tileFetcher: TileFetcher | null = null

const fetchJson: FetchJson = async (url, signal) => {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

/** The line between two points: routed, or straight; `line` is null for a straight line, `loading` while the services answer. */
interface Leg {
  line: LonLat[] | null
  loading: boolean
  abort: AbortController
}

export function DrawRouteDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const t = useT()
  // the body is mounted while open only: every opening starts from an empty drawing
  return (
    <Modal open={open} onClose={onClose} title={t('track.draw.title')} closeLabel={t('common.close')} closeTip={t('common.closeEsc')}>
      <DrawBody onDone={onClose} />
    </Modal>
  )
}

function DrawBody({ onDone }: { onDone(): void }) {
  const t = useT()
  const tracks = useAppStore((s) => s.tracks)
  const [waypoints, setWaypoints] = useState<LonLat[]>([])
  const [legs, setLegs] = useState<Leg[]>([])
  const [mode, setMode] = useState<LegMode>('trail')
  const [activity, setActivity] = useState<ActivityId>('hiking')
  const [name, setName] = useState(() => t('track.draw.defaultName'))
  const [fellBack, setFellBack] = useState(false)
  const profile = ACTIVITIES.find((a) => a.id === activity)?.profile ?? 'foot'
  // the legs still asked for when the dialog closes are dropped
  const legsRef = useRef(legs)
  useEffect(() => {
    legsRef.current = legs
  })
  useEffect(() => () => legsRef.current.forEach((leg) => leg.abort.abort()), [])

  const fit = useMemo<LonLatBounds>(() => {
    if (tracks.length === 0) return FRANCE
    return {
      west: Math.min(...tracks.map((x) => x.bounds.west)),
      south: Math.min(...tracks.map((x) => x.bounds.south)),
      east: Math.max(...tracks.map((x) => x.bounds.east)),
      north: Math.max(...tracks.map((x) => x.bounds.north)),
    }
  }, [tracks])

  function addPoint(point: LonLat) {
    const previous = waypoints[waypoints.length - 1]
    setWaypoints([...waypoints, point])
    if (!previous) return
    const leg: Leg = { line: null, loading: mode === 'trail', abort: new AbortController() }
    setLegs((current) => [...current, leg])
    if (mode !== 'trail') return
    routeLeg(previous, point, profile, fetchJson, leg.abort.signal).then(
      (line) => {
        if (!line) setFellBack(true)
        setLegs((current) => current.map((l) => (l === leg ? { ...l, line, loading: false } : l)))
      },
      () => undefined,
    )
  }
  function undo() {
    legs[legs.length - 1]?.abort.abort()
    setWaypoints(waypoints.slice(0, -1))
    setLegs(legs.slice(0, -1))
  }
  function clear() {
    legs.forEach((leg) => leg.abort.abort())
    setWaypoints([])
    setLegs([])
    setFellBack(false)
  }

  const points = joinLegs(
    waypoints,
    legs.map((leg) => leg.line),
  )
  const distanceM = points.length > 1 ? cumulativeDistances(points)[points.length - 1] : 0
  const busy = legs.some((leg) => leg.loading)

  function create() {
    const track = buildTrack({
      name: name.trim() || t('track.draw.defaultName'),
      source: 'gpx',
      segments: [{ points: points.map(({ lon, lat }) => ({ lon, lat })) }],
      activityType: activity,
    })
    onDone()
    void runImport([{ label: track.name, run: async (colorIndex) => assignColors([track], colorIndex) }])
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="type-hint">{t('track.draw.hint')}</p>
      <div className="flex flex-wrap items-end gap-3">
        <ToggleButtonGroup<ActivityId> className="min-w-0 flex-1" value={activity} onChange={setActivity} aria-label={t('track.draw.activity')}>
          {ACTIVITIES.map((a) => (
            <ToggleButton key={a.id} value={a.id}>
              {t(a.label)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <ToggleButtonGroup<LegMode> className="min-w-0 flex-1" value={mode} onChange={setMode} aria-label={t('track.draw.mode')}>
          <ToggleButton value="trail">{t('track.draw.mode.trail')}</ToggleButton>
          <ToggleButton value="straight">{t('track.draw.mode.straight')}</ToggleButton>
        </ToggleButtonGroup>
      </div>
      <DrawMap fit={fit} waypoints={waypoints} legs={legs} onAdd={addPoint} />
      <div className="flex flex-wrap items-center gap-2">
        <p className="type-hint flex-1" role="status">
          {busy ? t('track.draw.routing') : t('track.draw.summary', { distance: formatDistance(distanceM), count: waypoints.length })}
        </p>
        <Button size="sm" onClick={undo} disabled={waypoints.length === 0}>
          <Icon name="undo" size={16} />
          {t('track.draw.undo')}
        </Button>
        <Button size="sm" onClick={clear} disabled={waypoints.length === 0}>
          {t('track.draw.clear')}
        </Button>
      </div>
      {fellBack && <p className="type-hint">{t('track.draw.fallback')}</p>}
      <TextField label={t('track.draw.name')} value={name} onChange={setName} maxLength={80} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="type-hint">{t('track.draw.sources')}</p>
        <Button variant="primary" onClick={create} disabled={points.length < 2 || busy}>
          {t('track.draw.create')}
        </Button>
      </div>
    </div>
  )
}

/** The tiles, the line and the points; a click lays a point, a drag moves the map, the wheel zooms. */
function DrawMap({ fit, waypoints, legs, onAdd }: { fit: LonLatBounds; waypoints: readonly LonLat[]; legs: readonly Leg[]; onAdd(point: LonLat): void }) {
  const t = useT()
  const source = useMemo(() => getImagerySource(MAP_SOURCE_ID), [])
  const hostRef = useRef<HTMLDivElement>(null)
  const tilesRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(DEFAULT_MAP_WIDTH_PX)
  const height = MAP_HEIGHT_PX
  /** the view once moved or zoomed (exactly the box of the map); null: `fit` with a margin */
  const [view, setView] = useState<LonLatBounds | null>(null)
  const [tilesFailed, setTilesFailed] = useState(false)
  const plan = useMemo(() => planFlatMap(view ?? fit, width, height, source, MAP_MAX_TILES, view ? 0 : FLAT_MAP_MARGIN), [view, fit, width, height, source])
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

  // the legs (a straight one is dashed) and the points: the first green, the others in the accent colour
  useEffect(() => {
    const ctx = overlayRef.current?.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, width, height)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    legs.forEach((leg, i) => {
      const line = leg.line ?? [waypoints[i], waypoints[i + 1]]
      ctx.beginPath()
      line.forEach((p, k) => {
        const { x, y } = plan.project(p.lon, p.lat)
        if (k === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.setLineDash(leg.line === null ? [2, 8] : [])
      ctx.strokeStyle = '#FFFFFF'
      ctx.lineWidth = 7
      ctx.stroke()
      ctx.strokeStyle = ROUTE_COLOR
      ctx.lineWidth = 4
      ctx.stroke()
    })
    ctx.setLineDash([])
    waypoints.forEach((p, i) => {
      const { x, y } = plan.project(p.lon, p.lat)
      ctx.beginPath()
      ctx.arc(x, y, i === 0 ? 7 : 5, 0, Math.PI * 2)
      ctx.fillStyle = i === 0 ? '#3A6446' : '#FFFFFF'
      ctx.fill()
      ctx.lineWidth = 3
      ctx.strokeStyle = i === 0 ? '#FFFFFF' : ROUTE_COLOR
      ctx.stroke()
    })
  }, [plan, width, height, waypoints, legs])

  const zoom = (factor: number, ax = width / 2, ay = height / 2) => {
    const p = planRef.current
    const a = p.unproject(ax - ax / factor, ay - ay / factor)
    const b = p.unproject(ax + (width - ax) / factor, ay + (height - ay) / factor)
    setView({ west: a.lon, north: a.lat, east: b.lon, south: b.lat })
  }
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // the page must not scroll under the wheel: a passive React listener could not prevent it
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
  /** the pointer moved while pressed: the click that ends a drag lays no point */
  const dragged = useRef(false)
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    dragged.current = false
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { plan: planRef.current, x: e.clientX, y: e.clientY }
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
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragged.current) return
    const box = e.currentTarget.getBoundingClientRect()
    onAdd(planRef.current.unproject(e.clientX - box.left, e.clientY - box.top))
  }

  return (
    <div className="field">
      <span className="type-label">{t('track.draw.map')}</span>
      <div
        ref={hostRef}
        className="relative w-full cursor-crosshair touch-none overflow-hidden rounded-sm bg-surface-control"
        style={{ height }}
        data-testid="draw-map"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onClick={onClick}
      >
        <canvas ref={tilesRef} width={width} height={height} className="absolute inset-0" aria-hidden="true" />
        <canvas ref={overlayRef} width={width} height={height} className="pointer-events-none absolute inset-0" aria-hidden="true" />
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
      <p className="type-hint">{tilesFailed ? t('landmarks.map.tilesFailed') : source.attribution}</p>
    </div>
  )
}
