/**
 * Lanes of the timeline folded to a thin strip or locked against edits, per device (`localStorage`, not in the project:
 * a way of working, not a part of the film). Pure functions, and a hook that keeps them.
 */
import { useCallback, useState } from 'react'

const KEY = 'openflyover.lanes.v1'
/** Longest list kept (there are a dozen lanes). */
const MAX_LANES = 40

export interface LaneState {
  folded: readonly string[]
  locked: readonly string[]
}

export const NO_LANE_STATE: LaneState = { folded: [], locked: [] }

const ids = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 40))].slice(0, MAX_LANES) : []

/** The state saved in `raw` (anything unreadable: none folded, none locked). */
export function parseLaneState(raw: string | null): LaneState {
  if (!raw) return NO_LANE_STATE
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return NO_LANE_STATE
    const { folded, locked } = parsed as Record<string, unknown>
    return { folded: ids(folded), locked: ids(locked) }
  } catch {
    return NO_LANE_STATE
  }
}

/** The state with lane `id` folded / locked if it was not, else not. */
export function toggleLane(state: LaneState, kind: keyof LaneState, id: string): LaneState {
  const list = state[kind]
  return { ...state, [kind]: list.includes(id) ? list.filter((other) => other !== id) : [...list, id].slice(-MAX_LANES) }
}

function read(): LaneState {
  try {
    return parseLaneState(globalThis.localStorage?.getItem(KEY) ?? null)
  } catch {
    return NO_LANE_STATE
  }
}

function write(state: LaneState): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(state))
  } catch {
    // private window, full storage: the state lasts for the session
  }
}

/** The folded and locked lanes of this device, and a toggle that keeps them. */
export function useLaneState(): readonly [LaneState, (kind: keyof LaneState, id: string) => void] {
  const [state, setState] = useState<LaneState>(read)
  const toggle = useCallback((kind: keyof LaneState, id: string) => {
    setState((was) => {
      const next = toggleLane(was, kind, id)
      write(next)
      return next
    })
  }, [])
  return [state, toggle]
}
