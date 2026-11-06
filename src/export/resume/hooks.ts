/**
 * The hook of `createVideoEncoder` for a resumable export (`ResumeHooks`): keeps the packets as they come out of the
 * encoder, and hands the packets of a stored export to the muxer. Built by the export (session.ts), so that the
 * encoder, which is in the first screen, carries none of it.
 */
import { loadConfig, storeConfig, type ResumeHooks, type StoredConfig, type StoredPacket } from './resume'

export interface HookInputs {
  /** a stored export to continue */
  prior?: { config: StoredConfig; packets: () => AsyncIterable<StoredPacket> }
  /** each packet kept (the recorder's `push`) */
  onPacket(packet: StoredPacket, config?: StoredConfig): void
}

type Packet = import('mediabunny').EncodedPacket
type PacketMeta = { decoderConfig?: Parameters<typeof storeConfig>[0] } | undefined
/** What is read of mediabunny's encoder wrapper (not public API, as `counters` in encoder.ts): a change of it means no persistence. */
interface Wrapper {
  encodingConfig: { onEncodedPacket?: (packet: Packet, meta: PacketMeta) => unknown }
}

export function encoderHooks({ prior, onPacket }: HookInputs): ResumeHooks {
  return {
    async attach(source) {
      const { EncodedPacket, EncodedVideoPacketSource } = await import('mediabunny')
      // each packet the encoder makes goes to the recorder as well as to the muxer
      const config = (source as unknown as { _encoder?: Wrapper })._encoder?.encodingConfig
      const counted = config?.onEncodedPacket
      if (config) {
        config.onEncodedPacket = (packet, meta) => {
          counted?.(packet, meta)
          try {
            onPacket({ key: packet.type === 'key', timestamp: packet.timestamp, duration: packet.duration, data: packet.data }, meta?.decoderConfig && storeConfig(meta.decoderConfig))
          } catch {
            // keeping the packets is a bonus: never at the film's expense
          }
        }
      }
      if (!prior) return
      try {
        // `EncodedVideoPacketSource.add` only needs the track the source is connected to (mux.test.ts runs it on mediabunny)
        const add = EncodedVideoPacketSource.prototype.add as (this: unknown, packet: Packet, meta?: EncodedVideoChunkMetadata) => Promise<void>
        let first = true
        for await (const p of prior.packets()) {
          const meta = first ? ({ decoderConfig: loadConfig(prior.config) } as EncodedVideoChunkMetadata) : undefined
          first = false
          await add.call(source, new EncodedPacket(p.data, p.key ? 'key' : 'delta', p.timestamp, p.duration), meta)
        }
      } catch (error) {
        // mediabunny's track of the source, as `add` takes it: the output is dropped, nothing of the film is kept
        await (source as unknown as { _connectedTrack?: { output: { cancel(): Promise<void> } } })._connectedTrack?.output.cancel().catch(() => undefined)
        throw error
      }
    },
  }
}
