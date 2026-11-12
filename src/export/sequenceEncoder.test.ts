import { describe, expect, it } from 'vitest'
import type { WritableFile } from '../platform/platform'
import { ExportCanceledError } from './encoder'
import { SEQUENCE_DIGITS, createSequenceEncoder, sequenceFileName, sequencePattern } from './sequenceEncoder'

/** A canvas whose frames are made of their number, and a folder that keeps what is written. */
function fixture() {
  let frame = 0
  const canvas = { convertToBlob: async () => new Blob([new Uint8Array([137, 80, 78, 71, frame++])], { type: 'image/png' }) } as unknown as OffscreenCanvas
  const files = new Map<string, { data: Uint8Array<ArrayBuffer>; closed: boolean; discarded: boolean }>()
  const folder = {
    async createFile(name: string): Promise<WritableFile> {
      const entry = { data: new Uint8Array(0) as Uint8Array<ArrayBuffer>, closed: false, discarded: false }
      files.set(name, entry)
      return {
        fileName: name,
        async write(data, position) {
          expect(position).toBe(0)
          entry.data = data as Uint8Array<ArrayBuffer>
        },
        async close() {
          entry.closed = true
        },
        async discard() {
          entry.discarded = true
        },
      }
    },
  }
  return { canvas, files, folder }
}

describe('image sequence', () => {
  it('names the frames <name>_00001.png, <name>_00002.png…, and gives the pattern', () => {
    expect(sequenceFileName('Tour', 0)).toBe('Tour_00001.png')
    expect(sequenceFileName('Tour', 41)).toBe('Tour_00042.png')
    expect(sequenceFileName('Tour', 99_998)).toBe('Tour_99999.png')
    expect(sequencePattern('Tour')).toBe('Tour_#####.png')
    expect(SEQUENCE_DIGITS).toBe(5)
  })

  it('writes each frame as a PNG in its own file, closed, and counts the bytes', async () => {
    const { canvas, files, folder } = fixture()
    const session = createSequenceEncoder(canvas, folder, 'Tour')
    expect(session.codec).toEqual({ container: 'png', codec: 'png' })
    expect(session.audioCodec).toBeNull()
    expect(session.mimeType).toBe('image/png')
    for (let i = 0; i < 3; i++) await session.addFrame(i)
    expect([...files.keys()]).toEqual(['Tour_00001.png', 'Tour_00002.png', 'Tour_00003.png'])
    expect([...files.values()].every((f) => f.closed && !f.discarded)).toBe(true)
    expect(files.get('Tour_00002.png')?.data).toEqual(new Uint8Array([137, 80, 78, 71, 1]))
    expect(session.written()).toBe(3)
    expect(await session.finish()).toEqual({ blob: null, sizeBytes: 15 })
  })

  it('writes a repeated frame with the same bytes, without encoding it again', async () => {
    let encodes = 0
    const { files, folder } = fixture()
    const canvas = { convertToBlob: async () => new Blob([new Uint8Array([137, 80, 78, 71, ++encodes])], { type: 'image/png' }) } as unknown as OffscreenCanvas
    const session = createSequenceEncoder(canvas, folder, 'Tour')
    await expect(session.repeatFrame!(0)).rejects.toThrow()
    await session.addFrame(0)
    await session.repeatFrame!(1)
    await session.repeatFrame!(2)
    await session.addFrame(3)
    expect(encodes).toBe(2)
    const bytes = (name: string) => [...(files.get(name)?.data ?? [])]
    expect(bytes('Tour_00002.png')).toEqual(bytes('Tour_00001.png'))
    expect(bytes('Tour_00003.png')).toEqual(bytes('Tour_00001.png'))
    expect(bytes('Tour_00004.png')).not.toEqual(bytes('Tour_00001.png'))
    expect(session.written()).toBe(4)
    expect(await session.finish()).toEqual({ blob: null, sizeBytes: 20 })
    await session.cancel()
    await expect(session.repeatFrame!(4)).rejects.toBeInstanceOf(ExportCanceledError)
  })

  it('canceled: the next frame and the end refuse, what was written stays', async () => {
    const { canvas, files, folder } = fixture()
    const session = createSequenceEncoder(canvas, folder, 'Tour')
    await session.addFrame(0)
    await session.cancel()
    await expect(session.addFrame(1)).rejects.toBeInstanceOf(ExportCanceledError)
    await expect(session.finish()).rejects.toBeInstanceOf(ExportCanceledError)
    expect([...files.keys()]).toEqual(['Tour_00001.png'])
    expect(files.get('Tour_00001.png')?.discarded).toBe(false)
  })

  it('a file that cannot be written is removed and the error is passed on', async () => {
    const { canvas } = fixture()
    const discarded: string[] = []
    const folder = {
      async createFile(name: string): Promise<WritableFile> {
        return {
          fileName: name,
          async write() {
            throw new Error('disque plein')
          },
          async close() {},
          async discard() {
            discarded.push(name)
          },
        }
      },
    }
    const session = createSequenceEncoder(canvas, folder, 'Tour')
    await expect(session.addFrame(0)).rejects.toThrow('disque plein')
    expect(discarded).toEqual(['Tour_00001.png'])
  })
})
