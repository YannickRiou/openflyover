/**
 * Colour grading in the scene (`settings.grading`): the same post-effect in both render paths.
 * With the atmosphere, `AtmosphereLayer` appends the effect of `useGradingEffect` to its composer. Without it there is
 * no composer: `GradingComposer` adds a minimal one (render, SMAA, grading) only while the grading changes something
 * or an « Objectif » effect is on (the lens flare excepted: it needs the sun of the atmosphere), and the grading lays
 * the image over the CSS sky gradient so the export, which draws the same gradient under the canvas, gets the same image.
 *
 * « Naturel » (identity) mounts nothing: no extra pass, no shader, no render target.
 */
import { useEffect, useLayoutEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { EffectComposer, SMAA } from '@react-three/postprocessing'
import { gradingAt, hasGradingKeys } from '../film/paramKeys'
import { filmTrackOf } from '../flyover/sequence'
import { trackPathOf } from '../flyover/path'
import { useAppStore } from '../state/store'
import { isIdentityGrading } from './grading'
import { GradingEffect, type GradingEffectOptions } from './gradingEffect'
import { useLensEffects } from './useLensEffects'

/**
 * The grading effect kept in sync with the settings, and whether it changes the image (else leave it unmounted): keys on
 * a grading value (« Réglages ») set it from the film progress, before each frame (a pure function of the progress).
 */
export function useGradingEffect(options?: GradingEffectOptions): { effect: GradingEffect; active: boolean } {
  const grading = useAppStore((s) => s.settings.grading)
  const keyed = useAppStore((s) => hasGradingKeys(s.settings.film))
  const top = options?.skyBackdrop?.top
  const horizon = options?.skyBackdrop?.horizon
  const effect = useMemo(
    () => new GradingEffect(top !== undefined && horizon !== undefined ? { skyBackdrop: { top, horizon } } : {}),
    [top, horizon],
  )
  useEffect(() => () => effect.dispose(), [effect])
  useLayoutEffect(() => effect.setGrading(grading), [effect, grading, keyed])
  useFrame(() => {
    if (!keyed) return
    const { playback, settings, tracks } = useAppStore.getState()
    const track = filmTrackOf(tracks, settings.race)
    effect.setGrading(gradingAt(settings.film, settings.grading, playback.progress * (track ? trackPathOf(track).lengthM : 0)))
  }, -1)
  return { effect, active: keyed || !isIdentityGrading(grading) }
}

/** Grading and lens effects without the atmosphere: a composer of their own, over the CSS sky gradient of the canvas. */
export function GradingComposer({ skyTop, skyHorizon }: { skyTop: string; skyHorizon: string }) {
  const { effect, active } = useGradingEffect({ skyBackdrop: { top: skyTop, horizon: skyHorizon } })
  const lens = useLensEffects()
  if (!active && lens.effects.length === 0 && !lens.shutter) return null
  return (
    <EffectComposer multisampling={0}>
      <SMAA />
      {lens.effects.map((e) => (
        <primitive key={e.name} object={e} />
      ))}
      {/* also with « Naturel »: it lays the image over the sky gradient (opaque output under the lens effects) */}
      <primitive object={effect} />
      {lens.shutter && <primitive object={lens.shutter} />}
    </EffectComposer>
  )
}
