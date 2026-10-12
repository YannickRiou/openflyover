/**
 * Fetch state of the OpenStreetMap water of the film track (`WaterLayer.tsx`), shown as a chip in the status bar:
 * idle while the water setting is off or without a track.
 */
import { create } from 'zustand'

export type WaterStatus = 'idle' | 'loading' | 'ready' | 'error'

export const useWaterStatusStore = create<{ status: WaterStatus }>()(() => ({ status: 'idle' }))

export const setWaterStatus = (status: WaterStatus) => useWaterStatusStore.setState({ status })
