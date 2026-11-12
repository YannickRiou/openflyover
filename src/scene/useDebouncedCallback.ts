/**
 * Debounce utilities.
 *
 * `createDebounced` is framework-free (and unit-tested); `useDebouncedCallback` wraps it for React and
 * cancels any pending invocation on unmount.
 */
import { useEffect, useMemo } from 'react'

export interface Debounced<A extends unknown[]> {
  (...args: A): void
  /** Drop the pending invocation, if any. */
  cancel(): void
  /** Run the pending invocation immediately, if any. */
  flush(): void
  /** True while an invocation is scheduled. */
  isPending(): boolean
}

export interface DebounceOptions {
  /**
   * Upper bound on how long an invocation can be deferred while calls keep arriving (milliseconds).
   * Without it a steady stream of calls (one per frame, say) starves the trailing call forever.
   */
  maxWaitMs?: number
  /**
   * While it answers true, a due invocation does not run: it stays pending until `flush()` (or until a later call's
   * timer finds it false). A video export holds the re-drapes this way: the relief changes with every tile that arrives,
   * and each timer redid the whole drape (water, tracks, labels) several times per frame, on the thread the tiles need
   * to be decoded and handed over; one drape per frame, at the flush, is all the picture shows.
   */
  hold?: () => boolean
}

/**
 * Trailing-edge debounce: `fn` runs once, `delayMs` after the last call, with the last call's arguments,
 * and no later than `maxWaitMs` after the first call of a burst when that option is set.
 */
export function createDebounced<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
  options: DebounceOptions = {},
): Debounced<A> {
  const { maxWaitMs, hold } = options
  /** the invocation was due while held: it waits for `flush()` or the next call */
  let held = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let maxTimer: ReturnType<typeof setTimeout> | null = null
  let pendingArgs: A | null = null

  const clearTimers = () => {
    if (timer !== null) clearTimeout(timer)
    if (maxTimer !== null) clearTimeout(maxTimer)
    timer = null
    maxTimer = null
  }

  const fire = (forced = false) => {
    clearTimers()
    if (!forced && hold?.()) {
      held = true
      return
    }
    held = false
    const args = pendingArgs
    pendingArgs = null
    if (args) fn(...args)
  }

  const debounced = ((...args: A) => {
    pendingArgs = args
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => fire(), delayMs)
    if (maxWaitMs !== undefined && maxTimer === null) maxTimer = setTimeout(() => fire(), maxWaitMs)
  }) as Debounced<A>

  debounced.cancel = () => {
    clearTimers()
    pendingArgs = null
    held = false
  }
  debounced.flush = () => {
    if (timer === null && !held) return
    fire(true)
  }
  debounced.isPending = () => timer !== null || held

  return debounced
}

/**
 * React hook returning a debounced version of `callback`.
 *
 * The instance is stable for a given (`callback`, `delayMs`, `maxWaitMs`) triple, so pass a stable
 * callback (`useCallback`): a new triple creates a new instance and drops the pending call of the
 * previous one, as does unmounting.
 */
export function useDebouncedCallback<A extends unknown[]>(
  callback: (...args: A) => void,
  delayMs: number,
  maxWaitMs?: number,
  hold?: () => boolean,
): Debounced<A> {
  const debounced = useMemo(
    () => createDebounced<A>(callback, delayMs, { maxWaitMs, hold }),
    [callback, delayMs, maxWaitMs, hold],
  )

  useEffect(() => () => debounced.cancel(), [debounced])

  return debounced
}
