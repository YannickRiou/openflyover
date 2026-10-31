import { Box3, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { MARKER_FIGURES, DEFAULT_MARKER, figureStride, isValidMarker } from './markerSettings'
import type { FigureClock } from './markerSettings'
import { createMarkerModel, disposeMarkerModel, hasMarkerModel, joint, standModel } from './markerModels'

const clock = { totalTime: () => 10, progressAtTime: (t: number) => Math.min(Math.max(t / 10, 0), 1) } as FigureClock

describe('joint', () => {
  it('keeps both bones at their length', () => {
    const j = joint(new Vector3(0, 1, 0), new Vector3(0, 0.4, 0.2), 0.43, 0.43, new Vector3(0, 0, 1), new Vector3())
    expect(j.distanceTo(new Vector3(0, 1, 0))).toBeCloseTo(0.43, 3)
    expect(j.distanceTo(new Vector3(0, 0.4, 0.2))).toBeCloseTo(0.43, 3)
  })
  it('bends towards the given side', () => {
    expect(joint(new Vector3(0, 1, 0), new Vector3(0, 0.4, 0), 0.43, 0.43, new Vector3(0, 0, 1), new Vector3()).z).toBeGreaterThan(0)
  })
})

describe('markerModels', () => {
  it('builds a model for each figure that has one', () => {
    const owners = MARKER_FIGURES.filter(hasMarkerModel)
    expect(owners).toHaveLength(MARKER_FIGURES.length)
    for (const figure of owners) {
      const model = createMarkerModel(figure)!
      model.root.updateMatrixWorld(true)
      const size = new Box3().setFromObject(model.root).getSize(new Vector3())
      // every model is of the size of a person, a bicycle, a horse or a plane: between 0.8 and 4 units in its longest side
      expect(Math.max(size.x, size.y, size.z)).toBeGreaterThan(0.8)
      expect(Math.max(size.x, size.y, size.z)).toBeLessThan(4)
      disposeMarkerModel(model)
    }
  })
  it('returns null for a figure without a model', () => {
    for (const figure of MARKER_FIGURES.filter((f) => !hasMarkerModel(f))) expect(createMarkerModel(figure)).toBeNull()
  })
  it('poses the same way for the same phase', () => {
    const model = createMarkerModel('cycliste')!
    const box = () => new Box3().setFromObject(model.root).min.toArray().join()
    model.pose(1.2)
    const first = box()
    model.pose(3)
    model.pose(1.2)
    expect(box()).toBe(first)
  })
  it('stands on its point and faces the track', () => {
    const model = createMarkerModel('cycliste')!
    standModel(model, new Vector3(5, 2, 3), new Vector3(1, 0, 0), 3.4)
    expect(model.root.position.toArray()).toEqual([5, 2, 3])
    expect(model.root.scale.x).toBeCloseTo(2, 5)
    expect(new Vector3(0, 0, 1).applyQuaternion(model.root.quaternion).x).toBeCloseTo(1, 5)
  })
})

describe('figureStride', () => {
  it('starts at zero and never goes back', () => {
    expect(figureStride(clock, 0)).toBe(0)
    let last = 0
    for (let t = 0; t <= 10; t += 0.25) {
      const phase = figureStride(clock, t)
      expect(phase).toBeGreaterThanOrEqual(last)
      last = phase
    }
  })
})

describe('model3d setting', () => {
  it('is off by default and validated', () => {
    expect(DEFAULT_MARKER.model3d).toBe(false)
    expect(isValidMarker({ ...DEFAULT_MARKER, model3d: true })).toBe(true)
    expect(isValidMarker({ ...DEFAULT_MARKER, model3d: 'yes' })).toBe(false)
  })
})
