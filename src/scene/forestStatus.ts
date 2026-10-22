/**
 * Fetch state of the OpenStreetMap forests of the film track (`ForestLayer.tsx`), shown as a chip in the status bar:
 * idle while the forest setting is off or without a track, queued while the request waits for the others to Overpass.
 */
import { create } from 'zustand'

export type ForestStatus = 'idle' | 'queued' | 'loading' | 'ready' | 'error'

export const useForestStatusStore = create<{ status: ForestStatus }>()(() => ({ status: 'idle' }))

export const setForestStatus = (status: ForestStatus) => useForestStatusStore.setState({ status })
