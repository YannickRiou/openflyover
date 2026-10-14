import { useId, useMemo, useState } from 'react'
import { CLOUD_QUALITY_NAMES, effectiveRender } from '../export/qualityTier'
import { t, useT } from '../i18n'
import { formatDate } from '../i18n/format'
import { hasParamKeys } from '../film/paramKeys'
import { SUN_CHIP_LABELS, SUN_CHIPS, SUN_HOUR_RANGE, clockHourOfSolar, solarDay, sunChipHour, sunDayMs } from '../flyover/sun'
import type { SolarDay } from '../flyover/sun'
import { getSettingsHistory } from '../project/history'
import { useFilmSequence, useFilmTrack } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import type { Settings } from '../state/store'
import { IMAGERY_SOURCES, TERRAIN_SOURCES } from '../terrain/sources'
import { CLOUD_ALTITUDE_RANGE, SEA_TOP_RANGE, seaTopFor, type CloudMode, type CloudQuality, type CloudQualitySetting, type SeaRender } from '../weather/sceneClouds'
import { useWeatherStore } from '../weather/store'
import { NightSettings } from './NightSettings'
import { PanelKeys } from './KeyControls'
import { InfoTip, PanelSection, RangeField, SettingRow } from './PanelSection'
import { formatNumber, formatPercent } from './format'
import { Button, Checkbox, Radio, RadioGroup, Switch } from './primitives'

const ZOOM_OFFSETS: { value: Settings['imageryZoomOffset']; label: string }[] = [
  { value: 0, get label() { return t('offline.level.0') } },
  { value: 1, get label() { return t('offline.level.1') } },
  { value: 2, get label() { return t('offline.level.2') } },
]

const EXAGGERATION_MIN = 1
const EXAGGERATION_MAX = 3
const EXAGGERATION_STEP = 0.1

const EXPOSURE_EV_MIN = -2
const EXPOSURE_EV_MAX = 2
const EXPOSURE_EV_STEP = 0.5

const WEATHER_STRENGTH_STEP = 0.05

/** 0.5 -> "+0,5 IL" */
function formatEv(ev: number): string {
  return t('light.ev', { value: `${ev > 0 ? '+' : ev < 0 ? '−' : ''}${formatNumber(Math.abs(ev), 1)}` })
}

/** 10.5 -> "10 h 30" */
function formatHour(hour: number): string {
  const minutes = Math.round(hour * 60)
  return t('format.clock', { hours: Math.floor(minutes / 60), minutes: String(minutes % 60).padStart(2, '0') })
}

/** "2024-07-14" -> "14 juil. 2024" */
function formatDay(date: string): string {
  const ms = Date.parse(`${date}T12:00:00Z`)
  return Number.isNaN(ms) ? date : formatDate(ms, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** Day used for the chips and the day bar before a track is loaded. */
const PLAIN_DAY: SolarDay = { sunrise: 6, sunset: 18, noon: 12, polar: null }

/** Position of a solar hour along the slider. */
const hourAt = (hour: number) => `${(Math.min(Math.max(hour, 0), SUN_HOUR_RANGE.max) / SUN_HOUR_RANGE.max) * 100}%`

/** Night / twilight / day colours under the solar hour slider. */
function dayGradient(day: SolarDay): string {
  const { sunrise, sunset, noon } = day
  if (day.polar === 'night') return 'linear-gradient(90deg, var(--color-ink), var(--color-ink-soft), var(--color-ink))'
  if (sunrise === null || sunset === null) {
    return 'linear-gradient(90deg, var(--color-glacier), var(--color-white), var(--color-glacier))'
  }
  const stops = [
    `var(--color-ink) ${hourAt(sunrise - 1)}`,
    `var(--color-accent-light) ${hourAt(sunrise)}`,
    `var(--color-glacier) ${hourAt(sunrise + 1)}`,
    `var(--color-white) ${hourAt(noon)}`,
    `var(--color-glacier) ${hourAt(sunset - 1)}`,
    `var(--color-accent-light) ${hourAt(sunset)}`,
    `var(--color-ink) ${hourAt(sunset + 1)}`,
  ]
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

/**
 * « Lumière »: « Source de la lumière », the recorded time of the track (« À la suite »: each stage at its own hour, the
 * light blending across the junctions) or a fixed solar hour for the whole film, chosen on a day bar (night, sunrise,
 * day, sunset at the place and on the day of the film track) or with a chip (one undo step per chip).
 */
function SunTimeControl() {
  const t = useT()
  const id = useId()
  const sunHour = useAppStore((s) => s.settings.sunHour)
  const sunFromTrack = useAppStore((s) => s.settings.sunFromTrack)
  const sunDate = useAppStore((s) => s.settings.sunDate)
  const setSetting = useAppStore((s) => s.setSetting)
  const sunKeyed = useAppStore((s) => hasParamKeys(s.settings.film, ['sunHour']))
  const stages = useFilmSequence()?.stages.length ?? 0
  const filmTrack = useFilmTrack()
  const startTime = filmTrack?.stats.startTime
  const utcOffsetMin = filmTrack?.utcOffsetMin
  const origin = useAppStore((s) => s.frameOrigin)
  const [today] = useState(() => Date.now())
  const trackHasTime = startTime !== undefined
  const follows = sunFromTrack && trackHasTime
  const lat = origin?.lat
  const lon = origin?.lon
  // same place and day as the scene: frame origin, the day chosen, else the UTC day of the first track's start
  const day = useMemo(
    () => (lat === undefined || lon === undefined ? null : solarDay(lat, lon, sunDayMs(sunDate, startTime, today))),
    [lat, lon, sunDate, startTime, today],
  )
  const shown = day ?? PLAIN_DAY
  const setHour = (hour: number) => getSettingsHistory().transaction(() => setSetting('sunHour', hour))

  let dayHint = t('light.sun.dayUnknown')
  let solarTip = t('light.sun.solarTip')
  if (day?.polar === 'day') dayHint = t('light.sun.polarDay')
  else if (day?.polar === 'night') dayHint = t('light.sun.polarNight')
  else if (day && day.sunrise !== null && day.sunset !== null && lon !== undefined) {
    const solar = t('light.sun.span', { rise: formatHour(day.sunrise), set: formatHour(day.sunset) })
    // clock time of the place only when the track gives its UTC offset (no time zone database)
    if (utcOffsetMin === undefined) dayHint = t('light.sun.daySolar', { rise: formatHour(day.sunrise), set: formatHour(day.sunset) })
    else {
      const clock = (hour: number) => formatHour(clockHourOfSolar(hour, lon, utcOffsetMin))
      dayHint = t('light.sun.dayLocal', { rise: clock(day.sunrise), set: clock(day.sunset) })
      solarTip = t('light.sun.solarTipDay', { solar })
    }
  }

  return (
    <>
      <fieldset className="field fieldset">
        <legend className="field__label">{t('light.sun.legend')}</legend>
        <RadioGroup
          aria-label={t('light.sun.legend')}
          value={follows ? 'follow' : 'fixed'}
          onChange={(mode) => setSetting('sunFromTrack', mode === 'follow')}
        >
          <Radio value="follow" disabled={!trackHasTime} aria-describedby={`${id}-sun-mode-hint`}>
            {t('light.sun.follow')}
          </Radio>
          <Radio value="fixed">{t('light.sun.fixed')}</Radio>
        </RadioGroup>
        <p id={`${id}-sun-mode-hint`} className="field__hint">
          {!trackHasTime
            ? t('light.sun.needsTime')
            : follows
              ? stages > 1
                ? t('light.sun.followHintStages')
                : t('light.sun.followHint')
              : stages > 1
                ? t('light.sun.fixedHintStages')
                : t('light.sun.fixedHint')}
        </p>
      </fieldset>

      {sunKeyed && (
        <p className="field__hint">{t(follows ? 'light.sun.keyedFollow' : 'light.sun.keyedFixed')}</p>
      )}
      {follows && sunKeyed && <PanelKeys target={{ kind: 'param', param: 'sunHour' }} />}

      {!follows && (
        <div className="field">
          <div className="field__label-row">
            <label className="field__label" htmlFor={`${id}-sun-hour`}>
              {t('light.sun.solarHour')}
            </label>
            <InfoTip text={solarTip} />
          </div>
          <div className="range-row">
            <div className="sun-day">
              <input
                id={`${id}-sun-hour`}
                className="range"
                type="range"
                min={SUN_HOUR_RANGE.min}
                max={SUN_HOUR_RANGE.max}
                step={SUN_HOUR_RANGE.step}
                value={sunHour}
                onChange={(e) => setSetting('sunHour', Number(e.currentTarget.value))}
                aria-valuetext={formatHour(sunHour)}
                aria-describedby={`${id}-sun-day`}
              />
              <div className="sun-day__bar" style={{ background: dayGradient(shown) }} aria-hidden="true">
                {shown.sunrise !== null && <span className="sun-day__mark" style={{ left: hourAt(shown.sunrise) }} />}
                {shown.sunset !== null && <span className="sun-day__mark" style={{ left: hourAt(shown.sunset) }} />}
              </div>
            </div>
            <output className="range-row__value range-row__value--wide" htmlFor={`${id}-sun-hour`}>
              {formatHour(sunHour)}
            </output>
          </div>
          <PanelKeys target={{ kind: 'param', param: 'sunHour' }} />
          <p id={`${id}-sun-day`} className="field__hint">
            {dayHint}
          </p>
          <div className="sun-chips" role="group" aria-label={t('light.sun.moments')}>
            {SUN_CHIPS.map((chip) => {
              const hour = sunChipHour(chip, shown)
              return (
                <button
                  key={chip}
                  type="button"
                  className="sun-chip"
                  aria-pressed={hour !== null && hour === sunHour}
                  disabled={hour === null}
                  title={hour === null ? t('light.sun.notThatDay') : formatHour(hour)}
                  onClick={() => hour !== null && setHour(hour)}
                >
                  {SUN_CHIP_LABELS[chip]}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {!follows && (
        <SettingRow label={t('light.sun.day')} value={sunDate ? formatDay(sunDate) : t('light.sun.dayOfOuting')} paths={['sunDate']}>
          <div className="field">
            <div className="field__label-row">
              <label className="field__label" htmlFor={`${id}-sun-date`}>
                {t('light.sun.day')}
              </label>
              <InfoTip text={t('light.sun.dayTip')} />
            </div>
            <div className="sun-date">
              <input
                id={`${id}-sun-date`}
                className="input"
                type="date"
                value={sunDate}
                onChange={(e) => setSetting('sunDate', e.currentTarget.value)}
              />
              {sunDate && (
                <Button onClick={() => setSetting('sunDate', '')}>
                  {t('light.sun.dayOfOuting')}
                </Button>
              )}
            </div>
          </div>
        </SettingRow>
      )}
    </>
  )
}

const CLOUD_MODE_OPTIONS: { value: CloudMode; label: string }[] = [
  { value: 'meteo', get label() { return t('light.clouds.mode.meteo') } },
  { value: 'manuel', get label() { return t('light.clouds.mode.manuel') } },
  { value: 'mer', get label() { return t('light.clouds.mode.mer') } },
  { value: 'aucun', get label() { return t('light.clouds.mode.aucun') } },
]
const SEA_RENDER_OPTIONS: { value: SeaRender; label: string }[] = [
  { value: 'volume', get label() { return t('light.clouds.render.volume') } },
  { value: 'surface', get label() { return t('light.clouds.render.surface') } },
]
const CLOUD_QUALITY_OPTIONS: { value: CloudQuality; label: string }[] = [
  { value: 'low', get label() { return CLOUD_QUALITY_NAMES.low } },
  { value: 'medium', get label() { return CLOUD_QUALITY_NAMES.medium } },
  { value: 'high', get label() { return CLOUD_QUALITY_NAMES.high } },
]

/**
 * « Nuages » (atmosphere on): volumetric clouds from the weather of the outing, a manual cover, a sea of clouds (its
 * top proposed from the first track when chosen), or none.
 */
function CloudsControl({ weatherReady }: { weatherReady: boolean }) {
  const t = useT()
  const id = useId()
  const clouds = useAppStore((s) => s.settings.clouds)
  const stats = useAppStore((s) => s.tracks[0]?.stats)
  const setSetting = useAppStore((s) => s.setSetting)
  const set = (patch: Partial<Settings['clouds']>) => setSetting('clouds', { ...clouds, ...patch })
  // what the export really uses: the quality chosen by hand, else the one of the export quality (qualityTier.ts)
  const videoQuality = useAppStore((s) => s.settings.video.quality)
  const effectiveQuality = effectiveRender(videoQuality, clouds).cloudsQuality
  const qualityLabel = CLOUD_QUALITY_OPTIONS.find((o) => o.value === effectiveQuality)?.label
  return (
    <>
      <fieldset className="field fieldset">
        {/* the section is titled « Nuages » */}
        <legend className="visually-hidden">{t('light.clouds.legend')}</legend>
        <RadioGroup
          aria-label={t('light.clouds.legend')}
          value={clouds.mode}
          onChange={(mode) => set(mode === 'mer' ? { mode, seaTopM: seaTopFor(stats?.minEle, stats?.maxEle) } : { mode })}
        >
          {CLOUD_MODE_OPTIONS.map((option) => (
            <Radio key={option.value} value={option.value}>
              {option.label}
            </Radio>
          ))}
        </RadioGroup>
        <p className="field__hint">
          {clouds.mode === 'aucun'
            ? t('light.clouds.hintNone')
            : clouds.mode === 'manuel'
              ? t('light.clouds.hintManual')
              : clouds.mode === 'mer'
                ? t('light.clouds.hintSea')
                : weatherReady
                ? t('light.clouds.hintWeather')
                : t('light.clouds.hintWaiting')}
        </p>
      </fieldset>

      {clouds.mode === 'manuel' && (
        <RangeField
          label={t('light.clouds.cover')}
          min={0}
          max={1}
          step={0.05}
          value={clouds.coverage}
          format={formatPercent}
          onChange={(coverage) => set({ coverage })}
        />
      )}

      {clouds.mode === 'mer' && (
        <RangeField
          label={t('light.clouds.seaTop')}
          tip={t('light.clouds.seaTopTip')}
          {...SEA_TOP_RANGE}
          value={clouds.seaTopM}
          format={(v) => `${formatNumber(v)} m`}
          onChange={(seaTopM) => set({ seaTopM })}
        />
      )}

      {clouds.mode === 'mer' && (
        <SettingRow
          label={t('light.clouds.seaRender')}
          value={SEA_RENDER_OPTIONS.find((o) => o.value === clouds.seaRender)?.label}
          paths={['clouds.seaRender']}
          weight="clouds"
        >
          <fieldset className="field fieldset">
            <legend className="field__label">{t('light.clouds.seaRender')}</legend>
            <RadioGroup aria-label={t('light.clouds.seaRender')} value={clouds.seaRender} onChange={(seaRender) => set({ seaRender })}>
              {SEA_RENDER_OPTIONS.map((option) => (
                <Radio key={option.value} value={option.value}>
                  {option.label}
                </Radio>
              ))}
            </RadioGroup>
            <p className="field__hint">
              {clouds.seaRender === 'surface'
                ? t('light.clouds.hintSurface')
                : t('light.clouds.hintVolume')}
            </p>
          </fieldset>
        </SettingRow>
      )}

      {clouds.mode !== 'aucun' && clouds.mode !== 'mer' && (
        <SettingRow label={t('light.clouds.base')} value={`${formatNumber(clouds.altitudeM)} m`} paths={['clouds.altitudeM']}>
          <RangeField
            label={t('light.clouds.base')}
            tip={t('light.clouds.baseTip')}
            {...CLOUD_ALTITUDE_RANGE}
            value={clouds.altitudeM}
            format={(v) => `${formatNumber(v)} m`}
            onChange={(altitudeM) => set({ altitudeM })}
          />
        </SettingRow>
      )}

      {clouds.mode !== 'aucun' && (
        <SettingRow
          label={t('light.clouds.quality')}
          value={qualityLabel}
          paths={['clouds.quality']}
          weight="clouds"
          preset="clouds"
        >
          <div className="field">
            <div className="field__label-row">
              <label className="field__label" htmlFor={`${id}-clouds-quality`}>
                {t('light.clouds.quality')}
              </label>
              <InfoTip text={t('light.clouds.qualityTip')} />
            </div>
            <select
              id={`${id}-clouds-quality`}
              className="select"
              value={clouds.quality}
              onChange={(e) => set({ quality: e.currentTarget.value as CloudQualitySetting })}
            >
              <option value="auto">{t('light.clouds.qualityAuto', { quality: qualityLabel ?? '' })}</option>
              {CLOUD_QUALITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {clouds.quality !== 'auto' && (
              <Button onClick={() => set({ quality: 'auto' })}>
                {t('light.clouds.backToPreset')}
              </Button>
            )}
          </div>
        </SettingRow>
      )}
    </>
  )
}

/** « Plans d'eau »: lakes and rivers of OpenStreetMap drawn as reflective water, and their strength. */
function WaterControl() {
  const t = useT()
  const id = useId()
  const water = useAppStore((s) => s.settings.water)
  const setSetting = useAppStore((s) => s.setSetting)
  return (
    <>
      <div className="field__label-row">
        <Checkbox
          id={`${id}-water`}
          checked={water.enabled}
          onChange={(on) => setSetting('water', { ...water, enabled: on })}
        >
          {t('light.water.enable')}
        </Checkbox>
        <InfoTip text={t('light.water.tip')} />
      </div>
      {water.enabled && (
        <SettingRow label={t('light.water.strength')} value={formatPercent(water.strength)} paths={['water.strength']}>
          <RangeField
            label={t('light.water.strength')}
            min={0}
            max={1}
            step={0.05}
            value={water.strength}
            format={formatPercent}
            onChange={(strength) => setSetting('water', { ...water, strength })}
          />
        </SettingRow>
      )}
    </>
  )
}

/** « Nettoyer le relief en mer »: spikes of the elevation data over the sea, and the sea brought to 0 m. */
function DemCleanControl() {
  const t = useT()
  const id = useId()
  const demClean = useAppStore((s) => s.settings.demClean)
  const setSetting = useAppStore((s) => s.setSetting)
  return (
    <>
      <div className="field__label-row">
        <Checkbox
          id={`${id}-clean`}
          checked={demClean.enabled}
          onChange={(on) => setSetting('demClean', { ...demClean, enabled: on })}
        >
          {t('light.demClean.enable')}
        </Checkbox>
        <InfoTip text={t('light.demClean.tip')} />
      </div>
      {demClean.enabled && (
        <div className="field__label-row">
          <Checkbox
            id={`${id}-sea`}
            checked={demClean.seaToZero}
            onChange={(on) => setSetting('demClean', { ...demClean, seaToZero: on })}
          >
            {t('light.demClean.seaToZero')}
          </Checkbox>
          <InfoTip text={t('light.demClean.seaToZeroTip')} />
        </div>
      )}
    </>
  )
}

/** « Carte » tab, before the track and the landmarks: sections Fond de carte and Relief. */
export function MapSettings() {
  const t = useT()
  const settings = useAppStore((s) => s.settings)
  const setSetting = useAppStore((s) => s.setSetting)
  const id = useId()
  const terrainId = `${id}-terrain`
  const imageryId = `${id}-imagery`
  const wireframeId = `${id}-wireframe`
  const zoomLabel = ZOOM_OFFSETS.find((o) => o.value === settings.imageryZoomOffset)?.label
  const terrainName = TERRAIN_SOURCES.find((source) => source.id === settings.terrainSourceId)?.name

  return (
    <>
      {/* the imagery source is left out of the marker: the import picks it per region (IGN, swisstopo) */}
      <PanelSection title={t('light.map.background')} keys={['terrainSourceId', 'imageryZoomOffset', 'water']}>
        <div className="field">
          <label className="field__label" htmlFor={imageryId}>
            {t('light.map.imagery')}
          </label>
          <select
            id={imageryId}
            className="select"
            value={settings.imagerySourceId}
            onChange={(e) => setSetting('imagerySourceId', e.currentTarget.value)}
          >
            {IMAGERY_SOURCES.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </div>

        <WaterControl />

        <SettingRow label={t('light.map.imageryDetail')} value={zoomLabel} paths={['imageryZoomOffset']}>
          <fieldset className="field fieldset">
            <legend className="field__label">{t('light.map.imageryDetail')}</legend>
            <RadioGroup
              aria-label={t('light.map.imageryDetail')}
              value={settings.imageryZoomOffset}
              onChange={(offset) => setSetting('imageryZoomOffset', offset)}
            >
              {ZOOM_OFFSETS.map((option) => (
                <Radio key={option.value} value={option.value}>
                  {option.label}
                </Radio>
              ))}
            </RadioGroup>
          </fieldset>
        </SettingRow>

        <SettingRow label={t('light.map.terrainSource')} value={terrainName} paths={['terrainSourceId']}>
          <div className="field">
            <label className="field__label" htmlFor={terrainId}>
              {t('light.map.terrainSource')}
            </label>
            <select
              id={terrainId}
              className="select"
              value={settings.terrainSourceId}
              onChange={(e) => setSetting('terrainSourceId', e.currentTarget.value)}
            >
              {TERRAIN_SOURCES.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
          </div>
        </SettingRow>
      </PanelSection>

      <PanelSection title={t('light.map.terrain')} keys={['exaggeration', 'demClean', 'wireframe']}>
        <RangeField
          label={t('light.map.exaggeration')}
          tip={t('light.map.exaggerationTip')}
          min={EXAGGERATION_MIN}
          max={EXAGGERATION_MAX}
          step={EXAGGERATION_STEP}
          value={settings.exaggeration}
          format={(v) => `×${formatNumber(v, 1)}`}
          onChange={(exaggeration) => setSetting('exaggeration', exaggeration)}
          wide={false}
        />

        <DemCleanControl />

        <SettingRow label={t('light.map.wireframe')} value={settings.wireframe ? t('common.yes') : t('common.no')} paths={['wireframe']}>
          <div className="field__label-row">
            <Checkbox
              id={wireframeId}
              checked={settings.wireframe}
              onChange={(on) => setSetting('wireframe', on)}
            >
              {t('light.map.wireframe')}
            </Checkbox>
            <InfoTip text={t('light.map.wireframeTip')} />
          </div>
        </SettingRow>
      </PanelSection>
    </>
  )
}

/** The weather of the outing is loaded for the first track: the clouds « Météo » and the weather in the image follow it. */
function useWeatherReady(): boolean {
  const firstTrackId = useAppStore((s) => s.tracks[0]?.id)
  return useWeatherStore((s) => s.status === 'ready' && s.trackId !== null && s.trackId === firstTrackId)
}

/** In place of what needs the atmosphere (sky, clouds, sun) while it is off. */
function AtmosphereOffHint({ what }: { what: 'clouds' | 'scene' }) {
  const t = useT()
  return <p className="field__hint">{t(what === 'clouds' ? 'light.weather.offClouds' : 'light.weather.offScene')}</p>
}

/** « Météo » tab, after the weather of the outing: sections Nuages and Pluie et brume (the weather in the image). */
export function WeatherSettings() {
  const t = useT()
  const atmosphere = useAppStore((s) => s.settings.atmosphere)
  const weatherScene = useAppStore((s) => s.settings.weatherScene)
  const setSetting = useAppStore((s) => s.setSetting)
  const weatherReady = useWeatherReady()
  const id = useId()

  return (
    <>
      <PanelSection title={t('light.weather.clouds')} keys={['clouds']}>
        {atmosphere ? <CloudsControl weatherReady={weatherReady} /> : <AtmosphereOffHint what="clouds" />}
      </PanelSection>

      <PanelSection title={t('light.weather.rainMist')} keys={['weatherScene']}>
        {!atmosphere ? (
          <AtmosphereOffHint what="scene" />
        ) : !weatherReady ? (
          <p className="field__hint">{t('light.weather.waiting')}</p>
        ) : (
          <>
            <Switch
              id={`${id}-weather-scene`}
              checked={weatherScene.enabled}
              onChange={(on) => setSetting('weatherScene', { ...weatherScene, enabled: on })}
            >
              {t('light.weather.scene')}
            </Switch>
            {weatherScene.enabled && (
              <SettingRow label={t('light.weather.strength')} value={formatPercent(weatherScene.strength)} paths={['weatherScene.strength']}>
                <RangeField
                  label={t('light.weather.strength')}
                  min={0}
                  max={1}
                  step={WEATHER_STRENGTH_STEP}
                  value={weatherScene.strength}
                  format={formatPercent}
                  onChange={(strength) => setSetting('weatherScene', { ...weatherScene, strength })}
                />
              </SettingRow>
            )}
          </>
        )}
      </PanelSection>
    </>
  )
}

/** « Lumière » tab, before the colours (`GradingPanel`): sections Atmosphère (sky, shadows, exposure) and Soleil. */
export function LightSettings() {
  const t = useT()
  const atmosphere = useAppStore((s) => s.settings.atmosphere)
  const shadows = useAppStore((s) => s.settings.shadows)
  const exposureEv = useAppStore((s) => s.settings.exposureEv)
  const exposureKeyed = useAppStore((s) => hasParamKeys(s.settings.film, ['exposure']))
  const setSetting = useAppStore((s) => s.setSetting)
  const id = useId()

  return (
    <>
      <PanelSection title={t('light.atmosphere.title')} keys={['atmosphere', 'shadows', 'exposureEv']}>
        <Switch id={`${id}-atmosphere`} checked={atmosphere} onChange={(on) => setSetting('atmosphere', on)}>{t('light.atmosphere.enable')}</Switch>

        {atmosphere && (
          <Checkbox id={`${id}-shadows`} checked={shadows} onChange={(on) => setSetting('shadows', on)}>{t('light.atmosphere.shadows')}</Checkbox>
        )}

        {atmosphere && (
          <SettingRow label={t('light.atmosphere.exposure')} value={formatEv(exposureEv)} paths={['exposureEv']}>
            <RangeField
              label={t('light.atmosphere.exposure')}
              tip={t('light.atmosphere.exposureTip')}
              min={EXPOSURE_EV_MIN}
              max={EXPOSURE_EV_MAX}
              step={EXPOSURE_EV_STEP}
              value={exposureEv}
              format={formatEv}
              onChange={(ev) => setSetting('exposureEv', ev)}
            />
            {exposureKeyed && (
              <p className="field__hint">{t('light.atmosphere.exposureKeyed')}</p>
            )}
            <PanelKeys target={{ kind: 'param', param: 'exposure' }} />
          </SettingRow>
        )}
      </PanelSection>

      <PanelSection title={t('light.atmosphere.sun')} keys={['sunFromTrack', 'sunHour', 'sunDate']}>
        {atmosphere ? (
          <SunTimeControl />
        ) : (
          <p className="field__hint">{t('light.atmosphere.sunOff')}</p>
        )}
      </PanelSection>

      <NightSettings />
    </>
  )
}
