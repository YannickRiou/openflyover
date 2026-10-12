/**
 * GPU time of the export's renders (diagnostic): a `TIME_ELAPSED` query of `EXT_disjoint_timer_query_webgl2` around each
 * `advance`, read a few tasks later once the GPU has finished it. The time on the main thread (`renderMs`) only covers
 * the commands handed to the GPU; this is the time the GPU spent on them. Chrome and Firefox on a computer have it;
 * Safari, so iOS, does not: the counters then stay at 0 and the reports say « non mesuré ». A query whose result spans
 * a GPU reset (`GPU_DISJOINT_EXT`) is dropped.
 */

/** The parts of the extension and of WebGL 2 the timer uses. */
interface TimerQueryExt {
  readonly TIME_ELAPSED_EXT: number
  readonly GPU_DISJOINT_EXT: number
}

type QueryContext = Pick<
  WebGL2RenderingContext,
  'createQuery' | 'deleteQuery' | 'beginQuery' | 'endQuery' | 'getQueryParameter' | 'getParameter' | 'getExtension' | 'QUERY_RESULT' | 'QUERY_RESULT_AVAILABLE'
>

export interface GpuTimer {
  /** start timing the next render (nothing when one is being timed) */
  begin(): void
  end(): void
  /** collect the results that are ready */
  poll(): void
  /** GPU milliseconds of the renders measured so far, and how many */
  readonly totalMs: number
  readonly measured: number
  /** queries still waiting for their result */
  readonly pending: number
  dispose(): void
}

/** Queries kept waiting at most: older ones are dropped (a GPU far behind would grow the list). */
const MAX_PENDING = 64

/** A timer on `gl`, or null where the browser gives no timer queries (WebGL 1, Safari, the extension refused). */
export function createGpuTimer(gl: unknown): GpuTimer | null {
  const ctx = gl as Partial<QueryContext> | null
  if (!ctx || typeof ctx.createQuery !== 'function' || typeof ctx.getExtension !== 'function') return null
  const context = ctx as QueryContext
  let ext: TimerQueryExt | null = null
  try {
    ext = context.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExt | null
  } catch {
    ext = null
  }
  if (!ext) return null
  const timerExt = ext
  const pending: WebGLQuery[] = []
  let active: WebGLQuery | null = null
  let totalMs = 0
  let measured = 0

  const drop = (query: WebGLQuery) => context.deleteQuery(query)

  return {
    begin() {
      if (active) return
      const query = context.createQuery()
      if (!query) return
      context.beginQuery(timerExt.TIME_ELAPSED_EXT, query)
      active = query
    },
    end() {
      if (!active) return
      context.endQuery(timerExt.TIME_ELAPSED_EXT)
      pending.push(active)
      active = null
      while (pending.length > MAX_PENDING) drop(pending.shift()!)
    },
    poll() {
      if (pending.length === 0) return
      // a GPU reset makes every result in flight meaningless
      if (context.getParameter(timerExt.GPU_DISJOINT_EXT)) {
        pending.splice(0).forEach(drop)
        return
      }
      // results come in order: stop at the first that is not ready
      while (pending.length > 0 && context.getQueryParameter(pending[0], context.QUERY_RESULT_AVAILABLE)) {
        const query = pending.shift()!
        totalMs += Number(context.getQueryParameter(query, context.QUERY_RESULT)) / 1e6
        measured++
        drop(query)
      }
    },
    get totalMs() {
      return totalMs
    },
    get measured() {
      return measured
    },
    get pending() {
      return pending.length
    },
    dispose() {
      if (active) {
        context.endQuery(timerExt.TIME_ELAPSED_EXT)
        drop(active)
        active = null
      }
      pending.splice(0).forEach(drop)
    },
  }
}
