import { useEffect, useState } from 'react'
import { useT } from '../i18n'
import { useRegionStore } from '../osm/region'
import { useForestStore, useLandmarkStore, useWaterStore } from '../osm/store'
import { overlayCredits } from '../overlay/data'
import { getPlatform } from '../platform'
import { getPerfProbe } from '../scene/perfProbe'
import { useWaterStatusStore } from '../scene/waterStatus'
import { updateDateNote, useSourceDates } from '../terrain/sourceDates'
import { getImagerySource } from '../terrain/sources'
import { useAppStore } from '../state/store'
import { useWeatherStore, weatherShown } from '../weather/store'
import { formatPercent } from './format'
import { Icon } from './icons'
import {
  IDLE_MAP_STATUS,
  MAP_LOADING_DELAY_MS,
  compactCredits,
  fetchChip,
  nextMapStatus,
  perfParts,
  type FetchChip,
  type MapStatus,
  type PerfSample,
  type SystemStats,
} from './mapStatus'
import { setPreferences, usePreferences } from './preferences'
import { PERF_ITEMS } from './shell'
import type { PerfItem } from './shell'
import { Button, Modal, Tip } from './primitives'
import { LATEST_NEWS } from './whatsNew'
import { WhatsNewDialog } from './WhatsNewDialog'

/*
 * The strip's classes. It is a container (`@container/status`): narrower than 900 px the performance readout goes, narrower
 * than 560 px the chips keep their icon only and the providers behind the credits fold into « … ».
 */
const BAR =
  '@container/status chrome-focus flex min-w-0 items-center gap-3 border-t border-ink-soft bg-chrome pr-2 pl-3 text-caption whitespace-nowrap text-glacier tabular-nums phone-any:pb-[env(safe-area-inset-bottom)]'
/** The spinner: a ring with its light-accent arc. */
const SPINNER = 'spin-fast size-2.5 flex-none rounded-full border-2 border-ink-soft border-t-accent-light'
/** The colour of a chip by tone: white while loading, the attention colour on error, dimmed when there is nothing to show. */
const CHIP_TONE: Record<FetchChip['tone'], string> = {
  loading: 'text-white',
  ready: '',
  attention: 'text-amber-light',
  muted: 'opacity-75',
}
const CREDIT_LINK = 'text-inherit underline hover:text-white'

/** Performance readout refresh. */
const PERF_INTERVAL_MS = 1000

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

/** Memory and processor of the machine (desktop app only, src-tauri/src/system.rs); null when they cannot be read. */
async function readSystemStats(): Promise<SystemStats | null> {
  try {
    return await (await import('@tauri-apps/api/core')).invoke<SystemStats>('system_stats')
  } catch {
    return null
  }
}

/**
 * Performance readout, read every second while one of its parts is wanted: frames drawn by the 3D view (R3F's
 * after-render callback, the export's frames included), textures and geometries of its renderer, terrain tiles,
 * JavaScript heap (Chromium only), memory and processor of the machine on the desktop.
 */
function usePerformance(shown: Record<PerfItem, boolean>): PerfSample | null {
  const wanted = PERF_ITEMS.some((item) => shown[item])
  const system = shown.system && getPlatform().capabilities.isDesktop
  const [sample, setSample] = useState<PerfSample | null>(null)
  useEffect(() => {
    if (!wanted) return
    let frames = 0
    let since = performance.now()
    let machine: SystemStats | undefined
    let alive = true
    // the 3D view registers its probe once its chunk is loaded: counting starts then
    let stopCounting: (() => void) | undefined
    const timer = window.setInterval(() => {
      const now = performance.now()
      const probe = getPerfProbe()
      // no frame rate on the tick that starts the count
      const starting = !!probe && !stopCounting
      if (probe && !stopCounting) {
        stopCounting = probe.onFrame(() => {
          frames++
        })
      }
      const memory = probe?.memory()
      const heap = (performance as { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize
      setSample({
        fps: memory && !starting ? (frames * 1000) / (now - since) : undefined,
        textures: memory?.textures,
        geometries: memory?.geometries,
        tiles: memory ? useAppStore.getState().terrainStats.loadedTiles : undefined,
        heapBytes: heap,
        system: machine,
      })
      frames = 0
      since = now
      if (system) {
        void readSystemStats().then((stats) => {
          if (alive) machine = stats ?? undefined
        })
      }
    }, PERF_INTERVAL_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
      stopCounting?.()
    }
  }, [wanted, system])
  return wanted ? sample : null
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

/** One fetch: spinner while loading, check once loaded, attention colour (focusable, for its message) on error. */
function Chip({ chip }: { chip: FetchChip }) {
  const t = useT()
  const attention = chip.tone === 'attention'
  return (
    <Tip text={chip.tip} side="top">
      <span className={`inline-flex flex-none items-center gap-1 @max-[560px]/status:text-[0px] ${CHIP_TONE[chip.tone]}`} tabIndex={attention ? 0 : undefined}>
        {chip.tone === 'loading' ? (
          <span className={SPINNER} aria-hidden="true" />
        ) : (
          <span className={chip.tone === 'ready' ? 'flex text-moss-light' : 'flex'}>
            <Icon name={chip.tone === 'ready' ? 'circle-check' : 'circle-alert'} size={12} />
          </span>
        )}
        {chip.label}
        <span className="sr-only">{t('status.chipSr', { tip: chip.tip })}</span>
      </span>
    </Tip>
  )
}

/** Weather, landmarks, region and water fetches, as chosen in « Réglages » (nothing while idle). */
function FetchChips() {
  useT()
  const shown = usePreferences((s) => s.status)
  // primitives only: a selector returning a new object on every call makes the store re-render forever
  const weatherStatus = useWeatherStore((s) => s.status)
  const weatherMessage = useWeatherStore((s) => s.message)
  const landmarksStatus = useLandmarkStore((s) => s.status)
  const landmarksMessage = useLandmarkStore((s) => s.message)
  const regionStatus = useRegionStore((s) => s.status)
  const waterStatus = useWaterStatusStore((s) => s.status)
  const weather = fetchChip('weather', weatherStatus, weatherMessage)
  const landmarks = fetchChip('landmarks', landmarksStatus, landmarksMessage)
  const region = fetchChip('region', regionStatus)
  const water = fetchChip('water', waterStatus)
  const chips = [shown.weather && weather, shown.landmarks && landmarks, shown.region && region, shown.water && water].filter((c) => !!c)
  if (chips.length === 0) return null
  return (
    <p className="flex min-w-0 items-center gap-2 overflow-hidden">
      {chips.map((chip) => (
        <Chip key={chip.label} chip={chip} />
      ))}
    </p>
  )
}

/**
 * Status strip under the timeline: map state (« Carte · 72 % » ring while the view waits for tiles, « Carte prête »
 * once it is complete, tiles in error), import spinner, the other fetches, the performance readout when there is
 * room, and the short credits of the active sources, always visible; the ⓘ button opens the full « Sources et
 * licences » lines. Only the import status is a live region: the map state changes several times a second and must not
 * be announced by screen readers.
 */
export function StatusBar() {
  const t = useT()
  const map = useMapStatus()
  const loading = useAppStore((s) => s.loading)
  const terrainSourceId = useAppStore((s) => s.settings.terrainSourceId)
  const imagerySourceId = useAppStore((s) => s.settings.imagerySourceId)
  const weather = useWeatherStore(weatherShown)
  const landmarks = useLandmarkStore((s) => Object.values(s.landmarks).some((list) => list.length > 0))
  // OpenStreetMap is credited for the water, the forests and the highlighted region as well as for the landmarks
  const water = useWaterStore((s) => s.polygons > 0)
  const forest = useForestStore((s) => s.polygons > 0)
  const region = useRegionStore((s) => s.region !== null)
  const perfShown = usePreferences((s) => s.performance)
  const perf = usePerformance(perfShown)
  const sourceDates = useSourceDates((s) => s.dates)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [newsOpen, setNewsOpen] = useState(false)
  // the dot of the « i » button: the newest « Nouveautés » have not been opened yet
  const newsUnseen = usePreferences((s) => s.whatsNewSeen !== LATEST_NEWS)
  const openNews = () => {
    setSourcesOpen(false)
    setNewsOpen(true)
    setPreferences({ whatsNewSeen: LATEST_NEWS })
  }

  const imagery = getImagerySource(imagerySourceId)
  // IGN layers: the update date of the data (Etalab licence), as the service sends it
  const dateNote = updateDateNote(imagery.urlTemplate, sourceDates)
  const osm = landmarks || water || forest || region
  const credits = overlayCredits({ terrainSourceId, imagerySourceId, weather, landmarks: osm, water })
  const short = compactCredits({ terrainSourceId, imagerySourceId, weather, osm })
  const perfText = perf ? perfParts(perf, perfShown).join(' · ') : ''

  return (
    <footer className={BAR}>
      {/* calm: nothing before the first tile, a short load (small camera move) does not show */}
      {map.shown !== 'idle' && (
        <p className="flex flex-none items-center gap-2">
          {map.shown === 'loading' ? (
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
          ) : (
            <span className="flex items-center gap-1.5" title={t('status.mapReadyTip')}>
              <span className="flex text-moss-light">
                <Icon name="circle-check" size={12} />
              </span>
              {t('status.mapReady')}
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
      {perfText && (
        <p className="min-w-0 truncate @max-[900px]/status:hidden" title={t('status.perfTip')}>
          {perfText}
        </p>
      )}
      <div className="ml-auto shrink-0 grow text-right">
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
                  <span className="absolute right-0 bottom-[calc(100%+6px)] z-9 rounded-sm bg-chrome px-2 py-1 text-white shadow-pop">{item.more}</span>
                </details>
              </>
            )}
          </span>
        ))}
      </div>
      <Tip text={t('status.sources')} side="top" align="end">
        <button
          type="button"
          className="relative inline-flex size-5 flex-none cursor-pointer items-center justify-center rounded-full p-0 text-glacier transition-ui hover:text-white touch:before:absolute touch:before:-inset-3.5 touch:before:content-['']"
          aria-label={newsUnseen ? `${t('status.sources')} · ${t('news.title')}` : t('status.sources')}
          onClick={() => setSourcesOpen(true)}
        >
          <Icon name="info" size={14} />
          {newsUnseen && <span className="absolute top-0 right-0 size-2 rounded-full bg-accent-light" data-testid="news-dot" aria-hidden="true" />}
        </button>
      </Tip>

      <WhatsNewDialog open={newsOpen} onClose={() => setNewsOpen(false)} />
      <Modal open={sourcesOpen} onClose={() => setSourcesOpen(false)} title={t('status.sources')} closeLabel={t('common.close')} closeTip={t('common.closeEsc')}>
        <Button className="mb-3" onClick={openNews}>
          <Icon name="sparkles" size={16} />
          {t('news.button')}
          {newsUnseen && <span className="size-2 rounded-full bg-accent-light" aria-hidden="true" />}
        </Button>
        <ul className="mb-3 flex flex-col gap-2">
          {credits.map((line) => (
            <li key={line}>
              {line}
              {dateNote && line.includes(imagery.attribution) && ` · ${dateNote}`}
            </li>
          ))}
        </ul>
        <p>
          {short
            .filter((item) => item.href)
            .map((item, i) => (
              <span key={item.text}>
                {i > 0 && ' · '}
                <a className="underline" href={item.href} target="_blank" rel="noreferrer">
                  {item.text.replace('© ', '')}
                </a>
              </span>
            ))}
        </p>
        <p className="type-hint">{t('status.sourcesNote')}</p>
        <p className="type-hint">
          {t('status.sourcesProject')}{' '}
          <a className="underline" href="https://github.com/YannickRiou/openflyover" target="_blank" rel="noreferrer">
            GitHub
          </a>
          .
        </p>
        {getPlatform().checkForUpdate && <p className="type-hint">{t('status.sourcesUpdates')}</p>}
      </Modal>
    </footer>
  )
}
