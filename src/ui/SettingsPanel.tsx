import { useEffect, useId, useMemo, useState } from 'react'
import { CLOUD_QUALITY_NAMES, effectiveRender } from '../export/qualityTier'
import { t, useT } from '../i18n'
import { formatDate } from '../i18n/format'
import { hasParamKeys } from '../film/paramKeys'
import { trackPathOf } from '../flyover/path'
import { playsInSequence } from '../flyover/sequence'
import { SUN_CHIP_LABELS, SUN_CHIPS, SUN_HOUR_RANGE, clockHourOfSolar, solarDay, sunChipHour, sunDayMs } from '../flyover/sun'
import type { SolarDay } from '../flyover/sun'
import { FOREST_DENSITY_RANGE } from '../osm/forest'
import { getSettingsHistory } from '../project/history'
import { useFilmSequence, useFilmTrack, useKeyedValue } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import type { Settings } from '../state/store'
import { findImageryDates, imageryDateKind, imageryDateValue, type ImageryDate, type ImageryDates } from '../terrain/imageryDates'
import { TERRAIN_SOURCES, getImagerySource, groupImagerySources } from '../terrain/sources'
import { centroid } from '../geo/lonLat'
import { CLOUD_ALTITUDE_RANGE, CLOUD_WIND_RANGE, DEFAULT_CLOUDS, SEA_TOP_RANGE, WIND_DIRECTIONS, seaTopFor, type CloudMode, type CloudQuality, type SeaRender } from '../weather/sceneClouds'
import { SNOW_LINE_RANGE, snowLineAtProgress, type SnowMode, type SnowUnknown } from '../weather/snowLine'
import { useWeatherStore, weatherSeriesOf } from '../weather/store'
import { NightSettings } from './NightSettings'
import { PanelKeys } from './KeyControls'
import { InfoTip, PanelSection, RangeField, SettingRow } from './PanelSection'
import { formatNumber, formatPercent } from './format'
import { Button, Checkbox, DateField, Radio, RadioGroup, Select, Slider, Switch } from './primitives'

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

/** The bar under the slider is inset by half a thumb (8 px) so it lines up with the thumb's centre; the marks are sunrise and sunset. */
const DAY_BAR = 'relative mx-[8px] h-2 rounded-full border border-edge'
const DAY_MARK = 'absolute -top-1 -bottom-1 -ml-px w-0.5 rounded-[1px] bg-text-2'

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
  const sunSetting = useAppStore((s) => s.settings.sunHour)
  const sunFromTrack = useAppStore((s) => s.settings.sunFromTrack)
  const sunDate = useAppStore((s) => s.settings.sunDate)
  const setSetting = useAppStore((s) => s.setSetting)
  // with keys on the sun hour the slider shows and edits the key at the marker, not the setting they ignore
  const [sunHour, setSunHour] = useKeyedValue('sunHour', sunSetting, (hour) => setSetting('sunHour', hour))
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
  const setHour = (hour: number) => getSettingsHistory().transaction(() => setSunHour(hour))

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
      <fieldset className="field min-w-0">
        <legend className="type-label mb-1">{t('light.sun.legend')}</legend>
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
        <p id={`${id}-sun-mode-hint`} className="type-hint">
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
        <p className="type-hint">{t(follows ? 'light.sun.keyedFollow' : 'light.sun.keyedFixed')}</p>
      )}
      {follows && sunKeyed && <PanelKeys target={{ kind: 'param', param: 'sunHour' }} />}

      {!follows && (
        <div className="field">
          <div className="flex items-center gap-1">
            <span className="type-label">
              {t('light.sun.solarHour')}
            </span>
            <InfoTip text={solarTip} />
          </div>
          <Slider
            aria-label={t('light.sun.solarHour')}
            aria-describedby={`${id}-sun-day`}
            min={SUN_HOUR_RANGE.min}
            max={SUN_HOUR_RANGE.max}
            step={SUN_HOUR_RANGE.step}
            value={sunHour}
            onChange={setSunHour}
            format={formatHour}
            below={
              <div className={DAY_BAR} style={{ background: dayGradient(shown) }} aria-hidden="true">
                {shown.sunrise !== null && <span className={DAY_MARK} style={{ left: hourAt(shown.sunrise) }} />}
                {shown.sunset !== null && <span className={DAY_MARK} style={{ left: hourAt(shown.sunset) }} />}
              </div>
            }
          />
          <PanelKeys target={{ kind: 'param', param: 'sunHour' }} />
          <p id={`${id}-sun-day`} className="type-hint">
            {dayHint}
          </p>
          <RadioGroup
            look="chips"
            className="mt-2"
            aria-label={t('light.sun.moments')}
            value={SUN_CHIPS.find((chip) => sunChipHour(chip, shown) === sunHour) ?? ''}
            onChange={(chip) => {
              const hour = chip && sunChipHour(chip, shown)
              if (typeof hour === 'number') setHour(hour)
            }}
          >
            {SUN_CHIPS.map((chip) => {
              const hour = sunChipHour(chip, shown)
              return (
                <Radio key={chip} value={chip} disabled={hour === null} title={hour === null ? t('light.sun.notThatDay') : formatHour(hour)}>
                  {SUN_CHIP_LABELS[chip]}
                </Radio>
              )
            })}
          </RadioGroup>
        </div>
      )}

      {/* with keys on the sun, its hours are solar hours of this day, in « Heure de la trace » too */}
      {(!follows || sunKeyed) && (
        <SettingRow label={t('light.sun.day')} value={sunDate ? formatDay(sunDate) : t('light.sun.dayOfOuting')} paths={['sunDate']}>
          <div className="field">
            <div className="flex items-center gap-1">
              <label className="type-label" id={`${id}-sun-date-label`} htmlFor={`${id}-sun-date`}>
                {t('light.sun.day')}
              </label>
              <InfoTip text={t('light.sun.dayTip')} />
            </div>
            <div className="flex gap-2">
              <DateField
                id={`${id}-sun-date`}
                aria-labelledby={`${id}-sun-date-label`}
                className="min-w-0 flex-1"
                value={sunDate}
                onChange={(day) => setSetting('sunDate', day)}
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

/** Label of a date of photos: the day they were taken, else the year (IGN) or the release (Esri without metadata). */
function imageryDateLabel(date: ImageryDate): string {
  const day = formatDate(date.timeMs, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  if (date.taken) return day
  return date.kind === 'ign' ? String(new Date(date.timeMs).getUTCFullYear()) : t('light.map.imageryDateRelease', { date: day })
}

/**
 * « Date des photos » (IGN BD ORTHO, Esri World Imagery): the latest photos, or older ones found at the first track
 * on demand (a few small requests, `findImageryDates`), to choose a season with or without snow.
 */
function ImageryDateControl() {
  const t = useT()
  const id = useId()
  const sourceId = useAppStore((s) => s.settings.imagerySourceId)
  const date = useAppStore((s) => s.settings.imageryDate)
  const bounds = useAppStore((s) => s.tracks[0]?.bounds)
  const setSetting = useAppStore((s) => s.setSetting)
  const [search, setSearch] = useState<{ key: string; status: 'loading' | 'error' } | ({ key: string } & ImageryDates) | null>(null)
  const kind = imageryDateKind(sourceId)
  const at = bounds ? centroid(bounds) : null
  const key = at ? `${sourceId}:${at.lon.toFixed(3)},${at.lat.toFixed(3)}` : ''
  const current = search?.key === key ? search : null
  const dates = current && 'dates' in current ? current.dates : []
  const latest = current && 'dates' in current ? current.latest : null
  const latestLabel = latest ? t('light.map.imageryDateLatestOn', { date: imageryDateLabel(latest) }) : t('light.map.imageryDateLatest')
  const value = imageryDateValue(date, kind) === null ? '' : date
  const chosen = dates.find((d) => d.value === value)
  // a date chosen before its list was found here (another tab, a project reopened): the year for IGN, never the number of an Esri release
  const valueLabel = value === '' ? latestLabel : chosen ? imageryDateLabel(chosen) : kind === 'ign' ? value.slice(kind.length + 1) : t('light.map.imageryDateOther')
  const find = () => {
    if (!at) return
    setSearch({ key, status: 'loading' })
    findImageryDates(getImagerySource(sourceId), at).then(
      (found) => setSearch({ key, ...found }),
      () => setSearch({ key, status: 'error' }),
    )
  }
  // the list of a chosen date is found again by itself (kept for the session: no new request when it was found before)
  const pending = kind !== null && value !== '' && at !== null && current === null
  useEffect(() => {
    if (!pending || !bounds) return
    let live = true
    findImageryDates(getImagerySource(sourceId), centroid(bounds)).then(
      (found) => live && setSearch({ key, ...found }),
      () => {},
    )
    return () => {
      live = false
    }
  }, [pending, key, sourceId, bounds])
  if (!kind) return null
  const options = [
    { value: '', label: latestLabel },
    ...dates.map((d) => ({ value: d.value, label: imageryDateLabel(d) })),
    ...(value !== '' && !chosen ? [{ value, label: valueLabel }] : []),
  ]
  return (
    <SettingRow label={t('light.map.imageryDate')} value={valueLabel} paths={['imageryDate']}>
      <div className="field">
        <label className="type-label" htmlFor={`${id}-imagery-date`}>
          {t('light.map.imageryDate')}
        </label>
        <Select id={`${id}-imagery-date`} value={value} options={options} onChange={(next) => setSetting('imageryDate', next)} />
        {!(current && 'dates' in current) && (
          <Button block disabled={!at || current?.status === 'loading'} onClick={find}>
            {current?.status === 'loading' ? t('light.map.imageryDateSearching') : t('light.map.imageryDateSearch')}
          </Button>
        )}
        <p className="type-hint">
          {!at
            ? t('light.map.imageryDateNoTrack')
            : current && 'status' in current && current.status === 'error'
              ? t('light.map.imageryDateError')
              : current && 'dates' in current && dates.length === 0
                ? t('light.map.imageryDateNone')
                : kind === 'ign'
                  ? t('light.map.imageryDateHintIgn')
                  : t('light.map.imageryDateHintEsri')}
        </p>
      </div>
    </SettingRow>
  )
}

/** Headings of the imagery picker (`groupImagerySources`). */
const IMAGERY_GROUP_LABELS = {
  get photos() { return t('light.map.imageryPhotos') },
  get maps() { return t('light.map.imageryMaps') },
  get elsewhere() { return t('light.map.imageryElsewhere') },
}

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
      <fieldset className="field min-w-0">
        {/* the section is titled « Nuages » */}
        <legend className="sr-only">{t('light.clouds.legend')}</legend>
        <RadioGroup
          aria-label={t('light.clouds.legend')}
          value={clouds.mode}
          // the top of the sea fits the track the first time; a top chosen since is kept
          onChange={(mode) => set(mode === 'mer' && clouds.seaTopM === DEFAULT_CLOUDS.seaTopM ? { mode, seaTopM: seaTopFor(stats?.minEle, stats?.maxEle) } : { mode })}
        >
          {CLOUD_MODE_OPTIONS.map((option) => (
            <Radio key={option.value} value={option.value}>
              {option.label}
            </Radio>
          ))}
        </RadioGroup>
        <p className="type-hint">
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

      {clouds.mode === 'meteo' && (
        <Checkbox id={`${id}-wind-by-hand`} checked={clouds.windByHand} onChange={(windByHand) => set({ windByHand })}>
          {t('light.clouds.windByHand')}
        </Checkbox>
      )}

      {(clouds.mode === 'manuel' || clouds.mode === 'mer' || (clouds.mode === 'meteo' && clouds.windByHand)) && (
        <>
          <RangeField
            label={t('light.clouds.wind')}
            tip={t('light.clouds.windTip')}
            {...CLOUD_WIND_RANGE}
            value={clouds.windKmh}
            format={(v) => `${formatNumber(v)} km/h`}
            onChange={(windKmh) => set({ windKmh })}
          />
          <div className="field">
            <label className="type-label" htmlFor={`${id}-wind-direction`}>
              {t('light.clouds.windDirection')}
            </label>
            <Select
              id={`${id}-wind-direction`}
              value={clouds.windDirection}
              options={WIND_DIRECTIONS.map((d) => ({ value: d, label: t(`light.clouds.windFrom.${d}`) }))}
              onChange={(windDirection) => set({ windDirection })}
            />
          </div>
        </>
      )}

      {clouds.mode === 'mer' && (
        <SettingRow
          label={t('light.clouds.seaRender')}
          value={SEA_RENDER_OPTIONS.find((o) => o.value === clouds.seaRender)?.label}
          paths={['clouds.seaRender']}
          weight="clouds"
        >
          <fieldset className="field min-w-0">
            <legend className="type-label mb-1">{t('light.clouds.seaRender')}</legend>
            <RadioGroup aria-label={t('light.clouds.seaRender')} value={clouds.seaRender} onChange={(seaRender) => set({ seaRender })}>
              {SEA_RENDER_OPTIONS.map((option) => (
                <Radio key={option.value} value={option.value}>
                  {option.label}
                </Radio>
              ))}
            </RadioGroup>
            <p className="type-hint">
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
            <div className="flex items-center gap-1">
              <label className="type-label" htmlFor={`${id}-clouds-quality`}>
                {t('light.clouds.quality')}
              </label>
              <InfoTip text={t('light.clouds.qualityTip')} />
            </div>
            <Select
              id={`${id}-clouds-quality`}
              value={clouds.quality}
              options={[{ value: 'auto', label: t('light.clouds.qualityAuto', { quality: qualityLabel ?? '' }) }, ...CLOUD_QUALITY_OPTIONS]}
              onChange={(quality) => set({ quality })}
            />
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
      <div className="flex items-center gap-1">
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

/** « Forêts »: trees where OpenStreetMap has forests, and how many per hectare. */
function ForestControl() {
  const t = useT()
  const id = useId()
  const forest = useAppStore((s) => s.settings.forest)
  const setSetting = useAppStore((s) => s.setSetting)
  const perHectare = (n: number) => t('light.forest.densityValue', { n })
  return (
    <>
      <div className="flex items-center gap-1">
        <Checkbox id={`${id}-forest`} checked={forest.enabled} onChange={(on) => setSetting('forest', { ...forest, enabled: on })}>
          {t('light.forest.enable')}
        </Checkbox>
        <InfoTip text={t('light.forest.tip')} />
      </div>
      {forest.enabled && (
        <SettingRow label={t('light.forest.density')} value={perHectare(forest.density)} paths={['forest.density']}>
          <RangeField
            label={t('light.forest.density')}
            tip={t('light.forest.densityTip')}
            min={FOREST_DENSITY_RANGE.min}
            max={FOREST_DENSITY_RANGE.max}
            step={FOREST_DENSITY_RANGE.step}
            value={forest.density}
            format={perHectare}
            onChange={(density) => setSetting('forest', { ...forest, density })}
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
      <div className="flex items-center gap-1">
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
        <div className="flex items-center gap-1">
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
  const trackBounds = useAppStore((s) => s.tracks[0]?.bounds)
  const imageryId = `${id}-imagery`
  const zoomLabel = ZOOM_OFFSETS.find((o) => o.value === settings.imageryZoomOffset)?.label
  const terrainName = TERRAIN_SOURCES.find((source) => source.id === settings.terrainSourceId)?.name

  return (
    <>
      {/* the imagery source is left out of the marker: the import picks it per region (IGN, swisstopo) */}
      <PanelSection title={t('light.map.background')} keys={['terrainSourceId', 'imageryZoomOffset', 'water', 'forest']}>
        <div className="field">
          <label className="type-label" htmlFor={imageryId}>
            {t('light.map.imagery')}
          </label>
          <Select
            id={imageryId}
            value={settings.imagerySourceId}
            options={groupImagerySources(trackBounds ? centroid(trackBounds) : undefined).map((group) => ({
              label: IMAGERY_GROUP_LABELS[group.kind],
              options: group.sources.map((source) => ({ value: source.id, label: source.name })),
            }))}
            onChange={(source) => setSetting('imagerySourceId', source)}
          />
          <p className="type-hint">{t('light.map.imageryAuto')}</p>
        </div>

        <ImageryDateControl />

        <WaterControl />

        <ForestControl />

        <SettingRow label={t('light.map.imageryDetail')} value={zoomLabel} paths={['imageryZoomOffset']}>
          <fieldset className="field min-w-0">
            <legend className="type-label mb-1">{t('light.map.imageryDetail')}</legend>
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
            <p className="type-hint">{t('light.map.imageryDetailHint')}</p>
          </fieldset>
        </SettingRow>

        <SettingRow label={t('light.map.terrainSource')} value={terrainName} paths={['terrainSourceId']}>
          <div className="field">
            <label className="type-label" htmlFor={terrainId}>
              {t('light.map.terrainSource')}
            </label>
            <Select
              id={terrainId}
              value={settings.terrainSourceId}
              options={TERRAIN_SOURCES.map((source) => ({ value: source.id, label: source.name }))}
              onChange={(source) => setSetting('terrainSourceId', source)}
            />
          </div>
        </SettingRow>
      </PanelSection>

      <PanelSection title={t('light.map.terrain')} keys={['exaggeration', 'demClean']}>
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
  return <p className="type-hint">{t(what === 'clouds' ? 'light.weather.offClouds' : 'light.weather.offScene')}</p>
}

const SNOW_MODE_OPTIONS: { value: SnowMode; label: string }[] = [
  { value: 'meteo', get label() { return t('light.snow.mode.meteo') } },
  { value: 'manuelle', get label() { return t('light.snow.mode.manuelle') } },
  { value: 'aucune', get label() { return t('light.snow.mode.aucune') } },
]

/** What the weather gives at the start of the first track: the snow line rounded to 50 m, or none and why. */
function useWeatherSnow(): { lineM: number | null; unknown: SnowUnknown | null } {
  const track = useAppStore((s) => s.tracks[0])
  const series = useWeatherStore((s) => weatherSeriesOf(s, track))
  return useMemo(() => {
    const { line, unknown } = track && series ? snowLineAtProgress(series, trackPathOf(track), 0) : { line: null, unknown: null }
    return { lineM: line && Math.round(line.snowLineM / 50) * 50, unknown }
  }, [track, series])
}

/** « Neige »: snow on the terrain above a line, from the weather of the day, set by hand or none, and what it gives now. */
function SnowControl() {
  const t = useT()
  const snow = useAppStore((s) => s.settings.snow)
  const setSetting = useAppStore((s) => s.setSetting)
  const sequence = useAppStore((s) => playsInSequence(s.settings.race, s.tracks.length))
  const weatherEnabled = useAppStore((s) => s.settings.weather.enabled)
  const weatherReady = useWeatherReady()
  const { lineM, unknown } = useWeatherSnow()
  return (
    <>
      <fieldset className="field min-w-0">
        <legend className="sr-only">{t('light.weather.snow')}</legend>
        <RadioGroup look="chips" aria-label={t('light.weather.snow')} value={snow.mode} onChange={(mode) => setSetting('snow', { ...snow, mode })}>
          {SNOW_MODE_OPTIONS.map((option) => (
            <Radio key={option.value} value={option.value}>
              {option.label}
            </Radio>
          ))}
        </RadioGroup>
        <p className="type-hint" role="status">
          {snow.mode === 'aucune'
            ? t('light.snow.hintNone')
            : snow.mode === 'manuelle'
              ? t('light.snow.hintManual', { altitude: formatNumber(snow.lineM) })
              : !weatherEnabled
                ? t('light.snow.hintOff')
                : !weatherReady
                  ? t('light.snow.hintWaiting')
                  : unknown
                    ? t(unknown === 'altitude' ? 'light.snow.hintNoAltitude' : 'light.snow.hintNoData')
                    : lineM === null
                      ? t('light.snow.hintNoSnow')
                      : t('light.snow.hintWeather', { altitude: formatNumber(lineM) })}
        </p>
        {snow.mode === 'meteo' && (
          <p className="type-hint">
            {t('light.snow.rule')}
            {sequence && ` ${t('light.snow.sequenceNote')}`}
          </p>
        )}
        {snow.mode !== 'aucune' && <p className="type-hint">{t('light.snow.glaciers')}</p>}
      </fieldset>
      {snow.mode === 'manuelle' && (
        <RangeField
          label={t('light.snow.line')}
          {...SNOW_LINE_RANGE}
          value={snow.lineM}
          format={(v) => `${formatNumber(v)} m`}
          onChange={(lineM) => setSetting('snow', { ...snow, lineM })}
        />
      )}
    </>
  )
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
          <p className="type-hint">{t('light.weather.waiting')}</p>
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

      <PanelSection title={t('light.weather.snow')} keys={['snow']}>
        <SnowControl />
      </PanelSection>
    </>
  )
}

/** « Lumière » tab, before the colours (`GradingPanel`): sections Atmosphère (sky, shadows, exposure) and Soleil. */
export function LightSettings() {
  const t = useT()
  const atmosphere = useAppStore((s) => s.settings.atmosphere)
  const shadows = useAppStore((s) => s.settings.shadows)
  const cloudShadows = useAppStore((s) => s.settings.cloudShadows)
  // the shadows fall from clouds in volume: none with « Aucun » nor with a sea of clouds drawn as a flat layer
  const noCloudVolume = useAppStore((s) => s.settings.clouds.mode === 'aucun' || (s.settings.clouds.mode === 'mer' && s.settings.clouds.seaRender === 'surface'))
  const exposureSetting = useAppStore((s) => s.settings.exposureEv)
  const exposureKeyed = useAppStore((s) => hasParamKeys(s.settings.film, ['exposure']))
  const setSetting = useAppStore((s) => s.setSetting)
  // with keys on the exposure the slider shows and edits the key at the marker, not the setting they ignore
  const [exposureEv, setExposureEv] = useKeyedValue('exposure', exposureSetting, (ev) => setSetting('exposureEv', ev))
  const id = useId()

  return (
    <>
      <PanelSection title={t('light.atmosphere.title')} keys={['atmosphere', 'shadows', 'cloudShadows', 'exposureEv']}>
        <Switch id={`${id}-atmosphere`} checked={atmosphere} onChange={(on) => setSetting('atmosphere', on)}>{t('light.atmosphere.enable')}</Switch>

        {atmosphere && (
          <Checkbox id={`${id}-shadows`} checked={shadows} onChange={(on) => setSetting('shadows', on)}>{t('light.atmosphere.shadows')}</Checkbox>
        )}

        {atmosphere && (
          <>
            <Checkbox id={`${id}-cloud-shadows`} checked={cloudShadows} disabled={noCloudVolume} onChange={(on) => setSetting('cloudShadows', on)}>{t('light.atmosphere.cloudShadows')}</Checkbox>
            {noCloudVolume && <p className="type-hint">{t('light.atmosphere.cloudShadowsNone')}</p>}
          </>
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
              onChange={setExposureEv}
            />
            {exposureKeyed && (
              <p className="type-hint">{t('light.atmosphere.exposureKeyed')}</p>
            )}
            <PanelKeys target={{ kind: 'param', param: 'exposure' }} />
          </SettingRow>
        )}
      </PanelSection>

      <PanelSection title={t('light.atmosphere.sun')} keys={['sunFromTrack', 'sunHour', 'sunDate']}>
        {atmosphere ? (
          <SunTimeControl />
        ) : (
          <p className="type-hint">{t('light.atmosphere.sunOff')}</p>
        )}
      </PanelSection>

      <NightSettings />
    </>
  )
}
