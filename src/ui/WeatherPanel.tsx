import { useEffect, useId, useMemo } from 'react'
import { buildTrackPath } from '../flyover/path'
import { useT } from '../i18n'
import { playsBilan, playsInSequence } from '../flyover/sequence'
import { useAppStore } from '../state/store'
import { openMeteoAttribution } from '../weather/openMeteo'
import { summarizeOuting, weatherWidgetData } from '../weather/series'
import { syncStageWeather, syncWeather, useWeatherStore } from '../weather/store'
import { formatClock, formatNumber } from './format'
import { Icon } from './icons'
import { Button, Switch } from './primitives'

function formatTemperature(c: number): string {
  return `${formatNumber(c)} °C`
}

/** Progress steps the marker conditions follow: enough for hourly data, without a render per frame. */
const PROGRESS_STEPS = 1000

/** The outing and the marker, one line each: a short name, then the sentence. */
const LINE = 'grid grid-cols-[5.5em_minmax(0,1fr)] gap-2 text-body text-text-1 tabular-nums'
const LINE_LABEL = 'type-hint font-medium'
/** « Détails »: a folded row under a hairline, its chevron turns when it is folded. */
const DETAILS_HEAD =
  'flex min-h-control-lg cursor-pointer list-none items-center justify-between text-body font-medium text-text-2 transition-ui group-open:text-text-1 hover:text-text-1 [&::-webkit-details-marker]:hidden'
/** The figures of the outing and of the marker: names on the left, values on the right. */
const FACTS_TITLE = 'type-label mt-2 mb-1 font-body'
const FACTS = 'grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-body tabular-nums [&>dd]:text-text-1 [&>dt]:text-text-2'

/**
 * "Météo de la sortie": weather of the first track (Open-Meteo archive, or forecast for a planned outing), outing
 * summary and the conditions under the flyover marker. Also drives the weather store (`syncWeather`, and « À la suite »
 * `syncStageWeather` for the later stages).
 */
export function WeatherPanel() {
  const t = useT()
  const id = useId()
  const track = useAppStore((s) => s.tracks[0])
  const enabled = useAppStore((s) => s.settings.weather.enabled)
  const setSetting = useAppStore((s) => s.setSetting)
  const progress = useAppStore((s) => Math.round(s.playback.progress * PROGRESS_STEPS) / PROGRESS_STEPS)
  const status = useWeatherStore((s) => s.status)
  const message = useWeatherStore((s) => s.message)
  const stageMessage = useWeatherStore((s) => s.stageMessage)
  const series = useWeatherStore((s) => s.series)
  const weatherTrackId = useWeatherStore((s) => s.trackId)
  const tracks = useAppStore((s) => s.tracks)
  // the later stages' weather: not in a « Bilan » (a request per outing)
  const sequence = useAppStore((s) => playsInSequence(s.settings.race, s.tracks.length) && !playsBilan(s.settings.race, s.tracks.length))

  useEffect(() => {
    syncWeather(track, enabled)
  }, [track, enabled])

  useEffect(() => {
    syncStageWeather(sequence ? tracks.slice(1) : [], enabled)
  }, [sequence, tracks, enabled])

  const path = useMemo(() => (track ? buildTrackPath(track) : null), [track])
  const ready = status === 'ready' && series !== null && path !== null && weatherTrackId === track?.id
  const summary = useMemo(() => (ready ? summarizeOuting(series, path) : undefined), [ready, series, path])
  const now = ready ? weatherWidgetData(series, path, progress) : undefined
  const forecast = ready && series?.forecast === true

  if (!track) return null

  return (
    <section className="flex flex-col gap-3" aria-label={t('weather.panel.title')}>
      <Switch id={`${id}-enabled`} checked={enabled} onChange={(on) => setSetting('weather', { enabled: on })}>{t('weather.panel.enable')}</Switch>

      <p className="type-hint" role="status" aria-live="polite">
        {!enabled && t('weather.panel.off')}
        {enabled && status === 'loading' && t('weather.panel.loading')}
        {enabled && (status === 'unavailable' || status === 'error') && message}
      </p>

      {enabled && status === 'error' && (
        <Button block onClick={() => syncWeather(track, enabled, { retry: true })}>
          {t('common.retry')}
        </Button>
      )}

      {enabled && stageMessage && (
        <>
          <p className="type-hint" role="status">
            {t('weather.panel.stageError', { reason: stageMessage })}
          </p>
          <Button block onClick={() => syncStageWeather(sequence ? tracks.slice(1) : [], enabled)}>
            {t('common.retry')}
          </Button>
        </>
      )}

      {summary && (
        <p className={LINE}>
          <span className={LINE_LABEL}>{forecast ? t('weather.panel.forecast') : t('weather.panel.outing')}</span>
          <span>
            {t('weather.panel.summary', {
              condition: summary.dominant.label,
              min: formatNumber(summary.minTemperatureC),
              max: formatTemperature(summary.maxTemperatureC),
              rain: summary.precipitationMm < 0.05 ? t('weather.panel.noRain') : `${formatNumber(summary.precipitationMm, 1)} mm`,
              wind: formatNumber(summary.maxWindKmh),
            })}
          </span>
        </p>
      )}
      {now && (
        <p className={LINE}>
          <span className={LINE_LABEL}>{t('weather.panel.at', { time: formatClock(now.timeMs) })}</span>
          <span>
            {t(now.windFrom ? 'weather.panel.nowFrom' : 'weather.panel.now', {
              condition: now.condition.label,
              temp: formatTemperature(now.temperatureC),
              wind: formatNumber(now.windSpeedKmh),
              dir: now.windFrom,
            })}
          </span>
        </p>
      )}

      {summary && (
        <details className="group border-t border-edge">
          <summary className={DETAILS_HEAD}>
            {t('weather.panel.details')}
            <span className="flex text-text-2 transition-ui group-[:not([open])]:-rotate-90">
              <Icon name="chevron-down" size={16} />
            </span>
          </summary>
          <h3 className={FACTS_TITLE}>{t('weather.panel.duringOuting')}</h3>
          <dl className={FACTS}>
            <dt>{t('weather.panel.conditions')}</dt>
            <dd>{summary.dominant.label}</dd>
            <dt>{t('weather.panel.temperature')}</dt>
            <dd>
              {t('weather.panel.temperatureRange', { min: formatTemperature(summary.minTemperatureC), max: formatTemperature(summary.maxTemperatureC) })}
            </dd>
            <dt>{t('weather.panel.precipitation')}</dt>
            <dd>
              {(() => {
                const rain = summary.precipitationMm < 0.05 ? t('weather.panel.none') : `${formatNumber(summary.precipitationMm, 1)} mm`
                return summary.snowfallCm >= 0.05 ? t('weather.panel.withSnow', { rain, snow: formatNumber(summary.snowfallCm, 1) }) : rain
              })()}
            </dd>
            <dt>{t('weather.panel.maxWind')}</dt>
            <dd>{t('weather.panel.maxWindValue', { wind: formatNumber(summary.maxWindKmh), gusts: formatNumber(summary.maxGustsKmh) })}</dd>
          </dl>
          {now && (
            <>
              <h3 className={FACTS_TITLE}>{t('weather.panel.atMarker', { time: formatClock(now.timeMs) })}</h3>
              <dl className={FACTS}>
                <dt>{t('weather.panel.sky')}</dt>
                <dd>{t('weather.panel.skyValue', { condition: now.condition.label, cover: formatNumber(now.cloudCover) })}</dd>
                <dt>{t('weather.panel.temperature')}</dt>
                <dd>{t('weather.panel.feelsLike', { temp: formatTemperature(now.temperatureC), apparent: formatTemperature(now.apparentTemperatureC) })}</dd>
                <dt>{t('weather.panel.wind')}</dt>
                <dd>
                  {t(now.windFrom ? 'weather.panel.windValueFrom' : 'weather.panel.windValue', {
                    wind: formatNumber(now.windSpeedKmh),
                    dir: now.windFrom,
                    gusts: formatNumber(now.windGustsKmh),
                  })}
                </dd>
                <dt>{t('weather.panel.rain')}</dt>
                <dd>{formatNumber(now.precipitationMm, 1)} mm/h</dd>
              </dl>
            </>
          )}
        </details>
      )}

      {forecast && <p className="type-hint">{t('weather.panel.forecastNote')}</p>}
      {ready && (
        <p className="type-hint">
          <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
            {openMeteoAttribution()}
          </a>
        </p>
      )}
    </section>
  )
}
