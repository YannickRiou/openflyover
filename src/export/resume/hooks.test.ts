import { describe, expect, it, vi } from 'vitest'
import type { VideoSampleSource } from 'mediabunny'
import { encoderHooks } from './hooks'

describe('encoderHooks', () => {
  it('hands each packet to the recorder as well as to the callback already there', async () => {
    const counted = vi.fn()
    const encodingConfig: { onEncodedPacket?: (packet: unknown, meta: unknown) => void } = { onEncodedPacket: counted }
    const source = { _encoder: { encodingConfig } } as unknown as VideoSampleSource
    const kept = vi.fn()
    await encoderHooks({ onPacket: kept }).attach(source)
    const packet = { type: 'key', timestamp: 0.5, duration: 0.25, data: new Uint8Array([1]) }
    encodingConfig.onEncodedPacket?.(packet, { decoderConfig: { codec: 'vp8', codedWidth: 8, codedHeight: 8 } })
    expect(counted).toHaveBeenCalledOnce()
    expect(kept).toHaveBeenCalledWith({ key: true, timestamp: 0.5, duration: 0.25, data: packet.data }, { codec: 'vp8', codedWidth: 8, codedHeight: 8 })
  })

  it('never lets the recorder break the film', async () => {
    const encodingConfig: { onEncodedPacket?: (packet: unknown, meta: unknown) => void } = {}
    const source = { _encoder: { encodingConfig } } as unknown as VideoSampleSource
    await encoderHooks({
      onPacket: () => {
        throw new Error('storage gone')
      },
    }).attach(source)
    expect(() => encodingConfig.onEncodedPacket?.({ type: 'delta', timestamp: 0, duration: 1, data: new Uint8Array() }, undefined)).not.toThrow()
  })

  it('does nothing where the encoder is not the one expected', async () => {
    await expect(encoderHooks({ onPacket: vi.fn() }).attach({} as VideoSampleSource)).resolves.toBeUndefined()
  })
})
