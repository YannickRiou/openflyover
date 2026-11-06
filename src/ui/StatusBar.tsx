import { useEffect, useState } from 'react'
import { useT } from '../i18n'
import { useRegionStore } from '../osm/region'
import { hasOsmLandmarks, useForestStore, useGlacierStore, useLandmarkStore, useWaterStore } from '../osm/store'
import { useForestStatusStore } from '../scene/forestStatus'
import { useGlacierStatusStore } from '../scene/glacierStatus'
import { useWaterStatusStore } from '../scene/waterStatus'
import { useAppStore } from '../state/store'
import { useWeatherStore, weatherShown } from '../weather/store'
import { formatPercent } from './format'
import { Icon } from './icons'
import {
  IDLE_MAP_STATUS,
  MAP_LOADING_DELAY_MS,
  compactCredits,
  fetchChip,
  layerNotices,
  nextMapStatus,
  type MapStatus,
} from './mapStatus'

import { Tip } from './primitives'
import { DEFAULT_PREFERENCES } from './shell'

/*
 * The strip's classes. It is a container (`@container/status`): narrower than 560 px the providers behind the credits fold
 * into « … ».
 */
const BAR =
  '@container/status chrome-focus flex min-w-0 items-center gap-3 border-t border-ink-soft bg-chrome pr-2 pl-3 text-caption whitespace-nowrap text-glacier tabular-nums phone-any:pb-[env(safe-area-inset-bottom)]'
/** The spinner: a ring with its light-accent arc. */
const SPINNER = 'spin-fast size-2.5 flex-none rounded-full border-2 border-ink-soft border-t-accent-light'
const CREDIT_LINK = 'text-inherit underline hover:text-white'

/** Map state from the terrain stats, re-read when a load reaches its display delay. */
function useMapStatus(): MapStatus {
  const [status, setStatus] = useState(IDLE_MAP_STATUS)
  useEffect(() => {
    let current = IDLE_MAP_STATUS
    let timer = 0
    const step = () => {
      window.clearTimeout(timer)
      const now = performance.now()
      current = nextMapStatus(current, useAppStore.getState().terrainStats, now)
      setStatus(current)
      if (current.phase === 'loading' && current.shown !== 'loading') {
        timer = window.setTimeout(step, current.since + MAP_LOADING_DELAY_MS - now)
      }
    }
    step()
    const unsubscribe = useAppStore.subscribe((s, prev) => {
      if (s.terrainStats !== prev.terrainStats) step()
    })
    return () => {
      unsubscribe()
      window.clearTimeout(timer)
    }
  }, [])
  return status
}

/** Small ring filled with the share of the view drawn; it turns slowly while tiles arrive. */
function ProgressRing({ value }: { value: number }) {
  const circumference = 2 * Math.PI * 5
  return (
    <svg className="spin-slow size-3 flex-none fill-none stroke-2" viewBox="0 0 12 12" aria-hidden="true">
      <circle className="stroke-ink-soft" cx="6" cy="6" r="5" />
      <circle
        className="origin-center -rotate-90 stroke-accent-light transition-[stroke-dashoffset] duration-400 ease-out [stroke-linecap:round] motion-reduce:transition-none"
        cx="6"
        cy="6"
        r="5"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - value)}
      />
    </svg>
  )
}

/**
 * Weather, landmarks, region, water, forest and glacier fetches, as chosen in « Réglages »: one indicator for the ones
 * still loading, one for the failed ones (focusable, for their messages); nothing once they are loaded.
 */
function FetchChips() {
  const t = useT()
  // every layer says it loads (the choice of the chips left « Réglages »: the bar shows only what is loading or failed)
  const shown = DEFAULT_PREFERENCES.status
  // primitives only: a selector returning a new object on every call makes the store re-render forever
  const weatherStatus = useWeatherStore((s) => s.status)
  const weatherMessage = useWeatherStore((s) => s.message)
  const landmarksStatus = useLandmarkStore((s) => s.status)
  const landmarksMessage = useLandmarkStore((s) => s.message)
  const regionStatus = useRegionStore((s) => s.status)
  const waterStatus = useWaterStatusStore((s) => s.status)
  const glacierStatus = useGlacierStatusStore((s) => s.status)
  const weather = fetchChip('weather', weatherStatus, weatherMessage)
  const landmarks = fetchChip('landmarks', landmarksStatus, landmarksMessage)
  const region = fetchChip('region', regionStatus)
  const forestStatus = useForestStatusStore((s) => s.status)
  const water = fetchChip('water', waterStatus)
  const forest = fetchChip('forest', forestStatus, forestStatus === 'error' ? t('status.forestError') : null)
  const glacier = fetchChip('glacier', glacierStatus)
  const chips = [shown.weather && weather, shown.landmarks && landmarks, shown.region && region, shown.water && water, shown.forest && forest, shown.glacier && glacier].filter((c) => !!c)
  const { loading, failed } = layerNotices(chips)
  const failedTips = failed.map((chip) => chip.tip).join(' ')
  if (loading.length === 0 && failed.length === 0) return null
  return (
    <p className="flex min-w-0 items-center gap-3 overflow-hidden">
      {loading.length > 0 && (
        <span className="flex min-w-0 items-center gap-1.5 text-white">
          <span className={SPINNER} aria-hidden="true" />
          <span className="truncate">{t('status.layersLoading', { layers: loading.join(', ') })}</span>
        </span>
      )}
      {failed.length > 0 && (
        <Tip text={failedTips} side="top">
          <span className="inline-flex min-w-0 items-center gap-1 text-amber-light" tabIndex={0}>
            <Icon name="circle-alert" size={12} />
            <span className="truncate">{t('status.layersFailed', { layers: failed.map((chip) => chip.label).join(', ') })}</span>
            <span className="sr-only">{t('status.chipSr', { tip: failedTips })}</span>
          </span>
        </Tip>
      )}
    </p>
  )
}

/** The sources behind the map on screen: what the credits of the status bar and of « À propos » are made from. */
export function useCreditSources() {
  const terrainSourceId = useAppStore((s) => s.settings.terrainSourceId)
  const imagerySourceId = useAppStore((s) => s.settings.imagerySourceId)
  const weather = useWeatherStore(weatherShown)
  const landmarks = useLandmarkStore((s) => hasOsmLandmarks(s.landmarks))
  // OpenStreetMap is credited for the water, the forests and the highlighted region as well as for the landmarks
  const water = useWaterStore((s) => s.polygons > 0)
  const forests = useForestStore((s) => s.polygons > 0)
  const glaciers = useGlacierStore((s) => s.polygons > 0)
  const region = useRegionStore((s) => s.region !== null)
  return { terrainSourceId, imagerySourceId, weather, landmarks, water, forests, glaciers, osm: landmarks || water || forests || glaciers || region }
}

/**
 * Status strip under the timeline, calm: while something loads, the map (« Chargement de la carte… 72 % » ring while
 * the view waits for tiles), the import spinner and one indicator for the other fetches; what failed (tiles, a fetch)
 * stays in words; nothing once all is loaded. The short credits of the active sources are always visible; the full lines
 * and the performance readout are in « À propos et mises à jour » (the OpenFlyover menu), not on the strip. Only the import
 * status is a live region: the map state changes several times a second and must not be announced by screen readers.
 */
export function StatusBar() {
  const t = useT()
  const map = useMapStatus()
  const loading = useAppStore((s) => s.loading)
  const { terrainSourceId, imagerySourceId, weather, osm } = useCreditSources()
  const short = compactCredits({ terrainSourceId, imagerySourceId, weather, osm })

  return (
    <footer className={BAR}>
      {/* calm: nothing before the first tile, a short load (small camera move) does not show, nothing once loaded */}
      {(map.shown === 'loading' || map.failed > 0) && (
        <p className="flex flex-none items-center gap-2">
          {map.shown === 'loading' && (
            <span
              className="flex items-center gap-1.5 text-white"
              title={t('status.mapTip')}
              role="progressbar"
              aria-label={t('status.mapLoading')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(map.progress * 100)}
            >
              <ProgressRing value={map.progress} />
              {t('status.map', { value: formatPercent(map.progress) })}
            </span>
          )}
          {map.failed > 0 && (
            <Tip text={t('status.failedTip')} side="top" align="start">
              <span className="text-amber-light" tabIndex={0}>
                {t('status.failedTiles', { count: map.failed })}
              </span>
            </Tip>
          )}
        </p>
      )}
      {/* always mounted so that assistive tech sees the text change */}
      <p className="flex flex-none items-center gap-1.5" role="status" aria-live="polite" hidden={!loading}>
        <span className={SPINNER} aria-hidden="true" />
        {t('status.importing')}
      </p>
      <FetchChips />
      {/* the credits give way (cut with « … ») so the button after them always shows */}
      <div className="ml-auto min-w-0 shrink grow truncate text-right">
        {short.map((item, i) => (
          <span key={item.text}>
            {i > 0 && ' · '}
            {item.href ? (
              <a className={CREDIT_LINK} href={item.href} target="_blank" rel="noreferrer">
                {item.text}
              </a>
            ) : (
              item.text
            )}
            {item.more && (
              <>
                <span className="@max-[560px]/status:hidden"> — {item.more}</span>
                {/* narrow status bar: the providers behind a button, above the bar when open */}
                <details className="relative hidden @max-[560px]/status:inline-block">
                  <summary className="cursor-pointer list-none px-1 [&::-webkit-details-marker]:hidden" aria-label={t('status.creditSources', { name: item.text })}>…</summary>
                  {/* fixed: the credits above clip what overflows them */}
                  <span className="fixed right-2 bottom-[calc(var(--statusbar-h)+env(safe-area-inset-bottom)+6px)] z-9 rounded-sm bg-chrome px-2 py-1 whitespace-normal text-white shadow-pop">{item.more}</span>
                </details>
              </>
            )}
          </span>
        ))}
      </div>
    </footer>
  )
}
