import { describe, expect, it } from 'vitest'
import { MAX_SUMMITS, SUMMIT_RADIUS_M, parseSummits, summitLabels, summitQuery } from './summits'

const peak = (id: number, tags: Record<string, string>, lat = 45, lon = 6) => ({ type: 'node', id, lat, lon, tags: { natural: 'peak', ...tags } })

describe('summitQuery', () => {
  it('asks for the named peaks around a point rounded to 0.02°', () => {
    const q = summitQuery(6.1234, 45.4321)
    expect(q).toContain('node["natural"="peak"]["name"]')
    expect(q).toContain(`around:${SUMMIT_RADIUS_M},45.44,6.12`)
  })
  it('gives two stops next to each other the same query', () => {
    expect(summitQuery(6.1201, 45.4401)).toBe(summitQuery(6.1298, 45.4399))
  })
})

describe('parseSummits', () => {
  it('keeps the named peaks, highest first, unknown heights last', () => {
    const out = parseSummits({ elements: [peak(1, { name: 'Bas', ele: '1200' }), peak(2, { name: 'Sans hauteur' }), peak(3, { name: 'Haut', ele: '3100' }), peak(4, { ele: '4000' })] })
    expect(out.map((s) => s.name)).toEqual(['Haut', 'Bas', 'Sans hauteur'])
    expect(out[0]).toMatchObject({ id: 'node/3', ele: 3100 })
  })
  it('prefers the French name', () => {
    expect(parseSummits({ elements: [peak(1, { name: 'Mont', 'name:fr': 'Mont Blanc' })] })[0].name).toBe('Mont Blanc')
  })
  it('keeps at most MAX_SUMMITS', () => {
    const elements = Array.from({ length: MAX_SUMMITS + 10 }, (_, i) => peak(i, { name: `P${i}`, ele: String(1000 + i) }))
    expect(parseSummits({ elements })).toHaveLength(MAX_SUMMITS)
  })
  it('throws on a server-side error', () => {
    expect(() => parseSummits({ remark: 'runtime error: timeout' })).toThrow()
  })
})

describe('summitLabels', () => {
  const summits = parseSummits({ elements: [peak(1, { name: 'Haut', ele: '3100' }), peak(2, { name: 'Bas', ele: '900' })] })
  it('words the height and ranks the highest first', () => {
    const labels = summitLabels(summits)
    expect(labels.map((l) => l.id)).toEqual(['summit:node/1', 'summit:node/2'])
    expect(labels[0].text).toMatch(/^Haut · 3.?100 m$/)
    expect(labels[0].priority).toBeGreaterThan(labels[1].priority)
    expect(labels.every((l) => l.kind === 'peak')).toBe(true)
  })
  it('leaves out the summits the landmarks name already', () => {
    expect(summitLabels(summits, new Set(['osm:node/1'])).map((l) => l.id)).toEqual(['summit:node/2'])
  })
})
