import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { trackPathOf, samplePath } from '../flyover/path'
import { sharedOverpassQuery } from '../osm/overpass'
import { parseSummits, summitLabels, summitQuery } from '../osm/summits'
import type { Summit } from '../osm/summits'
import { useAppStore } from '../state/store'
import { setLabelSource, useLabelSources } from './labelSources'
import { useFilmClock, useFilmTrack } from './usePacing'

/** Label source of the distant summits (`setLabelSource`). */
const SOURCE = 'summits'

/**
 * The summits within 25 km of each « Panorama » stop of the film, named while the camera turns round and only then: they
 * are fetched when the film is set up (shared Overpass queue and cache) and published as labels when the film time enters
 * the window of the stop. Draws nothing itself: `Labels` draws the source with the others.
 */
export function PanoramaSummits() {
  const clock = useFilmClock()
  const track = useFilmTrack()
  const enabled = useAppStore((s) => s.settings.landmarks.enabled)
  const summits = useRef(new Map<string, readonly Summit[]>())
  const shown = useRef<string | null>(null)

  const publish = (stopId: string | null) => {
    const list = stopId ? summits.current.get(stopId) : undefined
    const known = new Set((useLabelSources.getState().sources.osm ?? []).map((l) => l.id))
    setLabelSource(SOURCE, list ? summitLabels(list, known) : [])
  }

  useEffect(() => {
    const stops = clock.stops.filter((s) => s.camera === 'panorama')
    const found = summits.current
    found.clear()
    if (!track || !enabled || stops.length === 0) return
    const path = trackPathOf(track)
    const ctrl = new AbortController()
    for (const stop of stops) {
      const at = samplePath(path, stop.atM)
      sharedOverpassQuery(summitQuery(at.lon, at.lat), parseSummits, ctrl.signal).then(
        (list) => {
          found.set(stop.id, list)
          if (shown.current === stop.id) publish(stop.id)
        },
        // a failed or cancelled request: that panorama names nothing
        () => undefined,
      )
    }
    return () => {
      ctrl.abort()
      found.clear()
      setLabelSource(SOURCE, [])
    }
    // `publish` only reads refs and the label store
  }, [clock, track, enabled])

  // the labels change when the film enters or leaves a panorama, not at every frame
  useFrame(() => {
    const { progress, timeS } = useAppStore.getState().playback
    const state = clock.stateAt(Math.min(timeS ?? clock.timeAtProgress(progress), clock.totalTime()))
    const id = state.phase === 'stop' && state.stop?.camera === 'panorama' ? state.stop.id : null
    if (id === shown.current) return
    shown.current = id
    publish(id)
  })

  return null
}
