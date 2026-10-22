/**
 * « Photos sur le terrain » (prototype): where a photo of the timeline stands on the relief, and how the camera turns
 * towards it. Pure: the position is the point of the track under the marker at the photo's film time, the aim and the
 * light-up are functions of the film time.
 */
import { nearestOnPath, samplePath, type TrackPath } from '../flyover/path'
import type { FilmClock } from './clock'
import type { FilmMedia } from './model'

/** Farthest a geotagged photo may be from the track to be pinned on it (metres): the same limit as its suggested placement. */
export const PIN_MAX_OFF_M = 2000

export interface PhotoPin {
  /** id of the photo on the timeline (`FilmMedia.id`) */
  id: string
  /** picture in the media table */
  src: string
  /** distance along the track of the pin (metres): where the photo was taken (EXIF), else where the marker is when it appears */
  atM: number
  /** the pin's place on the track */
  lon: number
  lat: number
  ele?: number
  /** the photo is on screen between these film times */
  startS: number
  endS: number
}

/** The camera starts turning this long before the photo appears, and turns back this long after it leaves (film seconds). */
export const PIN_APPROACH_S = 15
export const PIN_RELEASE_S = 6
/** Share of the way from the usual aim to the pin the camera goes at most (1 would drop the marker out of the frame). */
export const PIN_AIM_SHARE = 0.7

/** The camera aims this share of its distance to the pin above the foot of the post, where the picture floats. */
export const PIN_AIM_RAISE = 0.1

/** What a pin needs of an entry of the media table: its thumbnail, and where the photo was taken when the file said. */
export type PinAsset = { thumb?: string; lon?: number; lat?: number }

/**
 * One pin per picture or clip of the film that has a thumbnail. Its place is the track point nearest to where the
 * photo was taken (EXIF GPS, within `PIN_MAX_OFF_M`), else the point under the marker when it appears.
 */
export function photoPins(
  media: readonly FilmMedia[],
  path: TrackPath,
  clock: Pick<FilmClock, 'progressAtTime'>,
  table: Readonly<Record<string, PinAsset | undefined>>,
): PhotoPin[] {
  if (path.count === 0 || path.lengthM <= 0) return []
  const pins: PhotoPin[] = []
  for (const item of media) {
    const asset = table[item.src]
    if (!asset?.thumb) continue
    let atM = Math.min(1, Math.max(0, clock.progressAtTime(item.startS))) * path.lengthM
    if (asset.lon !== undefined && asset.lat !== undefined) {
      const near = nearestOnPath(path, { lon: asset.lon, lat: asset.lat })
      if (near && near.offM <= PIN_MAX_OFF_M) atM = near.distanceM
    }
    const at = samplePath(path, atM)
    pins.push({ id: item.id, src: item.src, atM, lon: at.lon, lat: at.lat, ele: at.ele, startS: item.startS, endS: item.startS + item.durationS })
  }
  return pins
}

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

/** The photo is on screen at film time `timeS`: its pin is lit. */
export function pinLit(pin: Pick<PhotoPin, 'startS' | 'endS'>, timeS: number): boolean {
  return timeS >= pin.startS && timeS < pin.endS
}

/** 0 to 1: how far the camera has turned to the pin at film time `timeS` (eases in before the photo, holds, eases out after). */
export function pinAimWeight(pin: Pick<PhotoPin, 'startS' | 'endS'>, timeS: number): number {
  if (timeS < pin.startS) return smooth((timeS - (pin.startS - PIN_APPROACH_S)) / PIN_APPROACH_S)
  if (timeS < pin.endS) return 1
  return 1 - smooth((timeS - pin.endS) / PIN_RELEASE_S)
}

/**
 * The pins the camera turns towards at film time `timeS`, each with its share of the way from the usual aim to the pin
 * (`PIN_AIM_SHARE` at most for all of them together: a pin being left and the next being approached share the pull,
 * so the aim never jumps from one to the other).
 */
export function pinAims<P extends Pick<PhotoPin, 'startS' | 'endS'>>(pins: readonly P[], timeS: number): { pin: P; share: number }[] {
  const weighted = pins.map((pin) => ({ pin, weight: pinAimWeight(pin, timeS) })).filter((w) => w.weight > 0)
  const total = weighted.reduce((sum, w) => sum + w.weight, 0)
  const scale = PIN_AIM_SHARE / Math.max(1, total)
  return weighted.map(({ pin, weight }) => ({ pin, share: weight * scale }))
}
