/**
 * « Mesurer le coût des couches » (Réglages › Diagnostic): the time of an image of the film with each layer off in turn
 * (clouds, shadows, atmosphere, forest, water, contour lines, 3D labels, 3D marker model, motion blur, overlay) and with half the pixels, measured on the
 * device itself. A phone has no GPU timer (Safari), so this is the only way to know which layer to lighten there.
 * Each measure is a short window of the film exported without encoding (`probe`, `layerCostRun.ts`); this file is pure
 * (tested): the list of layers, the sequencing with injected dependencies, and the lines of the report (in French, as the
 * rest of the report).
 */
import type { Settings } from '../state/store'
import type { ReportRow, ReportSection } from './diagnostic'

export interface LayerVariant {
  id: string
  /** « sans nuages »: how the line reads in the report */
  label: string
  /** the settings with this layer off; null when it is off already (nothing to measure) */
  apply(settings: Settings): Settings | null
  /** the size of the image is halved on both sides: how much of the time is the number of pixels */
  half?: boolean
}

const noLabels = (labels: Settings['labels']) => !labels.waypoints && labels.kmStep === 0 && !labels.endpoints && !labels.photos && !labels.photoPins

export const LAYER_VARIANTS: readonly LayerVariant[] = [
  { id: 'clouds', label: 'sans nuages', apply: (s) => (s.clouds.mode === 'aucun' ? null : { ...s, clouds: { ...s.clouds, mode: 'aucun' } }) },
  { id: 'shadows', label: 'sans ombres', apply: (s) => (s.shadows ? { ...s, shadows: false } : null) },
  { id: 'atmosphere', label: "sans atmosphère", apply: (s) => (s.atmosphere ? { ...s, atmosphere: false } : null) },
  { id: 'forest', label: 'sans forêt', apply: (s) => (s.forest.enabled ? { ...s, forest: { ...s.forest, enabled: false } } : null) },
  { id: 'water', label: "sans eau", apply: (s) => (s.water.enabled ? { ...s, water: { ...s.water, enabled: false } } : null) },
  { id: 'contours', label: 'sans courbes de niveau', apply: (s) => (s.contours.enabled ? { ...s, contours: { ...s.contours, enabled: false } } : null) },
  {
    id: 'labels',
    label: 'sans étiquettes 3D',
    apply: (s) => (noLabels(s.labels) ? null : { ...s, labels: { ...s.labels, waypoints: false, kmStep: 0, endpoints: false, photos: false, photoPins: false } }),
  },
  // each image is rendered up to `maxSubFrames` times with the shutter open: this is the share of the cost that multiplies
  { id: 'shutter', label: 'sans flou de bougé (un seul rendu par image)', apply: (s) => (s.lens.shutter > 0 ? { ...s, lens: { ...s.lens, shutter: 0 } } : null) },
  // the figurine's glTF character (skinned, outlined: about thirty draw calls) against its flat stand-in
  { id: 'marker3d', label: 'sans modèle 3D du marqueur', apply: (s) => (s.marker.kind === 'figurine' && s.marker.model3d ? { ...s, marker: { ...s.marker, model3d: false } } : null) },
  { id: 'overlay', label: "sans habillage", apply: (s) => (s.overlay.enabled ? { ...s, overlay: { ...s.overlay, enabled: false } } : null) },
  { id: 'half', label: 'moitié de la résolution (chaque côté divisé par 2)', apply: (s) => s, half: true },
]

export interface LayerCostResult {
  /** « référence » or the label of the variant */
  label: string
  /** ms per image; null when it was not measured (`skipped`) */
  msPerFrame: number | null
  /** why it was not measured */
  skipped?: string
}

export interface LayerCostDeps {
  settings(): Settings
  setSettings(settings: Settings): void
  /** export the window without encoding at `scale` of the size, resolve with the ms per image after the first one */
  measure(scale: number): Promise<number>
  /** a pause after a change of the settings, for the layers to follow it */
  settle(): Promise<void>
  canceled(): boolean
  /** `label` is about to be measured (index from 1 of `total`) */
  progress?(label: string, index: number, total: number): void
}

export const REFERENCE_LABEL = 'référence'

/**
 * The reference first (measured twice, the first run only warms the tiles and the shaders up), then each layer off in turn,
 * the settings put back after each and at the end. Stops at the first cancel (also when it interrupts a measure) and
 * returns what was measured; another failure throws after the settings are back.
 */
export async function measureLayerCost(deps: LayerCostDeps, variants: readonly LayerVariant[] = LAYER_VARIANTS): Promise<LayerCostResult[]> {
  const base = deps.settings()
  const plan = variants.map((variant) => ({ variant, settings: variant.apply(base) }))
  const total = 1 + plan.filter((p) => p.settings !== null).length
  const results: LayerCostResult[] = []
  try {
    deps.progress?.(REFERENCE_LABEL, 1, total)
    await deps.measure(1)
    if (deps.canceled()) return results
    results.push({ label: REFERENCE_LABEL, msPerFrame: await deps.measure(1) })
    let index = 1
    for (const { variant, settings } of plan) {
      if (settings === null) {
        results.push({ label: variant.label, msPerFrame: null, skipped: 'déjà désactivé dans ce projet' })
        continue
      }
      if (deps.canceled()) return results
      index++
      deps.progress?.(variant.label, index, total)
      deps.setSettings(settings)
      await deps.settle()
      results.push({ label: variant.label, msPerFrame: await deps.measure(variant.half ? 0.5 : 1) })
      deps.setSettings(base)
    }
    return results
  } catch (error) {
    // the measure under way was cut short by the cancel: what came before it is kept
    if (deps.canceled()) return results
    throw error
  } finally {
    deps.setSettings(base)
  }
}

const comma = (n: number, digits = 0) => n.toFixed(digits).replace('.', ',')

/** The lines of the report: the reference, then for each layer the time and what it saves. */
export function layerCostRows(results: readonly LayerCostResult[], detail: string): ReportRow[] {
  const reference = results.find((r) => r.label === REFERENCE_LABEL)?.msPerFrame ?? null
  const rows: ReportRow[] = []
  for (const { label, msPerFrame, skipped } of results) {
    if (msPerFrame === null) {
      rows.push([label, skipped ?? 'non mesuré'])
    } else if (label === REFERENCE_LABEL) {
      rows.push([label, `${comma(msPerFrame)} ms par image (${detail})`])
    } else if (reference !== null && reference > 0) {
      const saved = reference - msPerFrame
      rows.push([label, `${comma(msPerFrame)} ms par image, ${saved >= 0 ? '−' : '+'}${comma(Math.abs(saved))} ms (${saved >= 0 ? '−' : '+'}${comma((Math.abs(saved) / reference) * 100)} %)`])
    } else {
      rows.push([label, `${comma(msPerFrame)} ms par image`])
    }
  }
  return rows
}

/** The section added to the diagnostic report. `incomplete`: the measure was stopped before the end. */
export function layerCostSection(results: readonly LayerCostResult[], detail: string, incomplete = false): ReportSection {
  const rows = layerCostRows(results, detail)
  if (incomplete) rows.push(['Mesure', 'interrompue avant la fin'])
  return { title: 'Coût des couches', rows }
}
