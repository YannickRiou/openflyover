import { beforeEach, describe, expect, it } from 'vitest'
import { buildFilmClock } from '../film/clock'
import { useMediaStore } from '../film/media'
import { smoothedTrackPath } from '../flyover/smooth'
import { DEFAULT_PACING } from '../flyover/pacing'
import { buildTrack } from '../import/stats'
import { resetAppStore, useAppStore } from '../state/store'
import { filmPins } from './filmView'

const track = buildTrack({
  name: 't',
  source: 'gpx',
  segments: [{ points: [6.8, 6.81, 6.82, 6.83].map((lon) => ({ lon, lat: 45.9 })) }],
})

describe('filmPins', () => {
  beforeEach(() => resetAppStore())

  it('keeps its pins from one frame to the next, even when the smoothed path is made again each time', () => {
    const clock = buildFilmClock({
      opening: { style: 'aucune', durationS: 0 },
      closing: { style: 'aucune', durationS: 0 },
      stops: [],
      lengthM: smoothedTrackPath(track, 0).lengthM,
      highlightsM: [],
      durationS: 60,
      pacing: { ...DEFAULT_PACING, keepDuration: false },
    })
    const src = useMediaStore.getState().add([{ data: 'data:image/jpeg;base64,AA', thumb: 'data:image/jpeg;base64,AA', width: 4, height: 3 }])[0]
    const media = [{ id: 'media-1', startS: 10, durationS: 5, kind: 'image', src, layout: 'carte', anchor: 'bottom-right', size: 1, kenBurns: false }]
    useAppStore.getState().setSetting('trackStyle', { ...useAppStore.getState().settings.trackStyle, smoothingM: 30 })
    useAppStore.getState().setSetting('film', { ...useAppStore.getState().settings.film, media } as never)
    const first = filmPins(smoothedTrackPath(track, 30), clock)
    expect(first).toHaveLength(1)
    expect(filmPins(smoothedTrackPath(track, 30), clock)).toBe(first)
    // another smoothing is another line: the pins are made again
    useAppStore.getState().setSetting('trackStyle', { ...useAppStore.getState().settings.trackStyle, smoothingM: 60 })
    expect(filmPins(smoothedTrackPath(track, 60), clock)).not.toBe(first)
  })
})
