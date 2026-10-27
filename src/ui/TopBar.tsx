import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { VIDEO_ASPECTS } from '../export/schedule'
import { useBatchStore } from '../export/batch'
import { isExportBusy, useExportStore } from '../export/store'
import { useT } from '../i18n'
import { getSettingsHistory } from '../project/history'
import { useAppStore } from '../state/store'
import { AspectIcon, Icon } from './icons'
import { LanguageMenu } from './LanguageMenu'
import type { IconName } from './icons'
import { saveProject } from './projectActions'
import { effectiveProjectName, isProjectDirty } from './shell'
import { withShortcut } from './shortcuts'
import { Button, Menu, Radio, RadioGroup, TextField, Tip } from './primitives'
import type { ButtonProps } from './primitives'

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

/** Output format of the preview and of the export: « Libre » (preview only) or one of the video aspects. */
function FormatSwitcher({ disabled }: { disabled: boolean }) {
  const t = useT()
  const aspect = useAppStore((s) => s.settings.video.aspect)
  const free = useAppStore((s) => s.freeFraming)
  const pick = (id: string | null) => {
    const store = useAppStore.getState()
    const next = VIDEO_ASPECTS.find((a) => a.id === id)
    if (next && next.id !== store.settings.video.aspect) store.setSetting('video', { ...store.settings.video, aspect: next.id })
    store.setFreeFraming(!next)
  }

  return (
    <RadioGroup
      look="plain"
      className="flex flex-row flex-nowrap gap-0.5 rounded-md border border-white/15 p-0.5 phone-any:hidden"
      aria-label={t('topbar.format.aria')}
      value={free ? FREE : aspect}
      disabled={disabled}
      onChange={(id) => pick(id === FREE ? null : id)}
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

interface MoreItem {
  label: string
  icon: IconName
  onClick(): void
  disabled: boolean
}

/** « Plus d'actions » (condensed bar only): the actions of the bar that do not fit. */
function MoreMenu({ items }: { items: MoreItem[] }) {
  const t = useT()
  return (
    <Menu
      label={t('topbar.more')}
      sheet
      items={items.map((item) => ({
        id: item.label,
        label: item.label,
        icon: <Icon name={item.icon} size={18} />,
        disabled: item.disabled,
        onSelect: item.onClick,
      }))}
      trigger={
        <Button variant="icon" className="btn-chrome hidden w-control bar-condensed:inline-flex" aria-label={t('topbar.more')}>
          <Icon name="ellipsis" />
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
  /** open the keyboard shortcuts */
  onHelp(): void
}

/**
 * Top bar: logo, project name (edited in place), undo / redo, open / save (icons; the save icon tells its state), output format,
 * shortcuts (« ? »), « Exporter » (the export drawer; « 42 % · Annuler » while exporting).
 */
export function TopBar({ onOpen, exportOpen, onToggleExport, onHelp }: TopBarProps) {
  const t = useT()
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
      if (unsaved) setJustSaved(false)
      return
    }
    setJustSaved(true)
    const timer = setTimeout(() => setJustSaved(false), SAVED_FLASH_MS)
    return () => clearTimeout(timer)
  }, [unsaved])

  return (
    <header className="chrome-focus relative z-10 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-white/10 bg-chrome pr-2 pl-3 text-white bar-condensed:flex bar-condensed:gap-2 phone-any:pt-[var(--safe-top)]">
      <div className="flex min-w-0 items-center gap-1 bar-condensed:flex-auto">
        <img className="mr-1 size-7 flex-none" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={28} height={28} title="OpenFlyover" />
        <h1 className="sr-only">OpenFlyover</h1>
        <TextField
          className="min-w-16 flex-[0_1_220px] bar-condensed:flex-auto"
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
          <BarButton className="bar-condensed:hidden" onClick={history.undo} disabled={!canUndo || busy} aria-label={t('topbar.undo')}>
            <Icon name="undo" />
          </BarButton>
        </Tip>
        <Tip text={withShortcut(t('topbar.redo'), 'redo')}>
          <BarButton className="bar-condensed:hidden" onClick={history.redo} disabled={!canRedo || busy} aria-label={t('topbar.redo')}>
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

      <div className="flex items-center justify-self-end gap-2">
        <Tip text={withShortcut(t('topbar.shortcuts'), 'help')}>
          <BarButton className="phone-any:hidden" onClick={onHelp} aria-label={t('topbar.shortcuts')}>
            <Icon name="circle-help" />
          </BarButton>
        </Tip>
        <LanguageMenu />
        <MoreMenu
          items={[
            { label: t('topbar.undo'), icon: 'undo', onClick: history.undo, disabled: !canUndo || busy },
            { label: t('topbar.redo'), icon: 'redo', onClick: history.redo, disabled: !canRedo || busy },
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
      </div>
    </header>
  )
}
