/**
 * Update date of the IGN Géoplateforme layers in use: the Licence Ouverte Etalab 2.0 asks to mention « la date de la
 * dernière mise à jour de l'Information réutilisée ». It is read from the `Last-Modified` header of the tiles
 * (a CORS-safelisted header, `fetchTileBlob`), the most recent one per layer for this session; nothing is known when
 * the service does not send it (« Sources et licences » says so, no date is made up).
 */
import { create } from 'zustand'

/** Last-Modified (ms since 1970) per IGN layer name (`LAYER` of the WMTS request). */
export const useSourceDates = create<{ dates: Readonly<Record<string, number>> }>()(() => ({ dates: {} }))

const IGN_HOST = 'data.geopf.fr'

/** The IGN layer of a Géoplateforme tile URL or URL template (`LAYER=…`), null for any other host. */
export function ignLayerOf(url: string): string | null {
  const match = /^https:\/\/([^/?#]+)[^?#]*\?([^#]*)/.exec(url)
  if (!match || match[1] !== IGN_HOST) return null
  return new URLSearchParams(match[2]).get('LAYER')
}

/** Note the `Last-Modified` of a tile response; only an IGN layer and a later date change the store. */
export function noteTileLastModified(url: string, lastModified: string | null | undefined): void {
  if (!lastModified) return
  const layer = ignLayerOf(url)
  const time = Date.parse(lastModified)
  if (layer === null || !Number.isFinite(time)) return
  const { dates } = useSourceDates.getState()
  if ((dates[layer] ?? -Infinity) < time) useSourceDates.setState({ dates: { ...dates, [layer]: time } })
}

/** 12/03/2026: the day of the HTTP date (UTC, as sent). */
export function formatUpdateDate(time: number): string {
  const d = new Date(time)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}

/** What « Sources et licences » adds after the line of an IGN source (`urlTemplate`); null for other sources. */
export function updateDateNote(urlTemplate: string, dates: Readonly<Record<string, number>>): string | null {
  const layer = ignLayerOf(urlTemplate)
  if (layer === null) return null
  const time = dates[layer]
  return time === undefined ? 'date de mise à jour non communiquée par le service' : `données mises à jour le ${formatUpdateDate(time)}`
}
