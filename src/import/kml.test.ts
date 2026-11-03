// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { parseKml } from './kml'

const wrap = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><name>Sortie du jour</name>${body}</Document></kml>`

const GX_TRACK = wrap(`
  <Placemark><name>Vol de test</name>
    <gx:Track>
      <altitudeMode>absolute</altitudeMode>
      <when>2021-09-15T11:23:45Z</when><when>2021-09-15T11:23:46Z</when><when>2021-09-15T11:23:47Z</when>
      <gx:coord>6.868 45.890 1905</gx:coord><gx:coord>6.869 45.891 1907</gx:coord><gx:coord>6.870 45.892 1909</gx:coord>
    </gx:Track>
  </Placemark>
  <Placemark><name>Décollage</name><Point><coordinates>6.868,45.890,1900</coordinates></Point></Placemark>`)

describe('parseKml', () => {
  it('reads a gx:Track: positions, altitudes and times matched by index, the Point as a waypoint', () => {
    const [track] = parseKml(GX_TRACK, 'x.kml')
    expect(track.name).toBe('Vol de test')
    const points = track.segments[0].points
    expect(points).toHaveLength(3)
    expect(points[0]).toEqual({ lon: 6.868, lat: 45.89, ele: 1905, time: Date.UTC(2021, 8, 15, 11, 23, 45) })
    expect(points[2].time).toBe(Date.UTC(2021, 8, 15, 11, 23, 47))
    expect(track.waypoints).toEqual([{ lon: 6.868, lat: 45.89, ele: 1900, name: 'Décollage' }])
    expect(track.source).toBe('gpx')
  })

  it('reads a LineString: lon,lat,alt triples, no time', () => {
    const [track] = parseKml(wrap('<Placemark><LineString><coordinates>6.1,45.1,1000 6.2,45.2,1100\n6.3,45.3,1200</coordinates></LineString></Placemark>'), 'ligne.kml')
    expect(track.name).toBe('Sortie du jour')
    expect(track.segments[0].points.map((p) => p.lon)).toEqual([6.1, 6.2, 6.3])
    expect(track.segments[0].points[0].time).toBeUndefined()
    expect(track.segments[0].points[2].ele).toBe(1200)
  })

  it('drops altitudes that are not metres above the sea (clamped, relative, or all zero): the app computes them from the relief', () => {
    for (const mode of ['clampToGround', 'relativeToGround']) {
      const [track] = parseKml(wrap(`<Placemark><LineString><altitudeMode>${mode}</altitudeMode><coordinates>6.1,45.1,50 6.2,45.2,60</coordinates></LineString></Placemark>`), 'a.kml')
      expect(track.segments[0].points.every((p) => p.ele === undefined)).toBe(true)
    }
    const flat = parseKml(wrap('<Placemark><LineString><coordinates>6.1,45.1,0 6.2,45.2,0</coordinates></LineString></Placemark>'), 'a.kml')[0]
    expect(flat.segments[0].points.every((p) => p.ele === undefined)).toBe(true)
  })

  it('makes one track of a Placemark with several geometries (segments) and one track per Placemark', () => {
    const body = `<Placemark><name>A</name><MultiGeometry>
        <LineString><coordinates>6.1,45.1,1 6.2,45.2,2</coordinates></LineString>
        <LineString><coordinates>6.3,45.3,3 6.4,45.4,4</coordinates></LineString></MultiGeometry></Placemark>
      <Placemark><LineString><coordinates>7.1,46.1,1 7.2,46.2,2</coordinates></LineString></Placemark>`
    const tracks = parseKml(wrap(body), 'b.kml')
    expect(tracks).toHaveLength(2)
    expect(tracks[0].segments).toHaveLength(2)
    expect(tracks[0].name).toBe('A')
    expect(tracks[1].name).toBe('Sortie du jour (2)')
  })

  it('skips positions that are not valid, keeps the rest', () => {
    const [track] = parseKml(wrap('<Placemark><LineString><coordinates>6.1,45.1,1 abc,def,0 200,45,1 6.2,45.2,2</coordinates></LineString></Placemark>'), 'a.kml')
    expect(track.segments[0].points.map((p) => p.lon)).toEqual([6.1, 6.2])
  })

  it('names the problem: empty, malformed, not a KML, nothing to draw', () => {
    expect(() => parseKml('', 'a.kml')).toThrow(/KML invalide : fichier vide/)
    expect(() => parseKml('<kml><Document>', 'a.kml')).toThrow(/KML invalide : XML mal formé/)
    expect(() => parseKml('<gpx/>', 'a.kml')).toThrow(/n'est pas <kml>/)
    expect(() => parseKml(wrap('<Placemark><name>Rien</name></Placemark>'), 'a.kml')).toThrow(/aucune trace ni ligne/)
  })
})
