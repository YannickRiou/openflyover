/**
 * The resumable export as the export controller sees it: which export is this (`projectKey`), what is stored for it,
 * and the hooks that give the video encoder the stored packets and take its new ones.
 */
import { useAppStore } from '../../state/store'
import { encoderHooks } from './hooks'
import { createRecorder, type Recorder } from './recorder'
import { fingerprint, resumePoint, stableJson, trackDigest, type ResumeExpectation, type ResumeHooks, type StoredPacket } from './resume'
import { storedPackets, type ResumeStorage } from './storage'

/** Fingerprint of the project and its settings (tracks, film, camera, video format...): a stored export belongs to it. */
export function projectKey(state: Pick<ReturnType<typeof useAppStore.getState>, 'tracks' | 'settings'> = useAppStore.getState()): string {
  return fingerprint(stableJson([state.tracks.map(trackDigest), state.settings]))
}

export interface ResumeRun {
  /** first frame to render: 0, or where the stored export stops */
  startFrame: number
  recorder: Recorder
  /** for the video encoder */
  hooks: ResumeHooks
  /** codec of the stored export being continued */
  codec?: string
  /** the stored packets a continued export hands to the muxer first */
  prior?: () => AsyncIterable<StoredPacket>
}

/**
 * Start recording an export: when `wantsResume` and the stored export is this one, it is continued (`startFrame`, and
 * its packets in `prior`); otherwise what was stored is deleted and the recording starts over.
 */
export async function beginRun(
  storage: ResumeStorage,
  job: ResumeExpectation & { name: string },
  wantsResume: boolean,
  now: () => number = Date.now,
): Promise<ResumeRun> {
  const manifest = await storage.readManifest()
  const point = wantsResume ? resumePoint(manifest, job, now()) : null
  const continued = manifest && point !== null && manifest.config ? manifest : null
  if (!continued) await storage.clear().catch(() => undefined)
  const recorder = createRecorder({ storage, job, from: continued ?? undefined, now })
  const packets = continued ? () => storedPackets(storage, continued) : undefined
  const prior = continued && packets ? { container: continued.container, codec: continued.codec, config: continued.config!, packets } : undefined
  return {
    startFrame: continued ? point! : 0,
    recorder,
    prior: packets,
    codec: continued?.codec,
    hooks: encoderHooks({ prior, onPacket: recorder.push }),
  }
}
