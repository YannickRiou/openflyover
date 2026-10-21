import { afterEach, describe, expect, it, vi } from 'vitest'
import { datedImagerySource, findImageryDates, imageryDateKind, imageryDateValue, isImageryDate, tileAt } from './imageryDates'
import { buildTileUrl, getImagerySource } from './sources'

const ign = getImagerySource('ign-ortho')
const esri = getImagerySource('arcgis-world-imagery')

describe('« Date des photos »: the setting', () => {
  it('is a year of IGN or a release of Esri, ignored by the other sources', () => {
    expect(imageryDateKind('ign-ortho')).toBe('ign')
    expect(imageryDateKind('arcgis-world-imagery')).toBe('esri')
    expect(imageryDateKind('swisstopo')).toBeNull()
    expect(imageryDateValue('ign:2020', 'ign')).toBe(2020)
    expect(imageryDateValue('ign:2020', 'esri')).toBeNull()
    expect(imageryDateValue('', 'ign')).toBeNull()
    expect(['', 'ign:2020', 'esri:17632'].every(isImageryDate)).toBe(true)
    expect(['ign:20', 'esri:', 'swisstopo:2020', 3].some(isImageryDate)).toBe(false)
  })

  it('switches the IGN layer to the year, the latest photos where the year is blank', () => {
    const dated = datedImagerySource(ign, 'ign:2020')
    expect(dated.id).toBe('ign-ortho@ign:2020')
    expect(buildTileUrl(dated, { z: 13, x: 4204, y: 2943 })).toContain('LAYER=ORTHOIMAGERY.ORTHOPHOTOS2020&')
    expect(dated.fallback).toBe(ign)
    // the latest, or a date of the other kind: the source itself
    expect(datedImagerySource(ign, '')).toBe(ign)
    expect(datedImagerySource(ign, 'esri:17632')).toBe(ign)
  })

  it('reads an Esri release from the Wayback archive', () => {
    const dated = datedImagerySource(esri, 'esri:17632')
    expect(buildTileUrl(dated, { z: 15, x: 17009, y: 11722 })).toBe(
      'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/17632/15/11722/17009',
    )
    expect(dated.fallback).toBeUndefined()
    expect(datedImagerySource(esri, 'ign:2020')).toBe(esri)
  })

  it('probes the Web Mercator tile under the place', () => {
    expect(tileAt({ lon: 6.87, lat: 45.92 }, 15)).toEqual({ z: 15, x: 17009, y: 11668 })
  })
})

describe('the Esri versions at a place', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('walks back from the newest release by the ones the tile changed in, with the day each photo was taken', async () => {
    // releases 30 (newest) → 10 (oldest); here the tile changed in 30, 20 (re-published by 25) and 10
    const config = {
      '10': { itemTitle: 'World Imagery (Wayback 2014-02-20)', metadataLayerUrl: 'https://meta.test/r10' },
      '20': { itemTitle: 'World Imagery (Wayback 2019-10-30)', metadataLayerUrl: 'https://meta.test/r20' },
      '25': { itemTitle: 'World Imagery (Wayback 2021-06-30)', metadataLayerUrl: 'https://meta.test/r25' },
      '30': { itemTitle: 'World Imagery (Wayback 2024-03-07)', metadataLayerUrl: 'https://meta.test/r30' },
    }
    const select: Record<string, number> = { '30': 30, '25': 20, '20': 20, '10': 10 }
    const taken: Record<string, number | null> = { r30: Date.UTC(2023, 7, 4), r20: Date.UTC(2019, 1, 12), r10: null }
    const requests: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      requests.push(url)
      const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
      if (url.endsWith('waybackconfig.json')) return json(config)
      const tilemap = /tilemap\/(\d+)\//.exec(url)
      if (tilemap) return json({ data: [1], select: [select[tilemap[1]]] })
      const meta = /meta\.test\/(r\d+)\//.exec(url)
      return json({ features: [{ attributes: { SRC_DATE2: meta ? taken[meta[1]] : null } }] })
    })
    const dates = await findImageryDates(esri, { lon: 6.87, lat: 45.92 })
    expect(dates.map((d) => d.value)).toEqual(['esri:30', 'esri:20', 'esri:10'])
    expect(dates.map((d) => d.taken)).toEqual([true, true, false])
    expect(dates[0].timeMs).toBe(Date.UTC(2023, 7, 4))
    // without metadata: the release date
    expect(dates[2].timeMs).toBe(Date.parse('2014-02-20'))
    // one tilemap request per version (25 is skipped), then one metadata query each
    expect(requests.filter((u) => u.includes('/tilemap/'))).toHaveLength(3)
    // kept for the session: no request the second time
    await findImageryDates(esri, { lon: 6.87, lat: 45.92 })
    expect(requests).toHaveLength(1 + 3 + 3)
  })
})
