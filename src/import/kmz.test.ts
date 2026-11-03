import { describe, expect, it, vi } from 'vitest'
import { parseKmz } from './kmz'

// the zip reading is what is tested here (no DOM needed): the KML parser, tested in kml.test.ts, is replaced by its input
vi.mock('./kml', () => ({ parseKml: (text: string) => [text] }))

const KML = '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Vol</name><LineString><coordinates>6.1,45.1,1000 6.2,45.2,1100</coordinates></LineString></Placemark></Document></kml>'

const u16 = (n: number) => [n & 255, (n >> 8) & 255]
const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]

interface Part {
  name: string
  data: Uint8Array
  /** compressed bytes and method: 0 stored, 8 deflate */
  method: 0 | 8
  size: number
}

/** A zip archive: local headers and data, the central directory, the end record (CRC left at 0: the reader does not check it). */
function zip(parts: Part[], extra: number[] = []): ArrayBuffer {
  const out: number[] = []
  const central: number[] = []
  for (const p of parts) {
    const name = [...new TextEncoder().encode(p.name)]
    const offset = out.length
    out.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(p.method), ...u16(0), ...u16(0), ...u32(0), ...u32(p.data.length), ...u32(p.size), ...u16(name.length), ...u16(0), ...name, ...p.data)
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(p.method), ...u16(0), ...u16(0), ...u32(0), ...u32(p.data.length), ...u32(p.size), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name)
  }
  const start = out.length
  out.push(...central, ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(parts.length), ...u16(parts.length), ...u32(central.length), ...u32(start), ...u16(extra.length), ...extra)
  return new Uint8Array(out).buffer
}

const stored = (name: string, text: string): Part => {
  const data = new TextEncoder().encode(text)
  return { name, data, method: 0, size: data.length }
}

async function deflated(name: string, text: string): Promise<Part> {
  const raw = new TextEncoder().encode(text)
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return { name, data: new Uint8Array(await new Response(stream).arrayBuffer()), method: 8, size: raw.length }
}

describe('parseKmz', () => {
  it('reads the doc.kml of an archive, stored', async () => {
    expect(await parseKmz(zip([stored('images/icon.png', 'png'), stored('doc.kml', KML)]), 'Vol.kmz')).toEqual([KML])
  })

  it('inflates a deflated entry, and takes the first .kml when there is no doc.kml', async () => {
    expect(await parseKmz(zip([await deflated('flight.KML', KML)]), 'x.kmz')).toEqual([KML])
    // doc.kml wins over another .kml
    expect(await parseKmz(zip([stored('other.kml', 'other'), stored('doc.kml', KML)]), 'x.kmz')).toEqual([KML])
  })

  it('finds the end record behind a comment', async () => {
    expect(await parseKmz(zip([stored('doc.kml', KML)], [...new TextEncoder().encode('made by a logger')]), 'x.kmz')).toEqual([KML])
  })

  it('names the problem: not a zip, no KML in it, a method it does not know, an archive too big to read', async () => {
    await expect(parseKmz(new TextEncoder().encode(KML).buffer, 'x.kmz')).rejects.toThrow(/KMZ invalide : ce n'est pas une archive zip/)
    await expect(parseKmz(zip([stored('notes.txt', 'hello')]), 'x.kmz')).rejects.toThrow(/aucun fichier \.kml/)
    await expect(parseKmz(zip([{ ...stored('doc.kml', KML), method: 8 as const, size: 100 * 1024 * 1024 }]), 'x.kmz')).rejects.toThrow(/trop gros/)
    const odd = { ...stored('doc.kml', KML), method: 0 as const }
    const bytes = new Uint8Array(zip([odd]))
    // method 99 in the central directory entry
    bytes[bytes.length - 22 - (46 + 7) + 10] = 99
    await expect(parseKmz(bytes.buffer, 'x.kmz')).rejects.toThrow(/méthode de compression/)
  })
})
