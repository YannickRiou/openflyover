import { describe, expect, it } from 'vitest'
import {
  FILE_VERSION_GZIP,
  FILE_VERSION_PLAIN,
  PROJECT_EXTENSION,
  PROJECT_MIME_TYPE,
  PROJECT_SIGNATURE,
  decodeProjectFile,
  encodeProjectFile,
} from './file'

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())
const ascii = (bytes: Uint8Array) => String.fromCharCode(...bytes)
const asBlob = (...parts: BlobPart[]) => new Blob(parts)

describe('project file constants', () => {
  it('names the extension, the type and the signature', () => {
    expect(PROJECT_EXTENSION).toBe('opnflvr')
    expect(PROJECT_MIME_TYPE).toBe('application/x-opnflvr')
    expect(PROJECT_SIGNATURE).toBe('OPNFLVR')
  })
})

describe('encodeProjectFile / decodeProjectFile', () => {
  const json = JSON.stringify({ format: 'openflyover-project', name: 'Tour é€ 😀', tracks: [] }, null, 2)

  it('writes the signature, the version byte, then a gzip stream', async () => {
    const file = await encodeProjectFile(json)
    const bytes = await bytesOf(file)
    expect(file.type).toBe(PROJECT_MIME_TYPE)
    expect(ascii(bytes.subarray(0, 7))).toBe('OPNFLVR')
    expect(bytes[7]).toBe(FILE_VERSION_GZIP)
    expect([bytes[8], bytes[9]]).toEqual([0x1f, 0x8b])
  })

  it('round-trips the exact text, accents and astral characters included', async () => {
    expect(await decodeProjectFile(await encodeProjectFile(json))).toBe(json)
  })

  it('round-trips a big text and compresses it', async () => {
    const big = JSON.stringify({ format: 'openflyover-project', tracks: Array.from({ length: 60000 }, (_, i) => ({ id: `t${i}`, name: 'Étape 😀 '.repeat(8) })) })
    expect(big.length).toBeGreaterThan(3 * (1 << 20))
    const file = await encodeProjectFile(big)
    expect(file.size).toBeLessThan(big.length / 4)
    expect(await decodeProjectFile(file)).toBe(big)
  })

  it('never splits a surrogate pair between two chunks', async () => {
    const text = `{"a":"${'x'.repeat((1 << 20) - 6)}😀😀😀"}`
    expect(await decodeProjectFile(await encodeProjectFile(text))).toBe(text)
  })

  it('stores the text as is, flagged, where there is no CompressionStream', async () => {
    const file = await encodeProjectFile(json, {})
    const bytes = await bytesOf(file)
    expect(bytes[7]).toBe(FILE_VERSION_PLAIN)
    expect(new TextDecoder().decode(bytes.subarray(8))).toBe(json)
    expect(await decodeProjectFile(file)).toBe(json)
    expect(await decodeProjectFile(file, {})).toBe(json)
  })

  it('says so when a compressed project meets a reader without DecompressionStream', async () => {
    await expect(decodeProjectFile(await encodeProjectFile(json), {})).rejects.toThrow('ne sait pas décompresser')
  })

  it('still reads an old project: plain JSON text, with or without a byte order mark or leading blanks', async () => {
    expect(await decodeProjectFile(asBlob(json))).toBe(json)
    // Blob.text() drops the byte order mark
    expect(await decodeProjectFile(asBlob('\uFEFF', json))).toBe(json)
    expect(await decodeProjectFile(asBlob('\n  ', json))).toBe(`\n  ${json}`)
  })

  it('refuses an empty file', async () => {
    await expect(decodeProjectFile(asBlob())).rejects.toThrow('Le fichier est vide.')
  })

  it('refuses a file that is neither a signed project nor JSON, whatever its name', async () => {
    await expect(decodeProjectFile(asBlob('OPNFLVX\u0001abc'))).rejects.toThrow("Ce n'est pas un projet OpenFlyover")
    await expect(decodeProjectFile(asBlob('<gpx/>'))).rejects.toThrow("Ce n'est pas un projet OpenFlyover")
    await expect(decodeProjectFile(asBlob(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3])))).rejects.toThrow("Ce n'est pas un projet OpenFlyover")
    // shorter than the header
    await expect(decodeProjectFile(asBlob('OPNFL'))).rejects.toThrow("Ce n'est pas un projet OpenFlyover")
  })

  it('refuses a version it does not know, asking to update', async () => {
    const future = asBlob('OPNFLVR', new Uint8Array([9]), 'x')
    await expect(decodeProjectFile(future)).rejects.toThrow('version plus récente')
  })

  it('refuses corrupt or truncated compressed data', async () => {
    const bytes = await bytesOf(await encodeProjectFile(json))
    const garbage = asBlob(bytes.subarray(0, 8), new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))
    await expect(decodeProjectFile(garbage)).rejects.toThrow('endommagé')
    const truncated = asBlob(bytes.subarray(0, bytes.length - 12))
    await expect(decodeProjectFile(truncated)).rejects.toThrow('endommagé')
    const header = asBlob(bytes.subarray(0, 8))
    await expect(decodeProjectFile(header)).rejects.toThrow('endommagé')
  })
})
