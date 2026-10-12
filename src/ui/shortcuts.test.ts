// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { SHORTCUTS, SHORTCUT_GROUPS, keyFocus, matchShortcut, seekTime, spacePlays, withShortcut } from './shortcuts'
import type { KeyLike } from './shortcuts'

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
})

describe('matchShortcut', () => {
  it('maps Ctrl or Cmd + S / O / E', () => {
    expect(matchShortcut(key('s', { ctrlKey: true }), 'other')).toBe('save')
    expect(matchShortcut(key('O', { metaKey: true }), 'other')).toBe('open')
    expect(matchShortcut(key('e', { ctrlKey: true }), 'other')).toBe('export')
  })

  it('maps F, [ and ? without modifier, and the characters typed with AltGr or Shift', () => {
    expect(matchShortcut(key('f'), 'other')).toBe('fit')
    expect(matchShortcut(key('F'), 'other')).toBe('fit')
    expect(matchShortcut(key('['), 'other')).toBe('toggle-panel')
    // AltGr+5 on an AZERTY keyboard
    expect(matchShortcut(key('[', { ctrlKey: true, altKey: true }), 'other')).toBe('toggle-panel')
    // Shift+, on an AZERTY keyboard
    expect(matchShortcut(key('?', { shiftKey: true }), 'other')).toBe('help')
    expect(matchShortcut(key('?', { ctrlKey: true }), 'other')).toBeNull()
  })

  it('maps G to the safe zones, not with a modifier nor in a text field', () => {
    expect(matchShortcut(key('g'), 'other')).toBe('safe-zones')
    expect(matchShortcut(key('G'), 'arrows')).toBe('safe-zones')
    expect(matchShortcut(key('G', { shiftKey: true }), 'other')).toBeNull()
    expect(matchShortcut(key('g', { ctrlKey: true }), 'other')).toBeNull()
    expect(matchShortcut(key('g'), 'text')).toBeNull()
  })

  it('maps S and T to adding a stop and a text, not with a modifier', () => {
    expect(matchShortcut(key('s'), 'other')).toBe('add-stop')
    expect(matchShortcut(key('T'), 'other')).toBe('add-text')
    expect(matchShortcut(key('S', { shiftKey: true }), 'other')).toBeNull()
    expect(matchShortcut(key('t', { altKey: true }), 'other')).toBeNull()
    expect(matchShortcut(key('t', { ctrlKey: true }), 'other')).toBeNull()
    expect(matchShortcut(key('s'), 'text')).toBeNull()
  })

  it('maps Escape, the arrows (Shift: longer), Home and End', () => {
    expect(matchShortcut(key('Escape'), 'other')).toBe('close')
    expect(matchShortcut(key('ArrowLeft'), 'other')).toBe('seek-back')
    expect(matchShortcut(key('ArrowRight'), 'other')).toBe('seek-forward')
    expect(matchShortcut(key('ArrowLeft', { shiftKey: true }), 'other')).toBe('seek-back-long')
    expect(matchShortcut(key('ArrowRight', { shiftKey: true }), 'other')).toBe('seek-forward-long')
    expect(matchShortcut(key('Home'), 'other')).toBe('seek-start')
    expect(matchShortcut(key('End'), 'other')).toBe('seek-end')
    expect(matchShortcut(key('ArrowRight', { ctrlKey: true }), 'other')).toBeNull()
    expect(matchShortcut(key('ArrowRight', { altKey: true, shiftKey: true }), 'other')).toBeNull()
  })

  it('maps Alt+← / Alt+→ to the previous / next keyframe, except in a control that uses the arrows', () => {
    expect(matchShortcut(key('ArrowLeft', { altKey: true }), 'other')).toBe('seek-prev-key')
    expect(matchShortcut(key('ArrowRight', { altKey: true }), 'other')).toBe('seek-next-key')
    expect(matchShortcut(key('ArrowRight', { altKey: true }), 'arrows')).toBeNull()
    expect(matchShortcut(key('ArrowRight', { altKey: true, ctrlKey: true }), 'other')).toBeNull()
    expect(withShortcut('Image clé suivante', 'seek-key', 1)).toBe('Image clé suivante (Alt+→)')
  })

  it('leaves the arrows, Home and End to a control that uses them, not the other shortcuts', () => {
    expect(matchShortcut(key('ArrowLeft'), 'arrows')).toBeNull()
    expect(matchShortcut(key('Home'), 'arrows')).toBeNull()
    expect(matchShortcut(key('f'), 'arrows')).toBe('fit')
    expect(matchShortcut(key('s'), 'arrows')).toBe('add-stop')
    expect(matchShortcut(key('Escape'), 'arrows')).toBe('close')
  })

  it('ignores everything while typing, and other combinations', () => {
    for (const k of [key('s', { ctrlKey: true }), key('f'), key('['), key('?'), key('Escape'), key('ArrowLeft')]) {
      expect(matchShortcut(k, 'text')).toBeNull()
    }
    expect(matchShortcut(key('s', { ctrlKey: true, shiftKey: true }), 'other')).toBeNull()
    expect(matchShortcut(key('f', { altKey: true }), 'other')).toBeNull()
    expect(matchShortcut(key('f', { ctrlKey: true }), 'other')).toBeNull()
    expect(matchShortcut(key('z', { ctrlKey: true }), 'other')).toBeNull()
    expect(matchShortcut(key('a'), 'other')).toBeNull()
    // no digit shortcuts
    expect(matchShortcut(key('1'), 'other')).toBeNull()
  })
})

describe('keyFocus', () => {
  it('tells text entries, controls that use the arrows and the rest apart', () => {
    const el = (html: string) => {
      const box = document.createElement('div')
      box.innerHTML = html
      return box.firstElementChild
    }
    expect(keyFocus(el('<input type="text">'))).toBe('text')
    expect(keyFocus(el('<select></select>'))).toBe('text')
    expect(keyFocus(el('<input type="range">'))).toBe('arrows')
    expect(keyFocus(el('<button role="tab"></button>'))).toBe('arrows')
    expect(keyFocus(el('<div role="slider"></div>'))).toBe('arrows')
    expect(keyFocus(el('<button></button>'))).toBe('other')
    expect(keyFocus(null)).toBe('other')
  })
})

describe('seekTime', () => {
  it('moves by 1 or 5 s within the film, to the start or the end', () => {
    expect(seekTime('seek-forward', 10, 60)).toBe(11)
    expect(seekTime('seek-back-long', 10, 60)).toBe(5)
    expect(seekTime('seek-back', 0.4, 60)).toBe(0)
    expect(seekTime('seek-forward-long', 58, 60)).toBe(60)
    expect(seekTime('seek-start', 30, 60)).toBe(0)
    expect(seekTime('seek-end', 30, 60)).toBe(60)
    expect(seekTime('fit', 30, 60)).toBeNull()
  })
})

describe('registry', () => {
  it('has unique ids, known groups and keys for every shortcut', () => {
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length)
    for (const s of SHORTCUTS) {
      expect(SHORTCUT_GROUPS).toContain(s.group)
      expect(s.keys.length).toBeGreaterThan(0)
    }
  })

  it('adds the first key combination to a tooltip', () => {
    expect(withShortcut('Annuler', 'undo')).toBe('Annuler (Ctrl+Z)')
    expect(withShortcut('Rétablir', 'redo')).toBe('Rétablir (Ctrl+Maj+Z)')
    expect(withShortcut('Arrêt', 'add-stop')).toBe('Arrêt (S)')
  })
})

describe('spacePlays', () => {
  const el = (html: string) => {
    document.body.innerHTML = html
    return document.body.firstElementChild as HTMLElement
  }
  const clicked = () => false
  const tabbed = () => true

  it('plays from the page, a control focused by a click, or a pointer-focused slider', () => {
    expect(spacePlays(document.body)).toBe(true)
    expect(spacePlays(el('<button>OK</button>'), clicked)).toBe(true)
    expect(spacePlays(el('<input type="range" />'), clicked)).toBe(true)
    expect(spacePlays(null)).toBe(true)
  })

  it('plays from the timeline ruler even after the keyboard moved the focus there', () => {
    expect(spacePlays(el('<div role="slider" tabindex="0"></div>'), tabbed)).toBe(true)
  })

  it('leaves Space to a control the keyboard focused, to text fields and to lists', () => {
    expect(spacePlays(el('<button>OK</button>'), tabbed)).toBe(false)
    expect(spacePlays(el('<input type="checkbox" />'), tabbed)).toBe(false)
    expect(spacePlays(el('<input type="text" />'), clicked)).toBe(false)
    expect(spacePlays(el('<textarea></textarea>'), clicked)).toBe(false)
    expect(spacePlays(el('<select><option>a</option></select>'), clicked)).toBe(false)
    expect(spacePlays(el('<div role="listbox"></div>'), clicked)).toBe(false)
  })
})
