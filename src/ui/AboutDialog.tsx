import { useT } from '../i18n'
import { useRegionStore } from '../osm/region'
import { hasOsmLandmarks, useForestStore, useGlacierStore, useLandmarkStore, useWaterStore } from '../osm/store'
import { overlayCredits } from '../overlay/data'
import { getPlatform } from '../platform'
import { useAppStore } from '../state/store'
import { updateDateNote, useSourceDates } from '../terrain/sourceDates'
import { getImagerySource } from '../terrain/sources'
import { useWeatherStore, weatherShown } from '../weather/store'
import { compactCredits } from './mapStatus'
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
