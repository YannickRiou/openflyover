/**
 * The ◀ ◇ ▶ group of the keys: go to the previous key, add a key at the playhead, go to the next key. One group per kind
 * of key, where its keys are set: the camera keys and the speed keys in the header of their timeline lane (`Timeline`),
 * the other parameters under their slider and the marker keys in the « Marqueur » section (`PanelKeys`, which follows
 * the playhead itself). ARCHITECTURE.md "Film and timeline", "Keyframes".
 */
import type { ReactNode } from 'react'
import type { FilmClock } from '../film/clock'
import { PARAM_LANE_LABELS, keysOfParam } from '../film/paramKeys'
import type { FilmParam } from '../film/paramKeys'
import { keyState } from '../film/timeline'
import { addMarkerKeyHere, addParamKeyHere, seekKeyframe, toggleKeyframe, useFilmClock, useFilmTrack } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import type { AppState } from '../state/store'
import { Icon } from './icons'
import { withShortcut } from './shortcuts'
import './keyControls.css'

/** The keys a group drives: the camera keys, the keys of one parameter, or the marker keys. */
export type KeyTarget = { kind: 'camera' } | { kind: 'param'; param: FilmParam } | { kind: 'marker' }

/** The keys of `target` on the film clock, by position. */
function keysOf(clock: FilmClock, target: KeyTarget): readonly { id: string; timeS: number }[] {
  if (target.kind === 'camera') return clock.cameraKeys
  if (target.kind === 'marker') return clock.markerKeys
  return keysOfParam(clock.paramKeys, target.param)
}

/** The marker keys are round dots (the lane draws them so), the others diamonds: same shapes on the buttons. */
function Dot({ children }: { children?: ReactNode }) {
  return (
    <svg className="icon" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

function KeyIcon({ target, role }: { target: KeyTarget; role: 'prev' | 'add' | 'next' }) {
  if (target.kind !== 'marker') return <Icon name={role === 'prev' ? 'keyframe-prev' : role === 'next' ? 'keyframe-next' : 'diamond'} size={18} />
  if (role === 'prev') return <Dot><path d="m9 6-6 6 6 6" /><circle cx="17" cy="12" r="4" /></Dot>
  if (role === 'next') return <Dot><path d="m15 6 6 6-6 6" /><circle cx="7" cy="12" r="4" /></Dot>
  return <Dot><circle cx="12" cy="12" r="6" /></Dot>
}

interface Texts {
  group: string
  prev: { name: string; tip: string }
  add: { name: string; tip: string }
  next: { name: string; tip: string }
}

/** Accessible names and tips of a group; `on`: the playhead is on a key, which the middle button then opens. */
function textsOf(target: KeyTarget, on: boolean): Texts {
  if (target.kind === 'camera') {
    return {
      group: 'Images clés',
      prev: { name: 'Image clé précédente', tip: withShortcut('Image clé précédente', 'seek-key') },
      add: {
        name: on ? 'Supprimer l’image clé' : 'Ajouter une image clé',
        tip: on ? 'Supprimer l’image clé sous la tête de lecture' : 'Ajouter une image clé : garde la vue 3D cadrée à la position du marqueur',
      },
      next: { name: 'Image clé suivante', tip: withShortcut('Image clé suivante', 'seek-key', 1) },
    }
  }
  if (target.kind === 'marker') {
    return {
      group: 'Clés du marqueur',
      prev: { name: 'Marqueur : clé précédente', tip: 'Aller à la clé de marqueur précédente' },
      add: {
        name: on ? 'Marqueur : sélectionner la clé' : 'Marqueur : ajouter une clé',
        tip: on
          ? 'Ouvrir la clé de marqueur sous la tête de lecture dans l’inspecteur'
          : 'Ajouter une clé de marqueur : à cet endroit, le marqueur change d’aspect (boule, figurine, image) en fondu',
      },
      next: { name: 'Marqueur : clé suivante', tip: 'Aller à la clé de marqueur suivante' },
    }
  }
  const label = PARAM_LANE_LABELS[target.param]
  return {
    group: `Clés : ${label}`,
    prev: { name: `${label} : clé précédente`, tip: `Aller à la clé précédente (${label.toLowerCase()})` },
    add: {
      name: on ? `${label} : sélectionner la clé` : `${label} : ajouter une clé`,
      tip: on
        ? `Ouvrir la clé sous la tête de lecture dans l’inspecteur`
        : `Ajouter une clé à la position du marqueur, avec la valeur actuelle (${label.toLowerCase()})`,
    },
    next: { name: `${label} : clé suivante`, tip: `Aller à la clé suivante (${label.toLowerCase()})` },
  }
}

/**
 * ◀ ◇ ▶ of `target` at film time `timeS` (the playhead). The caller says where the playhead is, so that a timeline
 * which keeps still while the export moves it does not render again. `tipSide`: where the tips open.
 */
export function KeyGroup({
  target,
  clock,
  timeS,
  disabled = false,
  tipSide = 'top',
}: {
  target: KeyTarget
  clock: FilmClock
  timeS: number
  /** no track to put a key on */
  disabled?: boolean
  tipSide?: 'top' | 'bottom'
}) {
  const keys = keysOf(clock, target)
  const { prev, next, on } = keyState(keys, timeS)
  return <KeyButtons target={target} keys={keys} clock={clock} state={{ prev, next, on }} disabled={disabled} tipSide={tipSide} />
}

function KeyButtons({
  target,
  keys,
  clock,
  state,
  disabled,
  tipSide,
}: {
  target: KeyTarget
  keys: readonly { id: string; timeS: number }[]
  clock: FilmClock
  state: { prev: boolean; next: boolean; on: boolean }
  disabled: boolean
  tipSide: 'top' | 'bottom'
}) {
  const texts = textsOf(target, state.on)
  const add = () => {
    if (target.kind === 'camera') toggleKeyframe(clock)
    else if (target.kind === 'marker') addMarkerKeyHere()
    else addParamKeyHere(target.param)
  }
  const button = (role: 'prev' | 'add' | 'next', text: { name: string; tip: string }, onClick: () => void, off: boolean, on = false) => (
    <button
      type="button"
      className={on ? 'key-btn key-btn--on' : 'key-btn'}
      onClick={onClick}
      disabled={off}
      aria-label={text.name}
      data-tip={text.tip}
      data-tip-side={tipSide === 'top' ? 'top' : undefined}
    >
      <KeyIcon target={target} role={role} />
    </button>
  )
  return (
    <span className="key-group" role="group" aria-label={texts.group}>
      {button('prev', texts.prev, () => seekKeyframe(clock, -1, keys), !state.prev)}
      {button('add', texts.add, add, disabled, state.on)}
      {button('next', texts.next, () => seekKeyframe(clock, 1, keys), !state.next)}
    </span>
  )
}

/**
 * The group of a left panel (a parameter under its slider, the markers in « Marqueur »): it follows the playhead itself,
 * through selectors that change only when a button's state does.
 */
export function PanelKeys({ target }: { target: KeyTarget }) {
  const clock = useFilmClock()
  const track = useFilmTrack()
  const keys = keysOf(clock, target)
  const timeOf = (s: AppState) => Math.min(clock.totalTime(), s.playback.timeS ?? clock.timeAtProgress(s.playback.progress))
  const prev = useAppStore((s) => keyState(keys, timeOf(s)).prev)
  const next = useAppStore((s) => keyState(keys, timeOf(s)).next)
  const on = useAppStore((s) => keyState(keys, timeOf(s)).on)
  return (
    <div className="key-field">
      <KeyButtons target={target} keys={keys} clock={clock} state={{ prev, next, on }} disabled={!track} tipSide="bottom" />
    </div>
  )
}
