import { useSyncExternalStore } from 'react'

const COARSE = '(pointer: coarse)'
const subscribeCoarse = (onChange: () => void) => {
  const query = window.matchMedia?.(COARSE)
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}
const isCoarse = () => window.matchMedia?.(COARSE).matches ?? false

/**
 * The main pointer is a finger (`pointer: coarse`): the controls whose native picker is made for it (`Select`, `DateField`,
 * `TimeField`) stay the browser's own there. False without `matchMedia` (a test), as on a desktop.
 */
export const useCoarsePointer = () => useSyncExternalStore(subscribeCoarse, isCoarse, () => false)
