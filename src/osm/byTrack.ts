/**
 * What the map layers (water, forests) fetched per track of the film: kept by track id, merged for drawing. Pure.
 */

/**
 * What makes a shape the same in two answers: its id and its geometry (first point, point count). A lake, a riverbank or a
 * forest has one OpenStreetMap id and one shape whatever the corridor; but `sea/<cell>` ids and the `way/<id>#<k>` pieces of a
 * river are numbered per corridor, so two tracks give different shapes under one id.
 */
function shapeKey(item: { id: string }): string {
  const { outer, points } = item as { outer?: readonly (readonly number[])[]; points?: readonly (readonly number[])[] }
  const ring = outer ?? points ?? []
  return `${item.id}|${ring[0]?.join(',') ?? ''}|${ring.length}`
}

/** Results of `byTrack` for `trackIds` only (in that order), each shape once: two tracks that share a corridor share its shapes. */
export function mergeByTrack<T extends { id: string }>(byTrack: Readonly<Record<string, readonly T[]>>, trackIds: readonly string[]): T[] {
  const seen = new Set<string>()
  const merged: T[] = []
  for (const trackId of trackIds) {
    for (const item of byTrack[trackId] ?? []) {
      const key = shapeKey(item)
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(item)
    }
  }
  return merged
}

/** `byTrack` without the tracks that are no longer asked for (the same object when none is dropped). */
export function pruneByTrack<T>(byTrack: Readonly<Record<string, T>>, trackIds: Iterable<string>): Readonly<Record<string, T>> {
  const keep = new Set(trackIds)
  const ids = Object.keys(byTrack)
  if (ids.every((id) => keep.has(id))) return byTrack
  return Object.fromEntries(ids.filter((id) => keep.has(id)).map((id) => [id, byTrack[id]]))
}
