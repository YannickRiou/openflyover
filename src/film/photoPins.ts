/**
 * « Photos sur le terrain » (prototype): where a photo of the timeline stands on the relief, and how the camera turns
 * towards it. Pure: the position is the point of the track under the marker at the photo's film time, the aim and the
 * light-up are functions of the film time.
 */
import type { TrackPath } from '../flyover/path'
import type { FilmClock } from './clock'
import type { FilmMedia } from './model'

export interface PhotoPin {
  /** id of the photo on the timeline (`FilmMedia.id`) */
  id: string
  /** picture in the media table */
  src: string
  /** distance along the track where the marker is when the photo appears (metres) */
  atM: number
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
export const PIN_AIM_RAISE = 0.06

/** One pin per picture of the film, at the track point under the marker when it appears. */
export function photoPins(media: readonly FilmMedia[], path: TrackPath, clock: Pick<FilmClock, 'progressAtTime'>): PhotoPin[] {
  if (path.count === 0 || path.lengthM <= 0) return []
  return media
    .filter((item) => item.kind === 'image')
    .map((item) => {
      const progress = Math.min(1, Math.max(0, clock.progressAtTime(item.startS)))
      return { id: item.id, src: item.src, atM: progress * path.lengthM, startS: item.startS, endS: item.startS + item.durationS }
    })
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
export function pinAims(pins: readonly PhotoPin[], timeS: number): { pin: PhotoPin; share: number }[] {
  const weighted = pins.map((pin) => ({ pin, weight: pinAimWeight(pin, timeS) })).filter((w) => w.weight > 0)
  const total = weighted.reduce((sum, w) => sum + w.weight, 0)
  const scale = PIN_AIM_SHARE / Math.max(1, total)
  return weighted.map(({ pin, weight }) => ({ pin, share: weight * scale }))
}
