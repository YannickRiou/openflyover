/**
 * « Mesurer le coût des couches » on the device (`layerCost.ts` for the pure part): each measure is a window of
 * `WINDOW_FRAMES` frames in the middle of the flight, exported without encoding and recorded nowhere (`probe`). The run
 * holds the batch store `running` like a batch does (no autosave, no edit, the export panel locked), suspends the undo
 * history, and puts the settings, the « Export de test sans encodage » flag and the export store back at the end, whatever
 * happens. Loaded on demand by the Diagnostic row: nothing of it runs at start-up.
 */
import { deviceBudget } from '../core/deviceBudget'
import { filmClockFor } from '../film/clock'
import { getSettingsHistory } from '../project/history'
import { getFilmSource } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { useBatchStore } from './batch'
import { collectDiagnostic, formatReport, noEncodingTest, setNoEncodingTest } from './diagnostic'
import { layerCostSection, measureLayerCost } from './layerCost'
import { videoSize } from './schedule'
import { isExportBusy, useExportStore } from './store'
import { loadTrackData, shownFilm } from './trackFilms'

/** frames of a measure: enough to average out the noise of one, few enough for a phone (about a second each) */
export const WINDOW_FRAMES = 12
/** the film time between two frames of the window (seconds at ×1): the flight moves a little, the tiles stay */
const FPS = 10
/** wait after a change of the settings, for the layers to follow it (ms) */
const SETTLE_MS = 800

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

export interface LayerCostRun {
  /** the report with the « Coût des couches » section, ready to show */
  text: string
  completed: boolean
}

/** Why the measure cannot start now, null when it can. */
export function layerCostBlocked(): 'no-track' | 'busy' | null {
  if (isExportBusy(useExportStore.getState().phase) || useBatchStore.getState().phase === 'running') return 'busy'
  return useAppStore.getState().tracks.length === 0 ? 'no-track' : null
}

/** Measure, then build the report. `canceled` is read between and during the measures; `progress` says which one runs. */
export async function runLayerCost(canceled: () => boolean, progress: (label: string, index: number, total: number) => void): Promise<LayerCostRun | null> {
  if (layerCostBlocked() !== null) return null
  const base = useAppStore.getState().settings
  const resume = getSettingsHistory().suspend()
  const encodingFlag = noEncodingTest()
  useBatchStore.getState().hold(null)
  setNoEncodingTest(true)
  try {
    await loadTrackData(canceled)
    const film = shownFilm()
    const clock = filmClockFor(getFilmSource())
    const flight = Math.max(0, film.durationS - clock.openingS - clock.closingS)
    const fromS = clock.openingS + flight / 2
    const toS = fromS + (WINDOW_FRAMES - 0.5) / FPS
    const full = videoSize(base.video.aspect, base.video.resolution, deviceBudget().maxExportShortSide)

    const measure = async (scale: number): Promise<number> => {
      const store = useExportStore
      store.getState().start({
        ...film,
        fps: FPS,
        width: even(full.width * scale),
        height: even(full.height * scale),
        baseName: 'mesure',
        holdStartS: 0,
        holdEndS: 0,
        window: { fromS, toS },
        probe: true,
      })
      let first: number | null = null
      const stop = () => store.getState().cancel()
      const watcher = setInterval(() => canceled() && stop(), 250)
      try {
        return await new Promise<number>((resolve, reject) => {
          const done = store.subscribe((state) => {
            if (first === null && state.frame >= 1) first = performance.now()
            if (isExportBusy(state.phase)) return
            done()
            if (state.phase === 'done' && first !== null && state.frameCount > 1) resolve((performance.now() - first) / (state.frameCount - 1))
            else reject(new Error(state.error ?? 'mesure interrompue'))
          })
        })
      } finally {
        clearInterval(watcher)
        store.getState().reset()
      }
    }

    const results = await measureLayerCost({
      settings: () => useAppStore.getState().settings,
      setSettings: (settings) => useAppStore.setState({ settings }),
      measure,
      settle: () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS)),
      canceled,
      progress,
    })
    const completed = !canceled()
    const detail = `${even(full.width)} × ${even(full.height)}, ${WINDOW_FRAMES} images au milieu du vol, sans encodage`
    const report = collectDiagnostic()
    return { text: formatReport({ ...report, sections: [...report.sections, layerCostSection(results, detail, !completed)] }), completed }
  } finally {
    // the project as it was: the same settings object, so « Enregistré » stays
    useAppStore.setState({ settings: base })
    setNoEncodingTest(encodingFlag)
    useBatchStore.getState().release()
    resume()
  }
}
