import { describe, expect, it } from 'vitest'
import { MODEL_CREDITS, modelCreditsInUse, needsAttribution } from './modelCredits'
import { DEFAULT_MARKER } from './markerSettings'

describe('model credits', () => {
  it('every glTF file of public/models has a credit entry, and every entry has its file', () => {
    const files = Object.keys(import.meta.glob('../../public/models/*.glb')).map((path) => path.replace('../../public/', ''))
    expect(files.sort()).toEqual(MODEL_CREDITS.map((c) => c.file).sort())
  })

  it('names the author, the page and the licence of each model', () => {
    for (const c of MODEL_CREDITS) {
      expect(c.author).not.toBe('')
      expect(c.sourceUrl).toMatch(/^https:\/\//)
      expect(c.licenseUrl).toMatch(/^https:\/\//)
      expect(c.license).toMatch(/^CC/)
    }
  })

  it('asks for the credit of CC BY models only', () => {
    expect(needsAttribution({ license: 'CC BY 3.0' })).toBe(true)
    expect(needsAttribution({ license: 'CC0 1.0' })).toBe(false)
  })

  it('credits the models of the figures in the film, only for a figurine with its 3D model', () => {
    const figurine = { ...DEFAULT_MARKER, kind: 'figurine' as const, model3d: true, figure: 'auto' as const }
    const paragliding = [{ activityType: 'paragliding' as const }]
    expect(modelCreditsInUse(figurine, paragliding).map((c) => c.id)).toEqual(['parachute'])
    expect(modelCreditsInUse(figurine, [{ activityType: 'hiking' as const }]).map((c) => c.id)).toEqual(['adventurer'])
    expect(modelCreditsInUse(figurine, [{ activityType: 'driving' as const }])).toEqual([])
    expect(modelCreditsInUse({ ...figurine, model3d: false }, paragliding)).toEqual([])
    expect(modelCreditsInUse({ ...figurine, figure: 'parapente' }, [])).toHaveLength(1)
  })
})
