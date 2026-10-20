/**
 * Keyboard shortcuts: the list shown in the help (« ? ») and in the tooltips, and the matching of a key press for the
 * shell (`matchShortcut`, pure). Undo / redo stay in `installHistoryShortcuts`, Space and the timeline keys in
 * `Timeline.tsx`; they are listed here for the help. No digit shortcuts: AZERTY types them with Shift. No Ctrl+N for
 * « Nouveau projet »: browsers keep it for a new window, a page cannot take it.
 */
import { t } from '../i18n'
import type { MessageKey } from '../i18n'
import { isTextEntry } from '../project/history'

export const SHORTCUT_GROUPS = ['playback', 'editing', 'project', 'view'] as const
export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number]

export interface Shortcut {
  id: string
  /** key combinations, alternatives in order (the first one goes into the tooltips); the words of a key are `KEY_WORDS`, shown by `keyLabel` */
  keys: readonly string[]
  label: string
  group: ShortcutGroup
}

export const SHORTCUTS = [
  { id: 'play', keys: ['Space', 'K'], get label() { return t('shortcuts.label.play') }, group: 'playback' },
  { id: 'seek', keys: ['←', '→'], get label() { return t('shortcuts.label.seek') }, group: 'playback' },
  { id: 'seek-long', keys: ['Shift+←', 'Shift+→'], get label() { return t('shortcuts.label.seek-long') }, group: 'playback' },
  { id: 'seek-ends', keys: ['Home', 'End'], get label() { return t('shortcuts.label.seek-ends') }, group: 'playback' },
  { id: 'work-area', keys: ['I', 'O', 'Shift+X'], get label() { return t('shortcuts.label.work-area') }, group: 'playback' },
  { id: 'frame', keys: ['J', 'L'], get label() { return t('shortcuts.label.frame') }, group: 'playback' },
  { id: 'seek-key', keys: ['Alt+←', 'Alt+→'], get label() { return t('shortcuts.label.seek-key') }, group: 'playback' },
  { id: 'undo', keys: ['Ctrl+Z'], get label() { return t('shortcuts.label.undo') }, group: 'editing' },
  { id: 'redo', keys: ['Ctrl+Shift+Z', 'Ctrl+Y'], get label() { return t('shortcuts.label.redo') }, group: 'editing' },
  { id: 'nudge', keys: ['←', '→'], get label() { return t('shortcuts.label.nudge') }, group: 'editing' },
  { id: 'magnet', keys: ['Alt+drag'], get label() { return t('shortcuts.label.magnet') }, group: 'editing' },
  { id: 'marquee', keys: ['Ctrl+drag'], get label() { return t('shortcuts.label.marquee') }, group: 'editing' },
  { id: 'add-stop', keys: ['S'], get label() { return t('shortcuts.label.add-stop') }, group: 'editing' },
  { id: 'add-text', keys: ['T'], get label() { return t('shortcuts.label.add-text') }, group: 'editing' },
  { id: 'remove', keys: ['Del'], get label() { return t('shortcuts.label.remove') }, group: 'editing' },
  { id: 'duplicate', keys: ['Ctrl+D'], get label() { return t('shortcuts.label.duplicate') }, group: 'editing' },
  { id: 'split', keys: ['X'], get label() { return t('shortcuts.label.split') }, group: 'editing' },
  { id: 'scroll', keys: ['wheel'], get label() { return t('shortcuts.label.scroll') }, group: 'editing' },
  { id: 'zoom', keys: ['Ctrl+wheel'], get label() { return t('shortcuts.label.zoom') }, group: 'editing' },
  { id: 'pick', keys: ['clickTrack'], get label() { return t('shortcuts.label.pick') }, group: 'editing' },
  { id: 'open', keys: ['Ctrl+O'], get label() { return t('shortcuts.label.open') }, group: 'project' },
  { id: 'save', keys: ['Ctrl+S'], get label() { return t('shortcuts.label.save') }, group: 'project' },
  { id: 'save-as', keys: ['Ctrl+Shift+S'], get label() { return t('shortcuts.label.save-as') }, group: 'project' },
  { id: 'export', keys: ['Ctrl+E'], get label() { return t('shortcuts.label.export') }, group: 'project' },
  { id: 'fit', keys: ['F'], get label() { return t('shortcuts.label.fit') }, group: 'view' },
  { id: 'safe-zones', keys: ['G'], get label() { return t('shortcuts.label.safe-zones') }, group: 'view' },
  { id: 'toggle-panel', keys: ['['], get label() { return t('shortcuts.label.toggle-panel') }, group: 'view' },
  { id: 'help', keys: ['?'], get label() { return t('shortcuts.label.help') }, group: 'view' },
  { id: 'close', keys: ['Esc'], get label() { return t('shortcuts.label.close') }, group: 'view' },
] as const satisfies readonly Shortcut[]

/** Words of the keys in `keys` (symbols and letters are the same in every language). */
const KEY_WORDS = {
  Space: 'shortcuts.key.Space',
  Home: 'shortcuts.key.Home',
  End: 'shortcuts.key.End',
  Shift: 'shortcuts.key.Shift',
  Del: 'shortcuts.key.Del',
  Esc: 'shortcuts.key.Esc',
  drag: 'shortcuts.key.drag',
  wheel: 'shortcuts.key.wheel',
  clickTrack: 'shortcuts.key.clickTrack',
} as const satisfies Record<string, MessageKey>

/** A key combination as shown in the current language: « Ctrl+Shift+Z » is « Ctrl+Maj+Z » in French. */
export function keyLabel(keys: string): string {
  return keys
    .split('+')
    .map((part) => (part in KEY_WORDS ? t(KEY_WORDS[part as keyof typeof KEY_WORDS]) : part))
    .join('+')
}

export type ShortcutId = (typeof SHORTCUTS)[number]['id']

/** Tooltip text: `label` followed by key combination `index` (the first by default) of `id`, « Annuler (Ctrl+Z) ». */
export function withShortcut(label: string, id: ShortcutId, index = 0): string {
  const shortcut: Shortcut | undefined = SHORTCUTS.find((s) => s.id === id)
  return shortcut ? `${label} (${keyLabel(shortcut.keys[index] ?? shortcut.keys[0])})` : label
}

export type ShortcutAction =
  | 'save'
  | 'save-as'
  | 'open'
  | 'export'
  | 'fit'
  | 'safe-zones'
  | 'toggle-panel'
  | 'help'
  | 'close'
  | 'add-stop'
  | 'add-text'
  | 'seek-back'
  | 'seek-forward'
  | 'seek-back-long'
  | 'seek-forward-long'
  | 'seek-start'
  | 'seek-end'
  | 'seek-prev-key'
  | 'seek-next-key'
  | 'play-pause'
  | 'mark-in'
  | 'mark-out'
  | 'clear-range'
  | 'frame-back'
  | 'frame-forward'
  | 'frame-back-long'
  | 'frame-forward-long'
  | 'remove'
  | 'duplicate'
  | 'split'

export interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/**
 * Where the key press happens: `text` a text field or a list (no shortcut at all), `arrows` a control that uses the
 * arrows, Home and End itself (slider, radio, tab: no seeking), `other` anywhere else.
 */
export type KeyFocus = 'text' | 'arrows' | 'other'

const ARROW_CONTROLS = 'input[type="range"], input[type="radio"], [role="slider"], [role="tab"], [role="radio"], [role="listbox"], [role="menu"]'

export function keyFocus(target: EventTarget | null): KeyFocus {
  // a select, native or the button that opens its list (letters jump to an option, the arrows change it)
  if (isTextEntry(target) || target instanceof HTMLSelectElement || (target instanceof Element && target.closest('[aria-haspopup="listbox"]'))) return 'text'
  if (target instanceof Element && target.closest(ARROW_CONTROLS)) return 'arrows'
  return 'other'
}

/** Controls that may keep Space (not the timeline ruler, a `role="slider"` div whose keys are arrows only: Space plays from there). */
const SPACE_CONTROLS = 'input, button, a[href], [role="tab"], [role="radio"], [role="switch"]'

/**
 * Space plays / pauses unless it belongs to the focused element: a text field, a list, or a control the keyboard moved
 * the focus to (focus-visible). A button or slider only focused by a click does not keep Space for itself, which would
 * otherwise press the last button clicked instead of playing.
 */
export function spacePlays(target: EventTarget | null, focusVisible = (el: Element) => el.matches(':focus-visible')): boolean {
  if (!(target instanceof HTMLElement)) return true
  if (keyFocus(target) === 'text' || target.closest('textarea, [role="listbox"], [role="menu"]')) return false
  const control = target.closest(SPACE_CONTROLS)
  if (!control) return true
  try {
    return !focusVisible(control)
  } catch {
    return false
  }
}

/**
 * Shortcut of the shell for a key press, null when none: Ctrl/Cmd+S save, Ctrl/Cmd+Shift+S save as, Ctrl/Cmd+O open, Ctrl/Cmd+E export drawer,
 * F fit the view, G the safe zones, [ fold the panel and ? the help (whatever the modifiers that type them: AltGr, Shift), Escape close,
 * S / T add a stop / a text, I / O set the in / out point of the work area and Shift+X clears it, X cuts the selected text or photo at the playhead, Ctrl/Cmd+D duplicates it, Delete removes the
 * selected block, K plays / pauses, J / L step a frame back / forward (Shift: ten), ← / → seek (Shift: longer; Alt: to the
 * previous / next keyframe), Home / End.
 */
export function matchShortcut(e: KeyLike, focus: KeyFocus): ShortcutAction | null {
  if (focus === 'text') return null
  // « [ » needs AltGr (Ctrl+Alt) on French keyboards: the character decides, not the modifiers
  if (e.key === '[') return e.metaKey ? null : 'toggle-panel'
  if (e.key === '?') return e.metaKey || (e.ctrlKey && !e.altKey) ? null : 'help'
  if (e.altKey) {
    if (focus === 'arrows' || e.ctrlKey || e.metaKey || e.shiftKey) return null
    return e.key === 'ArrowLeft' ? 'seek-prev-key' : e.key === 'ArrowRight' ? 'seek-next-key' : null
  }
  const key = e.key.toLowerCase()
  if (e.ctrlKey || e.metaKey) {
    if (key === 's') return e.shiftKey ? 'save-as' : 'save'
    if (e.shiftKey) return null
    if (key === 'o') return 'open'
    if (key === 'e') return 'export'
    if (key === 'd') return 'duplicate'
    return null
  }
  if (e.key === 'Escape') return e.shiftKey ? null : 'close'
  if (key === 'f') return e.shiftKey ? null : 'fit'
  if (key === 'g') return e.shiftKey ? null : 'safe-zones'
  if (key === 's') return e.shiftKey ? null : 'add-stop'
  if (key === 't') return e.shiftKey ? null : 'add-text'
  if (key === 'k') return e.shiftKey ? null : 'play-pause'
  if (key === 'x') return e.shiftKey ? 'clear-range' : 'split'
  if (key === 'i') return e.shiftKey ? null : 'mark-in'
  if (key === 'o') return e.shiftKey ? null : 'mark-out'
  if (key === 'j') return e.shiftKey ? 'frame-back-long' : 'frame-back'
  if (key === 'l') return e.shiftKey ? 'frame-forward-long' : 'frame-forward'
  if (e.key === 'Delete') return focus === 'other' && !e.shiftKey ? 'remove' : null
  if (focus === 'arrows') return null
  if (e.key === 'ArrowLeft') return e.shiftKey ? 'seek-back-long' : 'seek-back'
  if (e.key === 'ArrowRight') return e.shiftKey ? 'seek-forward-long' : 'seek-forward'
  if (e.shiftKey) return null
  if (e.key === 'Home') return 'seek-start'
  if (e.key === 'End') return 'seek-end'
  return null
}

/** Frames a Shift+J / Shift+L step. */
export const FRAME_LONG_STEP = 10
export const SEEK_STEP_S = 1
export const SEEK_LONG_STEP_S = 5

/** Film time after a seek shortcut from `playheadS` in a film of `totalS` seconds, null for any other action. */
export function seekTime(action: ShortcutAction, playheadS: number, totalS: number, fps = 30): number | null {
  const steps: Partial<Record<ShortcutAction, number>> = {
    'frame-back': -1 / fps,
    'frame-forward': 1 / fps,
    'frame-back-long': -FRAME_LONG_STEP / fps,
    'frame-forward-long': FRAME_LONG_STEP / fps,
    'seek-back': -SEEK_STEP_S,
    'seek-forward': SEEK_STEP_S,
    'seek-back-long': -SEEK_LONG_STEP_S,
    'seek-forward-long': SEEK_LONG_STEP_S,
  }
  const end = Math.max(0, totalS)
  if (action === 'seek-start') return 0
  if (action === 'seek-end') return end
  const step = steps[action]
  return step === undefined ? null : Math.min(end, Math.max(0, playheadS + step))
}
