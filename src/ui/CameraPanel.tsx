import { useId } from 'react'
import { t, useT } from '../i18n'
import type { MessageKey } from '../i18n'
import {
  CAMERA_HEIGHTS,
  CAMERA_RANGES,
  CAMERA_STYLE_LABELS,
  cameraHeightStop,
  turnSmoothingM,
} from '../flyover/cameraSettings'
import { TOP_MIN_PITCH_DEG } from '../flyover/cameraSettings'
import type { CameraSettings, CameraStyle } from '../flyover/cameraSettings'
import { PACING_RANGES } from '../flyover/pacing'
import type { PacingSettings } from '../flyover/pacing'
import { playsBilan } from '../flyover/sequence'
import { setFlightTiming, useFilmClock, useFilmTrack } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { formatFilmTime } from '../film/timeline'
import { formatDegrees, formatDistance, formatNumber, formatPercent, formatSecondsShort } from './format'
import { Icon } from './icons'
import type { IconName } from './icons'
import { ModeGate, PanelSection, RangeField, SettingRow } from './PanelSection'
import type { UiMode } from './shell'
import { retryRegion, useRegionStore } from '../osm/region'
import type { RegionStatus } from '../osm/region'
import { Button, Checkbox, Slider, ToggleButton, ToggleButtonGroup } from './primitives'
import { AutoFilmSection } from './AutoFilmDialog'
import { FlightDurationField } from './FlightDurationField'

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

/** « Mouvement » in the order of the panel: the views that follow the marker from behind, then the cinematic and top views, then the free one. */
const MOTIONS: readonly CameraStyle[] = ['chase', 'sway', 'orbit', 'cinematic', 'top', 'free']

/** Picture of each movement (the keyframe diamond for « Libre »). */
const STYLE_ICONS: Record<CameraStyle, IconName> = {
  chase: 'navigation',
  sway: 'wind',
  orbit: 'orbit',
  cinematic: 'clapperboard',
  top: 'locate-fixed',
  free: 'diamond',
}

/** The tile of a choice of the settings (the basemap radios of `SettingsPanel`): framed, tinted and ringed with the accent once chosen. */
export const TILE = 'group flex min-w-0 flex-row items-stretch'
export const TILE_LABEL =
  'relative flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-start gap-0.5 rounded-sm border border-edge bg-surface-control px-1 pt-2 pb-1.5 text-center transition-ui hover:border-text-1 ' +
  'data-[selected=true]:border-brand data-[selected=true]:bg-accent-tint data-[selected=true]:ring-1 data-[selected=true]:ring-brand data-[selected=true]:ring-inset ' +
  'data-[focus-visible=true]:outline-2 data-[focus-visible=true]:outline-offset-2 data-[focus-visible=true]:outline-brand'
export const TILE_GRID = 'grid grid-cols-3 gap-2'
export const TILE_NAME = 'max-w-full truncate text-hint font-medium'

type NumericKey = keyof typeof CAMERA_RANGES

interface Slider {
  key: NumericKey
  label: string
  /** ⓘ next to the label */
  tip: string
  /** `autoM`: the length « Lissage des virages » takes in Auto for the first track, when there is one */
  format(value: number, autoM?: number): string
  /** styles where it does nothing: its row is left out */
  unusedIn?: readonly CameraStyle[]
  /** the lowest mode that shows it */
  min: UiMode
}

/** 0 -> the message `none`, else "2,5 s" */
const formatSmoothingS = (none: 'camera.slider.noneMasc' | 'camera.slider.noneFem') => (v: number) => (v === 0 ? t(none) : formatSecondsShort(v))

const SLIDERS: Slider[] = [
  { key: 'distance', min: 'confirme', get label() { return t('camera.slider.distance') }, get tip() { return t('camera.slider.distanceTip') }, format: (v) => `×${formatNumber(v, 1)}` },
  { key: 'pitchDeg', min: 'confirme', get label() { return t('camera.slider.pitch') }, get tip() { return t('camera.slider.pitchTip') }, format: formatDegrees },
  { key: 'headingOffsetDeg', min: 'expert', get label() { return t('camera.slider.heading') }, get tip() { return t('camera.slider.headingTip') }, format: formatDegrees },
  {
    key: 'leadRoomPct',
    min: 'expert',
    get label() { return t('camera.slider.leadRoom') },
    get tip() { return t('camera.slider.leadRoomTip') },
    format: (v) => (v === 0 ? t('camera.slider.noneMasc') : formatPercent(v / 100)),
    unusedIn: ['orbit'],
  },
  {
    key: 'turnSmoothingM',
    min: 'expert',
    get label() { return t('camera.slider.turn') },
    get tip() { return t('camera.slider.turnTip') },
    format: (v, autoM) => (v > 0 ? formatDistance(v) : autoM === undefined ? t('camera.slider.auto') : t('camera.slider.autoDistance', { distance: formatDistance(autoM) })),
  },
  {
    key: 'aimSmoothingS',
    min: 'expert',
    get label() { return t('camera.slider.aim') },
    get tip() { return t('camera.slider.aimTip') },
    format: formatSmoothingS('camera.slider.noneMasc'),
  },
  {
    key: 'cameraSmoothingS',
    min: 'expert',
    get label() { return t('camera.slider.cameraSmoothing') },
    get tip() { return t('camera.slider.cameraSmoothingTip') },
    format: formatSmoothingS('camera.slider.noneMasc'),
  },
  {
    key: 'endingS',
    min: 'expert',
    get label() { return t('camera.slider.ending') },
    get tip() { return t('camera.slider.endingTip') },
    format: formatSmoothingS('camera.slider.noneFem'),
  },
  {
    key: 'bankDeg',
    min: 'expert',
    get label() { return t('camera.slider.bank') },
    get tip() { return t('camera.slider.bankTip') },
    format: (v) => (v === 0 ? t('camera.slider.noneFem') : formatDegrees(v)),
    unusedIn: ['top', 'orbit'],
  },
]

/** One-line description of each style (hint under « Mouvement »). */
const STYLE_HINTS: Record<CameraStyle, string> = {
  get chase() { return t('camera.styleHint.chase') },
  get sway() { return t('camera.styleHint.sway') },
  get orbit() { return t('camera.styleHint.orbit') },
  get top() { return t('camera.styleHint.top') },
  get cinematic() { return t('camera.styleHint.cinematic') },
  get free() { return t('camera.styleHint.free') },
}

/**
 * The opening and closing shots in a line each: their style (« Depuis la région » among them) and a button to their
 * panel, the one place where a shot is set (style, region, duration, framing).
 */
function ShotSummary() {
  const t = useT()
  const film = useAppStore((s) => s.settings.film)
  return (
    <>
      {(['opening', 'closing'] as const).map((key) => (
        <div key={key} className="flex items-center justify-between gap-2">
          <span className="type-body">
            {t(key === 'opening' ? 'camera.shot.opening' : 'camera.shot.closing', { style: t(`inspector.shot.style.${film[key].style}` as MessageKey) })}
          </span>
          <Button size="sm" onClick={() => useAppStore.getState().setFilmSelection(key)}>
            {t('camera.shot.edit')}
          </Button>
        </div>
      ))}
      <p className="type-hint">{t('camera.shot.hint')}</p>
    </>
  )
}

/**
 * « Survol » tab: sections Caméra (« Mouvement » and « Hauteur » as two questions; fine parameters as rows), Durée et rythme (flyover duration,
 * situation shots of the opening and closing; their details as rows). A row shows a setting's name
 * and value, its control on demand. Stops are chosen on the timeline and in « Repères et points d'intérêt » (Carte).
 */
export function CameraPanel() {
  const t = useT()
  const camera = useAppStore((s) => s.settings.camera)
  const pacing = useAppStore((s) => s.settings.pacing)
  const flyoverDurationS = useAppStore((s) => s.settings.flyoverDurationS)
  const film = useFilmClock()
  const cameraKeyCount = film.cameraKeys.length
  const bilan = useAppStore((s) => playsBilan(s.settings.race, s.tracks.length))
  // without a stop, a speed portion, a night or a stage junction the speed is constant: the pace settings change nothing
  const paced = film.stops.length > 0 || film.speeds.length > 0 || film.nights.length > 0 || film.junctions.length > 0
  // « Garder la durée du survol » squeezes the stops and rescales a changed speed (flyover/pacing.ts): it acts with a stop, a
  // speed portion or a speed key, and may with the timed stages of a sequence; nights and passages lengthen the film either way
  const keepActs = film.stops.length > 0 || film.speeds.length > 0 || film.paramKeys.some((key) => key.param === 'speed') || film.junctions.length > 0
  const setSetting = useAppStore((s) => s.setSetting)
  const id = useId()
  const height = cameraHeightStop(camera)
  const heightName = height.custom ? t('camera.panel.custom') : t(`camera.height.${CAMERA_HEIGHTS[height.index].id}` as MessageKey)
  /** « Hauteur » sets the distance and the tilt, no other setting: smoothings, banking and the end stay as they are */
  const pickHeight = (index: number) => {
    const { distance, pitchDeg } = CAMERA_HEIGHTS[index]
    update({ distance, pitchDeg })
  }
  const update = (patch: Partial<CameraSettings>) => setSetting('camera', { ...camera, ...patch })
  const updatePacing = (patch: Partial<PacingSettings>) => setFlightTiming({ pacing: { ...pacing, ...patch } })
  const lengthM = useFilmTrack()?.stats.distanceM ?? 0
  const focalLabel = t('camera.slider.focalValue', { value: formatNumber(camera.focalMm) })
  /** « Lissage des virages » in Auto for the first track */
  const autoTurnM = lengthM > 0 ? turnSmoothingM({ ...camera, turnSmoothingM: 0 }, lengthM) : undefined

  return (
    <>
      <AutoFilmSection />
      <PanelSection title={t('camera.panel.camera')} summary={camera.style === 'free' ? CAMERA_STYLE_LABELS.free : `${CAMERA_STYLE_LABELS[camera.style]} · ${heightName}`} keys={['camera']}>
        {bilan && <p className="type-hint">{t('track.bilan.fixed')}</p>}
        {/* a Bilan shows the whole outing from above: only the lens counts */}
        {!bilan && (
          <div className="field min-w-0">
            <span className="type-label">{t('camera.panel.motion')}</span>
            <ToggleButtonGroup<CameraStyle> className="grid grid-cols-3 [&>*]:w-full" aria-label={t('camera.panel.motion')} value={camera.style} onChange={(style) => update({ style })}>
              {MOTIONS.map((style) => (
                <ToggleButton key={style} value={style}>
                  <span className="flex flex-col items-center gap-0.5 py-0.5">
                    <Icon name={STYLE_ICONS[style]} size={20} />
                    <span className={TILE_NAME}>{CAMERA_STYLE_LABELS[style]}</span>
                  </span>
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <p className="type-hint">{STYLE_HINTS[camera.style]}</p>
          </div>
        )}

        {/* 'free' follows the keyframes alone: there is no height to choose */}
        {!bilan && camera.style !== 'free' && (
          <div className="field min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="type-label">{t('camera.panel.height')}</span>
              <span className="text-body font-medium tabular-nums" data-testid="camera-height-name">{heightName}</span>
            </div>
            <Slider
              aria-label={t('camera.panel.height')}
              aria-describedby={`${id}-height-hint`}
              min={0}
              max={CAMERA_HEIGHTS.length - 1}
              step={1}
              value={height.index}
              spoken={() => heightName}
              onChange={pickHeight}
            />
            <p id={`${id}-height-hint`} className="type-hint">
              {height.custom ? t('camera.heightHint.custom') : t(`camera.heightHint.${CAMERA_HEIGHTS[height.index].id}` as MessageKey)}
            </p>
          </div>
        )}

        <ModeGate min="confirme" paths={['camera.orbitTurns', 'camera.northUp']}>
        {!bilan && camera.style === 'orbit' && (
          <RangeField
            label={t('camera.panel.orbitTurns')}
            tip={t('camera.panel.orbitTurnsTip')}
            {...CAMERA_RANGES.orbitTurns}
            value={camera.orbitTurns}
            format={(v) => formatNumber(v, 1)}
            onChange={(orbitTurns) => update({ orbitTurns })}
          />
        )}

        {!bilan && camera.style === 'top' && (
          <Checkbox id={`${id}-north-up`} checked={camera.northUp} onChange={(on) => update({ northUp: on })}>{t('camera.panel.northUp')}</Checkbox>
        )}
        </ModeGate>

        {/* the lens of the whole film, whatever the style (« Libre » too) */}
        <SettingRow label={t('camera.slider.focal')} value={focalLabel} paths={['camera.focalMm']} min="confirme">
          <RangeField
            label={t('camera.slider.focal')}
            tip={t('camera.slider.focalTip')}
            {...CAMERA_RANGES.focalMm}
            value={camera.focalMm}
            format={() => focalLabel}
            onChange={(focalMm) => update({ focalMm })}
          />
        </SettingRow>
        {/* the camera keys take the view from the first to the last: these settings are those of the rest of the film */}
        {!bilan && camera.style !== 'free' && cameraKeyCount > 0 && <p className="type-hint">{t('camera.panel.keyed', { count: cameraKeyCount })}</p>}
        {/* 'free' follows the keyframes alone: the framing sliders do nothing there */}
        {!bilan && camera.style !== 'free' && SLIDERS.filter(({ unusedIn }) => !unusedIn?.includes(camera.style)).map(({ key, label, tip, format, min }) => {
          // the view from above is at 70° at least: the lower half of the slider changes nothing there
          const range = key === 'pitchDeg' && camera.style === 'top' ? { ...CAMERA_RANGES[key], min: Math.max(CAMERA_RANGES[key].min, TOP_MIN_PITCH_DEG) } : CAMERA_RANGES[key]
          const value = format(camera[key], autoTurnM)
          return (
            <SettingRow key={key} label={label} value={value} paths={[`camera.${key}`]} min={min}>
              <RangeField label={label} tip={tip} {...range} value={camera[key]} format={() => value} onChange={(v) => update({ [key]: v })} />
            </SettingRow>
          )
        })}
      </PanelSection>

      <PanelSection title={t('camera.panel.durationSection')} summary={formatFilmTime(flyoverDurationS)} keys={['flyoverDurationS', 'pacing']}>
        <FlightDurationField />

        {/* the length of the speed changes (stops, portions): pacing, not camera; it eases the speed in every style, « Libre » too */}
        {paced && (
        <SettingRow label={t('camera.pacing.transitions')} value={formatSecondsShort(pacing.transitionS)} paths={['pacing.transitionS']} min="confirme">
          <RangeField
            label={t('camera.pacing.transitions')}
            tip={t('camera.pacing.transitionsTip')}
            {...PACING_RANGES.transitionS}
            value={pacing.transitionS}
            format={formatSecondsShort}
            onChange={(transitionS) => updatePacing({ transitionS })}
          />
        </SettingRow>
        )}

        {keepActs && (
        <SettingRow label={t('camera.pacing.keep')} value={pacing.keepDuration ? t('common.yes') : t('common.no')} paths={['pacing.keepDuration']} min="confirme">
          <Checkbox checked={pacing.keepDuration} onChange={(on) => updatePacing({ keepDuration: on })}>{t('camera.pacing.keep')}</Checkbox>
          <p className="type-hint">{t('camera.pacing.keepHint')}</p>
        </SettingRow>
        )}

        <ShotSummary />
      </PanelSection>
    </>
  )
}
