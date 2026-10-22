/**
 * Fetch state of the OpenStreetMap glaciers of the film track (`GlacierLayer.tsx`), shown as a chip in the status bar:
 * idle while the snow is off (« Aucune ») or without a track.
 */
import { create } from 'zustand'

export type GlacierStatus = 'idle' | 'loading' | 'ready' | 'error'

export const useGlacierStatusStore = create<{ status: GlacierStatus }>()(() => ({ status: 'idle' }))

export const setGlacierStatus = (status: GlacierStatus) => useGlacierStatusStore.setState({ status })
