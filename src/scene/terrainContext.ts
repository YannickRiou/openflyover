/**
 * The terrain engine and the local tangent frame that `TerrainLayer` shares with the scene components below it
 * (kept apart from the component so its file only exports components: React fast refresh).
 */
import { createContext, useContext } from 'react'
import type { LocalFrame, TerrainEngine } from '../core/types'

export interface TerrainContextValue {
  /** null until the engine has been created (first effect) or when no track is loaded */
  engine: TerrainEngine | null
  /** local tangent frame of the current trip, null when no track is loaded */
  frame: LocalFrame | null
}

export const TerrainEngineContext = createContext<TerrainContextValue>({ engine: null, frame: null })

export function useTerrainContext(): TerrainContextValue {
  return useContext(TerrainEngineContext)
}

