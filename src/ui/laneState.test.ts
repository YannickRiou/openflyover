import { describe, expect, it } from 'vitest'
import { NO_LANE_STATE, parseLaneState, toggleLane } from './laneState'

describe('lane state', () => {
  it('reads what was saved, and nothing from what cannot be read', () => {
    expect(parseLaneState(JSON.stringify({ folded: ['texts', 'media'], locked: ['music'] }))).toEqual({ folded: ['texts', 'media'], locked: ['music'] })
    expect(parseLaneState(null)).toBe(NO_LANE_STATE)
    expect(parseLaneState('')).toBe(NO_LANE_STATE)
    expect(parseLaneState('{')).toBe(NO_LANE_STATE)
    expect(parseLaneState('42')).toBe(NO_LANE_STATE)
    expect(parseLaneState('null')).toBe(NO_LANE_STATE)
    expect(parseLaneState(JSON.stringify({ folded: 'texts', locked: [3, null, 'music'] }))).toEqual({ folded: [], locked: ['music'] })
  })

  it('drops repeats and absurd ids, and keeps no more than a few dozen', () => {
    expect(parseLaneState(JSON.stringify({ folded: ['a', 'a', '', 'x'.repeat(41), 'b'] })).folded).toEqual(['a', 'b'])
    const many = Array.from({ length: 100 }, (_, i) => `lane-${i}`)
    expect(parseLaneState(JSON.stringify({ folded: many })).folded).toHaveLength(40)
  })

  it('toggles a lane in one list without touching the other', () => {
    const folded = toggleLane(NO_LANE_STATE, 'folded', 'texts')
    expect(folded).toEqual({ folded: ['texts'], locked: [] })
    const both = toggleLane(folded, 'locked', 'texts')
    expect(both).toEqual({ folded: ['texts'], locked: ['texts'] })
    expect(toggleLane(both, 'folded', 'texts')).toEqual({ folded: [], locked: ['texts'] })
    expect(NO_LANE_STATE).toEqual({ folded: [], locked: [] })
  })
})
