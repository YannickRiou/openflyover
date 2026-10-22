/**
 * What the map layers (water, forests) fetched per track of the film: kept by track id, merged for drawing. Pure.
 */

/** Results of `byTrack` for `trackIds` only (in that order), each item once: two tracks that share a corridor share its shapes (same `id`). */
export function mergeByTrack<T extends { id: string }>(byTrack: Readonly<Record<string, readonly T[]>>, trackIds: readonly string[]): T[] {
  const seen = new Set<string>()
  const merged: T[] = []
  for (const trackId of trackIds) {
    for (const item of byTrack[trackId] ?? []) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
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
