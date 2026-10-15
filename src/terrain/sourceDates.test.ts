import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchTileBlob } from './fetch'
import { formatUpdateDate, ignLayerOf, noteTileLastModified, updateDateNote, useSourceDates } from './sourceDates'
import { getImagerySource } from './sources'

const ORTHO = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&TILEMATRIX=14&TILEROW=5&TILECOL=8'

beforeEach(() => useSourceDates.setState({ dates: {} }))
afterEach(() => vi.unstubAllGlobals())

describe('IGN update dates', () => {
  it('reads the layer of a Géoplateforme URL or template only', () => {
    expect(ignLayerOf(ORTHO)).toBe('ORTHOIMAGERY.ORTHOPHOTOS')
    expect(ignLayerOf(getImagerySource('ign-plan').urlTemplate)).toBe('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2')
    expect(ignLayerOf(getImagerySource('arcgis-world-imagery').urlTemplate)).toBeNull()
    expect(ignLayerOf('https://example.org/wmts?LAYER=ORTHOIMAGERY.ORTHOPHOTOS')).toBeNull()
  })

  it('keeps the most recent Last-Modified per layer, ignores other hosts and bad dates', () => {
    noteTileLastModified(ORTHO, 'Thu, 12 Mar 2026 10:00:00 GMT')
    noteTileLastModified(ORTHO, 'Mon, 02 Feb 2026 10:00:00 GMT')
    noteTileLastModified(ORTHO, 'pas une date')
    noteTileLastModified('https://services.arcgisonline.com/x.jpg', 'Thu, 12 Mar 2026 10:00:00 GMT')
    expect(useSourceDates.getState().dates).toEqual({ 'ORTHOIMAGERY.ORTHOPHOTOS': Date.UTC(2026, 2, 12, 10) })
  })

  it('takes the header of a tile response (mocked: whether IGN sends it is not checked here)', async () => {
    const headers = new Headers({ 'Last-Modified': 'Thu, 12 Mar 2026 23:30:00 GMT' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['x']), { status: 200, headers })))
    await fetchTileBlob(ORTHO)
    expect(updateDateNote(getImagerySource('ign-ortho').urlTemplate, useSourceDates.getState().dates)).toBe(
      'données mises à jour le 12/03/2026',
    )
  })

  it('says when the service sent no date, and nothing for other sources', () => {
    expect(updateDateNote(getImagerySource('ign-ortho').urlTemplate, {})).toBe('date de mise à jour non communiquée par le service')
    expect(updateDateNote(getImagerySource('arcgis-world-imagery').urlTemplate, {})).toBeNull()
    expect(formatUpdateDate(Date.UTC(2026, 0, 5))).toBe('05/01/2026')
  })
})
