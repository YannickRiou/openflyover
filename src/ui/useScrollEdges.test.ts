import { describe, expect, it } from 'vitest'
import { markScrollEdges } from './useScrollEdges'

/** A row 300 px wide holding `content` px, scrolled to `left`. */
function row(content: number, left: number) {
  const marks = new Set<string>()
  const el = {
    scrollLeft: left,
    clientWidth: 300,
    scrollWidth: content,
    toggleAttribute: (name: string, on: boolean) => (on ? marks.add(name) : marks.delete(name), on),
  }
  markScrollEdges(el)
  return [...marks].sort()
}

describe('markScrollEdges', () => {
  it('marks the side where some of the row is hidden, none when it all fits', () => {
    expect(row(300, 0)).toEqual([])
    expect(row(600, 0)).toEqual(['data-more-end'])
    expect(row(600, 150)).toEqual(['data-more-end', 'data-more-start'])
    expect(row(600, 300)).toEqual(['data-more-start'])
  })
})
