/**
 * The soundtrack of a film for the export, mixed once per batch (`filmSoundtrack`): imported by the export only, so
 * that the batch module stays free of the audio code (a test that loads it lazily must not pull the decoders in).
 */
import { mixFilmAudio } from '../film/audio'
import type { MixedAudio } from '../film/audio'
import { normaliseLoudness } from '../film/loudness'
import { useMediaStore } from '../film/media'
import type { MediaTable } from '../film/media'
import type { Film } from '../film/model'
import { useBatchStore } from './batch'
import { writeBreadcrumb } from './guard'

/**
 * The soundtrack of the last film, kept while a batch or the render queue runs: the next formats of the same film have
 * the same one, so the music is decoded, mixed and brought to its loudness once per batch. Dropped when the batch ends.
 */
let keptSoundtrack: { film: Film; table: MediaTable; offsetS: number; lengthS: number; lufs: number | null; audio: MixedAudio | null } | null = null

/** A copy: the encoders and the loudness pass may change the samples they are given. */
const copySoundtrack = (audio: MixedAudio | null): MixedAudio | null => audio && { ...audio, channels: audio.channels.map((c) => c.slice()) }

/** The mixed soundtrack (`mixFilmAudio`), at `lufs` when « Normaliser le volume » is on; from `keptSoundtrack` within a batch. */
export async function filmSoundtrack(film: Film, offsetS: number, lengthS: number, lufs: number | null): Promise<MixedAudio | null> {
  const table = useMediaStore.getState().table
  const kept = keptSoundtrack
  if (kept && kept.film === film && kept.table === table && kept.offsetS === offsetS && kept.lengthS === lengthS && kept.lufs === lufs) {
    writeBreadcrumb('export : son repris du film précédent du lot')
    return copySoundtrack(kept.audio)
  }
  const audio = await mixFilmAudio(film, (id) => table[id], { offsetS, lengthS })
  // « Normaliser le volume »: the mix brought to the target loudness and kept under the true-peak ceiling
  if (audio && lufs != null) {
    const { measured, gainDb, limitedDb } = normaliseLoudness(audio, lufs)
    writeBreadcrumb(measured === null ? 'export : son silencieux, volume inchangé' : `export : volume ${measured.toFixed(1)} LUFS, gain ${gainDb.toFixed(1)} dB, limiteur ${limitedDb.toFixed(1)} dB`)
  }
  keptSoundtrack = useBatchStore.getState().phase === 'running' ? { film, table, offsetS, lengthS, lufs, audio: copySoundtrack(audio) } : null
  return audio
}


// the end of a batch drops the soundtrack it kept
useBatchStore.subscribe((state, previous) => {
  if (previous.phase === 'running' && state.phase !== 'running') keptSoundtrack = null
})
