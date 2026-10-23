/**
 * What a map layer (water, forests) fetches for each track of the film: one request per track, through the shared
 * Overpass queue and cache (osm/overpass.ts), kept by track id. A track that is removed (or whose points change), the
 * layer switched off or gone, gives its request up (`signal`): `sharedOverpassQuery` cancels a query once nobody waits
 * for it any more, so it no longer holds the single queue. See ARCHITECTURE.md "Several tracks".
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Track } from '../core/types'

type Segments = Track['segments']

export interface TrackResults<T> {
  /** answers by track id, for the tracks asked for now only */
  results: Readonly<Record<string, T>>
  /** a request is still waiting */
  loading: boolean
  /** the Overpass queue has reached a request still waiting (false while it works for others) */
  started: boolean
  /** a request failed (asked again when the tracks change) */
  failed: boolean
}

interface State<T> {
  /** answers, with the points of the track they were fetched for */
  answers: Readonly<Record<string, { segments: Segments; value: T }>>
  failures: Readonly<Record<string, Segments>>
}

const NOTHING: Readonly<Record<string, never>> = {}

/**
 * Fetch `fetch(track, onStart, signal)` for every track while `enabled`; each answer is available as it arrives. `onStart` is
 * for the fetcher to call when the queue really sends the request (`started`); `signal` aborts once the track is no longer
 * asked for.
 */
export function useTrackResults<T>(
  enabled: boolean,
  tracks: readonly Track[],
  fetch: (track: Track, onStart: () => void, signal: AbortSignal) => Promise<T>,
): TrackResults<T> {
  const [state, setState] = useState<State<T>>({ answers: {}, failures: {} })
  /** the points of each track whose request the queue has started */
  const [startedFor, setStartedFor] = useState<Readonly<Record<string, Segments>>>({})
  /** the points each track was asked for (an answer whose track has gone or changed meanwhile is stale) */
  const asked = useRef(new Map<string, Segments>())
  /** the tracks whose request failed: asked again the next time the tracks change */
  const failedIds = useRef(new Set<string>())
  /** the request of each track asked for, to give it up */
  const controllers = useRef(new Map<string, AbortController>())
  // the latest fetcher, without restarting the requests
  const fetchRef = useRef(fetch)
  useEffect(() => {
    fetchRef.current = fetch
  })

  // gone (or StrictMode's first run): every request is given up, and asked again by the next run
  useEffect(() => {
    const ask = asked.current
    const ctrls = controllers.current
    return () => {
      for (const ctrl of ctrls.values()) ctrl.abort()
      ctrls.clear()
      ask.clear()
    }
  }, [])

  useEffect(() => {
    const ask = asked.current
    const failedNow = failedIds.current
    const ctrls = controllers.current
    const forget = (id: string) => {
      ctrls.get(id)?.abort()
      ctrls.delete(id)
      ask.delete(id)
    }
    if (!enabled) {
      for (const id of [...ask.keys()]) forget(id)
      failedNow.clear()
      return
    }
    // a track whose request failed is asked again now: it is loading, not failed, until the new answer
    const retried = [...failedNow]
    for (const id of retried) ask.delete(id)
    failedNow.clear()
    if (retried.length > 0) setState((s) => ({ answers: s.answers, failures: Object.fromEntries(Object.entries(s.failures).filter(([id]) => !retried.includes(id))) }))
    const byId = new Map(tracks.map((t) => [t.id, t]))
    for (const [id, segments] of [...ask]) if (byId.get(id)?.segments !== segments) forget(id)
    for (const track of tracks) {
      if (ask.has(track.id)) continue
      const { id, segments } = track
      ask.set(id, segments)
      // the tracks still asked for are kept, the others dropped with the answer
      const keep = (answers: State<T>['answers'], failures: State<T>['failures']) => ({
        answers: Object.fromEntries(Object.entries(answers).filter(([key]) => ask.has(key))),
        failures: Object.fromEntries(Object.entries(failures).filter(([key]) => ask.has(key))),
      })
      const onStart = () => {
        if (ask.get(id) === segments) setStartedFor((s) => ({ ...s, [id]: segments }))
      }
      const ctrl = new AbortController()
      ctrls.set(id, ctrl)
      fetchRef.current(track, onStart, ctrl.signal).then(
        (value) => {
          if (ctrl.signal.aborted || ask.get(id) !== segments) return
          setState((s) => keep({ ...s.answers, [id]: { segments, value } }, s.failures))
        },
        () => {
          if (ctrl.signal.aborted || ask.get(id) !== segments) return
          failedNow.add(id)
          setState((s) => ({ answers: s.answers, failures: { ...s.failures, [id]: segments } }))
        },
      )
    }
  }, [enabled, tracks])

  return useMemo(() => {
    if (!enabled) return { results: NOTHING, loading: false, started: false, failed: false }
    const results: Record<string, T> = {}
    let loading = false
    let started = false
    let failed = false
    for (const { id, segments } of tracks) {
      const answer = state.answers[id]
      if (answer?.segments === segments) results[id] = answer.value
      else if (state.failures[id] === segments) failed = true
      else {
        loading = true
        // the queue is sequential: a started request that has not answered is the one it works on
        if (startedFor[id] === segments) started = true
      }
    }
    return { results, loading, started, failed }
  }, [enabled, tracks, state, startedFor])
}
