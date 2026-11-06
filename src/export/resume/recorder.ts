/**
 * Keeps the packets of an export as they come out of the encoder: one chunk per GOP, written when the next key frame
 * arrives, then the manifest says how many frames are kept. Each write is after the one before it, so what the manifest
 * announces is always on disk. At the first write error (quota, storage gone) or packets that are not one per frame in
 * order, the recorder gives up, deletes what it kept and the export goes on without persistence.
 */
import { MANIFEST_VERSION, encodeChunk, frameOf, type ResumeExpectation, type ResumeManifest, type StoredConfig, type StoredPacket } from './resume'
import type { ResumeStorage } from './storage'

export interface Recorder {
  /** the container and codec the encoder picked (known once it exists) */
  setCodec(container: string, codec: string): void
  /** a packet out of the encoder, with the decoder configuration it came with (the first ones) */
  push(packet: StoredPacket, config?: StoredConfig): void
  /** resolves when what was handed over is written */
  settle(): Promise<void>
  /** delete everything kept: the export ended, or was given up */
  discard(): Promise<void>
  /** still recording (false after a failure) */
  readonly active: boolean
}

export interface RecorderOptions {
  storage: ResumeStorage
  job: ResumeExpectation & { name: string }
  /** the stored export this one continues (its chunks stay, the new ones follow) */
  from?: ResumeManifest
  now?: () => number
  onGiveUp?: (error: unknown) => void
}

export function createRecorder({ storage, job, from, now = Date.now, onGiveUp }: RecorderOptions): Recorder {
  let active = true
  let container = from?.container ?? ''
  let codec = from?.codec ?? ''
  let config: StoredConfig | null = from?.config ?? null
  let gop: StoredPacket[] = []
  let frames = from?.frames ?? 0
  /** frame the next packet must be */
  let next = frames
  let chunks = from?.chunks ?? 0
  /** chunk index of the next GOP handed over (`chunks` counts those written) */
  let nextChunk = chunks
  let bytes = from?.bytes ?? 0
  const createdAt = from?.createdAt ?? now()
  /** writes, one after the other */
  let chain: Promise<void> = Promise.resolve()

  const giveUp = (error: unknown) => {
    if (!active) return
    active = false
    gop = []
    chain = chain.then(() => storage.clear().catch(() => undefined))
    onGiveUp?.(error)
  }

  const flush = () => {
    const packets = gop
    gop = []
    if (packets.length === 0) return
    if (config === null || container === '') return giveUp(new Error('resume: no decoder configuration'))
    const index = nextChunk++
    const data = encodeChunk(packets)
    const stored = config
    chain = chain.then(async () => {
      if (!active) return
      try {
        await storage.writeChunk(index, data)
        chunks = index + 1
        frames += packets.length
        bytes += data.length
        await storage.writeManifest({
          version: MANIFEST_VERSION,
          key: job.key,
          width: job.width,
          height: job.height,
          fps: job.fps,
          frameCount: job.frameCount,
          name: job.name,
          container,
          codec,
          config: stored,
          frames,
          chunks,
          bytes,
          createdAt,
          updatedAt: now(),
        })
      } catch (error) {
        giveUp(error)
      }
    })
  }

  return {
    setCodec(c, k) {
      container = c
      codec = k
    },
    push(packet, packetConfig) {
      if (!active) return
      if (packetConfig && config === null) config = packetConfig
      if (packet.key && gop.length > 0) flush()
      // a GOP starts on a key frame and has one packet per frame, in order (no frame reordering)
      if ((gop.length === 0 && !packet.key) || frameOf(packet, job.fps) !== next) return giveUp(new Error('resume: packets out of order'))
      gop.push(packet)
      next++
    },
    async settle() {
      // a failure adds the deletion to the chain meanwhile
      for (let seen = chain; ; seen = chain) {
        await seen
        if (seen === chain) return
      }
    },
    async discard() {
      active = false
      gop = []
      await this.settle()
      await storage.clear().catch(() => undefined)
    },
    get active() {
      return active
    },
  }
}
