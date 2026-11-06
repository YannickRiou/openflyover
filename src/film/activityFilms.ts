/**
 * « L'activité, proposée à l'import »: one film per marker figure, as a few settings that already exist (a camera
 * preset, the marker's figure, an overlay style, the flight duration). Applying it is an ordinary change of settings:
 * everything stays editable and shows as « modifié ». The video format is not touched (the device's default stays).
 * Pure module (no DOM, React or store): ARCHITECTURE.md "Activity at import".
 */
import { CAMERA_PRESETS } from '../flyover/cameraSettings'
import { withStyleLayout } from '../overlay/settings'
import type { OverlayStyleId } from '../overlay/settings'
import type { MarkerFigure } from '../scene/markerSettings'
import type { Settings } from '../state/store'

export interface ActivityFilm {
  /** id of a `CAMERA_PRESETS` entry: its style and height */
  camera: string
  style: OverlayStyleId
  /** flight duration at speed x1, seconds */
  durationS: number
}

export const ACTIVITY_FILMS: Record<MarkerFigure, ActivityFilm> = {
  randonneur: { camera: 'cinema', style: 'editorial', durationS: 75 },
  alpiniste: { camera: 'helicopter', style: 'journal', durationS: 75 },
  coureur: { camera: 'chase', style: 'broadcast', durationS: 45 },
  traileur: { camera: 'bird', style: 'broadcast', durationS: 60 },
  cycliste: { camera: 'fast-drone', style: 'broadcast', durationS: 45 },
  vae: { camera: 'chase', style: 'app', durationS: 60 },
  bikepacking: { camera: 'helicopter', style: 'journal', durationS: 90 },
  vtt: { camera: 'fast-drone', style: 'app', durationS: 45 },
  skieur: { camera: 'bird', style: 'broadcast', durationS: 45 },
  'ski-rando': { camera: 'helicopter', style: 'journal', durationS: 75 },
  nageur: { camera: 'fast-drone', style: 'editorial', durationS: 45 },
  kayak: { camera: 'fast-drone', style: 'editorial', durationS: 45 },
  cavalier: { camera: 'chase', style: 'journal', durationS: 60 },
  parapente: { camera: 'glider', style: 'cinema', durationS: 75 },
  moto: { camera: 'fast-drone', style: 'neon', durationS: 45 },
  voiture: { camera: 'chase', style: 'app', durationS: 60 },
  avion: { camera: 'plane', style: 'cinema', durationS: 90 },
}

/** `settings` with the film of `figure`: camera, marker (the figure, as a figurine), overlay style and duration. */
export function activityFilmSettings(settings: Settings, figure: MarkerFigure): Settings {
  const film = ACTIVITY_FILMS[figure]
  const camera = CAMERA_PRESETS.find((p) => p.id === film.camera)?.camera ?? settings.camera
  return {
    ...settings,
    camera: { ...camera },
    marker: { ...settings.marker, kind: 'figurine', figure },
    overlay: withStyleLayout(settings.overlay, film.style),
    flyoverDurationS: film.durationS,
  }
}
