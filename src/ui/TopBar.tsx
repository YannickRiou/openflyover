import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { VIDEO_ASPECTS } from '../export/schedule'
import { useBatchStore } from '../export/batch'
import { isExportBusy, useExportStore } from '../export/store'
import { useT } from '../i18n'
import { getPlatform } from '../platform'
import type { WindowControls } from '../platform'
import { getSettingsHistory } from '../project/history'
import { useAppStore } from '../state/store'
import { LogoMenu, NewsDot, useAppMenu, usePortraitPhone } from './AppMenu'
import { AspectIcon, Icon } from './icons'
import { LanguageMenu } from './LanguageMenu'
import type { IconName } from './icons'
import { saveProject } from './projectActions'
import { effectiveProjectName, isProjectDirty } from './shell'
import { withShortcut } from './shortcuts'
import { Button, Menu, Radio, RadioGroup, TextField, Tip } from './primitives'
import type { ButtonProps, MenuItem } from './primitives'

/** Project name input: reads as text on the bar, a frame on hover, a light field while edited. */
const NAME_INPUT =
  'h-control w-full rounded-sm border border-transparent bg-transparent px-2 text-body font-medium text-ellipsis text-white transition-ui ' +
  'placeholder:text-glacier hover:border-white/20 focus:bg-white focus:text-ink focus:placeholder:text-ink-soft'

/** The save icon: a dot while changes are not saved, the light accent for a few seconds once they are (`data-save-state`). */
const SAVE_STATE =
  'relative data-[save-state=unsaved]:after:absolute data-[save-state=unsaved]:after:top-1.5 data-[save-state=unsaved]:after:right-1.5 ' +
  'data-[save-state=unsaved]:after:size-1.5 data-[save-state=unsaved]:after:rounded-full data-[save-state=unsaved]:after:bg-amber-light ' +
  'data-[save-state=saved]:[--button-fg:var(--color-accent-light)]'

/** « Exporter »: the one primary action of the bar, as high as the icon buttons. */
const EXPORT_BUTTON = 'h-control min-h-0 px-3 whitespace-nowrap tabular-nums'

/** A button of the window on the right of the bar: the height of the bar under its border, as wide as the system's own (46 px). */
const WINDOW_BUTTON = 'h-[calc(var(--topbar-h)-1px)] w-11.5 rounded-none'

/** How long the save icon keeps the accent colour once the project is saved (ms). */
const SAVED_FLASH_MS = 3000

/** `value` of the « Libre » option (no video aspect). */
const FREE = 'free'

/** A bare icon button of the bar, on the ink chrome (`btn-chrome`, utilities.css). */
function BarButton({ className, ...props }: ButtonProps) {
  return <Button variant="icon" className={`btn-chrome ${className ?? ''}`} {...props} />
}

/** Label of a format of the switch: a framed icon, lit when chosen, with the focus ring of the ink chrome. */
const FORMAT_LABEL =
  'inline-flex h-7 w-9 cursor-pointer items-center justify-center gap-0 rounded-sm p-0 text-glacier transition-ui touch:h-11 touch:w-11 ' +
  'group-data-[disabled=true]:cursor-not-allowed hover:bg-white/10 hover:text-white data-[selected=true]:bg-white data-[selected=true]:text-ink ' +
  'data-[focus-visible=true]:outline-2 data-[focus-visible=true]:outline-offset-1 data-[focus-visible=true]:outline-accent-light'

/** Sets the output format: one of the video aspects, or « Libre » (`null`: the framing is free, the aspect of the video is kept). */
function pickFormat(id: string | null) {
  const store = useAppStore.getState()
  const next = VIDEO_ASPECTS.find((a) => a.id === id)
  if (next && next.id !== store.settings.video.aspect) store.setSetting('video', { ...store.settings.video, aspect: next.id })
  store.setFreeFraming(!next)
}

/** The chosen format: `FREE` for « Libre », else the id of the aspect. */
function useFormat() {
  const aspect = useAppStore((s) => s.settings.video.aspect)
  const free = useAppStore((s) => s.freeFraming)
  return free ? FREE : aspect
}

/** Icon of a format: a frame of its ratio, the corners of a frame for « Libre ». */
function FormatIcon({ id }: { id: string }) {
  const a = VIDEO_ASPECTS.find((v) => v.id === id)
  return a ? <AspectIcon x={a.x} y={a.y} /> : <Icon name="maximize" />
}

/** Output format of the preview and of the export: « Libre » (preview only) or one of the video aspects. Not on a phone: see `FormatMenu`. */
function FormatSwitcher({ disabled }: { disabled: boolean }) {
  const t = useT()
  const format = useFormat()

  return (
    <RadioGroup
      look="plain"
      className="flex flex-row flex-nowrap gap-0.5 rounded-md border border-white/15 p-0.5 phone-any:hidden"
      aria-label={t('topbar.format.aria')}
      value={format}
      disabled={disabled}
      onChange={(id) => pickFormat(id === FREE ? null : id)}
    >
      <Tip text={t('topbar.format.freeTip')}>
        <Radio value={FREE} className="group block data-[disabled=true]:opacity-40" labelClassName={FORMAT_LABEL}>
          <Icon name="maximize" />
          <span className="sr-only">{t('topbar.format.free')}</span>
        </Radio>
      </Tip>
      {VIDEO_ASPECTS.map((a) => (
        <Tip key={a.id} text={a.label}>
          <Radio value={a.id} className="group block data-[disabled=true]:opacity-40" labelClassName={FORMAT_LABEL}>
            <AspectIcon x={a.x} y={a.y} />
            <span className="sr-only">{a.label}</span>
          </Radio>
        </Tip>
      ))}
    </RadioGroup>
  )
}

/** The output format on a phone, in the place of the row of `FormatSwitcher`: a button with the chosen format opens the list as a sheet. */
function FormatMenu({ disabled }: { disabled: boolean }) {
  const t = useT()
  const format = useFormat()
  const choices = [{ id: FREE, label: t('topbar.format.free') }, ...VIDEO_ASPECTS.map((a) => ({ id: a.id, label: a.label }))]
  const current = choices.find((c) => c.id === format)
  return (
    <Menu
      label={t('topbar.format.aria')}
      sheet
      items={choices.map((c) => ({
        id: c.id,
        label: c.label,
        icon: <FormatIcon id={c.id} />,
        selected: c.id === format,
        onSelect: () => pickFormat(c.id === FREE ? null : c.id),
      }))}
      trigger={
        <Button
          variant="icon"
          className="btn-chrome hidden w-control phone-any:inline-flex"
          aria-label={`${t('topbar.format.aria')} (${current?.label})`}
          disabled={disabled}
        >
          <FormatIcon id={format} />
        </Button>
      }
    />
  )
}

/** Minimize, maximize or restore, close: the desktop window has no system title bar, the top bar is it (`Platform.windowControls`). */
function WindowButtons({ controls }: { controls: WindowControls }) {
  const t = useT()
  const [maximized, setMaximized] = useState(false)
  useEffect(() => controls.watchMaximized(setMaximized), [controls])
  const toggleLabel = t(maximized ? 'topbar.window.restore' : 'topbar.window.maximize')
  return (
    // the margin takes back the padding of the bar: the buttons touch the edge of the window
    <div className="-mr-2 ml-1 flex flex-none">
      <Tip text={t('topbar.window.minimize')}>
        <BarButton className={WINDOW_BUTTON} onClick={controls.minimize} aria-label={t('topbar.window.minimize')}>
          <Icon name="minus" size={16} />
        </BarButton>
      </Tip>
      <Tip text={toggleLabel}>
        <BarButton className={WINDOW_BUTTON} onClick={controls.toggleMaximize} aria-label={toggleLabel}>
          <Icon name={maximized ? 'copy' : 'square'} size={14} />
        </BarButton>
      </Tip>
      <Tip text={t('topbar.window.close')}>
        <BarButton className={`${WINDOW_BUTTON} btn-chrome-close`} onClick={controls.close} aria-label={t('topbar.window.close')}>
          <Icon name="x" size={18} />
        </BarButton>
      </Tip>
    </div>
  )
}

interface MoreItem {
  label: string
  icon: IconName
  onClick(): void
  disabled: boolean
}

/**
 * « Plus d'actions » (condensed bar only): the actions of the bar that do not fit, after `lead` (the OpenFlyover menu on a
 * portrait phone) and a line. `news`: the dot of the logo, which is not there on that phone.
 */
function MoreMenu({ items, lead = [], news = false }: { items: MoreItem[]; lead?: MenuItem[]; news?: boolean }) {
  const t = useT()
  return (
    <Menu
      label={t('topbar.more')}
      sheet
      items={[
        ...lead.map((item, i) => (i === lead.length - 1 ? { ...item, separator: true } : item)),
        ...items.map((item) => ({
          id: item.label,
          label: item.label,
          icon: <Icon name={item.icon} size={18} />,
          disabled: item.disabled,
          onSelect: item.onClick,
        })),
      ]}
      trigger={
        <Button
          variant="icon"
          className="btn-chrome relative hidden w-control bar-condensed:inline-flex"
          aria-label={news ? `${t('topbar.more')} · ${t('news.title')}` : t('topbar.more')}
        >
          <Icon name="ellipsis" />
          {news && <NewsDot />}
        </Button>
      }
    />
  )
}

interface TopBarProps {
  /** open the file picker (GPX, FIT or project) */
  onOpen(): void
  exportOpen: boolean
  onToggleExport(): void
  /** open the keyboard shortcuts (an entry of the OpenFlyover menu) */
  onHelp(): void
}

/**
 * Top bar: the logo (it opens the OpenFlyover menu), project name (edited in place), undo / redo, open / save (icons; the save
 * icon tells its state), output format, « Exporter » (the export drawer; « 42 % · Annuler » while exporting). In the desktop app
 * it is also the title bar of the window: dragged by its empty areas (`data-tauri-drag-region` works on the element that has it,
 * not on its children; never on the logo, which is a button), a double click maximises, and the window buttons come after
 * « Exporter ».
 */
export function TopBar({ onOpen, exportOpen, onToggleExport, onHelp }: TopBarProps) {
  const t = useT()
  const appMenu = useAppMenu(onHelp)
  const phone = usePortraitPhone()
  const { capabilities, windowControls } = getPlatform()
  // desktop without buttons of ours: macOS, whose traffic lights sit over the left of the bar
  const trafficLights = capabilities.isDesktop && !windowControls
  const history = getSettingsHistory()
  const { canUndo, canRedo } = useSyncExternalStore(history.subscribe, history.getState)
  const name = useAppStore((s) => s.projectName)
  const placeholder = useAppStore((s) => effectiveProjectName('', s.tracks[0]?.name))
  const hasTracks = useAppStore((s) => s.tracks.length > 0)
  const dirty = useAppStore((s) => isProjectDirty({ settings: s.settings, tracks: s.tracks, name: s.projectName }, s.savedProject))
  const phase = useExportStore((s) => s.phase)
  const percent = useExportStore((s) => (s.frameCount > 0 ? Math.round((s.frame / s.frameCount) * 100) : 0))
  // a batch is busy between two films too (the export store is idle then)
  const batchRunning = useBatchStore((s) => s.phase === 'running')
  const busy = isExportBusy(phase) || batchRunning
  // the save icon: a dot while changes are not saved, the accent colour for a few seconds once they are
  const unsaved = hasTracks && dirty
  const [justSaved, setJustSaved] = useState(false)
  const wasUnsaved = useRef(unsaved)
  useEffect(() => {
    const saved = wasUnsaved.current && !unsaved
    wasUnsaved.current = unsaved
    if (!saved) {
      return
    }
    setJustSaved(true)
    const timer = setTimeout(() => setJustSaved(false), SAVED_FLASH_MS)
    return () => clearTimeout(timer)
  }, [unsaved])

  return (
    <header
      data-tauri-drag-region
      className={`chrome-focus relative z-10 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-white/10 bg-chrome pr-2 text-white bar-condensed:flex bar-condensed:gap-2 phone-any:pt-[var(--safe-top)] ${trafficLights ? 'pl-20' : 'pl-3'}`}
    >
      <div data-tauri-drag-region className="flex min-w-0 items-center gap-1 bar-condensed:flex-auto">
        <LogoMenu items={appMenu.items} newsUnseen={appMenu.newsUnseen} />
        <h1 className="sr-only">OpenFlyover</h1>
        <TextField
          className="min-w-16 flex-[0_1_220px] bar-condensed:flex-auto phone-any:min-w-0"
          inputClassName={NAME_INPUT}
          value={name}
          placeholder={placeholder}
          maxLength={120}
          aria-label={t('topbar.projectName')}
          title={t('topbar.projectNameTip')}
          onChange={(value) => useAppStore.getState().setProjectName(value)}
        />
        <span className="mx-1 h-5 w-px flex-none bg-white/15 bar-condensed:hidden" aria-hidden="true" />
        <Tip text={withShortcut(t('topbar.undo'), 'undo')}>
          <BarButton onClick={history.undo} disabled={!canUndo || busy} aria-label={t('topbar.undo')}>
            <Icon name="undo" />
          </BarButton>
        </Tip>
        <Tip text={withShortcut(t('topbar.redo'), 'redo')}>
          <BarButton onClick={history.redo} disabled={!canRedo || busy} aria-label={t('topbar.redo')}>
            <Icon name="redo" />
          </BarButton>
        </Tip>
        <Tip text={withShortcut(t('topbar.openTip'), 'open')}>
          <BarButton className="bar-condensed:hidden" onClick={onOpen} disabled={busy} aria-label={t('topbar.open')}>
            <Icon name="folder-open" />
          </BarButton>
        </Tip>
        <Tip text={withShortcut(unsaved ? t('topbar.saveUnsavedTip') : t('topbar.saveTip'), 'save')}>
          <BarButton
            className={`${SAVE_STATE} bar-condensed:hidden`}
            data-testid="topbar-save"
            data-save-state={unsaved ? 'unsaved' : justSaved ? 'saved' : undefined}
            onClick={saveProject}
            disabled={busy}
            aria-label={unsaved ? t('topbar.saveUnsavedAria') : t('topbar.save')}
          >
            <Icon name="save" />
          </BarButton>
        </Tip>
      </div>

      <FormatSwitcher disabled={busy} />
      <FormatMenu disabled={busy} />

      <div data-tauri-drag-region className="flex items-center justify-self-end gap-2">
        {/* a phone chooses its language in « Réglages »: the bar keeps undo and redo instead */}
        <div className="contents phone:hidden">
          <LanguageMenu />
        </div>
        <MoreMenu
          lead={phone ? appMenu.items : undefined}
          news={phone && appMenu.newsUnseen}
          items={[
            { label: t('topbar.openMore'), icon: 'folder-open', onClick: onOpen, disabled: busy },
            { label: t('topbar.save'), icon: 'save', onClick: saveProject, disabled: busy },
          ]}
        />
        {busy ? (
          <Button
            variant="primary"
            className={EXPORT_BUTTON}
            data-testid="topbar-export"
            // between two films of a batch the export store is idle: the batch takes the cancel
            onClick={() => (batchRunning ? useBatchStore.getState().cancel() : useExportStore.getState().cancel())}
            disabled={phase === 'finalizing'}
            aria-label={phase === 'finalizing' ? t('topbar.finalizingAria') : t('topbar.cancelExportAria', { percent })}
          >
            {phase === 'finalizing' ? t('topbar.finalizing') : t('topbar.cancelExport', { percent })}
          </Button>
        ) : (
          // nothing to export before the first track
          hasTracks && (
            <Tip text={withShortcut(t('topbar.exportTip'), 'export')}>
              <Button
                variant="primary"
                className={EXPORT_BUTTON}
                data-testid="topbar-export"
                onClick={onToggleExport}
                aria-expanded={exportOpen}
                aria-controls="export-dock"
              >
                <Icon name="download" size={16} />
                {t('topbar.export')}
              </Button>
            </Tip>
          )
        )}
        {windowControls && <WindowButtons controls={windowControls} />}
      </div>
      {appMenu.dialogs}
    </header>
  )
}
