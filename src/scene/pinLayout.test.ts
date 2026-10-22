import { describe, expect, it } from 'vitest'
import { MAX_PIN_LEVELS, PIN_STACK_GAP_PX, layoutPins, type PinBox } from './pinLayout'

const box = (id: string, x: number, priority = 0, lit = false): PinBox => ({ id, x, y: 300, w: 100, h: 70, postPx: 26, lit, priority })

describe('layoutPins', () => {
  it('leaves pins apart where they are', () => {
    expect([...layoutPins([box('a', 100), box('b', 400)], []).values()]).toEqual([0, 0])
  })
  it('stacks a pin over the one that holds the place instead of hiding it', () => {
    const out = layoutPins([box('a', 100, 2), box('b', 130, 1)], [])
    expect(out.get('a')).toBe(0)
    expect(out.get('b')).toBe(70 + PIN_STACK_GAP_PX)
  })
  it('serves the lit pin first, whatever the others', () => {
    const out = layoutPins([box('a', 100, 9), box('b', 120, 0, true)], [])
    expect(out.get('b')).toBe(0)
    expect(out.get('a')).toBeGreaterThan(0)
  })
  it('lifts a pin over a 3D label, and keeps a lit pin over it', () => {
    const label = { left: 60, right: 180, top: 200, bottom: 240 }
    expect(layoutPins([box('a', 100)], [label]).get('a')).toBeGreaterThan(0)
    expect(layoutPins([box('a', 100, 0, true)], [label]).get('a')).toBe(0)
  })
  it('keeps a pin on the screen: it stays under a label it cannot clear rather than rise out of the frame', () => {
    const wall = { left: 0, right: 400, top: -1000, bottom: 400 }
    expect(layoutPins([box('a', 100)], [wall]).get('a')).toBe(0)
    const label = { left: 60, right: 180, top: 200, bottom: 240 }
    expect(layoutPins([box('a', 100)], [label], 150).get('a')).toBe(0)
  })
  it('leaves out a pin with no free place', () => {
    const crowd = Array.from({ length: MAX_PIN_LEVELS + 2 }, (_, i) => box(`p${i}`, 100, 100 - i))
    const out = layoutPins(crowd, [], -Infinity)
    expect([...out.values()].filter((v) => v === null)).toHaveLength(1)
    expect(out.get(`p${MAX_PIN_LEVELS + 1}`)).toBeNull()
  })
  it('lays out the same whatever the order of the pins', () => {
    const boxes = [box('a', 100, 3), box('b', 120, 2), box('c', 140, 1)]
    expect(layoutPins([...boxes].reverse(), []).get('c')).toBe(layoutPins(boxes, []).get('c'))
  })
})
