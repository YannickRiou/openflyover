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

describe('matchShortcut: editing keys', () => {
  it('K plays, J and L step a frame (Shift: ten), X cuts, Ctrl+D duplicates, Delete removes', () => {
    expect(matchShortcut(key('k'), 'other')).toBe('play-pause')
    expect(matchShortcut(key('j'), 'other')).toBe('frame-back')
    expect(matchShortcut(key('L'), 'other')).toBe('frame-forward')
    expect(matchShortcut(key('J', { shiftKey: true }), 'other')).toBe('frame-back-long')
    expect(matchShortcut(key('l', { shiftKey: true }), 'other')).toBe('frame-forward-long')
    expect(matchShortcut(key('x'), 'other')).toBe('split')
    expect(matchShortcut(key('d', { ctrlKey: true }), 'other')).toBe('duplicate')
    expect(matchShortcut(key('D', { metaKey: true }), 'other')).toBe('duplicate')
    expect(matchShortcut(key('Delete'), 'other')).toBe('remove')
  })

  it('Ctrl+C and Ctrl+V copy and paste, Shift+Delete removes and closes the gap, Delete alone does not', () => {
    expect(matchShortcut(key('c', { ctrlKey: true }), 'other')).toBe('copy')
    expect(matchShortcut(key('V', { metaKey: true }), 'other')).toBe('paste')
    expect(matchShortcut(key('c', { ctrlKey: true }), 'text')).toBeNull()
    expect(matchShortcut(key('v', { ctrlKey: true }), 'arrows')).toBe('paste')
    expect(matchShortcut(key('Delete', { shiftKey: true }), 'other')).toBe('ripple-remove')
    expect(matchShortcut(key('Delete'), 'other')).toBe('remove')
    expect(matchShortcut(key('Delete', { shiftKey: true }), 'text')).toBeNull()
    expect(matchShortcut(key('c', { ctrlKey: true, shiftKey: true }), 'other')).toBeNull()
  })

  it('I and O set the in and out points of the work area, Shift+X clears it', () => {
    expect(matchShortcut(key('i'), 'other')).toBe('mark-in')
    expect(matchShortcut(key('O'), 'other')).toBe('mark-out')
    expect(matchShortcut(key('X', { shiftKey: true }), 'other')).toBe('clear-range')
    expect(matchShortcut(key('x'), 'other')).toBe('split')
    expect(matchShortcut(key('i'), 'text')).toBeNull()
    expect(matchShortcut(key('i', { shiftKey: true }), 'other')).toBeNull()
    expect(matchShortcut(key('o', { ctrlKey: true }), 'other')).toBe('open')
  })

  it('none in a text field; Delete not on a slider nor with Shift; no letter with a modifier', () => {
    for (const k of ['k', 'j', 'l', 'x']) expect(matchShortcut(key(k), 'text')).toBeNull()
    expect(matchShortcut(key('d', { ctrlKey: true }), 'text')).toBeNull()
    expect(matchShortcut(key('Delete'), 'text')).toBeNull()
    expect(matchShortcut(key('Delete'), 'arrows')).toBeNull()
    expect(matchShortcut(key('x', { ctrlKey: true }), 'other')).toBeNull()
    expect(matchShortcut(key('k', { altKey: true }), 'other')).toBeNull()
    expect(matchShortcut(key('k', { shiftKey: true }), 'other')).toBeNull()
  })

  it('frame steps follow the frame rate of the film, within the film', () => {
    expect(seekTime('frame-forward', 10, 60, 30)).toBeCloseTo(10 + 1 / 30, 9)
    expect(seekTime('frame-back', 10, 60, 25)).toBeCloseTo(10 - 1 / 25, 9)
    expect(seekTime('frame-forward-long', 10, 60, 30)).toBeCloseTo(10 + 10 / 30, 9)
    expect(seekTime('frame-back', 0, 60, 30)).toBe(0)
    expect(seekTime('frame-forward', 60, 60, 30)).toBe(60)
  })
})

describe('matchShortcut', () => {
  it('maps Ctrl or Cmd + S / O / E', () => {
    expect(matchShortcut(key('s', { ctrlKey: true }), 'other')).toBe('save')
    expect(matchShortcut(key('O', { metaKey: true }), 'other')).toBe('open')
    expect(matchShortcut(key('e', { ctrlKey: true }), 'other')).toBe('export')
  })

  it('maps Ctrl or Cmd + K to the settings search, while K alone still plays', () => {
    expect(matchShortcut(key('k', { ctrlKey: true }), 'other')).toBe('search')
    expect(matchShortcut(key('K', { metaKey: true }), 'arrows')).toBe('search')
    expect(matchShortcut(key('k', { ctrlKey: true }), 'text')).toBeNull()
    expect(matchShortcut(key('k', { ctrlKey: true, shiftKey: true }), 'other')).toBeNull()
    expect(matchShortcut(key('k'), 'other')).toBe('play-pause')
  })

  it('maps Ctrl or Cmd + Shift + S to save as, and no other Shift combination', () => {
    expect(matchShortcut(key('S', { ctrlKey: true, shiftKey: true }), 'other')).toBe('save-as')
    expect(matchShortcut(key('s', { metaKey: true, shiftKey: true }), 'other')).toBe('save-as')
    expect(matchShortcut(key('O', { ctrlKey: true, shiftKey: true }), 'other')).toBeNull()
    expect(matchShortcut(key('S', { ctrlKey: true, shiftKey: true }), 'text')).toBeNull()
    expect(withShortcut('Enregistrer sous…', 'save-as')).toBe('Enregistrer sous… (Ctrl+Maj+S)')
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
    expect(matchShortcut(key('e', { ctrlKey: true, shiftKey: true }), 'other')).toBeNull()
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
    expect(keyFocus(el('<button aria-haspopup="listbox"></button>'))).toBe('text')
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
    expect(spacePlays(el('<button aria-haspopup="listbox">a</button>'), clicked)).toBe(false)
    expect(spacePlays(el('<div role="listbox"></div>'), clicked)).toBe(false)
  })
})
