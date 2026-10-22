import { describe, expect, it } from 'vitest'
import { mergeByTrack, pruneByTrack } from './byTrack'

const shape = (id: string) => ({ id })

describe('mergeByTrack', () => {
  const byTrack = { a: [shape('w1'), shape('w2')], b: [shape('w2'), shape('w3')], c: [shape('w4')] }

  it('puts the shapes of the tracks together in the order of the tracks, each once', () => {
    expect(mergeByTrack(byTrack, ['a', 'b', 'c']).map((s) => s.id)).toEqual(['w1', 'w2', 'w3', 'w4'])
    expect(mergeByTrack(byTrack, ['c', 'a']).map((s) => s.id)).toEqual(['w4', 'w1', 'w2'])
  })

  it('leaves out a track that was removed, and one that has not answered yet', () => {
    expect(mergeByTrack(byTrack, ['a', 'c']).map((s) => s.id)).toEqual(['w1', 'w2', 'w4'])
    expect(mergeByTrack(byTrack, ['a', 'late']).map((s) => s.id)).toEqual(['w1', 'w2'])
    expect(mergeByTrack(byTrack, [])).toEqual([])
  })
})

describe('pruneByTrack', () => {
  it('forgets the tracks no longer asked for, and returns the same object when nothing goes', () => {
    const byTrack = { a: 1, b: 2 }
    expect(pruneByTrack(byTrack, ['a'])).toEqual({ a: 1 })
    expect(pruneByTrack(byTrack, ['a', 'b', 'c'])).toBe(byTrack)
  })
})
