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
      <label className="format-switch__option" data-tip={t('topbar.format.freeTip')}>
        <input type="radio" name="output-format" checked={free} disabled={disabled} onChange={() => pick(null)} />
        <Icon name="maximize" size={18} />
        <span className="visually-hidden">{t('topbar.format.free')}</span>
      </label>
      {VIDEO_ASPECTS.map((a) => (
        <label key={a.id} className="format-switch__option" data-tip={a.label}>
          <input type="radio" name="output-format" checked={!free && aspect === a.id} disabled={disabled} onChange={() => pick(a.id)} />
          <AspectIcon x={a.x} y={a.y} size={18} />
          <span className="visually-hidden">{a.label}</span>
        </label>
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
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !ref.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])

  return (
    <div
      ref={ref}
      className="topbar__more"
      data-local-escape=""
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !open) return
        setOpen(false)
        e.stopPropagation()
      }}
    >
      <button type="button" className="icon-btn" aria-label={t('topbar.more')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="ellipsis" />
      </button>
      {open && (
        <div className="track-menu topbar__menu" role="menu" aria-label={t('topbar.more')}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="track-menu__item"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onClick()
              }}
            >
              <Icon name={item.icon} size={18} />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
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
        <input
          className="topbar__name"
          type="text"
          value={name}
          placeholder={placeholder}
          maxLength={120}
          aria-label={t('topbar.projectName')}
          title={t('topbar.projectNameTip')}
          onChange={(e) => useAppStore.getState().setProjectName(e.currentTarget.value)}
        />
        <span className="topbar__sep" aria-hidden="true" />
        <button type="button" className="icon-btn" onClick={history.undo} disabled={!canUndo || busy} aria-label={t('topbar.undo')} data-tip={withShortcut(t('topbar.undo'), 'undo')}>
          <Icon name="undo" />
        </button>
        <button type="button" className="icon-btn" onClick={history.redo} disabled={!canRedo || busy} aria-label={t('topbar.redo')} data-tip={withShortcut(t('topbar.redo'), 'redo')}>
          <Icon name="redo" />
        </button>
        <button type="button" className="icon-btn" onClick={onOpen} disabled={busy} aria-label={t('topbar.open')} data-tip={withShortcut(t('topbar.openTip'), 'open')}>
          <Icon name="folder-open" />
        </button>
        <button
          type="button"
          className={`icon-btn topbar__save${unsaved ? ' topbar__save--unsaved' : ''}${justSaved ? ' topbar__save--saved' : ''}`}
          onClick={saveProject}
          disabled={busy}
          aria-label={unsaved ? t('topbar.saveUnsavedAria') : t('topbar.save')}
          data-tip={withShortcut(unsaved ? t('topbar.saveUnsavedTip') : t('topbar.saveTip'), 'save')}
        >
          <Icon name="save" />
        </button>
      </div>

      <FormatSwitcher disabled={busy} />

      <div className="topbar__end">
        <button type="button" className="icon-btn" onClick={onHelp} aria-label={t('topbar.shortcuts')} data-tip={withShortcut(t('topbar.shortcuts'), 'help')}>
          <Icon name="circle-help" />
        </button>
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
          <button
            type="button"
            className="btn btn--primary topbar__export"
            // between two films of a batch the export store is idle: the batch takes the cancel
            onClick={() => (batchRunning ? useBatchStore.getState().cancel() : useExportStore.getState().cancel())}
            disabled={phase === 'finalizing'}
            aria-label={phase === 'finalizing' ? t('topbar.finalizingAria') : t('topbar.cancelExportAria', { percent })}
          >
            {phase === 'finalizing' ? t('topbar.finalizing') : t('topbar.cancelExport', { percent })}
          </button>
        ) : (
          // nothing to export before the first track
          hasTracks && (
            <button
              type="button"
              className="btn btn--primary topbar__export"
              onClick={onToggleExport}
              aria-expanded={exportOpen}
              aria-controls="export-dock"
              data-tip={withShortcut(t('topbar.exportTip'), 'export')}
            >
              <Icon name="download" size={18} />
              <span className="icon-btn__text">{t('topbar.export')}</span>
            </button>
          )
        )}
      </div>
    </header>
  )
}
