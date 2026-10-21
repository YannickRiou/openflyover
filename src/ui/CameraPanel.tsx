import { useId } from 'react'
import { clamp } from '../core/math'
import { t, useT } from '../i18n'
import {
  CAMERA_PRESETS,
  CAMERA_RANGES,
  CAMERA_STYLE_LABELS,
  CAMERA_STYLES,
  findCameraPreset,
  FLYOVER_DURATION_RANGE,
  turnSmoothingM,
} from '../flyover/cameraSettings'
import type { CameraPreset, CameraSettings, CameraStyle } from '../flyover/cameraSettings'
import { DEFAULT_FILM, SITUATION_DURATION_S } from '../film/model'
import { updateShot } from '../film/timeline'
import { PACING_RANGES } from '../flyover/pacing'
import type { PacingSettings } from '../flyover/pacing'
import { editFilm, setFlightTiming, useFilmClock, useFilmSource, useFilmTrack } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { formatDegrees, formatDistance, formatDuration, formatNumber, formatPercent, formatSecondsShort, formatSpeedUp } from './format'
import { Icon } from './icons'
import type { IconName } from './icons'
import { InfoTip, PanelSection, RangeField, SettingRow } from './PanelSection'
import { retryRegion, useRegionStore } from '../osm/region'
import type { RegionStatus } from '../osm/region'
import { Button, Checkbox, Radio, RadioGroup, Select, Slider, Switch } from './primitives'

/** « Mettre en avant la région »: what it does, then how the search for the region went (found: after its name). */
const REGION_HINTS: Record<RegionStatus, string> = {
  get idle() { return t('camera.region.idle') },
  get loading() { return t('camera.region.loading') },
  get ready() { return t('camera.region.ready') },
  get none() { return t('camera.region.none') },
  get error() { return t('camera.region.error') },
}
/** Hint under « Mettre en avant la région » (`highlight` on: how the search for the region went). Shared with FilmInspector. */
export function RegionHint({ id, highlight }: { id: string; highlight: boolean }) {
  const t = useT()
  const regionStatus = useRegionStore((s) => s.status)
  const regionName = useRegionStore((s) => s.region?.name)
  return (
    <>
      <p id={id} className="type-hint">
        {(() => {
          const hint = REGION_HINTS[highlight ? regionStatus : 'idle']
          return highlight && regionStatus === 'ready' && regionName ? t('camera.region.named', { name: regionName, hint }) : hint
        })()}
      </p>
      {highlight && regionStatus === 'error' && (
        <Button block onClick={retryRegion}>
          {t('common.retry')}
        </Button>
      )}
    </>
  )
}

const PRESET_ICONS: Record<string, IconName> = {
  chase: 'navigation',
  'fast-drone': 'drone',
  bird: 'bird',
  helicopter: 'wind',
  orbit: 'orbit',
  cinema: 'clapperboard',
  'high-drone': 'eye',
  glider: 'feather',
  balloon: 'cloud',
  plane: 'plane',
  'top-view': 'locate-fixed',
  satellite: 'satellite',
  free: 'diamond',
}

/** `value` of the tile that shows the settings when they match no preset. */
const CUSTOM_PRESET = 'custom'

/** A preset tile is a Radio of a `plain` group: the label is the tile, framed, tinted and ringed with the accent once chosen. */
const TILE = 'group flex min-w-0 flex-row items-stretch'
const TILE_LABEL =
  'relative flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-start gap-0.5 rounded-sm border border-edge bg-surface-control px-1 pt-2 pb-1.5 text-center transition-ui hover:border-text-1 ' +
  'data-[selected=true]:border-brand data-[selected=true]:bg-accent-tint data-[selected=true]:ring-1 data-[selected=true]:ring-brand data-[selected=true]:ring-inset ' +
  'data-[focus-visible=true]:outline-2 data-[focus-visible=true]:outline-offset-2 data-[focus-visible=true]:outline-brand'
/** « − » and « + » around the duration slider: the fine adjustment the slider only roughly reaches (a square the height of a control). */
const STEP_BUTTON = 'w-control flex-none px-0'
const TILE_GRID = 'grid grid-cols-3 gap-2'
const TILE_NAME = 'max-w-full truncate text-hint font-medium'
const TILE_FIGURES = 'text-caption whitespace-nowrap text-text-2 tabular-nums'

/** Key figures of a preset tile: distance multiplier and tilt (none for 'free', which does not use them). */
function presetFigures(camera: CameraSettings): string {
  if (camera.style === 'free') return '—'
  return `×${formatNumber(camera.distance, 1)} · ${formatDegrees(camera.pitchDeg)}`
}

/** 90 -> "1 min 30 s", 45 -> "45 s" */
function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds - m * 60)
  if (m === 0) return `${s} s`
  return s === 0 ? `${m} min` : `${m} min ${String(s).padStart(2, '0')} s`
}


type NumericKey = keyof typeof CAMERA_RANGES

interface Slider {
  key: NumericKey
  label: string
  /** ⓘ next to the label */
  tip: string
  /** `autoM`: the length « Lissage des virages » takes in Auto for the first track, when there is one */
  format(value: number, autoM?: number): string
}

/** 0 -> the message `none`, else "2,5 s" */
const formatSmoothingS = (none: 'camera.slider.noneMasc' | 'camera.slider.noneFem') => (v: number) => (v === 0 ? t(none) : formatSecondsShort(v))

const SLIDERS: Slider[] = [
  { key: 'distance', get label() { return t('camera.slider.distance') }, get tip() { return t('camera.slider.distanceTip') }, format: (v) => `×${formatNumber(v, 1)}` },
  { key: 'pitchDeg', get label() { return t('camera.slider.pitch') }, get tip() { return t('camera.slider.pitchTip') }, format: formatDegrees },
  { key: 'headingOffsetDeg', get label() { return t('camera.slider.heading') }, get tip() { return t('camera.slider.headingTip') }, format: formatDegrees },
  {
    key: 'turnSmoothingM',
    get label() { return t('camera.slider.turn') },
    get tip() { return t('camera.slider.turnTip') },
    format: (v, autoM) => (v > 0 ? formatDistance(v) : autoM === undefined ? t('camera.slider.auto') : t('camera.slider.autoDistance', { distance: formatDistance(autoM) })),
  },
  {
    key: 'aimSmoothingS',
    get label() { return t('camera.slider.aim') },
    get tip() { return t('camera.slider.aimTip') },
    format: formatSmoothingS('camera.slider.noneMasc'),
  },
  {
    key: 'cameraSmoothingS',
    get label() { return t('camera.slider.cameraSmoothing') },
    get tip() { return t('camera.slider.cameraSmoothingTip') },
    format: formatSmoothingS('camera.slider.noneMasc'),
  },
  {
    key: 'endingS',
    get label() { return t('camera.slider.ending') },
    get tip() { return t('camera.slider.endingTip') },
    format: formatSmoothingS('camera.slider.noneFem'),
  },
]

interface PacingSlider {
  key: keyof typeof PACING_RANGES
  label: string
  format(value: number): string
  /** spoken value (aria-valuetext), when it differs from the displayed one */
  spoken?(value: number): string
}

const PACING_SLIDERS: PacingSlider[] = [
  { key: 'slowFactor', get label() { return t('camera.pacing.slowFactor') }, format: formatPercent },
  {
    key: 'windowM',
    get label() { return t('camera.pacing.window') },
    format: (v) => `±${formatDistance(v)}`,
    spoken: (v) => t('camera.pacing.windowSpoken', { distance: formatDistance(v) }),
  },
  { key: 'pauseS', get label() { return t('camera.pacing.pause') }, format: (v) => (v === 0 ? t('camera.slider.noneFem') : `${formatNumber(v, 1)} s`) },
]

/** What « Ralentir aux temps forts » slows down on, in a few words. */
function slowOnLabel(pacing: PacingSettings): string {
  if (pacing.climbs && pacing.landmarks) return t('camera.pacing.slowOnBoth')
  return pacing.climbs ? t('camera.pacing.slowOnClimbs') : pacing.landmarks ? t('camera.pacing.slowOnLandmarks') : t('camera.pacing.slowOnNothing')
}

/** One-line description of each style (hint under the preset tiles). */
const STYLE_HINTS: Record<CameraStyle, string> = {
  get chase() { return t('camera.styleHint.chase') },
  get sway() { return t('camera.styleHint.sway') },
  get orbit() { return t('camera.styleHint.orbit') },
  get top() { return t('camera.styleHint.top') },
  get cinematic() { return t('camera.styleHint.cinematic') },
  get free() { return t('camera.styleHint.free') },
}

/** Tips of the « Plan de situation » switches. */
const SITUATION_TIPS = {
  get opening() { return t('camera.situationTip.opening') },
  get closing() { return t('camera.situationTip.closing') },
}

/**
 * « Plan de situation » of the opening and the closing, on: style 'situation' with the region highlighted (as in the
 * inspector); off: the default style back (and its duration, when the shot still has the one 'situation' gave it).
 */
function SituationShotSwitches() {
  const t = useT()
  const film = useAppStore((s) => s.settings.film)
  const id = useId()
  const isOn = (key: 'opening' | 'closing') => film[key].style === 'situation' && film[key].highlight === true
  const toggle = (key: 'opening' | 'closing', on: boolean) =>
    editFilm((f) => {
      if (on) return { film: updateShot(f, key, { style: 'situation', highlight: true }) }
      const back = f[key].durationS === SITUATION_DURATION_S ? { durationS: DEFAULT_FILM[key].durationS } : {}
      return { film: updateShot(f, key, { style: DEFAULT_FILM[key].style, ...back }) }
    })
  const any = isOn('opening') || isOn('closing')
  return (
    <>
      {(['opening', 'closing'] as const).map((key) => (
        <div key={key} className="flex items-center gap-1">
          <Switch
            checked={isOn(key)}
            aria-describedby={any ? `${id}-region-hint` : undefined}
            onChange={(on) => toggle(key, on)}
          >
            {key === 'opening' ? t('camera.situation.opening') : t('camera.situation.closing')}
          </Switch>
          <InfoTip text={SITUATION_TIPS[key]} />
        </div>
      ))}
      {any && <RegionHint id={`${id}-region-hint`} highlight />}
    </>
  )
}

/**
 * « Survol » tab: sections Caméra (preset tiles; style and fine parameters as rows), Durée et rythme (flyover duration,
 * situation shots of the opening and closing, slow-downs on/off; their details as rows). A row shows a setting's name
 * and value, its control on demand. Stops are chosen on the timeline and in « Repères et points d'intérêt » (Carte).
 */
export function CameraPanel() {
  const t = useT()
  const camera = useAppStore((s) => s.settings.camera)
  const durationS = useAppStore((s) => s.settings.flyoverDurationS)
  const pacing = useAppStore((s) => s.settings.pacing)
  const film = useFilmClock()
  const stopCount = film.stops.length
  // « À la suite »: the stages whose flight time is set on the timeline take theirs out of the duration
  const { stageIds, film: filmSettings } = useFilmSource()
  const timedStages = stageIds?.filter((id) => filmSettings.stageDurations?.[id] !== undefined).length ?? 0
  const recordedS = useFilmTrack()?.stats.durationS
  const setSetting = useAppStore((s) => s.setSetting)
  const id = useId()
  const speedUp = formatSpeedUp(recordedS, durationS)
  /** one notch of the slider, one way or the other, kept inside the range */
  const stepDuration = (direction: 1 | -1) =>
    setFlightTiming({ durationS: clamp(durationS + direction * FLYOVER_DURATION_RANGE.step, FLYOVER_DURATION_RANGE.min, FLYOVER_DURATION_RANGE.max) })
  const preset = findCameraPreset(camera)

  const presetTile = (p: CameraPreset) => (
    <Radio key={p.id} value={p.id} className={TILE} labelClassName={TILE_LABEL} title={CAMERA_STYLE_LABELS[p.camera.style]}>
      <Icon name={PRESET_ICONS[p.id]} size={20} />
      <span className={TILE_NAME}>{p.name}</span>
      <span className={TILE_FIGURES}>{presetFigures(p.camera)}</span>
    </Radio>
  )
  const pickPreset = (presetId: string) => {
    const picked = CAMERA_PRESETS.find((p) => p.id === presetId)
    if (picked) setSetting('camera', { ...picked.camera })
  }
  const update = (patch: Partial<CameraSettings>) => setSetting('camera', { ...camera, ...patch })
  const updatePacing = (patch: Partial<PacingSettings>) => setFlightTiming({ pacing: { ...pacing, ...patch } })
  const lengthM = useFilmTrack()?.stats.distanceM ?? 0
  /** « Lissage des virages » in Auto for the first track */
  const autoTurnM = lengthM > 0 ? turnSmoothingM({ ...camera, turnSmoothingM: 0 }, lengthM) : undefined

  return (
    <>
      <PanelSection title={t('camera.panel.camera')} keys={['camera']}>
        <fieldset className="field min-w-0">
          <legend id={`${id}-preset`} className="type-label mb-1">
            {t('camera.panel.preset')}
          </legend>
          <RadioGroup look="plain" className={TILE_GRID} aria-labelledby={`${id}-preset`} value={preset?.id ?? CUSTOM_PRESET} onChange={pickPreset}>
            {CAMERA_PRESETS.map(presetTile)}
            {!preset && (
              <Radio value={CUSTOM_PRESET} className={TILE} labelClassName={TILE_LABEL} title={t('camera.panel.customTip')}>
                <Icon name="sliders-horizontal" size={20} />
                <span className={TILE_NAME}>{t('camera.panel.custom')}</span>
                <span className={TILE_FIGURES}>{presetFigures(camera)}</span>
              </Radio>
            )}
          </RadioGroup>
          <p id={`${id}-style-hint`} className="type-hint">
            {STYLE_HINTS[camera.style]}
          </p>
        </fieldset>

        {camera.style === 'orbit' && (
          <RangeField
            label={t('camera.panel.orbitTurns')}
            tip={t('camera.panel.orbitTurnsTip')}
            {...CAMERA_RANGES.orbitTurns}
            value={camera.orbitTurns}
            format={(v) => formatNumber(v, 1)}
            onChange={(orbitTurns) => update({ orbitTurns })}
          />
        )}

        {camera.style === 'top' && (
          <Checkbox id={`${id}-north-up`} checked={camera.northUp} onChange={(on) => update({ northUp: on })}>{t('camera.panel.northUp')}</Checkbox>
        )}

        <SettingRow label={t('camera.panel.style')} value={CAMERA_STYLE_LABELS[camera.style]} paths={['camera.style']}>
          <div className="field">
            <label className="type-label" htmlFor={`${id}-style`}>
              {t('camera.panel.style')}
            </label>
            <Select
              id={`${id}-style`}
              value={camera.style}
              aria-describedby={`${id}-style-hint`}
              options={CAMERA_STYLES.map((style) => ({ value: style, label: CAMERA_STYLE_LABELS[style] }))}
              onChange={(style) => update({ style })}
            />
          </div>
        </SettingRow>
        {/* 'free' follows the keyframes alone: the framing sliders do nothing there */}
        {camera.style !== 'free' && SLIDERS.map(({ key, label, tip, format }) => {
          const range = CAMERA_RANGES[key]
          const value = format(camera[key], autoTurnM)
          return (
            <SettingRow key={key} label={label} value={value} paths={[`camera.${key}`]}>
              <RangeField label={label} tip={tip} {...range} value={camera[key]} format={() => value} onChange={(v) => update({ [key]: v })} />
            </SettingRow>
          )
        })}
      </PanelSection>

      <PanelSection title={t('camera.panel.durationSection')} keys={['flyoverDurationS', 'pacing']}>
        <div className="field">
          <div className="flex items-center gap-1">
            <span className="type-label">{t('camera.duration.label')}</span>
            <InfoTip text={t('camera.duration.tip')} />
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className={STEP_BUTTON}
              aria-label={t('camera.duration.shorten')}
              disabled={durationS <= FLYOVER_DURATION_RANGE.min}
              onClick={() => stepDuration(-1)}
            >
              −
            </Button>
            <Slider
              className="w-auto flex-auto"
              aria-label={t('camera.duration.label')}
              min={FLYOVER_DURATION_RANGE.min}
              max={FLYOVER_DURATION_RANGE.max}
              step={FLYOVER_DURATION_RANGE.step}
              value={durationS}
              onChange={(v) => setFlightTiming({ durationS: v })}
              spoken={formatSeconds}
            />
            <Button
              size="sm"
              className={STEP_BUTTON}
              aria-label={t('camera.duration.lengthen')}
              disabled={durationS >= FLYOVER_DURATION_RANGE.max}
              onClick={() => stepDuration(1)}
            >
              +
            </Button>
            <output className="range-value-wide">
              {formatSeconds(durationS)}
            </output>
          </div>
          <p className="type-hint">
            {t(speedUp ? 'camera.duration.filmSpeedUp' : 'camera.duration.film', {
              duration: formatSeconds(Math.round(film.totalTime())),
              stops: stopCount === 0 ? t('camera.duration.noStops') : t('camera.duration.stops', { count: stopCount }),
              speedUp: speedUp ?? '',
              recorded: formatDuration(recordedS ?? 0),
            })}
            {timedStages > 0 && ` · ${t('camera.duration.timedStages', { count: timedStages })}`}
          </p>
        </div>

        <SituationShotSwitches />

        <div className="flex items-center gap-1">
          <Switch checked={pacing.enabled} onChange={(on) => updatePacing({ enabled: on })}>{t('camera.pacing.enable')}</Switch>
          <InfoTip text={t('camera.pacing.enableTip')} />
        </div>

        {pacing.enabled && (
          <>
            <SettingRow label={t('camera.pacing.slowOn')} value={slowOnLabel(pacing)} paths={['pacing.climbs', 'pacing.landmarks']}>
              <fieldset className="field min-w-0">
                <legend className="type-label mb-1">{t('camera.pacing.slowOn')}</legend>
                <Checkbox checked={pacing.climbs} onChange={(on) => updatePacing({ climbs: on })}>{t('camera.pacing.climbTops')}</Checkbox>
                <Checkbox checked={pacing.landmarks} onChange={(on) => updatePacing({ landmarks: on })}>{t('camera.pacing.landmarks')}</Checkbox>
              </fieldset>
            </SettingRow>

            {PACING_SLIDERS.map(({ key, label, format, spoken = format }) => {
              const range = PACING_RANGES[key]
              return (
                <SettingRow key={key} label={label} value={format(pacing[key])} paths={[`pacing.${key}`]}>
                  <RangeField label={label} {...range} value={pacing[key]} format={format} spoken={spoken} onChange={(v) => updatePacing({ [key]: v })} />
                </SettingRow>
              )
            })}

            <SettingRow label={t('camera.pacing.keep')} value={pacing.keepDuration ? t('common.yes') : t('common.no')} paths={['pacing.keepDuration']}>
              <Checkbox checked={pacing.keepDuration} onChange={(on) => updatePacing({ keepDuration: on })}>{t('camera.pacing.keep')}</Checkbox>
              <p className="type-hint">{t('camera.pacing.keepHint')}</p>
            </SettingRow>
          </>
        )}

        <SettingRow label={t('camera.pacing.transitions')} value={formatSecondsShort(pacing.transitionS)} paths={['pacing.transitionS']}>
          <RangeField
            label={t('camera.pacing.transitions')}
            tip={t('camera.pacing.transitionsTip')}
            {...PACING_RANGES.transitionS}
            value={pacing.transitionS}
            format={formatSecondsShort}
            onChange={(transitionS) => updatePacing({ transitionS })}
          />
        </SettingRow>
      </PanelSection>
    </>
  )
}
