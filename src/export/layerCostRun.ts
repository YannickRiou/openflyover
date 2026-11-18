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
import type { Settings } from '../state/store'
import { useBatchStore } from './batch'
import { collectDiagnostic, formatReport, noEncodingTest, setNoEncodingTest } from './diagnostic'
import { layerCostSection, measureLayerCost } from './layerCost'
import { videoSize } from './schedule'
import { isExportBusy, useExportStore } from './store'
import { loadTrackData, shownFilm } from './trackFilms'

/** frames of a measure: enough to average out the noise of one, few enough for a phone (about a second each) */
export const WINDOW_FRAMES = 12
/**
 * frames drawn before the clock starts, after each change of the layers: the first ones compile the shaders and fill the
 * caches of the new settings (a third pass on an iPhone came out slower than the first for that reason)
 */
export const WARM_FRAMES = 3
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
    const toS = fromS + (WARM_FRAMES + WINDOW_FRAMES - 0.5) / FPS
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
            if (first === null && state.frame >= WARM_FRAMES) first = performance.now()
            if (isExportBusy(state.phase)) return
            done()
            if (state.phase === 'done' && first !== null && state.frameCount > WARM_FRAMES) resolve((performance.now() - first) / (state.frameCount - WARM_FRAMES))
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
    const detail = `${even(full.width)} × ${even(full.height)}, ${WINDOW_FRAMES} images au milieu du vol après ${WARM_FRAMES} de chauffe, sans encodage`
    const section = layerCostSection(results, detail, !completed)
    if (completed) section.rows.push(...(await webgpuCloudsRows(base, measure)))
    const report = collectDiagnostic()
    return { text: formatReport({ ...report, sections: [...report.sections, section] }), completed }
  } finally {
    // the project as it was: the same settings object, so « Enregistré » stays
    useAppStore.setState({ settings: base })
    setNoEncodingTest(encodingFlag)
    useBatchStore.getState().release()
    resume()
  }
}

/**
 * The trial of the clouds marched in WebGPU (`scene/webgpuClouds`): the same window exported with the WebGL clouds, then
 * with the WebGPU ones, back to back (the reference of the section drifts with the heat of the device), then once more
 * with each stage of the WebGPU frame waited for, to say where its time goes. A failure is a line of the report, never a
 * failed measure.
 */
async function webgpuCloudsRows(settings: Settings, measure: (scale: number) => Promise<number>): Promise<[string, string][]> {
  const { UNAVAILABLE, cloudStagesRow, cloudTrialRow, unavailableText } = await import('../scene/webgpuClouds/bench')
  if (!settings.atmosphere || settings.clouds.mode === 'aucun') return [cloudTrialRow({ unavailable: UNAVAILABLE['no-clouds'] })]
  const { forceWebgpuClouds } = await import('../scene/webgpuClouds/preference')
  const { lastWebgpuBlocker, profileStages, webgpuAdapter, webgpuTimings } = await import('../scene/webgpuClouds/bridge')
  try {
    forceWebgpuClouds(false)
    const webglMs = await measure(1)
    forceWebgpuClouds(true)
    const before = { ...webgpuTimings }
    const webgpuMs = await measure(1)
    const frames = webgpuTimings.frames - before.frames
    if (frames === 0) return [cloudTrialRow({ unavailable: unavailableText(lastWebgpuBlocker() ?? 'aucune image') })]
    const trial = cloudTrialRow({ webglMs, webgpuMs, adapter: webgpuAdapter() ?? '?', gpuMsPerFrame: (webgpuTimings.gpuMs - before.gpuMs) / frames })
    // each stage of the frame waited for: slower than the run above, only to share its time out
    profileStages.on = true
    const mid = { ...webgpuTimings, stages: { ...webgpuTimings.stages } }
    await measure(1)
    const n = Math.max(1, webgpuTimings.profiled - mid.profiled)
    const per = (key: keyof typeof webgpuTimings.stages) => (webgpuTimings.stages[key] - mid.stages[key]) / n
    const frames2 = Math.max(1, webgpuTimings.frames - mid.frames)
    const stages = cloudStagesRow({
      upload: per('upload'),
      shadow: per('shadow'),
      march: per('march'),
      resolve: per('resolve'),
      finish: per('finish'),
      readback: per('readback'),
      waits: per('waits'),
      readDistance: (webgpuTimings.readDistanceMs - mid.readDistanceMs) / frames2,
      readIrradiance: (webgpuTimings.readIrradianceMs - mid.readIrradianceMs) / frames2,
      rest: (webgpuTimings.restMs - mid.restMs) / frames2,
      wait: (webgpuTimings.waitMs - mid.waitMs) / frames2,
    })
    return [trial, stages]
  } catch (error) {
    return [cloudTrialRow({ unavailable: `échec : ${error instanceof Error ? error.message.split('\n')[0] : String(error)}` })]
  } finally {
    forceWebgpuClouds(null)
    const { profileStages } = await import('../scene/webgpuClouds/bridge')
    profileStages.on = false
  }
}
