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

describe('mergeByTrack with shapes numbered per corridor', () => {
  const ring = (lon: number): [number, number][] => [[lon, 45], [lon + 0.1, 45], [lon + 0.1, 45.1]]

  it('keeps the sea cells and the river pieces of each corridor, and merges what is the same shape', () => {
    // two corridors both number their first sea cell `sea/0`, and a river crosses both
    const seaA = { id: 'sea/0', outer: ring(6) }
    const seaB = { id: 'sea/0', outer: ring(7) }
    const pieceA = { id: 'way/9#0', points: ring(6) }
    const pieceB = { id: 'way/9#0', points: ring(6.5) }
    const lake = { id: 'way/1', outer: ring(6) }
    const merged = mergeByTrack({ a: [seaA, pieceA, lake], b: [seaB, pieceB, { ...lake }, { ...seaA }] }, ['a', 'b'])
    expect(merged).toEqual([seaA, pieceA, lake, seaB, pieceB])
  })
})

describe('pruneByTrack', () => {
  it('forgets the tracks no longer asked for, and returns the same object when nothing goes', () => {
    const byTrack = { a: 1, b: 2 }
    expect(pruneByTrack(byTrack, ['a'])).toEqual({ a: 1 })
    expect(pruneByTrack(byTrack, ['a', 'b', 'c'])).toBe(byTrack)
  })
})
