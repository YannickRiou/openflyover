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
import { Button, Menu, TextField, Tip } from './primitives'

/** How long the save icon keeps the accent colour once the project is saved (ms). */
const SAVED_FLASH_MS = 3000

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
    <div className="format-switch" role="radiogroup" aria-label={t('topbar.format.aria')}>
      <Tip text={t('topbar.format.freeTip')}>
        <label className="format-switch__option">
          <input type="radio" name="output-format" checked={free} disabled={disabled} onChange={() => pick(null)} />
          <Icon name="maximize" size={18} />
          <span className="visually-hidden">{t('topbar.format.free')}</span>
        </label>
      </Tip>
      {VIDEO_ASPECTS.map((a) => (
        <Tip key={a.id} text={a.label}>
          <label className="format-switch__option">
            <input type="radio" name="output-format" checked={!free && aspect === a.id} disabled={disabled} onChange={() => pick(a.id)} />
            <AspectIcon x={a.x} y={a.y} size={18} />
            <span className="visually-hidden">{a.label}</span>
          </label>
        </Tip>
      ))}
    </div>
  )
}

interface MoreItem {
  label: string
  icon: IconName
  onClick(): void
  disabled: boolean
}

/** « Plus d'actions » (phone only, shown by shell.css): the actions of the bar that do not fit. */
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
        <Button variant="icon" className="topbar__more" aria-label={t('topbar.more')}>
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
    <header className="topbar">
      <div className="topbar__start">
        <img className="topbar__logo" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={28} height={28} title="OpenFlyover" />
        <h1 className="visually-hidden">OpenFlyover</h1>
        <TextField
          className="topbar__name"
          value={name}
          placeholder={placeholder}
          maxLength={120}
          aria-label={t('topbar.projectName')}
          title={t('topbar.projectNameTip')}
          onChange={(value) => useAppStore.getState().setProjectName(value)}
        />
        <span className="topbar__sep" aria-hidden="true" />
        <Tip text={withShortcut(t('topbar.undo'), 'undo')}>
          <Button variant="icon" onClick={history.undo} disabled={!canUndo || busy} aria-label={t('topbar.undo')}>
            <Icon name="undo" />
          </Button>
        </Tip>
        <Tip text={withShortcut(t('topbar.redo'), 'redo')}>
          <Button variant="icon" onClick={history.redo} disabled={!canRedo || busy} aria-label={t('topbar.redo')}>
            <Icon name="redo" />
          </Button>
        </Tip>
        <Tip text={withShortcut(t('topbar.openTip'), 'open')}>
          <Button variant="icon" onClick={onOpen} disabled={busy} aria-label={t('topbar.open')}>
            <Icon name="folder-open" />
          </Button>
        </Tip>
        <Tip text={withShortcut(unsaved ? t('topbar.saveUnsavedTip') : t('topbar.saveTip'), 'save')}>
          <Button
            variant="icon"
            className={`topbar__save${unsaved ? ' topbar__save--unsaved' : ''}${justSaved ? ' topbar__save--saved' : ''}`}
            data-testid="topbar-save"
            data-save-state={unsaved ? 'unsaved' : justSaved ? 'saved' : undefined}
            onClick={saveProject}
            disabled={busy}
            aria-label={unsaved ? t('topbar.saveUnsavedAria') : t('topbar.save')}
          >
            <Icon name="save" />
          </Button>
        </Tip>
      </div>

      <FormatSwitcher disabled={busy} />

      <div className="topbar__end">
        <Tip text={withShortcut(t('topbar.shortcuts'), 'help')}>
          <Button variant="icon" onClick={onHelp} aria-label={t('topbar.shortcuts')}>
            <Icon name="circle-help" />
          </Button>
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
            className="topbar__export"
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
                className="topbar__export"
                data-testid="topbar-export"
                onClick={onToggleExport}
                aria-expanded={exportOpen}
                aria-controls="export-dock"
              >
                <Icon name="download" size={18} />
                <span className="icon-btn__text">{t('topbar.export')}</span>
              </Button>
            </Tip>
          )
        )}
      </div>
    </header>
  )
}
