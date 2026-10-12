import { useEffect, useRef, useState } from 'react'
import { _roots, addAfterEffect } from '@react-three/fiber'
import { useRegionStore } from '../osm/region'
import { useLandmarkStore, useWaterStore } from '../osm/store'
import { overlayCredits } from '../overlay/data'
import { getPlatform } from '../platform'
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
import { usePreferences } from './preferences'
import { PERF_ITEMS } from './shell'
import type { PerfItem } from './shell'

/** Performance readout refresh. */
const PERF_INTERVAL_MS = 1000

/** French plural: zero and one take the singular. */
function plural(count: number, singular: string, pluralForm: string): string {
  return count > 1 ? pluralForm : singular
}

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
    const stopCounting = addAfterEffect(() => {
      frames++
    })
    const timer = window.setInterval(() => {
      const now = performance.now()
      // the 3D view of the app (the only R3F root)
      const renderer = _roots.values().next().value?.store.getState().gl
      const heap = (performance as { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize
      setSample({
        fps: renderer ? (frames * 1000) / (now - since) : undefined,
        textures: renderer?.info.memory.textures,
        geometries: renderer?.info.memory.geometries,
        tiles: renderer ? useAppStore.getState().terrainStats.loadedTiles : undefined,
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
      stopCounting()
    }
  }, [wanted, system])
  return wanted ? sample : null
}

/** Small ring filled with the share of the view drawn; it turns slowly while tiles arrive. */
function ProgressRing({ value }: { value: number }) {
  const circumference = 2 * Math.PI * 5
  return (
    <svg className="status__ring" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="5" />
      <circle cx="6" cy="6" r="5" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value)} />
    </svg>
  )
}

/** One fetch: spinner while loading, check once loaded, attention colour (focusable, for its message) on error. */
function Chip({ chip }: { chip: FetchChip }) {
  const attention = chip.tone === 'attention'
  return (
    <span className={`status__chip status__chip--${chip.tone}`} data-tip={chip.tip} data-tip-side="top" tabIndex={attention ? 0 : undefined}>
      {chip.tone === 'loading' ? (
        <span className="status__spinner" aria-hidden="true" />
      ) : (
        <Icon name={chip.tone === 'ready' ? 'circle-check' : 'circle-alert'} size={12} />
      )}
      {chip.label}
      <span className="visually-hidden"> : {chip.tip}</span>
    </span>
  )
}

/** Weather, landmarks, region and water fetches, as chosen in « Réglages » (nothing while idle). */
function FetchChips() {
  const shown = usePreferences((s) => s.status)
  const weather = useWeatherStore((s) => fetchChip('weather', s.status, s.message))
  const landmarks = useLandmarkStore((s) => fetchChip('landmarks', s.status, s.message))
  const region = useRegionStore((s) => fetchChip('region', s.status))
  const water = useWaterStatusStore((s) => fetchChip('water', s.status))
  const chips = [shown.weather && weather, shown.landmarks && landmarks, shown.region && region, shown.water && water].filter((c) => !!c)
  if (chips.length === 0) return null
  return (
    <p className="status__chips">
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
  const map = useMapStatus()
  const loading = useAppStore((s) => s.loading)
  const terrainSourceId = useAppStore((s) => s.settings.terrainSourceId)
  const imagerySourceId = useAppStore((s) => s.settings.imagerySourceId)
  const weather = useWeatherStore(weatherShown)
  const landmarks = useLandmarkStore((s) => Object.values(s.landmarks).some((list) => list.length > 0))
  // OpenStreetMap is credited for the water and the highlighted region as well as for the landmarks
  const water = useWaterStore((s) => s.polygons > 0)
  const region = useRegionStore((s) => s.region !== null)
  const perfShown = usePreferences((s) => s.performance)
  const perf = usePerformance(perfShown)
  const sourceDates = useSourceDates((s) => s.dates)
  const dialog = useRef<HTMLDialogElement>(null)

  const imagery = getImagerySource(imagerySourceId)
  // IGN layers: the update date of the data (Etalab licence), as the service sends it
  const dateNote = updateDateNote(imagery.urlTemplate, sourceDates)
  const osm = landmarks || water || region
  const credits = overlayCredits({ terrainSourceId, imagerySourceId, weather, landmarks: osm })
  const short = compactCredits({ terrainSourceId, imagerySourceId, weather, osm })
  const perfText = perf ? perfParts(perf, perfShown).join(' · ') : ''

  return (
    <footer className="status">
      {/* calm: nothing before the first tile, a short load (small camera move) does not show */}
      {map.shown !== 'idle' && (
        <p className="status__map">
          {map.shown === 'loading' ? (
            <span
              className="status__map-state status__map-state--loading"
              title="Relief et imagerie de la vue actuelle"
              role="progressbar"
              aria-label="Chargement de la carte"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(map.progress * 100)}
            >
              <ProgressRing value={map.progress} />
              Carte · {formatPercent(map.progress)}
            </span>
          ) : (
            <span className="status__map-state status__map-state--ready" title="Toutes les tuiles de la vue actuelle sont chargées">
              <Icon name="circle-check" size={12} />
              Carte prête
            </span>
          )}
          {map.failed > 0 && (
            <span
              className="status__failed"
              tabIndex={0}
              data-tip="Réseau ou serveur : nouvel essai automatique"
              data-tip-side="top"
              data-tip-align="start"
            >
              {map.failed} {plural(map.failed, 'tuile', 'tuiles')} en erreur
            </span>
          )}
        </p>
      )}
      {/* always mounted so that assistive tech sees the text change */}
      <p className="status__line" role="status" aria-live="polite" hidden={!loading}>
        <span className="status__spinner" aria-hidden="true" />
        Import en cours…
      </p>
      <FetchChips />
      {perfText && (
        <p className="status__perf" title="Performances (choix dans « Réglages »)">
          {perfText}
        </p>
      )}
      <p className="status__credits">
        {short.map((item, i) => (
          <span key={item.text} className="status__credit">
            {i > 0 && ' · '}
            {item.href ? (
              <a href={item.href} target="_blank" rel="noreferrer">
                {item.text}
              </a>
            ) : (
              item.text
            )}
            {item.more && (
              <>
                <span className="status__credit-more"> — {item.more}</span>
                {/* narrow status bar: the providers behind a button, above the bar when open */}
                <details className="status__credit-fold">
                  <summary aria-label={`Sources ${item.text}`}>…</summary>
                  <span className="status__credit-pop">{item.more}</span>
                </details>
              </>
            )}
          </span>
        ))}
      </p>
      <button
        type="button"
        className="status__info"
        aria-label="Sources et licences"
        data-tip="Sources et licences"
        data-tip-side="top"
        data-tip-align="end"
        onClick={() => dialog.current?.showModal()}
      >
        <Icon name="info" size={14} />
      </button>

      <dialog ref={dialog} className="sources" aria-labelledby="sources-title">
        <div className="sources__head">
          <h2 id="sources-title" className="sources__title">
            Sources et licences
          </h2>
          <button type="button" className="icon-btn" aria-label="Fermer" data-tip="Fermer (Échap)" data-tip-side="left" onClick={() => dialog.current?.close()}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <ul className="sources__list">
          {credits.map((line) => (
            <li key={line}>
              {line}
              {dateNote && line.includes(imagery.attribution) && ` · ${dateNote}`}
            </li>
          ))}
        </ul>
        <p className="sources__links">
          {short
            .filter((item) => item.href)
            .map((item, i) => (
              <span key={item.text}>
                {i > 0 && ' · '}
                <a href={item.href} target="_blank" rel="noreferrer">
                  {item.text.replace('© ', '')}
                </a>
              </span>
            ))}
        </p>
        <p className="field__hint">
          Ces mentions sont incrustées dans les films exportés (Habillage, « Crédits des sources »). Polices : Fraunces et
          IBM Plex (SIL Open Font License 1.1). Icônes : Lucide (licence ISC). OpenFlyover est publié sous licence MIT.
        </p>
      </dialog>
    </footer>
  )
}
