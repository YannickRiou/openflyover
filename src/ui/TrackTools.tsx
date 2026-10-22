import { createContext, use, useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Track } from '../core/types'
import { trackPathOf } from '../flyover/path'
import { computeStats } from '../import/stats'
import { TOOL_IDS, hasTimes, invalidatedFigures, pointCount } from '../import/tools/common'
import type { ToolId } from '../import/tools/common'
import type { Anchors } from '../import/tools/distanceMap'
import { cutSection } from '../import/tools/cutSection'
import type { CutMode } from '../import/tools/cutSection'
import { DEFAULT_PAUSES, PAUSE_DURATION_RANGE, PAUSE_RADIUS_RANGE, findPauses, removePauses } from '../import/tools/removePauses'
import { DEFAULT_SPIKES, SPIKE_FACTOR_RANGE, findSpikes, removeSpikes } from '../import/tools/removeSpikes'
import { reverse } from '../import/tools/reverse'
import { clockOf, clockOffsetMin, instantOf, shiftTime } from '../import/tools/shiftTime'
import { DEFAULT_SIMPLIFY_M, SIMPLIFY_RANGE, SIMPLIFY_WARNING_M, simplify } from '../import/tools/simplify'
import { trim } from '../import/tools/trim'
import { t, useT } from '../i18n'
import { formatAscent, formatDistance, formatDuration, formatNumber } from './format'
import { Icon } from './icons'
import { Button, DateField, Modal, NumberField, Radio, RadioGroup, Slider, TimeField } from './primitives'
import { TrackPreview } from './TrackPreview'
import type { PointRange } from './TrackPreview'
import { appliedText, applyTrackTool, exportTrackGpx } from './applyTrackTool'
import type { AppliedTool } from './applyTrackTool'

/**
 * « Outils de la trace »: one button on the track's card opens a window of its own (the editing interface stays about the
 * film, not the GPX). The window has the track before and after at the top (`TrackPreview`), the seven tools in a list
 * on the left, the chosen one's parameters, figures and « Appliquer » (`applyTrackTool`: one step, « Annuler » in the
 * message and in the window) on the right, and « Exporter en GPX » and « Fermer » at the bottom. The tools are pure
 * (`src/import/tools/*`).
 */
const TOOLS = TOOL_IDS

const TOOL_NAMES: Record<ToolId, string> = {
  get trim() { return t('track.tools.trim.name') },
  get cut() { return t('track.tools.cut.name') },
  get spikes() { return t('track.tools.spikes.name') },
  get pauses() { return t('track.tools.pauses.name') },
  get simplify() { return t('track.tools.simplify.name') },
  get reverse() { return t('track.tools.reverse.name') },
  get shift() { return t('track.tools.shift.name') },
}
const TOOL_HINTS: Record<ToolId, string> = {
  get trim() { return t('track.tools.trim.hint') },
  get cut() { return t('track.tools.cut.hint') },
  get spikes() { return t('track.tools.spikes.hint') },
  get pauses() { return t('track.tools.pauses.hint') },
  get simplify() { return t('track.tools.simplify.hint') },
  get reverse() { return t('track.tools.reverse.hint') },
  get shift() { return t('track.tools.shift.hint') },
}

/** Tools that read or move the clock of the points. */
const NEEDS_TIMES: readonly ToolId[] = ['pauses', 'shift']
/** Tools that need something to cut: three points at least. */
const NEEDS_THREE: readonly ToolId[] = ['trim', 'cut']

const beforeAfter = (before: string, after: string): string => (before === after ? before : `${before} → ${after}`)

interface DialogProps {
  track: Track
  /** the tool was applied: the window offers « Annuler » */
  onApplied(applied: AppliedTool): void
}

/** The place at the top of the window where the preview of the tool in use is drawn. */
const PreviewSlot = createContext<HTMLElement | null>(null)

interface FrameProps extends DialogProps {
  /** what the tool did to the places of the track, so that what the film anchors there follows (`distanceMap`) */
  anchors?: Anchors
  /** the tool could not do what the controls ask (it would leave no line): said under the controls */
  refused?: boolean
  tool: ToolId
  /** the points after the tool: `track.segments` itself when it does nothing */
  next: Track['segments']
  marks?: readonly PointRange[]
  handles?: { range: PointRange; onChange(range: PointRange): void }
  /** what the dialog says under the controls (the count of spikes, the pauses found…) */
  children: ReactNode
}

/** What every tool shares: its preview (in the slot of the window), its help, the controls, the figures before → after and « Appliquer ». */
function ToolFrame({ track, tool, next, marks, handles, anchors, refused, onApplied, children }: FrameProps) {
  const t = useT()
  const slot = use(PreviewSlot)
  const changed = next !== track.segments
  const before = track.stats
  const after = useMemo(() => (changed ? computeStats(next) : before), [changed, next, before])
  const figures: [string, string][] = [
    [t('track.tools.distance'), beforeAfter(formatDistance(before.distanceM), formatDistance(after.distanceM))],
    [t('track.tools.ascent'), beforeAfter(formatAscent(before.ascentM), formatAscent(after.ascentM))],
    ...(before.durationS !== undefined || after.durationS !== undefined
      ? [[t('track.tools.duration'), beforeAfter(formatDuration(before.durationS ?? 0), formatDuration(after.durationS ?? 0))] as [string, string]]
      : []),
    [t('track.tools.points'), beforeAfter(formatNumber(before.pointCount), formatNumber(after.pointCount))],
  ]
  // the figures typed by hand that this tool makes wrong go with it: said before, not after
  const lost = changed ? invalidatedFigures(track, tool).length : 0
  function apply() {
    const applied = applyTrackTool(track, next, tool, TOOL_NAMES[tool], anchors)
    if (applied) onApplied(applied)
  }
  return (
    <>
      {slot && createPortal(<TrackPreview track={track} next={next} marks={marks} handles={handles} />, slot)}
      <div className="flex flex-col gap-3" data-testid="track-tool-dialog" data-tool={tool}>
        <p className="type-hint">{TOOL_HINTS[tool]}</p>
        {children}
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-sm bg-surface-card p-2 text-hint sm:grid-cols-4" data-testid="track-tool-figures">
          {figures.map(([label, value]) => (
            <div key={label}>
              <dt className="type-hint">{label}</dt>
              <dd className="font-semibold tabular-nums text-text-1">{value}</dd>
            </div>
          ))}
        </dl>
        {lost > 0 && (
          <p className="type-hint" role="status">
            {t('track.tools.willClear', { count: lost })}
          </p>
        )}
        {!changed && (
          <p className="type-hint" role="status">
            {refused ? t('track.tools.tooShort') : t('track.tools.nothing')}
          </p>
        )}
        <Button variant="primary" block disabled={!changed} onClick={apply}>
          {t('track.tools.apply')}
        </Button>
      </div>
    </>
  )
}

/** A slider over the points of the track, its value written as the distance from the start. */
function PointSlider({ label, track, value, min, max, onChange }: { label: string; track: Track; value: number; min: number; max: number; onChange(i: number): void }) {
  const dist = trackPathOf(track).dist
  return (
    <div className="field">
      <span className="type-label">{label}</span>
      <Slider aria-label={label} min={min} max={Math.max(min, max)} step={1} value={value} onChange={onChange} format={(i) => formatDistance(dist[Math.min(i, dist.length - 1)] ?? 0)} />
    </div>
  )
}

function TrimDialog({ track, onApplied }: DialogProps) {
  const last = pointCount(track.segments) - 1
  const [range, setRange] = useState<PointRange>({ from: 0, to: last })
  const next = useMemo(() => trim(track.segments, range.from, range.to), [track, range])
  const marks = [...(range.from > 0 ? [{ from: 0, to: range.from }] : []), ...(range.to < last ? [{ from: range.to, to: last }] : [])]
  const removed = [...(range.from > 0 ? [{ from: 0, to: range.from - 1 }] : []), ...(range.to < last ? [{ from: range.to + 1, to: last }] : [])]
  const refused = next === track.segments && removed.length > 0
  return (
    <ToolFrame track={track} tool="trim" next={next} marks={marks} handles={{ range, onChange: setRange }} anchors={{ removed }} refused={refused} onApplied={onApplied}>
      <PointSlider label={t('track.tools.trim.start')} track={track} value={range.from} min={0} max={range.to - 1} onChange={(from) => setRange({ ...range, from })} />
      <PointSlider label={t('track.tools.trim.end')} track={track} value={range.to} min={range.from + 1} max={last} onChange={(to) => setRange({ ...range, to })} />
    </ToolFrame>
  )
}

function CutDialog({ track, onApplied }: DialogProps) {
  const id = useId()
  const t = useT()
  const last = pointCount(track.segments) - 1
  const [range, setRange] = useState<PointRange>({ from: Math.round(last * 0.4), to: Math.round(last * 0.6) })
  const [mode, setMode] = useState<CutMode>('join')
  const next = useMemo(() => cutSection(track.segments, range.from, range.to, mode), [track, range, mode])
  return (
    <ToolFrame track={track} tool="cut" next={next} marks={[range]} handles={{ range, onChange: setRange }} anchors={{ removed: [range] }} refused={next === track.segments && range.to >= range.from} onApplied={onApplied}>
      <PointSlider label={t('track.tools.cut.from')} track={track} value={range.from} min={0} max={range.to} onChange={(from) => setRange({ ...range, from })} />
      <PointSlider label={t('track.tools.cut.to')} track={track} value={range.to} min={range.from} max={last} onChange={(to) => setRange({ ...range, to })} />
      <div className="field">
        <RadioGroup<CutMode> look="chips" aria-label={t('track.tools.cut.mode')} aria-describedby={`${id}-mode`} value={mode} onChange={setMode}>
          <Radio value="join">{t('track.tools.cut.join')}</Radio>
          <Radio value="split">{t('track.tools.cut.split')}</Radio>
        </RadioGroup>
        <p id={`${id}-mode`} className="type-hint">
          {mode === 'join' ? t('track.tools.cut.joinHint') : t('track.tools.cut.splitHint')}
        </p>
      </div>
    </ToolFrame>
  )
}

function SpikesDialog({ track, onApplied }: DialogProps) {
  const t = useT()
  const [factor, setFactor] = useState(DEFAULT_SPIKES.factor)
  const options = useMemo(() => ({ ...DEFAULT_SPIKES, factor }), [factor])
  const spikes = useMemo(() => findSpikes(track.segments, options), [track, options])
  const next = useMemo(() => removeSpikes(track.segments, options), [track, options])
  return (
    <ToolFrame track={track} tool="spikes" next={next} marks={spikes.map((i) => ({ from: i, to: i }))} onApplied={onApplied}>
      <div className="field">
        <span className="type-label">{t('track.tools.spikes.factor')}</span>
        <Slider aria-label={t('track.tools.spikes.factor')} {...SPIKE_FACTOR_RANGE} value={factor} onChange={setFactor} format={(v) => `× ${v}`} wide={false} />
        <p className="type-hint">{t('track.tools.spikes.factorHint')}</p>
      </div>
      <p className="font-semibold text-text-1" role="status">
        {t('track.tools.spikes.found', { count: spikes.length })}
      </p>
    </ToolFrame>
  )
}

function PausesDialog({ track, onApplied }: DialogProps) {
  const t = useT()
  const [radiusM, setRadius] = useState(DEFAULT_PAUSES.radiusM)
  const [minDurationS, setDuration] = useState(DEFAULT_PAUSES.minDurationS)
  const options = useMemo(() => ({ radiusM, minDurationS }), [radiusM, minDurationS])
  const pauses = useMemo(() => findPauses(track.segments, options), [track, options])
  const next = useMemo(() => removePauses(track.segments, options), [track, options])
  const dist = trackPathOf(track).dist
  const total = pauses.reduce((sum, p) => sum + p.durationS, 0)
  return (
    <ToolFrame track={track} tool="pauses" next={next} marks={pauses.map((p) => ({ from: p.fromIndex, to: p.toIndex }))} onApplied={onApplied}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="field">
          <span className="type-label">{t('track.tools.pauses.radius')}</span>
          <Slider aria-label={t('track.tools.pauses.radius')} {...PAUSE_RADIUS_RANGE} value={radiusM} onChange={setRadius} format={(v) => `${v} m`} />
        </div>
        <div className="field">
          <span className="type-label">{t('track.tools.pauses.duration')}</span>
          <Slider aria-label={t('track.tools.pauses.duration')} {...PAUSE_DURATION_RANGE} value={minDurationS} onChange={setDuration} format={(v) => t('format.seconds', { value: v })} />
        </div>
      </div>
      {pauses.length === 0 ? (
        <p className="type-hint" role="status">
          {t('track.tools.pauses.none')}
        </p>
      ) : (
        <div className="field">
          <span className="type-label">{t('track.tools.pauses.found', { count: pauses.length, total: formatDuration(total) })}</span>
          <ul className="max-h-32 overflow-y-auto rounded-sm bg-surface-control p-2 text-hint tabular-nums" data-testid="pause-list">
            {pauses.map((p) => (
              <li key={p.fromIndex}>{t('track.tools.pauses.item', { at: formatDistance(dist[p.fromIndex] ?? 0), duration: formatDuration(p.durationS) })}</li>
            ))}
          </ul>
        </div>
      )}
    </ToolFrame>
  )
}

function SimplifyDialog({ track, onApplied }: DialogProps) {
  const t = useT()
  const [toleranceM, setTolerance] = useState(DEFAULT_SIMPLIFY_M)
  const next = useMemo(() => simplify(track.segments, toleranceM), [track, toleranceM])
  return (
    <ToolFrame track={track} tool="simplify" next={next} onApplied={onApplied}>
      <div className="field">
        <span className="type-label">{t('track.tools.simplify.tolerance')}</span>
        <Slider aria-label={t('track.tools.simplify.tolerance')} {...SIMPLIFY_RANGE} value={toleranceM} onChange={setTolerance} format={(v) => `${formatNumber(v, 1)} m`} wide={false} />
        {toleranceM > SIMPLIFY_WARNING_M && (
          <p className="type-hint font-semibold text-(--text-info)" role="status">
            {t('track.tools.simplify.warning', { value: SIMPLIFY_WARNING_M })}
          </p>
        )}
      </div>
    </ToolFrame>
  )
}

function ReverseDialog({ track, onApplied }: DialogProps) {
  const next = useMemo(() => reverse(track.segments), [track])
  return (
    <ToolFrame track={track} tool="reverse" next={next} anchors={{ reversed: true }} onApplied={onApplied}>
      {null}
    </ToolFrame>
  )
}

type ShiftMode = 'offset' | 'start'

function ShiftDialog({ track, onApplied }: DialogProps) {
  const t = useT()
  const startMs = track.stats.startTime ?? 0
  const offsetMin = clockOffsetMin(track.utcOffsetMin, startMs)
  const [mode, setMode] = useState<ShiftMode>('offset')
  const [hours, setHours] = useState(0)
  const [minutes, setMinutes] = useState(0)
  const [start, setStart] = useState(() => clockOf(startMs, offsetMin))
  const newStartMs = instantOf(start.day, start.time, offsetMin)
  const shiftMs = mode === 'offset' ? (hours * 60 + minutes) * 60_000 : newStartMs === undefined ? 0 : newStartMs - startMs
  const next = useMemo(() => shiftTime(track.segments, shiftMs), [track, shiftMs])
  const clock = (ms: number) => {
    const c = clockOf(ms, offsetMin)
    return `${c.day} ${c.time}`
  }
  return (
    <ToolFrame track={track} tool="shift" next={next} onApplied={onApplied}>
      <RadioGroup<ShiftMode> look="chips" aria-label={t('track.tools.shift.mode')} value={mode} onChange={setMode}>
        <Radio value="offset">{t('track.tools.shift.byOffset')}</Radio>
        <Radio value="start">{t('track.tools.shift.byStart')}</Radio>
      </RadioGroup>
      {mode === 'offset' ? (
        <div className="grid grid-cols-2 gap-3">
          <NumberField label={t('track.tools.shift.hours')} value={hours} min={-999} max={999} step={1} onChange={setHours} />
          <NumberField label={t('track.tools.shift.minutes')} value={minutes} min={-59} max={59} step={1} onChange={setMinutes} />
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
          <div className="field">
            <span className="type-label">{t('track.tools.shift.day')}</span>
            <DateField aria-label={t('track.tools.shift.day')} required value={start.day} onChange={(day) => day && setStart({ ...start, day })} />
          </div>
          <div className="field">
            <span className="type-label">{t('track.tools.shift.time')}</span>
            <TimeField aria-label={t('track.tools.shift.time')} required value={start.time} onChange={(time) => time && setStart({ ...start, time })} />
          </div>
        </div>
      )}
      <p className="font-semibold tabular-nums text-text-1" data-testid="shift-start">
        {t('track.tools.shift.start', { from: clock(startMs), to: clock(startMs + shiftMs) })}
      </p>
    </ToolFrame>
  )
}

const DIALOGS: Record<ToolId, (props: DialogProps) => ReactNode> = {
  trim: TrimDialog,
  cut: CutDialog,
  spikes: SpikesDialog,
  pauses: PausesDialog,
  simplify: SimplifyDialog,
  reverse: ReverseDialog,
  shift: ShiftDialog,
}

/** « Outils de la trace… »: the one line of the track's card; the tools themselves are in the window it opens. */
export function TrackToolsButton({ track, busy }: { track: Track; busy: boolean }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <div className="col-span-2 col-start-2 mt-2 border-t border-edge">
      <button type="button" className="fold-head w-full p-0" disabled={busy} data-testid="track-tools-open" onClick={() => setOpen(true)}>
        {t('track.tools.open')}
        <Icon name="chevron-right" size={16} />
      </button>
      {open && <TrackToolsWindow track={track} onClose={() => setOpen(false)} />}
    </div>
  )
}

/** The window: the track and the preview at the top, the list of tools, the tool chosen, the export and « Fermer ». */
function TrackToolsWindow({ track, onClose }: { track: Track; onClose(): void }) {
  const t = useT()
  const id = useId()
  const [tool, setTool] = useState<ToolId>('trim')
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const [applied, setApplied] = useState<AppliedTool | null>(null)
  // the points changed (applied here, undone, or edited elsewhere): the controls start again from the new track
  const [seen, setSeen] = useState(track.segments)
  const [version, setVersion] = useState(0)
  if (seen !== track.segments) {
    setSeen(track.segments)
    setVersion(version + 1)
  }
  const count = pointCount(track.segments)
  const timed = hasTimes(track.segments)
  const unavailable = (one: ToolId): string | null =>
    NEEDS_TIMES.includes(one) && !timed ? t('track.tools.needTimes') : NEEDS_THREE.includes(one) && count < 3 ? t('track.tools.needPoints') : null
  const Panel = unavailable(tool) ? null : DIALOGS[tool]
  return (
    <Modal open onClose={onClose} title={t('track.tools.title')} closeLabel={t('common.close')} closeTip={t('common.closeEsc')} width={900}>
      <div className="flex flex-col gap-3" data-testid="track-tools-window">
        <p className="type-hint">{t('track.tools.intro')}</p>
        <div ref={setSlot} data-testid="track-tools-preview" />
        <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
          <div className="flex flex-row flex-wrap gap-1 sm:flex-col" role="group" aria-label={t('track.tools.list')}>
            {TOOLS.map((one) => {
              const reason = unavailable(one)
              return (
                <div key={one} className="flex flex-col">
                  <Button
                    block
                    variant={tool === one ? 'primary' : 'secondary'}
                    disabled={reason !== null}
                    aria-pressed={tool === one}
                    aria-describedby={reason ? `${id}-${one}` : undefined}
                    data-testid={`track-tool-${one}`}
                    onClick={() => setTool(one)}
                  >
                    {TOOL_NAMES[one]}
                  </Button>
                  {reason && (
                    <p id={`${id}-${one}`} className="type-hint">
                      {reason}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex flex-col gap-3">
            <PreviewSlot value={slot}>{Panel && <Panel key={`${tool}:${version}`} track={track} onApplied={setApplied} />}</PreviewSlot>
            {applied && applied.segments === track.segments && (
              <p className="flex items-center justify-between gap-2 rounded-sm bg-surface-card p-2 font-semibold text-text-1" role="status" data-testid="track-tools-applied">
                {appliedText(applied, track.name)}
                <Button size="sm" onClick={applied.undo}>
                  {t('common.undo')}
                </Button>
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-edge pt-3">
          <div className="field">
            <Button data-testid="track-tool-gpx" aria-describedby={`${id}-gpx`} onClick={() => void exportTrackGpx(track)}>
              {t('track.tools.gpx.name')}
            </Button>
            <p id={`${id}-gpx`} className="type-hint max-w-md">
              {t('track.tools.gpx.hint')}
            </p>
          </div>
          <Button variant="primary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
