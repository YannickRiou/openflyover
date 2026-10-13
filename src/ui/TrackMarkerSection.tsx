import { useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { junctionsM } from '../film/markerKeys'
import { t as translate, useT } from '../i18n'
import { TRACK_COLOR_MODES, TRACK_METRICS, hasMetric } from '../flyover/trackColor'
import { getPlatform } from '../platform'
import { fileToAvatarDataUrl } from '../scene/markerBadge'
import { FIGURE_GRID, MARKER_FIGURE_PATHS } from '../scene/markerFigures'
import {
  figureOfActivity,
  MARKER_BALL_STYLE_LABELS,
  MARKER_BALL_STYLES,
  MARKER_FIGURE_CHOICES,
  MARKER_FIGURE_LABELS,
  MARKER_KIND_LABELS,
  MARKER_KINDS,
  MARKER_LABEL_MAX_CHARS,
  MARKER_LABEL_MODE_LABELS,
  MARKER_LABEL_MODES,
  MARKER_SHAPE_LABELS,
  MARKER_SHAPES,
  MARKER_SIZE_RANGE,
  TRACK_DASH_LABELS,
  TRACK_DASHES,
  TRACK_GLOW_INTENSITY_RANGE,
  TRACK_GLOW_WIDTH_RANGE,
  TRACK_SMOOTHING_RANGE,
  TRACK_WIDTH_RANGE,
} from '../scene/markerSettings'
import type { MarkerFigure, MarkerSettings, TrackStyle } from '../scene/markerSettings'
import type { SettingPath } from '../project/apply'
import { addJunctionMarkerKeys, useFilmSequence, useFilmTrack } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import type { Settings } from '../state/store'
import { formatDistance, formatPercent, formatShort } from './format'
import { Icon } from './icons'
import { PanelKeys } from './KeyControls'
import { InfoTip, PanelSection, RangeField, SettingRow, TextField } from './PanelSection'
import { showToast } from './toast'
import './markerSection.css'

/** 0 -> "Aucun", else the distance */
const formatSmoothing = (metres: number) => (metres === 0 ? translate('camera.slider.noneMasc') : formatDistance(metres))

/** Pictogram of a figure, drawn from the same paths as the marker badge. */
function FigureIcon({ figure }: { figure: MarkerFigure }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox={`0 0 ${FIGURE_GRID} ${FIGURE_GRID}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {MARKER_FIGURE_PATHS[figure].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

/** One choice among `options`, as chips (radio buttons). */
function ChipChoice<T extends string>({
  label,
  name,
  options,
  value,
  labels,
  icon,
  onChange,
}: {
  label: string
  name: string
  options: readonly T[]
  value: T
  labels: Record<T, string>
  icon?: (option: T) => ReactNode
  onChange(value: T): void
}) {
  return (
    <fieldset className="field fieldset">
      <legend className="field__label">{label}</legend>
      <div className="chips">
        {options.map((option) => (
          <label key={option} className="chip">
            <input type="radio" name={name} checked={value === option} onChange={() => onChange(option)} />
            {icon?.(option)}
            {labels[option]}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** « Choisir une image » for a picture marker, through the platform file picker. */
function MarkerImageField({ marker, update }: { marker: MarkerSettings; update(patch: Partial<MarkerSettings>): void }) {
  const t = useT()
  const [error, setError] = useState<string | null>(null)
  const choose = async () => {
    try {
      const [file] = await getPlatform().openFiles({ filters: [{ name: t('marker.image.filter'), extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })
      if (!file) return
      setError(null)
      const image = await fileToAvatarDataUrl(file)
      // the marker as it is now (another change or an undo may have happened during the decoding)
      useAppStore.getState().setSetting('marker', { ...useAppStore.getState().settings.marker, image })
    } catch {
      setError(t('marker.image.error'))
    }
  }
  return (
    <div className="field">
      <div className="field__label-row">
        <button type="button" className="btn btn--secondary" onClick={() => void choose()}>
          {marker.image ? t('marker.image.change') : t('marker.image.choose')}
        </button>
        {marker.image && (
          <button type="button" className="btn btn--secondary" onClick={() => update({ image: '' })}>
            {t('marker.image.remove')}
          </button>
        )}
      </div>
      {error ? (
        <p className="field__hint" role="alert">
          {error}
        </p>
      ) : (
        <p className="field__hint">{t('marker.image.hint')}</p>
      )}
    </div>
  )
}

/**
 * « Trace » section of the Trace tab: the draw-on and the glow first; colouring, smoothing, line width and dashes as
 * rows (name and value, control on demand).
 */
export function TrackStyleSection({ hidden }: { hidden: boolean }) {
  const t = useT()
  const style = useAppStore((s) => s.settings.trackStyle)
  const setSetting = useAppStore((s) => s.setSetting)
  const id = useId()
  const updateStyle = (patch: Partial<TrackStyle>) => setSetting('trackStyle', { ...style, ...patch })
  const trackColorBy = useAppStore((s) => s.settings.trackColorBy)
  const firstTrack = useAppStore((s) => s.tracks[0])
  const colorModes = useMemo(
    () =>
      TRACK_COLOR_MODES.map((mode) =>
        mode === 'none'
          ? { mode, label: t('marker.track.solid'), available: true }
          : { mode, label: TRACK_METRICS[mode].label, available: !!firstTrack && hasMetric(firstTrack, mode) },
      ),
    [firstTrack, t],
  )

  return (
    <PanelSection title={t('marker.track.title')} keys={['trackColorBy', 'trackStyle']} hidden={hidden}>
      <div className="field__label-row">
        <label className="checkbox checkbox--switch">
          <input type="checkbox" checked={style.drawOn} onChange={(e) => updateStyle({ drawOn: e.currentTarget.checked })} />
          {t('marker.track.drawOn')}
        </label>
        <InfoTip text={t('marker.track.drawOnTip')} />
      </div>
      <label className="checkbox checkbox--switch">
        <input type="checkbox" checked={style.glow} onChange={(e) => updateStyle({ glow: e.currentTarget.checked })} />
        {t('marker.track.glow')}
      </label>
      {style.glow && (
        <>
          <SettingRow label={t('marker.track.glowIntensity')} value={formatPercent(style.glowIntensity)} paths={['trackStyle.glowIntensity']}>
            <RangeField
              label={t('marker.track.glowIntensity')}
              {...TRACK_GLOW_INTENSITY_RANGE}
              value={style.glowIntensity}
              format={formatPercent}
              onChange={(glowIntensity) => updateStyle({ glowIntensity })}
            />
          </SettingRow>
          <SettingRow label={t('marker.track.glowWidth')} value={`${formatShort(style.glowWidth)} px`} paths={['trackStyle.glowWidth']}>
            <RangeField
              label={t('marker.track.glowWidth')}
              {...TRACK_GLOW_WIDTH_RANGE}
              value={style.glowWidth}
              format={(v) => `${formatShort(v)} px`}
              onChange={(glowWidth) => updateStyle({ glowWidth })}
            />
          </SettingRow>
          <SettingRow
            label={t('marker.track.glowColor')}
            value={style.glowColor ? t('marker.track.custom') : t('marker.track.sameAsTrack')}
            paths={['trackStyle.glowColor']}
          >
            <div className="field">
              <label className="field__label" htmlFor={`${id}-glow-color`}>
                {t('marker.track.glowColor')}
              </label>
              <div className="color-row">
                <input
                  id={`${id}-glow-color`}
                  className="color-row__input"
                  type="color"
                  value={style.glowColor || firstTrack?.color || '#ffffff'}
                  onChange={(e) => updateStyle({ glowColor: e.currentTarget.value })}
                />
                <button type="button" className="btn btn--secondary" disabled={!style.glowColor} onClick={() => updateStyle({ glowColor: '' })}>
                  {t('marker.track.sameAsTrack')}
                </button>
              </div>
            </div>
          </SettingRow>
        </>
      )}
      <SettingRow label={t('marker.track.colorBy')} value={colorModes.find((m) => m.mode === trackColorBy)?.label} paths={['trackColorBy']}>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-color`}>
            {t('marker.track.colorBy')}
          </label>
          <select
            id={`${id}-color`}
            className="select"
            value={trackColorBy}
            onChange={(e) => setSetting('trackColorBy', e.currentTarget.value as Settings['trackColorBy'])}
          >
            {colorModes.map(({ mode, label, available }) => (
              <option key={mode} value={mode} disabled={!available}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </SettingRow>
      <SettingRow label={t('marker.track.smoothing')} value={formatSmoothing(style.smoothingM)} paths={['trackStyle.smoothingM']}>
        <RangeField
          label={t('marker.track.smoothing')}
          tip={t('marker.track.smoothingTip')}
          {...TRACK_SMOOTHING_RANGE}
          value={style.smoothingM}
          format={formatSmoothing}
          onChange={(smoothingM) => updateStyle({ smoothingM })}
        />
      </SettingRow>
      <SettingRow label={t('marker.track.width')} value={`${formatShort(style.width)} px`} paths={['trackStyle.width']}>
        <RangeField
          label={t('marker.track.width')}
          {...TRACK_WIDTH_RANGE}
          value={style.width}
          format={(v) => `${formatShort(v)} px`}
          onChange={(width) => updateStyle({ width })}
        />
      </SettingRow>
      <SettingRow label={t('marker.track.dash')} value={TRACK_DASH_LABELS[style.dash]} paths={['trackStyle.dash']}>
        <ChipChoice
          label={t('marker.track.dash')}
          name={`${id}-dash`}
          options={TRACK_DASHES}
          value={style.dash}
          labels={TRACK_DASH_LABELS}
          onChange={(dash) => updateStyle({ dash })}
        />
      </SettingRow>
    </PanelSection>
  )
}

/** A colour of the marker, '' = the colour of the track (« Celle de la trace »), as a row. */
function MarkerColorRow({
  label,
  path,
  value,
  trackColor,
  onChange,
}: {
  label: string
  path: SettingPath
  value: string
  trackColor: string
  onChange(color: string): void
}) {
  const t = useT()
  const id = useId()
  return (
    <SettingRow label={label} value={value ? t('marker.track.custom') : t('marker.track.sameAsTrack')} paths={[path]}>
      <div className="field">
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
        <div className="color-row">
          <input
            id={id}
            className="color-row__input"
            type="color"
            value={value || trackColor}
            onChange={(e) => onChange(e.currentTarget.value)}
          />
          <button type="button" className="btn btn--secondary" disabled={!value} onClick={() => onChange('')}>
            {t('marker.track.sameAsTrack')}
          </button>
        </div>
      </div>
    </SettingRow>
  )
}

/**
 * « Marqueur » section of the Trace tab: ball (and its style), figurine or picture, its main colour and its size;
 * the badge shape, the edge colour, the label and the stick folded under « Plus d'options ».
 */
export function MarkerSection({ hidden }: { hidden: boolean }) {
  const t = useT()
  const marker = useAppStore((s) => s.settings.marker)
  const setSetting = useAppStore((s) => s.setSetting)
  const firstTrack = useAppStore((s) => s.tracks[0])
  const racing = useAppStore((s) => s.tracks.length > 1 && s.settings.race.enabled)
  const filmTrack = useFilmTrack()
  const sequence = useFilmSequence()
  const junctions = useMemo(() => junctionsM(filmTrack, sequence?.cutsM).length, [filmTrack, sequence])
  const id = useId()
  const updateMarker = (patch: Partial<MarkerSettings>) => setSetting('marker', { ...marker, ...patch })
  const trackColor = firstTrack?.color ?? '#ffffff'
  const activityFigure = figureOfActivity(firstTrack?.activityType)
  const figurine = marker.kind === 'figurine'
  const alone = figurine && marker.shape === 'contour'

  return (
    <PanelSection title={t('marker.section.title')} keys={['marker']} hidden={hidden}>
      <ChipChoice
        label={t('marker.section.shape')}
        name={`${id}-kind`}
        options={MARKER_KINDS}
        value={marker.kind}
        labels={MARKER_KIND_LABELS}
        onChange={(kind) => updateMarker({ kind })}
      />
      {marker.kind === 'boule' && (
        <ChipChoice
          label={t('marker.section.style')}
          name={`${id}-ball`}
          options={MARKER_BALL_STYLES}
          value={marker.ballStyle}
          labels={MARKER_BALL_STYLE_LABELS}
          onChange={(ballStyle) => updateMarker({ ballStyle })}
        />
      )}
      {figurine && (
        <ChipChoice
          label={t('marker.section.figurine')}
          name={`${id}-figure`}
          options={MARKER_FIGURE_CHOICES}
          value={marker.figure}
          labels={MARKER_FIGURE_LABELS}
          icon={(figure) => <FigureIcon figure={figure === 'auto' ? activityFigure : figure} />}
          onChange={(figure) => updateMarker({ figure })}
        />
      )}
      {figurine && (
        <label className="checkbox">
          <input type="checkbox" checked={marker.animated} onChange={(e) => updateMarker({ animated: e.currentTarget.checked })} />
          {t('marker.section.animate')}
        </label>
      )}
      {marker.kind === 'image' && <MarkerImageField marker={marker} update={updateMarker} />}
      {marker.kind === 'boule' && (
        <MarkerColorRow
          label={t('marker.section.color')}
          path="marker.color"
          value={marker.color}
          trackColor={trackColor}
          onChange={(color) => updateMarker({ color })}
        />
      )}
      {figurine && (
        <MarkerColorRow
          label={alone ? t('marker.section.figureColor') : t('marker.section.discColor')}
          path="marker.figureColor"
          value={marker.figureColor}
          trackColor={trackColor}
          onChange={(figureColor) => updateMarker({ figureColor })}
        />
      )}
      {racing && marker.kind !== 'image' && <p className="field__hint">{t('marker.section.racing')}</p>}
      <SettingRow label={t('marker.section.size')} value={`×${formatShort(marker.size)}`} paths={['marker.size']}>
        <RangeField
          label={t('marker.section.size')}
          {...MARKER_SIZE_RANGE}
          value={marker.size}
          format={(v) => `×${formatShort(v)}`}
          onChange={(size) => updateMarker({ size })}
        />
      </SettingRow>
      <div className="field">
        <div className="field__label-row">
          <span className="field__label">{t('marker.section.changes')}</span>
          <InfoTip text={t('marker.section.changesTip')} />
        </div>
        <PanelKeys target={{ kind: 'marker' }} />
      </div>
      {junctions > 0 && (
        <div className="field">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => {
              const added = addJunctionMarkerKeys()
              showToast({ kind: 'success', text: added > 0 ? t('marker.section.added', { count: added }) : t('marker.section.allKeyed') })
            }}
          >
            {t(sequence ? 'marker.section.perStage' : 'marker.section.perDay', { count: junctions })}
          </button>
          <p className="field__hint">{t('marker.section.junctionHint')}</p>
        </div>
      )}
      <details className="preset-more">
        <summary className="preset-more__summary">
          <span className="preset-more__label">{t('marker.section.more')}</span>
          <Icon name="chevron-down" size={16} />
        </summary>
        <div className="marker-more__body">
          {figurine && (
            <ChipChoice
              label={t('marker.section.badge')}
              name={`${id}-shape`}
              options={MARKER_SHAPES}
              value={marker.shape}
              labels={MARKER_SHAPE_LABELS}
              onChange={(shape) => updateMarker({ shape })}
            />
          )}
          {marker.kind !== 'boule' && (
            <MarkerColorRow
              label={alone ? t('marker.section.outlineColor') : t('marker.section.edgeColor')}
              path="marker.color"
              value={marker.color}
              trackColor={trackColor}
              onChange={(color) => updateMarker({ color })}
            />
          )}
          <ChipChoice
            label={t('marker.section.label')}
            name={`${id}-label`}
            options={MARKER_LABEL_MODES}
            value={marker.label}
            labels={MARKER_LABEL_MODE_LABELS}
            onChange={(label) => updateMarker({ label })}
          />
          {marker.label === 'texte' && (
            <TextField
              label={t('marker.section.labelText')}
              value={marker.labelText}
              placeholder={firstTrack?.name}
              onChange={(labelText) => updateMarker({ labelText: labelText.slice(0, MARKER_LABEL_MAX_CHARS) })}
            />
          )}
          {marker.label !== 'aucune' && racing && <p className="field__hint">{t('marker.section.otherLabels')}</p>}
          <div className="field__label-row">
            <label className="checkbox checkbox--switch">
              <input type="checkbox" checked={marker.stick} onChange={(e) => updateMarker({ stick: e.currentTarget.checked })} />
              {t('marker.section.stick')}
            </label>
            <InfoTip text={t('marker.section.stickTip')} />
          </div>
        </div>
      </details>
    </PanelSection>
  )
}
