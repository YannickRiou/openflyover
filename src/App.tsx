import { Suspense, lazy, useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { useBatchStore } from './export/batch'
import { isRenderWindow, runInRenderWindow } from './export/renderWindow'
import { isExportBusy, useExportStore } from './export/store'
import { isCardItem } from './film/cards'
import { addStop, addText, copyBlocks, duplicateFilmItem, pasteBlocks, removeFilmItem, rippleRemove, splitFilmItem, timedBlockIds } from './film/timeline'
import type { Film } from './film/model'
import { useMediaStore } from './film/media'
import { getBlockClip, setBlockClip } from './ui/blockClipboard'
import { clampWorkArea, markIn, markOut } from './film/workArea'
import { getPlatform } from './platform'
import { takeOpenedFiles, watchOpenedFiles } from './platform/openedFiles'
import { getSettingsHistory, installHistoryShortcuts, installSliderGestures } from './project/history'
import { disableCard, editFilm, getFilmSource, seekKeyframe, useFilmClock } from './scene/usePacing'
import { useAppStore } from './state/store'
import { CameraPanel } from './ui/CameraPanel'
import { DiagnosticDialog } from './ui/DiagnosticDialog'
import { OpenChoiceDialog } from './ui/OpenChoiceDialog'
import { EmptyState } from './ui/EmptyState'
import { GradingPanel } from './ui/GradingPanel'
import { HelpDialog } from './ui/HelpDialog'
import { useActivityProposal } from './ui/activityProposal'
import { ModeQuestion } from './ui/ModeChoice'
import { Tour } from './ui/Tour'
import { SettingsSearch } from './ui/SettingsSearch'
import { isSectionShown, revealSection } from './ui/searchSections'
import { Icon } from './ui/icons'
import type { IconName } from './ui/icons'
import { LandmarkPanel } from './ui/LandmarkPanel'
import { LensPanel } from './ui/LensPanel'
import { installCloseGuard, installLibraryAutosave } from './ui/library'
import { OverlayPanel } from './ui/OverlayPanel'
import { ModeHint, PanelSection, TabWeightDot } from './ui/PanelSection'
import { PreferencesPanel } from './ui/PreferencesPanel'
import { useModeTabs } from './ui/uiMode'
import { chooseFilesToOpen, openFiles, reopenLastProject, reportOpenFailure, saveProject, saveProjectAs } from './ui/projectActions'
import { ProjectPanel } from './ui/ProjectPanel'
import { LightSettings, MapSettings, WeatherSettings } from './ui/SettingsPanel'
import { useSafeZonesStore } from './ui/SafeZones'
import { useScrollEdges } from './ui/useScrollEdges'
import {
  BOTTOM_SHEET_QUERY,
  COMPACT_QUERY,
  ONE_SIDE_MAX_WIDTH,
  SHELL_TABS,
  TAB_GROUPS,
  TAB_GROUP_IDS,
  groupOf,
  isFileDrag,
  matchesQuery,
  parseShellPrefs,
  shellReducer,
  shownTabs,
} from './ui/shell'
import type { ShellTab, TabGroup } from './ui/shell'
import { SheetHandle } from './ui/SheetHandle'
import { keyFocus, matchShortcut, seekTime, withShortcut } from './ui/shortcuts'
import { Stage } from './ui/Stage'
import { StatusBar } from './ui/StatusBar'
import { Timeline } from './ui/Timeline'
import { TimelineResizer } from './ui/TimelineResizer'
import { Toaster } from './ui/Toaster'
import { t as translate, useT } from './i18n'
import { setPreferences } from './ui/preferences'
import { showToast } from './ui/toast'
import { TopBar } from './ui/TopBar'
import { TrackList } from './ui/TrackList'
import { MarkerSection, TrackStyleSection } from './ui/TrackMarkerSection'
import { WeatherSection } from './ui/WeatherPanel'
import { Tab, TabList, TabPanel, Tabs, Tip, ToggleButton, ToggleButtonGroup, isModalOpen } from './ui/primitives'

// Loaded in their own chunks: the offline packs right after the first paint, the export drawer (video, batch,
// poster) when it is first opened, as its codec check pulls mediabunny (~700 kB). They stay mounted once loaded
// (side effects, see the side panel).
const ExportPanel = lazy(() => import('./ui/ExportPanel').then((m) => ({ default: m.ExportPanel })))
const OfflinePanel = lazy(() => import('./ui/OfflinePanel').then((m) => ({ default: m.OfflinePanel })))
// the film inspector only opens on a selected timeline block
const RenderWindowBar = lazy(() => import('./ui/RenderWindowBar').then((m) => ({ default: m.RenderWindowBar })))
// asked once, after the first import of a project
const ActivityDialog = lazy(() => import('./ui/ActivityDialog').then((m) => ({ default: m.ActivityDialog })))
const FilmInspector = lazy(() => import('./ui/FilmInspector').then((m) => ({ default: m.FilmInspector })))

const TAB_LABELS: Record<ShellTab, { label: string; icon: IconName }> = {
  trace: { get label() { return translate('shell.tab.trace') }, icon: 'route' },
  carte: { get label() { return translate('shell.tab.carte') }, icon: 'map' },
  meteo: { get label() { return translate('shell.tab.meteo') }, icon: 'cloud-sun' },
  lumiere: { get label() { return translate('shell.tab.lumiere') }, icon: 'sun' },
  survol: { get label() { return translate('shell.tab.survol') }, icon: 'video' },
  objectif: { get label() { return translate('shell.tab.objectif') }, icon: 'aperture' },
  habillage: { get label() { return translate('shell.tab.habillage') }, icon: 'layers' },
  projet: { get label() { return translate('shell.tab.projet') }, icon: 'folder' },
  reglages: { get label() { return translate('shell.tab.reglages') }, icon: 'sliders-horizontal' },
}

/** The tabs of the rail, in groups (`TAB_GROUPS`), on every device: Trace, Habillage and Projet keep the name of their first tab. */
const GROUP_LABELS: Record<TabGroup, { label: string; icon: IconName }> = {
  trace: TAB_LABELS.trace,
  decor: { get label() { return translate('shell.group.decor') }, icon: 'mountain' },
  camera: { get label() { return translate('shell.group.camera') }, icon: 'video' },
  habillage: TAB_LABELS.habillage,
  projet: TAB_LABELS.projet,
}

/** The tabs of the rail (five groups of tabs, `TAB_GROUPS`): a column on the side, a row in the phone bar (it still scrolls if a language makes them wider). */
const TAB_LIST =
  'flex min-h-0 flex-col items-center gap-1 overflow-y-auto [scrollbar-width:none] ' +
  'phone:scroll-fade-x phone:flex-1 phone:flex-row phone:gap-0 phone:overflow-x-auto phone:overflow-y-hidden phone:overscroll-x-contain phone:px-1'

const PREFS_KEY = 'openflyover.shell.v1'

function loadPrefs() {
  try {
    return parseShellPrefs(getPlatform().storage.get(PREFS_KEY))
  } catch {
    return parseShellPrefs(null)
  }
}

const isNarrow = () => window.innerWidth < ONE_SIDE_MAX_WIDTH
/** below this width the panel is a drawer over the view (`panel-frame`): it starts closed and closes on Escape or outside */
const DRAWER_MAX_WIDTH = 1024
const isDrawer = () => window.innerWidth < DRAWER_MAX_WIDTH
// a batch keeps the shell locked between its jobs too (the export store is idle for a moment between two)
/** Desktop: this page is the « File de rendus » window (export/renderWindow.ts): the 3D view and a progress bar only. */
const renderWindow = isRenderWindow()
/** its run starts once (StrictMode mounts the effects twice in development) */
let renderWindowStarted = false

const isExporting = () => isExportBusy(useExportStore.getState().phase) || useBatchStore.getState().phase === 'running'

const subscribeTo = (media: string) => (onChange: () => void) => {
  const query = window.matchMedia?.(media)
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}
/** The portrait phone layout (`BOTTOM_SHEET_QUERY`): preview on top, timeline, tab bar, half sheets. */
const subscribePhone = subscribeTo(BOTTOM_SHEET_QUERY)
const usePhone = () => useSyncExternalStore(subscribePhone, () => matchesQuery(BOTTOM_SHEET_QUERY))

/** Escape is left to an open menu inside this element (it closes itself first). */
const handlesOwnEscape = (target: EventTarget | null) => target instanceof Element && target.closest('[data-local-escape]') !== null

/**
 * ← / → (Shift: 5 s; Alt: previous / next keyframe), Home and End move the playhead in film time, J / L a frame (Shift:
 * ten); S / T add a stop at the marker / a text at the playhead; K plays / pauses; Delete removes the selected block,
 * Ctrl+D duplicates and X cuts a selected text or photo at the playhead. Its own component: the film clock changes with the settings and must not
 * re-render the shell. Listens in the bubble phase, after a timeline block that moves with the arrows (it prevents the
 * default).
 */
function SeekShortcuts() {
  const clock = useFilmClock()
  const clockRef = useRef(clock)
  useEffect(() => {
    clockRef.current = clock
  }, [clock])

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented || isModalOpen()) return
      const action = matchShortcut(e, keyFocus(e.target))
      const store = useAppStore.getState()
      if (!action || store.tracks.length === 0 || isExporting()) return
      const c = clockRef.current
      const total = c.totalTime()
      const playhead = Math.min(store.playback.timeS ?? c.timeAtProgress(store.playback.progress), total)
      if (action === 'add-stop' || action === 'add-text') {
        e.preventDefault()
        if (e.repeat) return
        if (action === 'add-stop') editFilm((f) => addStop(f, Math.round(store.playback.progress * (getFilmSource().track ?? store.tracks[0]).stats.distanceM)), { stops: true })
        else {
          const selectedStop = c.stops.find((s) => s.id === store.filmSelection) ?? null
          editFilm((f) => addText(f, playhead, selectedStop), { stops: selectedStop !== null })
        }
        return
      }
      if (action === 'mark-in' || action === 'mark-out' || action === 'clear-range') {
        e.preventDefault()
        if (e.repeat) return
        const area = clampWorkArea(store.workArea, total)
        store.setWorkArea(action === 'clear-range' ? null : action === 'mark-in' ? markIn(area, playhead, total) : markOut(area, playhead, total))
        return
      }
      if (action === 'play-pause') {
        e.preventDefault()
        if (!e.repeat) store.setPlaying(!store.playback.playing)
        return
      }
      if (action === 'copy' || action === 'paste') {
        const source = getFilmSource().film
        if (action === 'copy') {
          // blocks picked together, or the block selected: else the page's own copy of a text selection goes on
          const copied = copyBlocks(source, store.filmKeys.length > 1 ? store.filmKeys : store.filmSelection === null ? [] : [store.filmSelection])
          if (!copied) return
          e.preventDefault()
          setBlockClip(copied)
          return
        }
        const clip = getBlockClip()
        const media = () => useMediaStore.getState().table
        const pasted = clip ? pasteBlocks(source, clip, playhead, (src) => media()[src] !== undefined) : null
        if (!clip || !pasted) return
        e.preventDefault()
        if (e.repeat) return
        editFilm((f) => ({ film: pasteBlocks(f, clip, playhead, (src) => media()[src] !== undefined)?.film ?? f }))
        store.setFilmKeys(pasted.ids)
        return
      }
      if (action === 'remove' || action === 'ripple-remove' || action === 'duplicate' || action === 'split') {
        // blocks or keys picked together, or the block selected
        const picked = store.filmKeys.length > 1 ? store.filmKeys : store.filmSelection === null ? [] : [store.filmSelection]
        const item = picked[0]
        if (item === undefined) return
        e.preventDefault()
        if (e.repeat) return
        if (action === 'ripple-remove') {
          // Shift+Delete on texts, media and music: the gap closes
          if (picked.every((id) => timedBlockIds(getFilmSource().film).includes(id))) editFilm((f) => ({ film: rippleRemove(f, picked), id: null }))
        } else if (action === 'remove') {
          if (picked.length === 1 && isCardItem(item)) disableCard(item)
          else editFilm((f) => ({ film: picked.reduce(removeFilmItem, f), id: null }), { stops: picked.some((id) => c.stops.some((s) => s.id === id)) })
        } else if (picked.length === 1) {
          // a text or a photo: a copy just after it, or cut in two at the playhead, the new one selected
          editFilm((f) => {
            const done = action === 'duplicate' ? duplicateFilmItem(f, item) : splitFilmItem(f, item, playhead)
            return done ? { film: done.film, id: done.id } : { film: f }
          })
        }
        return
      }
      if (action === 'seek-prev-key' || action === 'seek-next-key') {
        // Alt+← is also the browser's « back »: kept from it even without a keyframe to go to
        e.preventDefault()
        seekKeyframe(c, action === 'seek-prev-key' ? -1 : 1)
        return
      }
      const t = seekTime(action, playhead, total, store.settings.video.fps)
      if (t === null) return
      e.preventDefault()
      store.setProgress(c.progressAtTime(t), t < total ? t : null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  return null
}

/**
 * Portrait phone: the actions of the selected timeline block in place of the tab bar (« Terminé » deselects it,
 * « Modifier » opens its inspector in the half sheet). « Couper » (at the playhead) and « Dupliquer » only for the blocks
 * that take them, as X and Ctrl+D: a text or a photo is cut, a text or a medium duplicated; never the flight nor a stop.
 */
function BlockTools({ onEdit, disabled }: { onEdit(): void; disabled: boolean }) {
  const t = useT()
  const item = useAppStore((s) => s.filmSelection)
  const shot = useAppStore((s) => (item === 'opening' || item === 'closing' ? s.settings.film[item] : null))
  const clock = useFilmClock()
  const playheadS = (s: { playback: { timeS?: number | null; progress: number } }) => Math.min(s.playback.timeS ?? clock.timeAtProgress(s.playback.progress), clock.totalTime())
  // the selectors give booleans: the bar renders again only when one changes, not at each frame of the playback
  const splits = useAppStore((s) => item !== null && splitFilmItem(s.settings.film, item, playheadS(s)) !== null)
  const cuttable = useAppStore((s) => item !== null && (s.settings.film.texts.some((x) => x.id === item) || s.settings.film.media.some((m) => m.id === item && m.kind === 'image' && !m.sync)))
  const duplicates = useAppStore((s) => item !== null && duplicateFilmItem(s.settings.film, item) !== null)
  if (item === null) return null
  const isStop = clock.stops.some((s) => s.id === item)
  /** a copy or the second piece, selected (one undo step) */
  const make = (done: (f: Film) => { film: Film; id: string } | null) =>
    editFilm((f) => {
      const result = done(f)
      return result ? { film: result.film, id: result.id } : { film: f }
    })
  return (
    <div className="rail-frame chrome-focus items-center gap-0 px-0.5" data-rail="" role="toolbar" aria-label={t('shell.blockTools.aria')}>
      <button type="button" className="rail-tab" onClick={() => useAppStore.getState().setFilmSelection(null)}>
        <Icon name="check" />
        <span className="rail-label">{t('common.done')}</span>
      </button>
      {/* (five buttons at most, a fifth of the width each: the line is thin and close) */}
      <span className="h-8 w-px flex-none bg-white/15" aria-hidden="true" />
      <button type="button" className="rail-tab" onClick={onEdit} disabled={disabled}>
        <Icon name="sliders-horizontal" />
        <span className="rail-label">{t('shell.blockTools.edit')}</span>
      </button>
      {cuttable && (
        <button
          type="button"
          className="rail-tab"
          disabled={disabled || !splits}
          onClick={() => make((f) => splitFilmItem(f, item, playheadS(useAppStore.getState())))}
        >
          <Icon name="scissors" />
          <span className="rail-label">{t('shell.blockTools.split')}</span>
        </button>
      )}
      {duplicates && (
        <button type="button" className="rail-tab" disabled={disabled} onClick={() => make((f) => duplicateFilmItem(f, item))}>
          <Icon name="copy" />
          <span className="rail-label">{t('shell.blockTools.duplicate')}</span>
        </button>
      )}
      <button
        type="button"
        className="rail-tab"
        disabled={disabled || shot?.style === 'aucune'}
        onClick={() => (isCardItem(item) ? disableCard(item) : editFilm((f) => ({ film: removeFilmItem(f, item), id: null }), { stops: isStop }))}
      >
        <Icon name="trash-2" />
        <span className="rail-label">{shot ? t('inspector.noShot') : t('inspector.remove')}</span>
      </button>
    </div>
  )
}

export default function App() {
  const t = useT()
  const hasTracks = useAppStore((s) => s.tracks.length > 0)
  const exportBusy = useExportStore((s) => isExportBusy(s.phase))
  const batchRunning = useBatchStore((s) => s.phase === 'running')
  const exporting = exportBusy || batchRunning
  // the block selected: a new one brings the inspector over the export drawer again
  const selection = useAppStore((s) => (s.tracks.length > 0 ? s.filmSelection : null))
  const selected = selection !== null
  const phone = usePhone()
  const [shell, dispatch] = useReducer(shellReducer, undefined, () =>
    shellReducer(
      { ...loadPrefs(), ...(isDrawer() && { collapsed: true }), dockOpen: false, collapsedByDock: false, inspecting: false, editing: false, home: null },
      { type: 'tracks', loaded: useAppStore.getState().tracks.length > 0 },
    ),
  )
  const tabs = shownTabs(shell)
  // the rail leaves out the tabs the mode hides (the search still finds their sections)
  const railTabs = useModeTabs(tabs)
  // the tab of a group opens the one of its tabs last shown
  const [lastShown, setLastShown] = useState<Partial<Record<TabGroup, ShellTab>>>({})
  if (lastShown[groupOf(shell.tab)] !== shell.tab) setLastShown({ ...lastShown, [groupOf(shell.tab)]: shell.tab })
  const groupTabs = (group: TabGroup) => (TAB_GROUPS[group] as readonly ShellTab[]).filter((tab) => railTabs.includes(tab))
  const railItems = TAB_GROUP_IDS.filter((group) => groupTabs(group).length > 0).map((group) => {
    const members = groupTabs(group)
    const last = lastShown[group]
    const id = members.includes(shell.tab) ? shell.tab : last && members.includes(last) ? last : members[0]!
    return { key: group, id, members, ...GROUP_LABELS[group] }
  })
  /** the tabs of the open group, switched at the top of the panel */
  const siblings = groupTabs(groupOf(shell.tab))
  const [dragging, setDragging] = useState(false)
  // the export drawer is mounted on its first opening, or on the first export (« Capturer cette image »), and kept (export
  // progress, result, batch): it is what saves the file
  const [dockMounted, setDockMounted] = useState(false)
  if ((shell.dockOpen || exportBusy) && !dockMounted) setDockMounted(true)
  const proposed = useActivityProposal((s) => s.figure !== null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const dockOpen = useRef(shell.dockOpen)
  const collapsedRef = useRef(shell.collapsed)
  const tabList = useRef<HTMLDivElement>(null)
  // on a phone the rail is a row that scrolls sideways: its hidden side fades
  const railFade = useScrollEdges(phone)
  const railRef = useCallback(
    (el: HTMLDivElement | null) => {
      tabList.current = el
      railFade(el)
    },
    [railFade],
  )

  // desktop: a batch asked on the command line runs once the app is up, then the app quits (export/cliRender.ts);
  // otherwise the project open when the app was last left comes back
  useEffect(() => {
    if (renderWindow) {
      if (!renderWindowStarted) void runInRenderWindow()
      renderWindowStarted = true
      return
    }
    const rendering = getPlatform().capabilities.isDesktop ? import('./export/cliRender').then((m) => m.runCliRenderIfAsked()) : Promise.resolve(false)
    void reopenLastProject(rendering, () => takeOpenedFiles(reportOpenFailure))
  }, [])

  // desktop: the queue rendered in the « File de rendus » window shows here as it goes
  useEffect(() => {
    if (!getPlatform().capabilities.isDesktop || renderWindow) return
    let stop: (() => void) | null = null
    let live = true
    void import('./export/queue').then(({ installQueueSync }) => {
      if (live) stop = installQueueSync(false)
    })
    return () => {
      live = false
      stop?.()
    }
  }, [])

  // desktop: a project the system opens with the app while it runs (macOS; elsewhere each file starts an instance)
  useEffect(
    () =>
      renderWindow ? undefined : watchOpenedFiles((files) => {
        if (isExporting()) showToast({ kind: 'info', text: translate('shell.exportBusy') })
        else void openFiles(files)
      }, reportOpenFailure),
    [],
  )

  // remember the tab and the folded panel chosen by the user (not a fold caused by the export drawer)
  const keptCollapsed = shell.collapsed && !shell.collapsedByDock
  const home = shell.home !== null
  useEffect(() => {
    // the drawer of a narrow window opens and closes on its own: only the tab is worth keeping then; the home
    // screen's folded « Projet » is not a choice
    if (isDrawer() || home || renderWindow) return
    try {
      getPlatform().storage.set(PREFS_KEY, JSON.stringify({ tab: shell.tab, collapsed: keptCollapsed }))
    } catch {
      // storage unavailable: the choice lasts for the session
    }
  }, [shell.tab, keptCollapsed, home])

  // no track: only « Projet » in the rail; the first track brings the other tabs back
  useEffect(() => dispatch({ type: 'tracks', loaded: hasTracks }), [hasTracks])

  // the tab open is one the mode now hides: the first tab takes its place
  useEffect(() => {
    if (!railTabs.includes(shell.tab) && !shell.collapsed) dispatch({ type: 'select-tab', tab: railTabs[0], narrow: isNarrow() })
  }, [railTabs, shell.tab, shell.collapsed])

  useEffect(() => {
    dockOpen.current = shell.dockOpen
  }, [shell.dockOpen])

  // the phone tab bar scrolls: the open tab stays in sight (also when restored at startup)
  useEffect(() => {
    tabList.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [shell.tab, railTabs])

  useEffect(() => {
    collapsedRef.current = shell.collapsed
    if (shell.collapsed) return
    // drawer mode: a press outside the panel and its rail closes it (a bottom sheet leaves the view usable)
    const onPointerDown = (e: PointerEvent) => {
      if (!isDrawer() || matchesQuery(BOTTOM_SHEET_QUERY) || !(e.target instanceof Element)) return
      if (e.target.closest('#side-panel, [data-rail]')) return
      dispatch({ type: 'toggle-panel', narrow: true })
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [shell.collapsed])

  // no undo during an export: the film being rendered would change under it
  useEffect(() => installHistoryShortcuts(getSettingsHistory(), window, () => !isExporting()), [])
  useEffect(() => installSliderGestures(getSettingsHistory()), [])
  // a project emptied of its tracks is not written over the kept one (it waits for a track)
  // the render window shows the queue's projects, never the one being edited: nothing of it is kept
  useEffect(() => (renderWindow ? undefined : installLibraryAutosave(() => !isExporting() && useAppStore.getState().tracks.length > 0)), [])
  useEffect(() => (renderWindow ? undefined : installCloseGuard(isExporting, saveProject)), [])
  // a hidden page draws no frame: the film pauses, and its music and video clips with it (an export goes on hidden)
  useEffect(() => {
    const pause = () => {
      if (document.hidden && !isExporting() && useAppStore.getState().playback.playing) useAppStore.getState().setPlaying(false)
    }
    document.addEventListener('visibilitychange', pause)
    return () => document.removeEventListener('visibilitychange', pause)
  }, [])

  /** a pointer button is down */
  const pressed = useRef(false)
  useEffect(() => {
    const down = () => {
      pressed.current = true
    }
    const up = () => {
      pressed.current = false
    }
    // a release outside the window is not seen: the next move tells
    const move = (e: PointerEvent) => {
      pressed.current = e.buttons !== 0
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    window.addEventListener('pointermove', move, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      window.removeEventListener('pointermove', move, true)
    }
  }, [])

  // a timeline block selected: its inspector in the dock, over the export drawer unless an export runs, after the release
  // of a press (the timeline must not change scale under a drag); the dock given back to the panel (narrow window): deselected
  useEffect(() => {
    const show = () => {
      window.removeEventListener('pointerup', show)
      window.removeEventListener('pointercancel', show)
      dispatch({ type: 'inspect', open: selected, narrow: isNarrow(), exporting: isExportBusy(useExportStore.getState().phase) || useBatchStore.getState().phase === 'running' })
    }
    if (!selected || !pressed.current) {
      show()
      return
    }
    window.addEventListener('pointerup', show)
    window.addEventListener('pointercancel', show)
    return () => {
      window.removeEventListener('pointerup', show)
      window.removeEventListener('pointercancel', show)
    }
  }, [selected, selection])
  useEffect(() => {
    // a group of keys has no inspector: it stays selected
    if (!shell.inspecting && useAppStore.getState().filmKeys.length === 0) useAppStore.getState().setFilmSelection(null)
  }, [shell.inspecting])

  useEffect(() => {
    // capture phase: Escape closes the export drawer, else deselects the timeline block (the dialogs close themselves)
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.isComposing || isModalOpen()) return
      const action = matchShortcut(e, keyFocus(e.target))
      if (!action || action.startsWith('seek') || action.startsWith('add-')) return
      if (action === 'close') {
        if (handlesOwnEscape(e.target)) return
        const store = useAppStore.getState()
        if (dockOpen.current && !isExporting()) dispatch({ type: 'close-dock' })
        else if (store.filmSelection !== null || store.filmKeys.length > 0) store.setFilmSelection(null)
        else if (isDrawer() && !collapsedRef.current) dispatch({ type: 'toggle-panel', narrow: true })
        else return
        e.stopPropagation()
      } else if (action === 'help') {
        setHelpOpen(true)
      } else if (action === 'search') {
        if (!isExporting()) setSearchOpen(true)
      } else if (action === 'save') {
        if (!isExporting()) saveProject()
      } else if (action === 'save-as') {
        if (!isExporting()) void saveProjectAs()
      } else if (action === 'open') {
        if (!isExporting()) void chooseFilesToOpen()
      } else if (action === 'export') {
        if (!isExporting()) dispatch({ type: 'toggle-dock', narrow: isNarrow() })
      } else if (action === 'fit') {
        if (e.repeat || isExporting() || useAppStore.getState().tracks.length === 0) return
        useAppStore.getState().requestFit()
      } else if (action === 'safe-zones') {
        if (!e.repeat) useSafeZonesStore.getState().toggle()
      } else if (action === 'toggle-panel') {
        if (e.repeat || isExporting()) return
        dispatch({ type: 'toggle-panel', narrow: isNarrow() })
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // files dropped anywhere: tracks imported, a project opened; the timeline keeps its own drop (photos)
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (!isFileDrag(e.dataTransfer?.types)) return
      if (e.defaultPrevented) {
        setDragging(false)
        return
      }
      // without this, the browser would open the dropped file in place of the app
      e.preventDefault()
      const accepted = !isExporting()
      if (e.dataTransfer) e.dataTransfer.dropEffect = accepted ? 'copy' : 'none'
      setDragging(accepted)
    }
    const onDragLeave = (e: DragEvent) => {
      // the pointer left the window
      if (!e.relatedTarget) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      setDragging(false)
      if (e.defaultPrevented || !isFileDrag(e.dataTransfer?.types)) return
      e.preventDefault()
      const files = getPlatform().droppedFiles(e.dataTransfer)
      if (files.length > 0 && !isExporting()) void openFiles(files)
    }
    const stop = () => setDragging(false)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragend', stop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', stop)
    }
  }, [])

  const panel = (tab: ShellTab, children: ReactNode) => (
    <TabPanel key={tab} id={tab} data-testid={`tab-panel-${tab}`} className="tabpanel-frame">
      {children}
    </TabPanel>
  )

  // the tab contents, the stage and the timeline are built once per track state: React skips the same elements when
  // only the shell changes (else a tab switch re-renders the nine panels and reconciles the 3D scene; slow on a phone)
  const contents = useMemo(
    () => ({
      trace: (
        <>
          <TrackList />
          <TrackStyleSection hidden={!hasTracks} />
          <MarkerSection hidden={!hasTracks} />
          <ModeHint panel="trace" />
        </>
      ),
      carte: (
        <>
          <MapSettings />
          <LandmarkPanel />
          <ModeHint panel="carte" />
        </>
      ),
      meteo: (
        <>
          <WeatherSection hidden={!hasTracks} />
          <WeatherSettings />
          <ModeHint panel="meteo" />
        </>
      ),
      lumiere: (
        <>
          <LightSettings />
          <GradingPanel />
          <ModeHint panel="lumiere" />
        </>
      ),
      survol: (
        <>
          <CameraPanel />
          <ModeHint panel="survol" />
        </>
      ),
      objectif: <LensPanel />,
      habillage: (
        <>
          <OverlayPanel />
          <ModeHint panel="habillage" />
        </>
      ),
      projet: (
        <>
          <ProjectPanel />
          <PanelSection title={t('shell.section.offline')} hidden={!hasTracks}>
            <Suspense>
              <OfflinePanel />
            </Suspense>
          </PanelSection>
        </>
      ),
      reglages: <PreferencesPanel />,
      stage: (
        <Stage>
          {!hasTracks && <EmptyState />}
          <Toaster />
        </Stage>
      ),
    }),
    // `t`: the titles passed down are worded here, the panels render again on their own
    [hasTracks, t],
  )
  // the landscape phone timeline folds under a sheet; the portrait one stays (the sheet lies over it)
  const sheetOpen = (!shell.collapsed || shell.dockOpen) && !phone
  const timeline = useMemo(
    () => (
      <Timeline
        sheetOpen={sheetOpen}
        centred={phone}
        onUnfold={() => {
          if (matchesQuery(COMPACT_QUERY) && !isExporting()) dispatch({ type: 'fold' })
        }}
      />
    ),
    [sheetOpen, phone],
  )

  return (
    <div className="shell-frame">
      {renderWindow ? (
        <Suspense>
          <RenderWindowBar />
        </Suspense>
      ) : (
      <TopBar
        onOpen={() => void chooseFilesToOpen()}
        exportOpen={shell.dockOpen}
        onToggleExport={() => dispatch({ type: 'toggle-dock', narrow: isNarrow() })}
        onHelp={() => setHelpOpen(true)}
      />
      )}

      <div className="relative flex min-h-0 phone:flex-col" data-collapsed={shell.collapsed || undefined}>
        <Tabs
          value={shell.tab}
          onChange={(tab) => dispatch({ type: 'select-tab', tab: tab as ShellTab, narrow: isNarrow() })}
          onReselect={(tab) => dispatch({ type: 'click-tab', tab: tab as ShellTab, narrow: isNarrow() })}
          orientation={phone ? 'horizontal' : 'vertical'}
        >
          {/* portrait phone: a selected block's actions take the place of the tab bar */}
          <nav className="rail-frame chrome-focus justify-between" data-rail="" aria-label={t('shell.rail.aria')} hidden={(phone && shell.inspecting) || renderWindow}>
            <TabList label={t('shell.rail.tablist')} className={TAB_LIST} ref={railRef}>
              {railItems.map((item) => (
                <Tab key={item.id} id={item.id} data-testid={`tab-${item.key}`} className="rail-tab" disabled={exporting} tip={item.label} tipDisabled={phone}>
                  <Icon name={item.icon} />
                  <span className="rail-label">{item.label}</span>
                  <TabWeightDot tabs={item.members} />
                </Tab>
              ))}
            </TabList>
            <Tip text={withShortcut(shell.collapsed ? t('shell.rail.expand') : t('shell.rail.collapse'), 'toggle-panel')} side="right">
              <button
                type="button"
                className="rail-toggle"
                onClick={() => dispatch({ type: 'toggle-panel', narrow: isNarrow() })}
                disabled={exporting}
                aria-expanded={!shell.collapsed}
                aria-controls="side-panel"
                aria-label={shell.collapsed ? t('shell.rail.expand') : t('shell.rail.collapse')}
              >
                <Icon name={shell.collapsed ? 'panel-left-open' : 'panel-left-close'} />
              </button>
            </Tip>
          </nav>

          {/* every tab stays mounted: weather, landmarks and export have side effects */}
          {/* no change to the tracks or the settings while a film is being made: the export reads them live */}
          <aside id="side-panel" data-testid="side-panel" className="panel-frame" aria-label={t('shell.panel.aria')} hidden={shell.collapsed || renderWindow} inert={exporting}>
            {/* no title: the tab bar stays in sight under the sheet and shows the open tab, the first section names it again */}
            <SheetHandle onClose={() => dispatch({ type: 'fold' })} />
            {siblings.length > 1 && (
              <div className="sticky top-0 z-1 flex-none bg-surface-panel px-4 pt-2 pb-2 phone-any:px-3" data-sheet-fixed="" data-testid="tab-group-switch">
                <ToggleButtonGroup<ShellTab>
                  value={shell.tab}
                  onChange={(tab) => dispatch({ type: 'select-tab', tab, narrow: isNarrow() })}
                  aria-label={GROUP_LABELS[groupOf(shell.tab)].label}
                >
                  {siblings.map((tab) => (
                    <ToggleButton key={tab} value={tab}>
                      {TAB_LABELS[tab].label}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </div>
            )}
            {SHELL_TABS.map((tab) => panel(tab, contents[tab]))}
          </aside>
        </Tabs>

        <main className="flex min-h-0 min-w-0 flex-auto flex-col bg-chrome phone:order-1 phone-any:relative">
          {contents.stage}
          {hasTracks && !renderWindow && <TimelineResizer disabled={exporting} />}
          {!renderWindow && timeline}
        </main>

        <aside id="export-dock" data-testid="export-dock" className="dock-frame" aria-label={t('shell.dock.export')} hidden={!shell.dockOpen || renderWindow}>
          <SheetHandle onClose={() => !exporting && dispatch({ type: 'close-dock' })} />
          <Suspense fallback={<p className="type-hint px-4">{t('shell.loading')}</p>}>
            {dockMounted && <ExportPanel onClose={exporting ? undefined : () => dispatch({ type: 'close-dock' })} />}
          </Suspense>
        </aside>
        {phone && shell.inspecting && <BlockTools disabled={exporting} onEdit={() => dispatch({ type: 'edit', open: true })} />}
        {/* the export drawer goes first; on a portrait phone the inspector waits for « Modifier » */}
        <aside className="dock-frame" aria-label={t('shell.dock.inspector')} hidden={shell.dockOpen || !shell.inspecting || (phone && !shell.editing)} inert={exporting}>
          <SheetHandle onClose={() => dispatch({ type: 'edit', open: false })} />
          {shell.inspecting && !shell.dockOpen && (!phone || shell.editing) && (
            <Suspense>
              <FilmInspector />
            </Suspense>
          )}
        </aside>
      </div>

      {!renderWindow && <StatusBar />}
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      {!renderWindow && <ModeQuestion />}
      {!renderWindow && proposed && (
        <Suspense>
          <ActivityDialog />
        </Suspense>
      )}
      {!renderWindow && <Tour />}
      <SettingsSearch
        open={searchOpen}
        tabs={tabs}
        onClose={() => setSearchOpen(false)}
        onPick={({ tab, title, needs }) => {
          setSearchOpen(false)
          // a section the mode hides: the mode that has it comes on, and says so
          if (needs && !isSectionShown(title)) {
            setPreferences({ uiMode: needs })
            showToast({ kind: 'info', text: t('shell.mode.switched', { mode: t(`shell.mode.${needs}`) }) })
          }
          dispatch({ type: 'select-tab', tab, narrow: isNarrow() })
          // the tab is drawn (the event is discrete: React has committed it) before the next frame: then the section opens
          requestAnimationFrame(() => revealSection(title))
        }}
      />
      <DiagnosticDialog />
      <OpenChoiceDialog />
      <SeekShortcuts />
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-100 flex items-center justify-center bg-ink/60 p-8 fade-in" aria-hidden="true">
          <div className="flex w-[min(520px,100%)] flex-col items-center gap-2 rounded-md border-2 border-dashed border-white bg-chrome px-6 py-8 text-center text-white">
            <Icon name="upload" size={32} />
            <p className="m-0 font-heading text-[20px]/[1.2] font-semibold">{t('shell.drop.title')}</p>
            <p className="m-0 text-[13px] text-glacier">{t('shell.drop.hint')}</p>
          </div>
        </div>
      )}
    </div>
  )
}
