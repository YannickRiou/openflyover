import { useEffect, useState } from 'react'
import { useT } from '../i18n'
import { useRegionStore } from '../osm/region'
import { hasOsmLandmarks, useForestStore, useGlacierStore, useLandmarkStore, useWaterStore } from '../osm/store'
import { overlayCredits } from '../overlay/data'
import { getPlatform } from '../platform'
import { useAppStore } from '../state/store'
import { updateDateNote, useSourceDates } from '../terrain/sourceDates'
import { getImagerySource } from '../terrain/sources'
import { useWeatherStore, weatherShown } from '../weather/store'
import { compactCredits, perfParts, type PerfSample, type SystemStats } from './mapStatus'
import { usePreferences } from './preferences'
import { PERF_ITEMS } from './shell'
import type { PerfItem } from './shell'
import { getPerfProbe } from '../scene/perfProbe'
import { Modal } from './primitives'
import { UpdatesSection } from './UpdatesSection'

/** package.json version, set by vite.config.ts (the same number as the desktop installer's) */
declare const __APP_VERSION__: string

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

/** Performance readout refresh. */
const PERF_INTERVAL_MS = 1000

/** Memory and processor of the machine (desktop app only, src-tauri/src/system.rs); null when they cannot be read. */
async function readSystemStats(): Promise<SystemStats | null> {
  try {
    return await (await import('@tauri-apps/api/core')).invoke<SystemStats>('system_stats')
  } catch {
    return null
  }
}

/**
 * Performance readout, read every second while « À propos et mises à jour » is open and one of its parts is wanted: frames drawn by the 3D view (R3F's
 * after-render callback, the export's frames included), textures and geometries of its renderer, terrain tiles,
 * JavaScript heap (Chromium only), memory and processor of the machine on the desktop.
 */
function usePerformance(shown: Record<PerfItem, boolean>, open: boolean): PerfSample | null {
  const wanted = open && PERF_ITEMS.some((item) => shown[item])
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
      // nobody sees it: no render of the bar, no question to the desktop app; the next shown tick counts from here
      if (document.hidden) {
        frames = 0
        since = now
        return
      }
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

/** The content, mounted only while the dialog is open: the credits follow the map on screen. */
function AboutBody() {
  const t = useT()
  const sources = useCreditSources()
  const sourceDates = useSourceDates((s) => s.dates)
  const imagery = getImagerySource(sources.imagerySourceId)
  // IGN layers: the update date of the data (Etalab licence), as the service sends it
  const dateNote = updateDateNote(imagery.urlTemplate, sourceDates)
  const { osm, ...credited } = sources
  const credits = overlayCredits({ ...credited, landmarks: osm })
  const short = compactCredits({ terrainSourceId: sources.terrainSourceId, imagerySourceId: sources.imagerySourceId, weather: sources.weather, osm })
  const perfShown = usePreferences((s) => s.performance)
  const perf = usePerformance(perfShown, true)
  const perfLines = perf ? perfParts(perf, perfShown) : []

  return (
    <>
      <p className="mb-3 font-semibold">{t('status.version', { version: __APP_VERSION__ })}</p>
      {getPlatform().checkForUpdate && <UpdatesSection />}
      <h3 className="mt-4 mb-2 font-heading text-title font-semibold text-text-1">{t('status.sourcesTitle')}</h3>
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
      {perfLines.length > 0 && (
        <>
          <p className="type-hint mt-3">{t('status.perfTitle')}</p>
          <ul className="mb-3 flex flex-col gap-1 tabular-nums">
            {perfLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
      <p className="type-hint">
        {t('status.sourcesProject')}{' '}
        <a className="underline" href="https://github.com/YannickRiou/openflyover" target="_blank" rel="noreferrer">
          GitHub
        </a>
        .
      </p>
    </>
  )
}

/**
 * « À propos et mises à jour » (the OpenFlyover menu of the top bar): the version, on the desktop app « Rechercher une mise à
 * jour », then the sources and licences of what is on the map.
 */
export function AboutDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const t = useT()
  return (
    <Modal open={open} onClose={onClose} title={t('status.about')} closeLabel={t('common.close')} closeTip={t('common.closeEsc')}>
      <AboutBody />
    </Modal>
  )
}
