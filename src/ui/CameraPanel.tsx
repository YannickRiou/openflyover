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
import { Button, Checkbox, Radio, RadioGroup, Select, Switch } from './primitives'

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
      <p id={id} className="field__hint">
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
}

/** Shown first: one preset per style plus a high view, from close to far; the others under « Plus de préréglages ». */
const MAIN_PRESETS = new Set(['chase', 'bird', 'orbit', 'cinema', 'high-drone', 'satellite'])

/** `value` of the tile that shows the settings when they match no preset. */
const CUSTOM_PRESET = 'custom'

/** Key figures of a preset tile: distance multiplier and tilt. */
function presetFigures(camera: CameraSettings): string {
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
        <div key={key} className="field__label-row">
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
  // the current preset stays in the main grid when it is a folded one
  const mainPresets = CAMERA_PRESETS.filter((p) => MAIN_PRESETS.has(p.id) || p === preset)
  const morePresets = CAMERA_PRESETS.filter((p) => !mainPresets.includes(p))
  const presetTile = (p: CameraPreset) => (
    <Radio key={p.id} value={p.id} className="format-tile style-tile" title={CAMERA_STYLE_LABELS[p.camera.style]}>
      <Icon name={PRESET_ICONS[p.id]} size={20} />
      <span className="format-tile__label">{p.name}</span>
      <span className="preset-tile__figures">{presetFigures(p.camera)}</span>
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
        <fieldset className="field fieldset">
          <legend id={`${id}-preset`} className="field__label">
            {t('camera.panel.preset')}
          </legend>
          <RadioGroup look="plain" className="style-tiles" aria-labelledby={`${id}-preset`} value={preset?.id ?? CUSTOM_PRESET} onChange={pickPreset}>
            {mainPresets.map(presetTile)}
            {!preset && (
              <Radio value={CUSTOM_PRESET} className="format-tile style-tile" title={t('camera.panel.customTip')}>
                <Icon name="sliders-horizontal" size={20} />
                <span className="format-tile__label">{t('camera.panel.custom')}</span>
                <span className="preset-tile__figures">{presetFigures(camera)}</span>
              </Radio>
            )}
          </RadioGroup>
          <details className="preset-more">
            <summary className="preset-more__summary">
              <span className="preset-more__label">{t('camera.panel.morePresets')}</span>
              <Icon name="chevron-down" size={16} />
            </summary>
            <RadioGroup look="plain" className="style-tiles" aria-label={t('camera.panel.morePresets')} value="" onChange={pickPreset}>
              {morePresets.map(presetTile)}
            </RadioGroup>
          </details>
          <p id={`${id}-style-hint`} className="field__hint">
            {STYLE_HINTS[camera.style]}
          </p>
        </fieldset>

        {camera.style === 'top' && (
          <Checkbox id={`${id}-north-up`} checked={camera.northUp} onChange={(on) => update({ northUp: on })}>{t('camera.panel.northUp')}</Checkbox>
        )}

        <SettingRow label={t('camera.panel.style')} value={CAMERA_STYLE_LABELS[camera.style]} paths={['camera.style']}>
          <div className="field">
            <label className="field__label" htmlFor={`${id}-style`}>
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
        {SLIDERS.map(({ key, label, tip, format }) => {
          const range = CAMERA_RANGES[key]
          const inputId = `${id}-${key}`
          const value = format(camera[key], autoTurnM)
          return (
            <SettingRow key={key} label={label} value={value} paths={[`camera.${key}`]}>
              <div className="field">
                <div className="field__label-row">
                  <label className="field__label" htmlFor={inputId}>
                    {label}
                  </label>
                  <InfoTip text={tip} />
                </div>
                <div className="range-row">
                  <input
                    id={inputId}
                    className="range"
                    type="range"
                    min={range.min}
                    max={range.max}
                    step={range.step}
                    value={camera[key]}
                    onChange={(e) => update({ [key]: Number(e.currentTarget.value) })}
                    aria-valuetext={value}
                  />
                  <output className="range-row__value range-row__value--wide" htmlFor={inputId}>
                    {value}
                  </output>
                </div>
              </div>
            </SettingRow>
          )
        })}
      </PanelSection>

      <PanelSection title={t('camera.panel.durationSection')} keys={['flyoverDurationS', 'pacing']}>
        <div className="field">
          <div className="field__label-row">
            <label className="field__label" htmlFor={`${id}-duration`}>
              {t('camera.duration.label')}
            </label>
            <InfoTip text={t('camera.duration.tip')} />
          </div>
          <div className="range-row">
            <button
              type="button"
              className="step-btn"
              aria-label={t('camera.duration.shorten')}
              disabled={durationS <= FLYOVER_DURATION_RANGE.min}
              onClick={() => stepDuration(-1)}
            >
              −
            </button>
            <input
              id={`${id}-duration`}
              className="range"
              type="range"
              min={FLYOVER_DURATION_RANGE.min}
              max={FLYOVER_DURATION_RANGE.max}
              step={FLYOVER_DURATION_RANGE.step}
              value={durationS}
              onChange={(e) => setFlightTiming({ durationS: Number(e.currentTarget.value) })}
              aria-valuetext={formatSeconds(durationS)}
            />
            <button
              type="button"
              className="step-btn"
              aria-label={t('camera.duration.lengthen')}
              disabled={durationS >= FLYOVER_DURATION_RANGE.max}
              onClick={() => stepDuration(1)}
            >
              +
            </button>
            <output className="range-row__value range-row__value--wide" htmlFor={`${id}-duration`}>
              {formatSeconds(durationS)}
            </output>
          </div>
          <p className="field__hint">
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

        <div className="field__label-row">
          <Switch checked={pacing.enabled} onChange={(on) => updatePacing({ enabled: on })}>{t('camera.pacing.enable')}</Switch>
          <InfoTip text={t('camera.pacing.enableTip')} />
        </div>

        {pacing.enabled && (
          <>
            <SettingRow label={t('camera.pacing.slowOn')} value={slowOnLabel(pacing)} paths={['pacing.climbs', 'pacing.landmarks']}>
              <fieldset className="field fieldset">
                <legend className="field__label">{t('camera.pacing.slowOn')}</legend>
                <Checkbox checked={pacing.climbs} onChange={(on) => updatePacing({ climbs: on })}>{t('camera.pacing.climbTops')}</Checkbox>
                <Checkbox checked={pacing.landmarks} onChange={(on) => updatePacing({ landmarks: on })}>{t('camera.pacing.landmarks')}</Checkbox>
              </fieldset>
            </SettingRow>

            {PACING_SLIDERS.map(({ key, label, format, spoken = format }) => {
              const range = PACING_RANGES[key]
              const inputId = `${id}-pacing-${key}`
              return (
                <SettingRow key={key} label={label} value={format(pacing[key])} paths={[`pacing.${key}`]}>
                  <div className="field">
                    <label className="field__label" htmlFor={inputId}>
                      {label}
                    </label>
                    <div className="range-row">
                      <input
                        id={inputId}
                        className="range"
                        type="range"
                        min={range.min}
                        max={range.max}
                        step={range.step}
                        value={pacing[key]}
                        onChange={(e) => updatePacing({ [key]: Number(e.currentTarget.value) })}
                        aria-valuetext={spoken(pacing[key])}
                      />
                      <output className="range-row__value range-row__value--wide" htmlFor={inputId}>
                        {format(pacing[key])}
                      </output>
                    </div>
                  </div>
                </SettingRow>
              )
            })}

            <SettingRow label={t('camera.pacing.keep')} value={pacing.keepDuration ? t('common.yes') : t('common.no')} paths={['pacing.keepDuration']}>
              <Checkbox checked={pacing.keepDuration} onChange={(on) => updatePacing({ keepDuration: on })}>{t('camera.pacing.keep')}</Checkbox>
              <p className="field__hint">{t('camera.pacing.keepHint')}</p>
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
