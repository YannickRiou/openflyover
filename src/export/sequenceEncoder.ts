/**
 * An image sequence in place of a video (« Séquence d'images »): every frame of the film is written as a numbered PNG
 * in a folder the user picked (`<name>_00001.png`, `<name>_00002.png`…), for an editor or a compositor that wants the
 * frames. It plays the part of a `VideoEncodeSession` so that the export loop is the same; no sound, no holds, the frames
 * are written as they are rendered.
 */
import type { WritableFolder } from '../platform/folder'
import { ExportCanceledError, type VideoEncodeSession } from './encoder'
import { videoFileName } from './store'

/** Digits of the frame number (99,999 frames: more than an hour at 24 images a second). */
export const SEQUENCE_DIGITS = 5

/** The name of the film made safe for a file system, as for a video (« Tour 10/12 » is « Tour 10-12 »). */
const safeBaseName = (baseName: string) => videoFileName(baseName, '')

/** `<name>_00001.png` for frame `index` (0 for the first); the name has no character a file system rejects. */
export function sequenceFileName(baseName: string, index: number): string {
  return `${safeBaseName(baseName)}_${String(index + 1).padStart(SEQUENCE_DIGITS, '0')}.png`
}

/** The pattern a compositor is given for the sequence: `<name>_#####.png`. */
export const sequencePattern = (baseName: string) => `${safeBaseName(baseName)}_${'#'.repeat(SEQUENCE_DIGITS)}.png`

export function createSequenceEncoder(canvas: OffscreenCanvas, folder: Pick<WritableFolder, 'createFile'>, baseName: string): VideoEncodeSession & { readonly written: () => number } {
  let canceled = false
  let count = 0
  let bytes = 0
  /** the PNG of the last frame added, for the frames that repeat it (holds): written again, not encoded again */
  let last: Uint8Array | null = null
  async function writeFrame(index: number, data: Uint8Array): Promise<void> {
    const file = await folder.createFile(sequenceFileName(baseName, index))
    try {
      await file.write(data, 0)
      await file.close()
      bytes += data.length
      count++
    } catch (error) {
      await file.discard().catch(() => undefined)
      throw error
    }
  }
  return {
    codec: { container: 'png', codec: 'png' },
    audioCodec: null,
    bitrate: 0,
    mimeType: 'image/png',
    extension: '.png',
    written: () => count,
    async addFrame(index) {
      if (canceled) throw new ExportCanceledError()
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      if (canceled) throw new ExportCanceledError()
      const data = new Uint8Array(await blob.arrayBuffer())
      last = null // not a repeat of the previous one if this write fails
      await writeFrame(index, data)
      last = data
    },
    async repeatFrame(index) {
      if (canceled) throw new ExportCanceledError()
      if (!last) throw new Error('No frame to repeat.')
      await writeFrame(index, last)
    },
    async finish() {
      if (canceled) throw new ExportCanceledError()
      return { blob: null, sizeBytes: bytes }
    },
    async cancel() {
      // the images already written stay in the folder: a folder gives no way to remove a file once it is closed
      canceled = true
    },
    counters: () => ({ inFlight: 0 }),
  }
}
