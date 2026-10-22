import { useMemo } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Track } from '../core/types'
import { trackPathOf } from '../flyover/path'
import type { TrackPath } from '../flyover/path'
import type { Segments } from '../import/tools/common'
import { useT } from '../i18n'
import { formatDistance } from './format'

/** Stretch of the track, as indexes of its points (over every segment), both included. */
export interface PointRange {
  from: number
  to: number
}

export interface TrackPreviewProps {
  track: Track
  /** the track after the tool; `track.segments` itself when nothing changes */
  next: Segments
  /** what the tool acts on (the part removed, a pause, a spike): shaded on the profile and drawn on the plan */
  marks?: readonly PointRange[]
  /** the two handles of a range tool: dragged on the profile, or moved by the sliders of the dialog */
  handles?: { range: PointRange; onChange(range: PointRange): void }
}

const PROFILE_W = 1000
const PROFILE_H = 100
const PLAN_W = 400
const PLAN_H = 220
const PLAN_PAD = 12
/** Points drawn at most on each line: a preview, not the track. */
const MAX_DRAWN = 600
const MIN_SPAN_M = 100

/** Index of the point nearest to `distanceM` along the track. */
function indexAt(path: TrackPath, distanceM: number): number {
  let lo = 0
  let hi = path.count - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (path.dist[mid] < distanceM) lo = mid + 1
    else hi = mid
  }
  return lo > 0 && distanceM - path.dist[lo - 1] < path.dist[lo] - distanceM ? lo - 1 : lo
}

/** Closed area under the elevation of the track (one sub-path per run of known elevations). */
function profileArea(path: TrackPath): string {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < path.count; i++) {
    if (Number.isNaN(path.ele[i])) continue
    min = Math.min(min, path.ele[i])
    max = Math.max(max, path.ele[i])
  }
  if (min > max || path.lengthM <= 0) return ''
  const span = Math.max(max - min, MIN_SPAN_M)
  let d = ''
  let run = false
  let lastX = 0
  for (const i of sampled(0, path.count - 1)) {
    const e = path.ele[i]
    if (Number.isNaN(e)) {
      if (run) d += `L${lastX.toFixed(1)} ${PROFILE_H}Z`
      run = false
      continue
    }
    const x = (path.dist[i] / path.lengthM) * PROFILE_W
    const y = PROFILE_H * (1 - 0.9 * ((e - min) / span))
    d += run ? `L${x.toFixed(1)} ${y.toFixed(1)}` : `M${x.toFixed(1)} ${PROFILE_H}L${x.toFixed(1)} ${y.toFixed(1)}`
    run = true
    lastX = x
  }
  return run ? `${d}L${lastX.toFixed(1)} ${PROFILE_H}Z` : d
}

/** Indexes from `first` to `last`, both included, at most `MAX_DRAWN` of them, evenly spread. */
function sampled(first: number, last: number): number[] {
  if (last < first) return []
  const steps = Math.min(last - first, MAX_DRAWN)
  return Array.from({ length: steps + 1 }, (_, n) => (steps === 0 ? first : first + Math.round((n * (last - first)) / steps)))
}

type Project = (lon: number, lat: number) => [number, number]

/** « M x y L x y … » of the points `from`..`to` of `segments` (indexes over every segment), one sub-path per segment. */
function polyline(segments: Segments, project: Project, from = 0, to = Infinity): string {
  let d = ''
  let offset = 0
  for (const { points } of segments) {
    sampled(Math.max(0, from - offset), Math.min(points.length - 1, to - offset)).forEach((i, n) => {
      const [x, y] = project(points[i].lon, points[i].lat)
      d += `${n > 0 ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    offset += points.length
  }
  return d
}

/**
 * The altitude profile and the plan of the track before a tool is applied: the part the tool acts on is shaded on the
 * profile and drawn in the accent colour on the plan, the result is drawn over the old line. Dragging on the profile
 * moves the nearer handle of a range tool. No map tiles: nothing to load, the preview is the same offline.
 */
export function TrackPreview({ track, next, marks = [], handles }: TrackPreviewProps) {
  const t = useT()
  const path = trackPathOf(track)
  const area = useMemo(() => profileArea(path), [path])
  const plan = useMemo(() => {
    const { west, east, south, north } = track.bounds
    const k = Math.cos((((south + north) / 2) * Math.PI) / 180)
    const w = Math.max((east - west) * k, 1e-6)
    const h = Math.max(north - south, 1e-6)
    const scale = Math.min((PLAN_W - 2 * PLAN_PAD) / w, (PLAN_H - 2 * PLAN_PAD) / h)
    const x0 = (PLAN_W - w * scale) / 2
    const y0 = (PLAN_H - h * scale) / 2
    const project: Project = (lon, lat) => [x0 + (lon - west) * k * scale, PLAN_H - (y0 + (lat - south) * scale)]
    return { project, before: polyline(track.segments, project) }
  }, [track])
  const result = useMemo(() => (next === track.segments ? '' : polyline(next, plan.project)), [next, track, plan])
  const shaded = useMemo(() => marks.map((m) => polyline(track.segments, plan.project, m.from, m.to)).join(''), [marks, track, plan])
  const along = (i: number) => (path.lengthM > 0 && i >= 0 && i < path.count ? (100 * path.dist[i]) / path.lengthM : 0)
  const at = (e: ReactPointerEvent<HTMLDivElement>): number => {
    const box = e.currentTarget.getBoundingClientRect()
    const fraction = box.width > 0 ? Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) : 0
    return indexAt(path, fraction * path.lengthM)
  }
  /** the handle nearer to `index` takes it, the other keeps its place */
  const drag = (index: number) => {
    if (!handles) return
    const { from, to } = handles.range
    handles.onChange(Math.abs(index - from) <= Math.abs(index - to) ? { from: Math.min(index, to), to } : { from, to: Math.max(index, from) })
  }
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" data-testid="track-preview">
      <div className="field">
        <span className="type-label">{t('track.tools.profile')}</span>
        <div
          className={`relative h-28 touch-none sm:h-44 rounded-sm bg-surface-control ${handles ? 'cursor-ew-resize' : ''}`}
          data-testid="track-preview-profile"
          role="presentation"
          onPointerDown={(e) => {
            if (!handles || e.button !== 0) return
            e.currentTarget.setPointerCapture?.(e.pointerId)
            drag(at(e))
          }}
          onPointerMove={(e) => handles && e.buttons === 1 && drag(at(e))}
        >
          <svg className="absolute inset-0 size-full" viewBox={`0 0 ${PROFILE_W} ${PROFILE_H}`} preserveAspectRatio="none" aria-hidden="true">
            <path d={area} className="fill-edge-strong" />
          </svg>
          {marks.map((m, i) => (
            <div
              key={i}
              className="pointer-events-none absolute inset-y-0 min-w-0.5 bg-brand/25 outline outline-1 outline-brand"
              style={{ left: `${along(m.from)}%`, width: `${Math.max(0, along(m.to) - along(m.from))}%` }}
            />
          ))}
          {handles && [handles.range.from, handles.range.to].map((i, k) => <div key={k} className="pointer-events-none absolute inset-y-0 w-0.5 bg-brand" style={{ left: `${along(i)}%` }} />)}
        </div>
        <p className="type-hint flex justify-between tabular-nums">
          <span>{formatDistance(0)}</span>
          <span>{formatDistance(path.lengthM)}</span>
        </p>
      </div>
      <div className="field">
        <span className="type-label">{t('track.tools.plan')}</span>
        <svg className="h-32 w-full rounded-sm bg-surface-control sm:h-44" viewBox={`0 0 ${PLAN_W} ${PLAN_H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={t('track.tools.plan')}>
          <path d={plan.before} className="stroke-edge-strong" fill="none" strokeWidth={result ? 2 : 3} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {result && <path d={result} fill="none" stroke={track.color} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
          <path d={shaded} className="stroke-brand" fill="none" strokeWidth={5} strokeOpacity={0.6} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {marks.filter((m) => m.from === m.to && m.from < path.count).map((m, i) => {
            const [x, y] = plan.project(path.lon[m.from], path.lat[m.from])
            return <circle key={i} cx={x} cy={y} r={4} className="fill-brand" />
          })}
          {handles && [handles.range.from, handles.range.to].map((i, k) => {
            if (i < 0 || i >= path.count) return null
            const [x, y] = plan.project(path.lon[i], path.lat[i])
            return <circle key={k} cx={x} cy={y} r={5} className="fill-brand stroke-white" strokeWidth={1.5} />
          })}
        </svg>
      </div>
    </div>
  )
}
