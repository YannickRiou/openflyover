// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BufferSource, BufferTarget, EncodedPacket, EncodedVideoPacketSource, EncodedPacketSink, Input, Output, VideoSampleSource, WebMOutputFormat, ALL_FORMATS } from 'mediabunny'

/**
 * The resume hands stored packets to a track whose source is a `VideoSampleSource` (the encoder's), through
 * `EncodedVideoPacketSource.prototype.add` (`createVideoEncoder`): this runs it on mediabunny itself, with a muxer.
 */
describe('stored packets in the track of a sample source', () => {
  it('are muxed in order with the packets that follow', async () => {
    const target = new BufferTarget()
    const output = new Output({ format: new WebMOutputFormat(), target })
    const source = new VideoSampleSource({ codec: 'vp8', bitrate: 1_000_000 })
    output.addVideoTrack(source, { frameRate: 24 })
    await output.start()
    const add = EncodedVideoPacketSource.prototype.add as unknown as (this: unknown, p: EncodedPacket, meta?: unknown) => Promise<void>
    const packet = (f: number) => new EncodedPacket(new Uint8Array([f, 1, 2, 3]), f % 4 === 0 ? 'key' : 'delta', f / 24, 1 / 24)
    const config = { decoderConfig: { codec: 'vp8', codedWidth: 64, codedHeight: 64 } }
    // frames 0 to 11 stored, then frames 12 to 19 from the resumed encoder (its first is a key frame)
    for (let f = 0; f < 12; f++) await add.call(source, packet(f), f === 0 ? config : undefined)
    for (let f = 12; f < 20; f++) await add.call(source, packet(f), f === 12 ? config : undefined)
    await output.finalize()

    const input = new Input({ source: new BufferSource(target.buffer!), formats: ALL_FORMATS })
    const track = await input.getPrimaryVideoTrack()
    const times: number[] = []
    for await (const p of new EncodedPacketSink(track!).packets()) times.push(Math.round(p.timestamp * 24))
    expect(times).toEqual(Array.from({ length: 20 }, (_, i) => i))
  })
})
