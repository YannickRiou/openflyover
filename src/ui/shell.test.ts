import { describe, expect, it } from 'vitest'
import type { Track } from '../core/types'
import { DEFAULT_SETTINGS } from '../state/store'
import {
  dismissSheet,
  effectiveProjectName,
  frameRect,
  isFileDrag,
  isProjectDirty,
  nextGridIndex,
  nextTabIndex,
  DEFAULT_PREFERENCES,
  parseFoldPrefs,
  parsePreferences,
  parseShellPrefs,
  routeOpenedFiles,
  shellReducer,
  shownTabs,
  SHELL_TABS,
  tipPlacement,
} from './shell'
import type { ShellState } from './shell'

describe('frameRect', () => {
  it('letterboxes a wide format in a taller stage, centred', () => {
    expect(frameRect(1000, 800, 16 / 9)).toEqual({ left: 0, top: 118, width: 1000, height: 563 })
  })

  it('pillarboxes a vertical format', () => {
    const r = frameRect(1000, 800, 9 / 16)
    expect(r.height).toBe(800)
    expect(r.width).toBe(450)
    expect(r.left).toBe(275)
    expect(r.top).toBe(0)
  })

  it('stays inside the stage and keeps the ratio within a pixel', () => {
    for (const aspect of [16 / 9, 9 / 16, 1, 4 / 5, 21 / 9]) {
      for (const [w, h] of [
        [1064, 678],
        [333, 917],
        [1, 1],
      ]) {
        const r = frameRect(w, h, aspect)
        expect(r.left + r.width).toBeLessThanOrEqual(w)
        expect(r.top + r.height).toBeLessThanOrEqual(h)
        expect(Math.abs(r.width - r.height * aspect)).toBeLessThanOrEqual(Math.max(1, aspect))
      }
    }
  })

  it('fills the stage in free framing or for an empty stage', () => {
    expect(frameRect(640, 480, null)).toEqual({ left: 0, top: 0, width: 640, height: 480 })
    expect(frameRect(0, 480, 16 / 9)).toEqual({ left: 0, top: 0, width: 0, height: 480 })
  })
})

describe('routeOpenedFiles', () => {
  it('opens the first project and imports the rest as tracks', () => {
    const files = [{ name: 'a.gpx' }, { name: 'Tour.openflyover.JSON' }, { name: 'b.fit' }, { name: 'c.json' }, { name: 'notes.txt' }]
    const out = routeOpenedFiles(files)
    expect(out.project?.name).toBe('Tour.openflyover.JSON')
    expect(out.tracks.map((f) => f.name)).toEqual(['a.gpx', 'b.fit', 'notes.txt'])
    expect(out.extraProjects.map((f) => f.name)).toEqual(['c.json'])
  })

  it('takes .opnflvr files (any case) as projects, before or after the older .json ones', () => {
    const out = routeOpenedFiles([{ name: 'a.gpx' }, { name: 'Tour.OPNFLVR' }, { name: 'old.openflyover.json' }, { name: 'b.opnflvr' }, { name: 'opnflvr' }])
    expect(out.project?.name).toBe('Tour.OPNFLVR')
    expect(out.tracks.map((f) => f.name)).toEqual(['a.gpx', 'opnflvr'])
    expect(out.extraProjects.map((f) => f.name)).toEqual(['old.openflyover.json', 'b.opnflvr'])
  })

  it('has no project for tracks only', () => {
    expect(routeOpenedFiles([{ name: 'x.gpx' }]).project).toBeNull()
  })
})

describe('isFileDrag', () => {
  it('is true only when the drag carries files', () => {
    expect(isFileDrag(['Files', 'application/x-moz-file'])).toBe(true)
    expect(isFileDrag(['text/plain', 'text/uri-list'])).toBe(false)
    expect(isFileDrag(undefined)).toBe(false)
  })
})

describe('nextTabIndex', () => {
  it('wraps on both axes and jumps with Home / End', () => {
    expect(nextTabIndex(0, 'ArrowUp', 5)).toBe(4)
    expect(nextTabIndex(4, 'ArrowDown', 5)).toBe(0)
    expect(nextTabIndex(2, 'ArrowLeft', 5)).toBe(1)
    expect(nextTabIndex(2, 'ArrowRight', 5)).toBe(3)
    expect(nextTabIndex(3, 'Home', 5)).toBe(0)
    expect(nextTabIndex(1, 'End', 5)).toBe(4)
    expect(nextTabIndex(1, 'Enter', 5)).toBeNull()
  })
})

describe('nextGridIndex', () => {
  it('moves one cell in a 3 × 3 grid, stops at the edges, jumps with Home / End', () => {
    expect(nextGridIndex(4, 'ArrowLeft', 3, 9)).toBe(3)
    expect(nextGridIndex(4, 'ArrowRight', 3, 9)).toBe(5)
    expect(nextGridIndex(4, 'ArrowUp', 3, 9)).toBe(1)
    expect(nextGridIndex(4, 'ArrowDown', 3, 9)).toBe(7)
    expect(nextGridIndex(3, 'ArrowLeft', 3, 9)).toBe(3)
    expect(nextGridIndex(5, 'ArrowRight', 3, 9)).toBe(5)
    expect(nextGridIndex(1, 'ArrowUp', 3, 9)).toBe(1)
    expect(nextGridIndex(7, 'ArrowDown', 3, 9)).toBe(7)
    expect(nextGridIndex(4, 'Home', 3, 9)).toBe(0)
    expect(nextGridIndex(4, 'End', 3, 9)).toBe(8)
    expect(nextGridIndex(4, ' ', 3, 9)).toBeNull()
  })
})

describe('project name and save state', () => {
  it('falls back on the first track then « Sans titre »', () => {
    expect(effectiveProjectName('  Mon film ', 'Trace')).toBe('Mon film')
    expect(effectiveProjectName(' ', 'Trace')).toBe('Trace')
    expect(effectiveProjectName('', undefined)).toBe('Sans titre')
  })

  it('is dirty once settings, tracks or name are replaced', () => {
    const tracks: Track[] = []
    const saved = { settings: DEFAULT_SETTINGS, tracks, name: 'a' }
    expect(isProjectDirty({ ...saved }, saved)).toBe(false)
    expect(isProjectDirty({ ...saved, settings: { ...DEFAULT_SETTINGS } }, saved)).toBe(true)
    expect(isProjectDirty({ ...saved, tracks: [] }, saved)).toBe(true)
    expect(isProjectDirty({ ...saved, name: 'b' }, saved)).toBe(true)
  })
})

describe('shellReducer', () => {
  const base: ShellState = { tab: 'trace', collapsed: false, dockOpen: false, collapsedByDock: false, inspecting: false, editing: false, home: null }

  it('a click on the open tab folds the panel, another tab unfolds it', () => {
    const folded = shellReducer(base, { type: 'click-tab', tab: 'trace', narrow: false })
    expect(folded.collapsed).toBe(true)
    expect(shellReducer(folded, { type: 'click-tab', tab: 'trace', narrow: false })).toMatchObject({ collapsed: false })
    expect(shellReducer(base, { type: 'click-tab', tab: 'carte', narrow: false })).toMatchObject({ tab: 'carte', collapsed: false })
    expect(shellReducer(base, { type: 'click-tab', tab: 'objectif', narrow: false })).toMatchObject({ tab: 'objectif', collapsed: false })
  })

  it('keyboard selection never folds', () => {
    expect(shellReducer(base, { type: 'select-tab', tab: 'trace', narrow: false }).collapsed).toBe(false)
  })

  it('on a narrow window the dock folds the panel and gives it back when it closes', () => {
    const open = shellReducer(base, { type: 'toggle-dock', narrow: true })
    expect(open).toMatchObject({ dockOpen: true, collapsed: true, collapsedByDock: true })
    expect(shellReducer(open, { type: 'close-dock' })).toMatchObject({ dockOpen: false, collapsed: false, collapsedByDock: false })
  })

  it('fold closes the panel and the export drawer, without bringing the panel back', () => {
    const open = shellReducer(base, { type: 'toggle-dock', narrow: true })
    expect(shellReducer(open, { type: 'fold' })).toMatchObject({ dockOpen: false, collapsed: true, collapsedByDock: false })
  })

  it('on a wide window both columns stay open', () => {
    const open = shellReducer(base, { type: 'toggle-dock', narrow: false })
    expect(open).toMatchObject({ dockOpen: true, collapsed: false })
    expect(shellReducer(open, { type: 'toggle-dock', narrow: false })).toMatchObject({ dockOpen: false, collapsed: false })
  })

  it('a panel folded by the user stays folded when the dock closes', () => {
    const folded = { ...base, collapsed: true }
    const open = shellReducer(folded, { type: 'toggle-dock', narrow: true })
    expect(open.collapsedByDock).toBe(false)
    expect(shellReducer(open, { type: 'close-dock' }).collapsed).toBe(true)
  })

  it('unfolding the panel on a narrow window closes the dock', () => {
    const open = shellReducer(base, { type: 'toggle-dock', narrow: true })
    expect(shellReducer(open, { type: 'toggle-panel', narrow: true })).toMatchObject({ collapsed: false, dockOpen: false })
  })

  it('on a narrow window the inspector folds the panel like the dock, and gives it back once deselected', () => {
    const shown = shellReducer(base, { type: 'inspect', open: true, narrow: true })
    expect(shown).toMatchObject({ inspecting: true, collapsed: true, collapsedByDock: true })
    expect(shellReducer(shown, { type: 'inspect', open: true, narrow: true })).toBe(shown)
    expect(shellReducer(shown, { type: 'inspect', open: false, narrow: true })).toMatchObject({ inspecting: false, collapsed: false })
    expect(shellReducer(base, { type: 'inspect', open: true, narrow: false })).toMatchObject({ inspecting: true, collapsed: false })
  })

  it('the export drawer goes over the inspector: the panel stays folded until both are gone', () => {
    const shown = shellReducer(base, { type: 'inspect', open: true, narrow: true })
    const drawer = shellReducer(shown, { type: 'toggle-dock', narrow: true })
    expect(drawer).toMatchObject({ dockOpen: true, inspecting: true, collapsed: true })
    const back = shellReducer(drawer, { type: 'close-dock' })
    expect(back).toMatchObject({ dockOpen: false, inspecting: true, collapsed: true })
    const deselected = shellReducer(drawer, { type: 'inspect', open: false, narrow: true })
    expect(deselected).toMatchObject({ dockOpen: true, inspecting: false, collapsed: true })
    expect(shellReducer(deselected, { type: 'close-dock' })).toMatchObject({ collapsed: false, collapsedByDock: false })
  })

  it('selecting a block brings its inspector over the export drawer, which an export in progress keeps', () => {
    const drawer = shellReducer(base, { type: 'toggle-dock', narrow: false })
    expect(drawer.dockOpen).toBe(true)
    // the drawer was open when the block is selected (or another one is): the inspector replaces it
    expect(shellReducer(drawer, { type: 'inspect', open: true, narrow: false })).toMatchObject({ dockOpen: false, inspecting: true })
    const inspecting = shellReducer(drawer, { type: 'inspect', open: true, narrow: false })
    const reopened = shellReducer(inspecting, { type: 'toggle-dock', narrow: false })
    expect(reopened).toMatchObject({ dockOpen: true, inspecting: true })
    expect(shellReducer(reopened, { type: 'inspect', open: true, narrow: false })).toMatchObject({ dockOpen: false, inspecting: true })
    // while exporting the drawer stays over it
    expect(shellReducer(drawer, { type: 'inspect', open: true, narrow: false, exporting: true })).toMatchObject({ dockOpen: true, inspecting: true })
    // the panel folded by the drawer on a narrow window stays folded: the inspector takes the dock
    const narrow = shellReducer(base, { type: 'toggle-dock', narrow: true })
    expect(shellReducer(narrow, { type: 'inspect', open: true, narrow: true })).toMatchObject({ dockOpen: false, inspecting: true, collapsed: true })
  })

  it('portrait phone: « Modifier » opens the inspector of the selected block, « Terminé » closes it and keeps the selection', () => {
    expect(shellReducer(base, { type: 'edit', open: true })).toBe(base)
    const selected = shellReducer(base, { type: 'inspect', open: true, narrow: true })
    expect(selected.editing).toBe(false)
    const editing = shellReducer(selected, { type: 'edit', open: true })
    expect(editing).toMatchObject({ inspecting: true, editing: true, collapsed: true })
    expect(shellReducer(editing, { type: 'edit', open: true })).toBe(editing)
    expect(shellReducer(editing, { type: 'edit', open: false })).toMatchObject({ inspecting: true, editing: false })
    // deselected, or the panel unfolded: the inspector goes with the selection
    expect(shellReducer(editing, { type: 'inspect', open: false, narrow: true })).toMatchObject({ inspecting: false, editing: false })
    expect(shellReducer(editing, { type: 'click-tab', tab: 'carte', narrow: true })).toMatchObject({ inspecting: false, editing: false })
    expect(shellReducer(editing, { type: 'tracks', loaded: false })).toMatchObject({ inspecting: false, editing: false })
  })

  it('unfolding the panel on a narrow window hides the inspector too', () => {
    const shown = shellReducer(base, { type: 'inspect', open: true, narrow: true })
    expect(shellReducer(shown, { type: 'toggle-panel', narrow: true })).toMatchObject({ collapsed: false, inspecting: false })
    expect(shellReducer(shown, { type: 'click-tab', tab: 'carte', narrow: false })).toMatchObject({ collapsed: false, inspecting: true })
  })

  it('without a track only « Projet » is shown, folded, and the other tabs and the export drawer cannot be reached', () => {
    const open = shellReducer({ ...base, tab: 'habillage' }, { type: 'toggle-dock', narrow: false })
    const home = shellReducer(open, { type: 'tracks', loaded: false })
    expect(home).toMatchObject({ tab: 'projet', collapsed: true, dockOpen: false, home: { tab: 'habillage', collapsed: false } })
    expect(shownTabs(home)).toEqual(['projet'])
    expect(shownTabs(base)).toEqual(SHELL_TABS)
    expect(shellReducer(home, { type: 'tracks', loaded: false })).toBe(home)
    for (const tab of SHELL_TABS.filter((t) => t !== 'projet')) {
      expect(shellReducer(home, { type: 'click-tab', tab, narrow: false })).toBe(home)
      expect(shellReducer(home, { type: 'select-tab', tab, narrow: false })).toBe(home)
    }
    expect(shellReducer(home, { type: 'toggle-dock', narrow: false })).toBe(home)
    expect(shellReducer(home, { type: 'click-tab', tab: 'projet', narrow: false })).toMatchObject({ tab: 'projet', collapsed: false })
  })

  it('the first track brings the tabs back as last left, « Trace » in place of « Projet »', () => {
    const home = shellReducer({ ...base, tab: 'survol', collapsed: true }, { type: 'tracks', loaded: false })
    const browsed = shellReducer(home, { type: 'click-tab', tab: 'projet', narrow: false })
    expect(shellReducer(browsed, { type: 'tracks', loaded: true })).toMatchObject({ tab: 'survol', collapsed: true, home: null })
    const fromProjet = shellReducer({ ...base, tab: 'projet' }, { type: 'tracks', loaded: false })
    expect(shellReducer(fromProjet, { type: 'tracks', loaded: true })).toMatchObject({ tab: 'trace', collapsed: false, home: null })
    expect(shellReducer(base, { type: 'tracks', loaded: true })).toBe(base)
  })

  it('a panel folded by the dock is remembered unfolded', () => {
    const open = shellReducer(base, { type: 'toggle-dock', narrow: true })
    expect(shellReducer(open, { type: 'tracks', loaded: false }).home).toEqual({ tab: 'trace', collapsed: false })
  })
})

describe('parseShellPrefs', () => {
  it('reads a saved tab and fold, defaults otherwise', () => {
    expect(parseShellPrefs('{"tab":"habillage","collapsed":true}')).toEqual({ tab: 'habillage', collapsed: true })
    expect(parseShellPrefs('{"tab":"export","collapsed":"oui"}')).toEqual({ tab: 'trace', collapsed: false })
    expect(parseShellPrefs('not json')).toEqual({ tab: 'trace', collapsed: false })
    expect(parseShellPrefs(null)).toEqual({ tab: 'trace', collapsed: false })
    expect(parseShellPrefs('null')).toEqual({ tab: 'trace', collapsed: false })
  })

  it('reads the tabs added later, and an unknown tab id falls back to Trace with the fold kept', () => {
    for (const tab of ['meteo', 'lumiere', 'objectif', 'reglages'] as const) {
      expect(parseShellPrefs(`{"tab":"${tab}","collapsed":false}`)).toEqual({ tab, collapsed: false })
    }
    expect(parseShellPrefs('{"tab":"preferences","collapsed":true}')).toEqual({ tab: 'trace', collapsed: true })
  })
})

describe('parsePreferences', () => {
  it('reads the language, French for anything that is not a known one', () => {
    expect(parsePreferences('{"language":"en"}').language).toBe('en')
    expect(parsePreferences('{"language":"de"}').language).toBe('fr')
    expect(parsePreferences('{"language":3}').language).toBe('fr')
    expect(parsePreferences('{}').language).toBe('fr')
  })

  it('reads each preference, defaults for anything missing, unknown or malformed', () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES)
    expect(parsePreferences('{')).toEqual(DEFAULT_PREFERENCES)
    expect(parsePreferences('[1]')).toEqual(DEFAULT_PREFERENCES)
    const read = parsePreferences('{"status":{"water":false,"weather":"non"},"performance":{"gpu":true,"cpu":true},"timelineClock":true}')
    expect(read).toEqual({
      status: { ...DEFAULT_PREFERENCES.status, water: false },
      performance: { ...DEFAULT_PREFERENCES.performance, gpu: true },
      timelineClock: true,
      timelineMagnet: true,
      appearance: DEFAULT_PREFERENCES.appearance,
      language: 'fr',
    })
    expect(parsePreferences('{"timelineMagnet":false}').timelineMagnet).toBe(false)
    expect(parsePreferences('{"timelineMagnet":"non"}').timelineMagnet).toBe(true)
  })

  it('reads the appearance, the defaults for preferences stored before it existed', () => {
    expect(parsePreferences('{"timelineClock":true}').appearance).toEqual(DEFAULT_PREFERENCES.appearance)
    expect(parsePreferences('{"appearance":{"theme":"dark","accent":"#00766F","density":"compact"}}').appearance).toEqual({
      ...DEFAULT_PREFERENCES.appearance,
      theme: 'dark',
      accent: '#00766f',
      density: 'compact',
    })
  })
})

describe('parseFoldPrefs', () => {
  it('reads the fold state of each section, ignoring anything malformed', () => {
    expect(parseFoldPrefs('{"Caméra":false,"Lumière":true,"Relief":"oui"}')).toEqual({ Caméra: false, Lumière: true })
    expect(parseFoldPrefs(null)).toEqual({})
    expect(parseFoldPrefs('{')).toEqual({})
    expect(parseFoldPrefs('[true]')).toEqual({})
    expect(parseFoldPrefs('null')).toEqual({})
  })
})

describe('dismissSheet', () => {
  it('closes a half sheet dragged down past a third of its height, not a shorter drag', () => {
    expect(dismissSheet(150, 400, 0)).toBe(true)
    expect(dismissSheet(100, 400, 0)).toBe(false)
    expect(dismissSheet(0, 400, 0)).toBe(false)
  })

  it('a flick down closes from a short drag, a move back up keeps it', () => {
    expect(dismissSheet(40, 400, 1000)).toBe(true)
    expect(dismissSheet(150, 400, -800)).toBe(false)
  })
})

describe('tipPlacement', () => {
  // the inspector column of a 1440 px window, from 1140 px
  const column = { left: 1140, top: 48, right: 1440, bottom: 876 }
  const icon = (left: number, top: number) => ({ left, top, right: left + 14, bottom: top + 14 })

  it('keeps a tip centred when it fits', () => {
    expect(tipPlacement(icon(1283, 300), 200, 100, column)).toEqual({ shift: 0, above: false })
  })

  it('shifts a tip clipped by the column into it, on either side', () => {
    // « Lieu » ⓘ near the left edge: centred, the tip would start 47 px out
    expect(tipPlacement(icon(1186, 327), 200, 104, column)).toEqual({ shift: 55, above: false })
    expect(tipPlacement(icon(1420, 327), 200, 104, column)).toEqual({ shift: -95, above: false })
  })

  it('puts it above without room below, and starts it at the left edge when wider than the room', () => {
    expect(tipPlacement(icon(1283, 800), 200, 100, column).above).toBe(true)
    // no room either way: stays below
    expect(tipPlacement(icon(1283, 400), 200, 900, column).above).toBe(false)
    expect(tipPlacement(icon(1283, 300), 400, 50, column).shift).toBe(1148 - (1290 - 200))
  })
})
