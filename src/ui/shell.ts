/**
 * Pure logic of the application shell (no React, no DOM): framing of the 3D preview to the output format,
 * routing of the opened or dropped files, project name and save state (shortcuts: `shortcuts.ts`).
 */
import { SNAP_GROUPS } from '../film/timeline'
import type { SnapGroup } from '../film/timeline'
import { isRecord } from '../core/guards'
import { DEFAULT_APPEARANCE, parseAppearance } from './appearance'
import type { Appearance } from './appearance'
import { DEFAULT_LANGUAGE, isLanguageCode } from '../i18n/languages'
import type { LanguageCode } from '../i18n/languages'
import type { Track } from '../core/types'
import { defaultProjectName } from '../project/document'
import type { Settings } from '../state/store'

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Largest rectangle of ratio `aspect` (width / height) centred in a `width` × `height` stage, in whole pixels
 * (letterbox or pillarbox); the whole stage when `aspect` is null (free framing) or the stage is empty.
 */
export function frameRect(width: number, height: number, aspect: number | null): Rect {
  if (aspect === null || !(aspect > 0) || width <= 0 || height <= 0) {
    return { left: 0, top: 0, width: Math.max(0, width), height: Math.max(0, height) }
  }
  const w = Math.min(width, Math.round(height * aspect))
  const h = Math.min(height, Math.round(w / aspect))
  return { left: Math.floor((width - w) / 2), top: Math.floor((height - h) / 2), width: w, height: h }
}

/** Files picked with « Ouvrir » or dropped on the window: a project (.opnflvr, or an older .json) is opened, everything else goes to the track importer. */
export interface OpenedFiles<F> {
  project: F | null
  tracks: F[]
  /** projects beyond the first: one project at a time */
  extraProjects: F[]
}

export function routeOpenedFiles<F extends { name: string }>(files: readonly F[]): OpenedFiles<F> {
  const out: OpenedFiles<F> = { project: null, tracks: [], extraProjects: [] }
  for (const file of files) {
    if (!/\.(opnflvr|json)$/i.test(file.name)) out.tracks.push(file)
    else if (out.project) out.extraProjects.push(file)
    else out.project = file
  }
  return out
}

/** A drag carries files (not text or a link): the window offers to import them. */
export function isFileDrag(types: readonly string[] | null | undefined): boolean {
  return types?.includes('Files') ?? false
}

/**
 * Index of the cell that takes the focus after `key` in a grid of `count` cells, `columns` per row (row by row), null
 * for any other key: the arrows move one cell and stop at the edges, Home / End go to the first / last cell.
 */
export function nextGridIndex(current: number, key: string, columns: number, count: number): number | null {
  if (count <= 0 || columns <= 0) return null
  const col = current % columns
  if (key === 'ArrowLeft') return col > 0 ? current - 1 : current
  if (key === 'ArrowRight') return col < columns - 1 && current + 1 < count ? current + 1 : current
  if (key === 'ArrowUp') return current - columns >= 0 ? current - columns : current
  if (key === 'ArrowDown') return current + columns < count ? current + columns : current
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

/** Name used for the project file: the typed name, else the first track's, else « Sans titre ». */
export function effectiveProjectName(name: string, firstTrackName: string | undefined): string {
  return name.trim() || firstTrackName || defaultProjectName()
}

/** What a saved project contains, as compared by reference with the last save or open. */
export interface SavedProject {
  settings: Settings
  tracks: readonly Track[]
  name: string
}

/** The project changed since `saved` (settings, tracks or name replaced since then). */
export function isProjectDirty(current: SavedProject, saved: SavedProject): boolean {
  return current.settings !== saved.settings || current.tracks !== saved.tracks || current.name !== saved.name
}

// ---------------------------------------------------------------------------
// Side columns: tabs of the left panel and the right dock (export drawer, else the inspector of the timeline)
// ---------------------------------------------------------------------------

/**
 * In montage order: the track, the place, the weather, the light, the camera, the lens, the overlay, the project; then
 * the preferences of the app (not of the project).
 */
export const SHELL_TABS = ['trace', 'carte', 'meteo', 'lumiere', 'survol', 'objectif', 'habillage', 'projet', 'reglages'] as const
export type ShellTab = (typeof SHELL_TABS)[number]

/** The only tab of the home screen (no track): the others have nothing to act on yet. */
export const HOME_TABS: readonly ShellTab[] = ['projet']

/** Below this window width (px) only one side column is open at a time (panel or dock). */
export const ONE_SIDE_MAX_WIDTH = 1360

export interface ShellState {
  tab: ShellTab
  /** the left panel is folded into the rail */
  collapsed: boolean
  /** the export drawer is open in the right dock */
  dockOpen: boolean
  /** the panel was folded by the opening of the dock: it comes back when the dock closes */
  collapsedByDock: boolean
  /** a timeline block is selected: the dock shows its inspector (the export drawer goes first) */
  inspecting: boolean
  /** portrait phone: the inspector of the selected block is open (« Modifier »); else its actions replace the tab bar */
  editing: boolean
  /** no track (home screen): the tab and fold to restore once one is loaded; null when there is one */
  home: Pick<ShellState, 'tab' | 'collapsed'> | null
}

/** The tabs shown in the rail. */
export const shownTabs = (state: Pick<ShellState, 'home'>): readonly ShellTab[] => (state.home ? HOME_TABS : SHELL_TABS)

export type ShellEvent =
  /** click on a tab: shows it, or folds the panel when it is already shown */
  | { type: 'click-tab'; tab: ShellTab; narrow: boolean }
  /** keyboard move to a tab: shows it */
  | { type: 'select-tab'; tab: ShellTab; narrow: boolean }
  | { type: 'toggle-panel'; narrow: boolean }
  | { type: 'toggle-dock'; narrow: boolean }
  | { type: 'close-dock' }
  /** a timeline block is selected (`open`) or no longer; `exporting`: an export runs, its drawer stays over the inspector */
  | { type: 'inspect'; open: boolean; narrow: boolean; exporting?: boolean }
  /** portrait phone: « Modifier » opens the selected block's inspector, « Terminé » closes it (the block stays selected) */
  | { type: 'edit'; open: boolean }
  /** the phone timeline unfolds: panel and export drawer make room (one sheet at a time) */
  | { type: 'fold' }
  /** the first track is loaded (`loaded`) or the last one removed */
  | { type: 'tracks'; loaded: boolean }

/** The panel unfolds; on a narrow window it takes the place of the dock (drawer and inspector). */
function unfold(state: ShellState, narrow: boolean): ShellState {
  return narrow
    ? { ...state, collapsed: false, collapsedByDock: false, dockOpen: false, inspecting: false, editing: false }
    : { ...state, collapsed: false, collapsedByDock: false }
}

/** The dock shows nothing any more: the panel folded by its opening comes back. */
function emptyDock(state: ShellState): ShellState {
  return state.collapsedByDock ? { ...state, collapsed: false, collapsedByDock: false } : state
}

function closeDock(state: ShellState): ShellState {
  if (!state.dockOpen) return state
  const closed = { ...state, dockOpen: false }
  return state.inspecting ? closed : emptyDock(closed)
}

/** Something appears in an empty dock: on a narrow window it folds the panel. */
function fillDock(state: ShellState, narrow: boolean): ShellState {
  if (narrow && !state.collapsed) return { ...state, collapsed: true, collapsedByDock: true }
  return state
}

/** `narrow`: the window is narrower than ONE_SIDE_MAX_WIDTH when the event happens. */
export function shellReducer(state: ShellState, event: ShellEvent): ShellState {
  switch (event.type) {
    case 'click-tab':
      if (!shownTabs(state).includes(event.tab)) return state
      if (event.tab === state.tab && !state.collapsed) return { ...state, collapsed: true, collapsedByDock: false }
      return unfold({ ...state, tab: event.tab }, event.narrow)
    case 'select-tab':
      if (!shownTabs(state).includes(event.tab)) return state
      return unfold({ ...state, tab: event.tab }, event.narrow)
    case 'toggle-panel':
      return state.collapsed ? unfold(state, event.narrow) : { ...state, collapsed: true, collapsedByDock: false }
    case 'toggle-dock':
      // nothing to export without a track
      if (state.home) return state
      if (state.dockOpen) return closeDock(state)
      return fillDock({ ...state, dockOpen: true }, event.narrow)
    case 'close-dock':
      return closeDock(state)
    case 'inspect':
      // a block selected comes over the export drawer, which an export in progress keeps
      if (event.open && state.dockOpen && !event.exporting) return { ...state, inspecting: true, dockOpen: false }
      if (event.open === state.inspecting) return state
      if (!event.open) {
        const closed = { ...state, inspecting: false, editing: false }
        return state.dockOpen ? closed : emptyDock(closed)
      }
      return state.dockOpen ? { ...state, inspecting: true } : fillDock({ ...state, inspecting: true }, event.narrow)
    case 'edit':
      return state.inspecting && state.editing !== event.open ? { ...state, editing: event.open } : state
    case 'fold':
      return { ...state, collapsed: true, collapsedByDock: false, dockOpen: false }
    case 'tracks':
      if (event.loaded) {
        if (!state.home) return state
        // the tabs come back as last left with a track; « Projet » was the home screen's, the track comes first
        const { tab, collapsed } = state.home
        return { ...state, tab: tab === 'projet' ? 'trace' : tab, collapsed, collapsedByDock: false, home: null }
      }
      // home screen: « Projet » alone and folded, the welcome takes the view
      if (state.home) return state
      return {
        tab: 'projet',
        collapsed: true,
        collapsedByDock: false,
        dockOpen: false,
        inspecting: false,
        editing: false,
        home: { tab: state.tab, collapsed: state.collapsed && !state.collapsedByDock },
      }
  }
}

/** Tab and folded panel remembered by the browser (not by the project); defaults for anything unreadable or unknown. */
export function parseShellPrefs(raw: string | null): Pick<ShellState, 'tab' | 'collapsed'> {
  const fallback = { tab: 'trace' as ShellTab, collapsed: false }
  if (!raw) return fallback
  try {
    const value: unknown = JSON.parse(raw)
    if (value === null || typeof value !== 'object') return fallback
    const { tab, collapsed } = value as Record<string, unknown>
    return {
      tab: (SHELL_TABS as readonly unknown[]).includes(tab) ? (tab as ShellTab) : fallback.tab,
      collapsed: typeof collapsed === 'boolean' ? collapsed : fallback.collapsed,
    }
  } catch {
    return fallback
  }
}

/** Open / folded state of the sections of the panels (`PanelSection`), remembered by the browser by section title. */
export const FOLDS_KEY = 'openflyover.folds.v1'

/** What is remembered: open (true) or folded (false) by section title; nothing for anything unreadable. */
export function parseFoldPrefs(raw: string | null): Record<string, boolean> {
  if (!raw) return {}
  try {
    const value: unknown = JSON.parse(raw)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'))
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Preferences of the app on this device (« Réglages » tab, `preferences.ts`)
// ---------------------------------------------------------------------------

/** Fetches shown as chips in the status bar. */
export const STATUS_CHIPS = ['weather', 'landmarks', 'region', 'water', 'forest', 'glacier'] as const
export type StatusChip = (typeof STATUS_CHIPS)[number]

/**
 * Parts of the performance readout of the status bar: frames drawn per second, textures and geometries on the GPU,
 * terrain tiles loaded, JavaScript memory (Chromium), memory and processor of the machine (desktop app).
 */
export const PERF_ITEMS = ['fps', 'gpu', 'tiles', 'memory', 'system'] as const
export type PerfItem = (typeof PERF_ITEMS)[number]

export interface Preferences {
  status: Record<StatusChip, boolean>
  performance: Record<PerfItem, boolean>
  /** recorded clock time of the marker on the timeline bar, after the timecode */
  timelineClock: boolean
  /** the timeline's magnet: blocks dragged snap to the edges, centres and marks of the others */
  timelineMagnet: boolean
  /** which families of targets the magnet snaps to (`SNAP_GROUPS`) */
  timelineSnap: Record<SnapGroup, boolean>
  /** the timecode of the bar in frames (`mm:ss:ff`, at the fps of the export) instead of seconds and tenths */
  timelineFrames: boolean
  /** look of the interface (`appearance.ts`) */
  appearance: Appearance
  /** language of the interface and of the film overlay (`i18n/`) */
  language: LanguageCode
  /** version of « Nouveautés » last opened (`whatsNew.ts`), '' when never: the dot of the « i » button shows until then */
  whatsNewSeen: string
}

export const DEFAULT_PREFERENCES: Preferences = {
  status: { weather: true, landmarks: true, region: true, water: true, forest: true, glacier: true },
  performance: { fps: true, gpu: false, tiles: true, memory: true, system: true },
  timelineClock: false,
  timelineMagnet: true,
  timelineSnap: { playhead: true, blocks: true, ruler: true, marks: true },
  timelineFrames: false,
  appearance: DEFAULT_APPEARANCE,
  language: DEFAULT_LANGUAGE,
  whatsNewSeen: '',
}

/** The booleans of `raw` for `keys`, the defaults for anything missing or not a boolean. */
function booleans<K extends string>(keys: readonly K[], raw: unknown, defaults: Record<K, boolean>): Record<K, boolean> {
  const value = isRecord(raw) ? raw : {}
  return Object.fromEntries(keys.map((key) => [key, typeof value[key] === 'boolean' ? value[key] : defaults[key]])) as Record<K, boolean>
}

/** Preferences remembered by the platform storage; defaults for anything unreadable or unknown. */
export function parsePreferences(raw: string | null): Preferences {
  let value: unknown = null
  try {
    value = raw ? JSON.parse(raw) : null
  } catch {
    // unreadable: the defaults
  }
  const v = isRecord(value) ? value : {}
  return {
    status: booleans(STATUS_CHIPS, v.status, DEFAULT_PREFERENCES.status),
    performance: booleans(PERF_ITEMS, v.performance, DEFAULT_PREFERENCES.performance),
    timelineClock: typeof v.timelineClock === 'boolean' ? v.timelineClock : DEFAULT_PREFERENCES.timelineClock,
    timelineMagnet: typeof v.timelineMagnet === 'boolean' ? v.timelineMagnet : DEFAULT_PREFERENCES.timelineMagnet,
    timelineSnap: booleans(SNAP_GROUPS, v.timelineSnap, DEFAULT_PREFERENCES.timelineSnap),
    timelineFrames: typeof v.timelineFrames === 'boolean' ? v.timelineFrames : DEFAULT_PREFERENCES.timelineFrames,
    appearance: parseAppearance(v.appearance),
    language: isLanguageCode(v.language) ? v.language : DEFAULT_PREFERENCES.language,
    whatsNewSeen: typeof v.whatsNewSeen === 'string' ? v.whatsNewSeen : DEFAULT_PREFERENCES.whatsNewSeen,
  }
}

// ---------------------------------------------------------------------------
// Phone layouts (the `phone` variants of theme.css)
// ---------------------------------------------------------------------------

/** Portrait phone: preview on top, timeline under it, tabs in a bottom bar; panels and drawers as half sheets over the timeline. */
export const BOTTOM_SHEET_QUERY = '(max-width: 699px)'
/** Phone, either way up: top bar actions in a menu, dialogs full screen; in landscape the timeline folds into a strip. */
export const COMPACT_QUERY = '(max-width: 699px), (max-height: 499px)'

export const matchesQuery = (query: string) => typeof window !== 'undefined' && (window.matchMedia?.(query).matches ?? false)

/** How far a flick carries a half sheet: its speed (px per second, down positive) times this (seconds). */
const SHEET_FLICK_S = 0.2
/** A half sheet dragged down past this fraction of its height (flick included) closes. */
const SHEET_DISMISS = 0.3

/** A half sheet released `dragPx` below its place (`heightPx` tall), moving down at `velocity` px/s, closes. */
export function dismissSheet(dragPx: number, heightPx: number, velocity: number): boolean {
  return dragPx + velocity * SHEET_FLICK_S > heightPx * SHEET_DISMISS
}
