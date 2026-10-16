/**
 * The ◀ ◇ ▶ group of the keys: go to the previous key, add a key at the playhead, go to the next key. One group per kind
 * of key, where its keys are set: the camera keys and the speed keys in the header of their timeline lane (`Timeline`),
 * the other parameters under their slider and the marker keys in the « Marqueur » section (`PanelKeys`, which follows
 * the playhead itself). ARCHITECTURE.md "Film and timeline", "Keyframes".
 */
import type { ReactNode } from 'react'
import type { FilmClock } from '../film/clock'
import { PARAM_LANE_LABELS, keysOfParam } from '../film/paramKeys'
import { t, useT } from '../i18n'
import type { FilmParam } from '../film/paramKeys'
import { keyState } from '../film/timeline'
import { seekKeyframe, toggleKeyframe, toggleMarkerKeyHere, toggleParamKeyHere, useFilmClock, useFilmTrack } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import type { AppState } from '../state/store'
import { Icon } from './icons'
import { withShortcut } from './shortcuts'
import { Tip } from './primitives'

/**
 * Where the group is, which sizes its buttons and gives them their colours: `lane` in the header of a timeline lane (light
 * on the dark chrome, small), `bar` in the tool row of the centred timeline (44 px targets), `panel` under a slider.
 */
export type KeyLook = 'lane' | 'bar' | 'panel'

const KEY_BUTTON = 'inline-flex flex-none cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 transition-ui disabled:cursor-not-allowed disabled:opacity-40'
const KEY_LOOKS: Record<KeyLook, { resting: string; on: string }> = {
  lane: {
    resting: `${KEY_BUTTON} h-5.5 w-6 text-glacier hover:enabled:bg-white/10 hover:enabled:text-white touch:h-7.5 touch:w-8 [&_svg]:size-4`,
    on: `${KEY_BUTTON} h-5.5 w-6 text-accent-light hover:enabled:bg-white/10 touch:h-7.5 touch:w-8 [&_svg]:size-4 [&_svg]:fill-current`,
  },
  bar: {
    resting: `${KEY_BUTTON} size-11 text-white hover:enabled:bg-white/10`,
    on: `${KEY_BUTTON} size-11 text-accent-light hover:enabled:bg-white/10 [&_svg]:fill-current`,
  },
  panel: {
    resting: `${KEY_BUTTON} size-7 text-text-2 hover:enabled:bg-surface-card`,
    on: `${KEY_BUTTON} size-7 text-brand hover:enabled:bg-surface-card [&_svg]:fill-current`,
  },
}

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
    <svg className="flex-none" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
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

/** Accessible names and tips of a group; `on`: the playhead is on a key, which the middle button then removes. */
function textsOf(target: KeyTarget, on: boolean): Texts {
  if (target.kind === 'camera') {
    return {
      group: t('keys.camera.group'),
      prev: { name: t('keys.camera.prev'), tip: withShortcut(t('keys.camera.prev'), 'seek-key') },
      add: {
        name: on ? t('keys.camera.remove') : t('keys.camera.add'),
        tip: on ? t('keys.camera.removeTip') : t('keys.camera.addTip'),
      },
      next: { name: t('keys.camera.next'), tip: withShortcut(t('keys.camera.next'), 'seek-key', 1) },
    }
  }
  if (target.kind === 'marker') {
    return {
      group: t('keys.marker.group'),
      prev: { name: t('keys.marker.prev'), tip: t('keys.marker.prevTip') },
      add: {
        name: on ? t('keys.marker.remove') : t('keys.marker.add'),
        tip: on ? t('keys.marker.removeTip') : t('keys.marker.addTip'),
      },
      next: { name: t('keys.marker.next'), tip: t('keys.marker.nextTip') },
    }
  }
  const label = PARAM_LANE_LABELS[target.param]
  const lower = label.toLowerCase()
  return {
    group: t('keys.param.group', { label }),
    prev: { name: t('keys.param.prev', { label }), tip: t('keys.param.prevTip', { label: lower }) },
    add: {
      name: on ? t('keys.param.remove', { label }) : t('keys.param.add', { label }),
      tip: on ? t('keys.param.removeTip') : t('keys.param.addTip', { label: lower }),
    },
    next: { name: t('keys.param.next', { label }), tip: t('keys.param.nextTip', { label: lower }) },
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
  look = 'lane',
}: {
  target: KeyTarget
  clock: FilmClock
  timeS: number
  /** no track to put a key on */
  disabled?: boolean
  tipSide?: 'top' | 'bottom'
  look?: KeyLook
}) {
  useT()
  const keys = keysOf(clock, target)
  const { prev, next, on } = keyState(keys, timeS)
  return <KeyButtons target={target} keys={keys} clock={clock} state={{ prev, next, on }} disabled={disabled} tipSide={tipSide} look={look} />
}

function KeyButtons({
  target,
  keys,
  clock,
  state,
  disabled,
  tipSide,
  look,
}: {
  target: KeyTarget
  keys: readonly { id: string; timeS: number }[]
  clock: FilmClock
  state: { prev: boolean; next: boolean; on: boolean }
  disabled: boolean
  tipSide: 'top' | 'bottom'
  look: KeyLook
}) {
  useT()
  const texts = textsOf(target, state.on)
  const add = () => {
    if (target.kind === 'camera') toggleKeyframe(clock)
    else if (target.kind === 'marker') toggleMarkerKeyHere(clock)
    else toggleParamKeyHere(clock, target.param)
  }
  const button = (role: 'prev' | 'add' | 'next', text: { name: string; tip: string }, onClick: () => void, off: boolean, on = false) => (
    <Tip text={text.tip} side={tipSide === 'top' ? 'top' : undefined}>
      <button
        type="button"
        className={on ? KEY_LOOKS[look].on : KEY_LOOKS[look].resting}
        onClick={onClick}
        disabled={off}
        aria-label={text.name}
      >
        <KeyIcon target={target} role={role} />
      </button>
    </Tip>
  )
  return (
    <span className="inline-flex items-center gap-0.5" role="group" aria-label={texts.group}>
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
    <div className="mt-0.5 flex justify-center">
      <KeyButtons target={target} keys={keys} clock={clock} state={{ prev, next, on }} disabled={!track} tipSide="bottom" look="panel" />
    </div>
  )
}
