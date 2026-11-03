/**
 * Credits of the glTF models of the « figurine » markers (`markerGlbFigures.ts`), kept in `modelCredits.json` so that the
 * app, the film and `THIRD_PARTY_NOTICES.md` (`scripts/third-party-notices.mjs`) read the same list. A model that needs
 * attribution (CC BY) is credited in the film and listed in the app; a model released into the public domain (CC0) is
 * listed too, the sources being cited either way. Every `.glb` of `public/models` has an entry (tested).
 */
import type { Track } from '../core/types'
import credits from './modelCredits.json'
import { figureOfActivity } from './markerSettings'
import type { MarkerFigure, MarkerSettings } from './markerSettings'

export interface ModelCredit {
  id: string
  /** name of the model on its page */
  title: string
  author: string
  /** « CC0 1.0 », « CC BY 3.0 » */
  license: string
  licenseUrl: string
  /** the page of the model */
  sourceUrl: string
  /** path in `public/` */
  file: string
  /** the figures that use it */
  figures: MarkerFigure[]
  /** what was changed (CC BY asks to say so) */
  modifications: string
}

export const MODEL_CREDITS: readonly ModelCredit[] = credits as ModelCredit[]

/** True when the licence asks for the author to be credited. */
export const needsAttribution = (credit: Pick<ModelCredit, 'license'>): boolean => /^CC BY/.test(credit.license)

/**
 * The models in use: those of the figures the film shows (`figure` « auto »: the one of each track's activity), when the
 * marker is a figurine with its 3D model; the figures with no model keep their pictogram, nothing to credit.
 */
export function modelCreditsInUse(
  marker: Pick<MarkerSettings, 'kind' | 'model3d' | 'figure'>,
  tracks: readonly Pick<Track, 'activityType'>[],
): ModelCredit[] {
  if (marker.kind !== 'figurine' || !marker.model3d) return []
  const figures = marker.figure === 'auto' ? tracks.map((t) => figureOfActivity(t.activityType)) : [marker.figure]
  const used = MODEL_CREDITS.filter((credit) => credit.figures.some((f) => figures.includes(f)))
  return used
}
