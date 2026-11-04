import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../state/store'
import type { Settings } from '../state/store'
import { LAYER_VARIANTS, REFERENCE_END_LABEL, REFERENCE_LABEL, layerCostRows, layerCostSection, measureLayerCost } from './layerCost'
import type { LayerCostDeps } from './layerCost'

const BASE: Settings = {
  ...DEFAULT_SETTINGS,
  shadows: true,
  atmosphere: true,
  clouds: { ...DEFAULT_SETTINGS.clouds, mode: 'meteo' },
  forest: { ...DEFAULT_SETTINGS.forest, enabled: true },
  water: { ...DEFAULT_SETTINGS.water, enabled: false },
  contours: { ...DEFAULT_SETTINGS.contours, enabled: false },
  labels: { ...DEFAULT_SETTINGS.labels, waypoints: true },
  overlay: { ...DEFAULT_SETTINGS.overlay, enabled: true },
}

/** A device whose images cost 100 ms, less without clouds and shadows, a quarter of that with half the pixels. */
function fakeDevice(overrides: Partial<LayerCostDeps> = {}) {
  let settings = BASE
  const seen: { clouds: string; shadows: boolean; scale: number }[] = []
  const deps: LayerCostDeps = {
    settings: () => settings,
    setSettings: (next) => void (settings = next),
    measure: async (scale) => {
      seen.push({ clouds: settings.clouds.mode, shadows: settings.shadows, scale })
      return (100 - (settings.clouds.mode === 'aucun' ? 40 : 0) - (settings.shadows ? 0 : 10)) * scale * scale
    },
    settle: async () => undefined,
    canceled: () => false,
    ...overrides,
  }
  return { deps, seen, now: () => settings }
}

describe('measureLayerCost', () => {
  it('measures the reference twice (the first only warms up), then each layer off in turn, the settings back after each', async () => {
    const { deps, seen, now } = fakeDevice()
    const progress: string[] = []
    const results = await measureLayerCost({ ...deps, progress: (label, index, total) => progress.push(`${index}/${total} ${label}`) })
    expect(seen.slice(0, 2)).toEqual([{ clouds: 'meteo', shadows: true, scale: 1 }, { clouds: 'meteo', shadows: true, scale: 1 }])
    expect(results[0]).toEqual({ label: REFERENCE_LABEL, msPerFrame: 100 })
    expect(results.find((r) => r.label === 'sans nuages')?.msPerFrame).toBe(60)
    expect(results.find((r) => r.label === 'sans ombres')?.msPerFrame).toBe(90)
    // half the pixels: both sides halved
    expect(results.find((r) => r.label.startsWith('moitié'))?.msPerFrame).toBe(25)
    expect(seen.at(-2)?.scale).toBe(0.5)
    // the reference again at the end, to see whether the device slowed down on the way
    expect(seen.at(-1)).toEqual({ clouds: 'meteo', shadows: true, scale: 1 })
    expect(results.at(-1)).toEqual({ label: REFERENCE_END_LABEL, msPerFrame: 100 })
    expect(now()).toBe(BASE)
    // a layer off already is not measured, and the count of the progress leaves it out
    expect(results.find((r) => r.label === 'sans eau')).toEqual({ label: 'sans eau', msPerFrame: null, skipped: 'déjà désactivé dans ce projet' })
    const total = LAYER_VARIANTS.filter((v) => v.apply(BASE) !== null).length + 2
    expect(progress[0]).toBe(`1/${total} ${REFERENCE_LABEL}`)
    expect(progress.at(-2)).toMatch(/^\d+\/\d+ moitié/)
    expect(progress.at(-1)).toBe(`${total}/${total} ${REFERENCE_LABEL}`)
  })

  it('stops at a cancel, also one that cuts a measure short, keeps what came before and puts the settings back', async () => {
    let cancel = false
    const { deps, now } = fakeDevice({
      measure: vi.fn(async (scale: number) => {
        if (now().shadows === false) {
          cancel = true
          throw new Error('Export annulé')
        }
        return 100 * scale
      }),
      canceled: () => cancel,
    })
    const results = await measureLayerCost(deps)
    expect(results.map((r) => r.label)).toEqual([REFERENCE_LABEL, 'sans nuages'])
    expect(now()).toBe(BASE)
  })

  it('a failure that is not a cancel throws, the settings put back', async () => {
    const { deps, now } = fakeDevice({
      measure: async () => {
        if (now().forest.enabled === false) throw new Error('WebGL perdu')
        return 100
      },
    })
    await expect(measureLayerCost(deps)).rejects.toThrow('WebGL perdu')
    expect(now()).toBe(BASE)
  })

  it('every layer is switched off by a settings change of its own, and none touches the others', () => {
    for (const variant of LAYER_VARIANTS.filter((v) => !v.half)) {
      const next = variant.apply(BASE)
      if (next === null) continue
      const changed = (Object.keys(BASE) as (keyof Settings)[]).filter((key) => next[key] !== BASE[key])
      expect(changed, variant.id).toHaveLength(1)
    }
    expect(LAYER_VARIANTS.find((v) => v.id === 'clouds')!.apply({ ...BASE, clouds: { ...BASE.clouds, mode: 'aucun' } })).toBeNull()
  })

  it('measures the motion blur only when it is on', () => {
    const variant = LAYER_VARIANTS.find((v) => v.id === 'shutter')!
    expect(variant.apply({ ...BASE, lens: { ...BASE.lens, shutter: 0.1 } })?.lens.shutter).toBe(0)
    expect(variant.apply({ ...BASE, lens: { ...BASE.lens, shutter: 0 } })).toBeNull()
  })

  it('measures the 3D model of a figurine marker only when there is one', () => {
    const variant = LAYER_VARIANTS.find((v) => v.id === 'marker3d')!
    const figurine = { ...BASE.marker, kind: 'figurine' as const, model3d: true }
    expect(variant.apply({ ...BASE, marker: figurine })?.marker.model3d).toBe(false)
    expect(variant.apply({ ...BASE, marker: { ...figurine, model3d: false } })).toBeNull()
    expect(variant.apply({ ...BASE, marker: { ...figurine, kind: 'boule' as const } })).toBeNull()
  })
})

describe('layerCostRows', () => {
  it('writes the reference, then the time and what each layer saves, in French', () => {
    const rows = layerCostRows(
      [
        { label: REFERENCE_LABEL, msPerFrame: 812.4 },
        { label: 'sans nuages', msPerFrame: 542 },
        { label: 'sans forêt', msPerFrame: 830 },
        { label: 'sans eau', msPerFrame: null, skipped: 'déjà désactivé dans ce projet' },
      ],
      '1080 × 1920, 12 images',
    )
    expect(rows).toEqual([
      [REFERENCE_LABEL, '812 ms par image (1080 × 1920, 12 images)'],
      ['sans nuages', '542 ms par image, −270 ms (−33 %)'],
      ['sans forêt', '830 ms par image, +18 ms (+2 %)'],
      ['sans eau', 'déjà désactivé dans ce projet'],
    ])
    expect(layerCostSection([], 'x', true)).toEqual({ title: 'Coût des couches', rows: [['Mesure', 'interrompue avant la fin']] })
  })
})
