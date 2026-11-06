import { parseManifest, type ResumeManifest } from './resume'
import type { ResumeStorage } from './storage'

/** In-memory `ResumeStorage` for tests; `failWrites` makes every write fail (a full quota). */
export function memoryStorage(): ResumeStorage & { chunks: Map<number, Uint8Array>; manifest: ResumeManifest | null; failWrites: Error | null } {
  const state = {
    chunks: new Map<number, Uint8Array>(),
    manifest: null as ResumeManifest | null,
    failWrites: null as Error | null,
  }
  return Object.assign(state, {
    async readManifest() {
      return state.manifest && parseManifest(JSON.parse(JSON.stringify(state.manifest)))
    },
    async writeManifest(m: ResumeManifest) {
      if (state.failWrites) throw state.failWrites
      state.manifest = JSON.parse(JSON.stringify(m)) as ResumeManifest
    },
    async writeChunk(index: number, bytes: Uint8Array) {
      if (state.failWrites) throw state.failWrites
      state.chunks.set(index, bytes.slice())
    },
    async readChunk(index: number) {
      return state.chunks.get(index) ?? null
    },
    async clear() {
      state.chunks.clear()
      state.manifest = null
    },
  })
}
