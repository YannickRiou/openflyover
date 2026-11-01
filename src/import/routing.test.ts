import { describe, expect, it, vi } from 'vitest'
import { ignCovers, ignUrl, joinLegs, osmUrl, parseRoute, routeLeg } from './routing'

const A = { lon: 6.8652, lat: 45.8326 }
const B = { lon: 6.88, lat: 45.85 }
const ign = { geometry: { type: 'LineString', coordinates: [[6.83, 45.85], [6.84, 45.86]] }, distance: 1200 }
const osrm = { code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: [[6.9, 45.8], [6.91, 45.81], [6.92, 45.82]] } }] }

describe('parseRoute', () => {
  it('reads the geometry of an IGN answer and of an OSRM answer', () => {
    expect(parseRoute(ign)).toEqual([{ lon: 6.83, lat: 45.85 }, { lon: 6.84, lat: 45.86 }])
    expect(parseRoute(osrm)).toHaveLength(3)
  })

  it('gives null for an error, an empty route or a point out of range', () => {
    expect(parseRoute(null)).toBeNull()
    expect(parseRoute({ error: { message: 'No data found' } })).toBeNull()
    expect(parseRoute({ code: 'NoRoute', routes: [] })).toBeNull()
    expect(parseRoute({ geometry: { coordinates: [[6.8, 45.8]] } })).toBeNull()
    expect(parseRoute({ geometry: { coordinates: [[6.8, 45.8], [6.9, 95]] } })).toBeNull()
  })
})

describe('urls and coverage', () => {
  it('asks the IGN for a pedestrian route and OSRM for the profile', () => {
    expect(ignUrl(A, B)).toContain('profile=pedestrian')
    expect(ignUrl(A, B)).toContain('start=6.865200,45.832600&end=6.880000,45.850000')
    expect(osmUrl('bike', A, B)).toContain('/routed-bike/route/v1/driving/6.865200,45.832600;6.880000,45.850000')
  })

  it('knows where the IGN has data', () => {
    expect(ignCovers(A, B)).toBe(true)
    expect(ignCovers(A, { lon: -122.4, lat: 37.8 })).toBe(false)
  })
})

describe('routeLeg', () => {
  it('walks in France through the IGN first', async () => {
    const fetchJson = vi.fn().mockResolvedValue(ign)
    expect(await routeLeg(A, B, 'foot', fetchJson)).toHaveLength(2)
    expect(fetchJson).toHaveBeenCalledTimes(1)
    expect(fetchJson.mock.calls[0][0]).toContain('data.geopf.fr')
  })

  it('falls back to OpenStreetMap when the IGN fails or has no route', async () => {
    const fetchJson = vi.fn().mockRejectedValueOnce(new Error('HTTP 400')).mockResolvedValueOnce(osrm)
    expect(await routeLeg(A, B, 'foot', fetchJson)).toHaveLength(3)
    expect(fetchJson.mock.calls[1][0]).toContain('routed-foot')
  })

  it('uses OpenStreetMap only for a bike and outside the IGN box', async () => {
    const fetchJson = vi.fn().mockResolvedValue(osrm)
    await routeLeg(A, B, 'bike', fetchJson)
    await routeLeg({ lon: -122.4, lat: 37.8 }, { lon: -122.41, lat: 37.81 }, 'foot', fetchJson)
    expect(fetchJson.mock.calls.every(([url]) => String(url).includes('routing.openstreetmap.de'))).toBe(true)
  })

  it('gives null when no service finds a route', async () => {
    expect(await routeLeg(A, B, 'foot', vi.fn().mockRejectedValue(new Error('offline')))).toBeNull()
  })

  it('lets an abort through', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(routeLeg(A, B, 'bike', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')), controller.signal)).rejects.toThrow()
  })
})

describe('joinLegs', () => {
  const C = { lon: 6.9, lat: 45.87 }

  it('joins the routed legs and keeps a repeated junction once', () => {
    const first = [A, { lon: 6.87, lat: 45.84 }, B]
    const second = [B, { lon: 6.89, lat: 45.86 }, C]
    expect(joinLegs([A, B, C], [first, second])).toEqual([A, { lon: 6.87, lat: 45.84 }, B, { lon: 6.89, lat: 45.86 }, C])
  })

  it('draws a straight line for a leg without route', () => {
    expect(joinLegs([A, B], [null])).toEqual([A, B])
  })

  it('keeps a lone point, and gives nothing for no point', () => {
    expect(joinLegs([A], [])).toEqual([A])
    expect(joinLegs([], [])).toEqual([])
  })
})
