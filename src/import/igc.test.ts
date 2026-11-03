import { describe, expect, it } from 'vitest'
import { parseIgc } from './igc'

/** A made-up flight (no real pilot, glider or site): date 15 Sep 2021, LAD / LOD extensions on bytes 36-39. */
const FLIGHT = [
  'AXXX123 Made up logger',
  'HFDTEDATE:150921,01',
  'HFPLTPILOTINCHARGE:Nobody Atall',
  'HFGTYGLIDERTYPE:Ozone Zeno',
  'HFGIDGLIDERID:F-0000',
  'I023637LAD3839LOD',
  'C150921074500150921000101Task',
  'C4553412N00652087ETakeoff',
  'C4554000N00653000EStart',
  'C0000000N00000000EUnused',
  'B1123454553412N00652087EA01850019055678',
  'B1123464553420N00652100EA01852019075680',
  'B1123474553430N00652115EV01855000000000',
  'LXXXsomething ignored',
  'G0123456789ABCDEF',
].join('\n')

describe('parseIgc', () => {
  it('reads the fixes: position with the extra digits of the minutes, UTC time, GNSS altitude', () => {
    const [track] = parseIgc(FLIGHT, 'vol-du-15.igc')
    expect(track.name).toBe('vol-du-15')
    expect(track.segments).toHaveLength(1)
    const [first, second] = track.segments[0].points
    expect(track.segments[0].points).toHaveLength(3)
    // 45° 53.412 56′ N, 6° 52.087 78′ E
    expect(first.lat).toBeCloseTo(45 + 53.41256 / 60, 9)
    expect(first.lon).toBeCloseTo(6 + 52.08778 / 60, 9)
    expect(first.ele).toBe(1905)
    expect(first.time).toBe(Date.UTC(2021, 8, 15, 11, 23, 45))
    expect(second.time).toBe(Date.UTC(2021, 8, 15, 11, 23, 46))
    expect(track.source).toBe('gpx')
    expect(track.stats.pointCount).toBe(3)
  })

  it('takes the pressure altitude of a fix that has no GNSS altitude (validity V)', () => {
    const points = parseIgc(FLIGHT, 'a.igc')[0].segments[0].points
    expect(points[2].ele).toBe(1855)
  })

  it('says paragliding, hang gliding when the glider type says so, and never reads the pilot or the glider identity', () => {
    expect(parseIgc(FLIGHT, 'a.igc')[0].activityType).toBe('paragliding')
    expect(parseIgc(FLIGHT.replace('Ozone Zeno', 'Moyes Litespeed hang glider'), 'a.igc')[0].activityType).toBe('hang gliding')
    expect(parseIgc(FLIGHT.replace(/\nHFGTY[^\n]*/, ''), 'a.igc')[0].activityType).toBe('paragliding')
    const text = JSON.stringify(parseIgc(FLIGHT, 'a.igc'))
    expect(text).not.toMatch(/Nobody|F-0000|Ozone/)
  })

  it('puts the points of the task on the track as waypoints, the declaration and the unused entries left out', () => {
    const [track] = parseIgc(FLIGHT, 'a.igc')
    expect(track.waypoints?.map((w) => w.name)).toEqual(['Takeoff', 'Start'])
    expect(track.waypoints?.[0].lat).toBeCloseTo(45 + 53.412 / 60, 9)
  })

  it('reads a file without extensions, CRLF line ends, southern and western hemispheres', () => {
    const text = ['AXYZ', 'HFDTE010120', 'B0000014530000S07015000WA00100000100'].join('\r\n')
    const [track] = parseIgc(text, 'south.igc')
    const [point] = track.segments[0].points
    expect(point.lat).toBeCloseTo(-45.5, 9)
    expect(point.lon).toBeCloseTo(-70.25, 9)
    expect(point.time).toBe(Date.UTC(2020, 0, 1, 0, 0, 1))
  })

  it('goes on to the next day when the time of the day goes back (a flight across midnight UTC)', () => {
    const text = ['AXYZ', 'HFDTE311221', 'B2359584530000N00600000EA00100000100', 'B0000014530000N00600000EA00100000100', 'B0000024530000N00600000EA00100000100'].join('\n')
    const times = parseIgc(text, 'a.igc')[0].segments[0].points.map((p) => p.time)
    expect(times).toEqual([Date.UTC(2021, 11, 31, 23, 59, 58), Date.UTC(2022, 0, 1, 0, 0, 1), Date.UTC(2022, 0, 1, 0, 0, 2)])
  })

  it('has no time without a date, drops fixes without a position or with an impossible time, keeps the rest', () => {
    const text = ['AXYZ', 'B1200004530000N00600000EA00100000100', 'B1200010000000N00000000EA00100000100', 'B2500004530000N00600000EA00100000100', 'B12000'].join('\n')
    const points = parseIgc(text, 'a.igc')[0].segments[0].points
    expect(points).toHaveLength(1)
    expect(points[0].time).toBeUndefined()
  })

  it('reads the date of the older header, and a year of the nineties', () => {
    expect(parseIgc('AXYZ\nHFDTE150921\nB1000004530000N00600000EA00100000100', 'a.igc')[0].segments[0].points[0].time).toBe(Date.UTC(2021, 8, 15, 10))
    expect(parseIgc('AXYZ\nHFDTE150995\nB1000004530000N00600000EA00100000100', 'a.igc')[0].segments[0].points[0].time).toBe(Date.UTC(1995, 8, 15, 10))
  })

  it('names the problem: not an IGC file, an IGC file without a fix', () => {
    expect(() => parseIgc('', 'a.igc')).toThrow(/IGC/)
    expect(() => parseIgc('<?xml version="1.0"?><gpx/>', 'a.igc')).toThrow(/n'est pas un fichier IGC/)
    expect(() => parseIgc('AXYZ\nHFDTE150921\nG1234', 'a.igc')).toThrow(/aucun point de vol/)
  })
})
