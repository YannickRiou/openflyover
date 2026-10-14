import { errorMessage } from '../core/errors'
import { t as translate, useT } from '../i18n'
import { formatDate } from '../i18n/format'
import { useEffect, useId, useState } from 'react'
import { getPlatform } from '../platform'
import type { ProjectEntry } from '../platform'
import { applySettings } from '../project/apply'
import { getSettingsHistory } from '../project/history'
import { PRESET_NAME_MAX, PRESET_SCOPE_LABELS, PRESET_SCOPES, getPresetStore, normalizePresetName, presetSettings } from '../project/presets'
import type { PresetScope } from '../project/presets'
import { useBatchStore } from '../export/batch'
import { isExportBusy, useExportStore } from '../export/store'
import { useAppStore } from '../state/store'
import { Icon } from './icons'
import {
  deleteEntry,
  formatProjectSize,
  keepOpenProject,
  libraryFile,
  refreshLibrary,
  renameEntry,
  unsavedChangesText,
  useLibraryStore,
} from './library'
import { chooseFilesToOpen, closeProject, newProject, openProject, saveProject, saveProjectAs } from './projectActions'
import type { CloseAnswer } from './projectActions'
import { withShortcut } from './shortcuts'
import { showToast } from './toast'
import { Button, Tip } from './primitives'

/**
 * "Projet" tab: the actions on the open project (new, open, save as a file, close), « Mes projets », then the presets
 * of the settings. Open and save are also in the top bar, with their shortcuts.
 */
export function ProjectPanel() {
  return (
    <>
      <ProjectSection />
      <LibrarySection />
      <PresetSection />
    </>
  )
}

/** The open project: new, open, save as a file, close; « Fermer sans enregistrer ? » in place when changes would be lost. */
function ProjectSection() {
  const t = useT()
  const hasTracks = useAppStore((s) => s.tracks.length > 0)
  const named = useAppStore((s) => s.projectName !== '')
  const kept = useLibraryStore((s) => s.currentId !== null)
  const exporting = useExportStore((s) => isExportBusy(s.phase))
  // a batch is busy between two films too (the export store is idle then)
  const batchRunning = useBatchStore((s) => s.phase === 'running')
  /** « Nouveau projet » or « Fermer le projet » running (waiting for the last write or the answer) */
  const [closing, setClosing] = useState(false)
  /** the question in place, answered by its buttons */
  const [question, setQuestion] = useState<{ text: string; answer(a: CloseAnswer): void } | null>(null)
  const id = useId()
  const busy = exporting || batchRunning
  // nothing open: no track, no entry, no name
  const open = hasTracks || kept || named

  // the question is about the project it was asked for: another one opened or imported meanwhile, or an export
  // started, cancels it
  useEffect(() => {
    if (!question) return
    if (busy) {
      question.answer('cancel')
      return
    }
    return useAppStore.subscribe((state, previous) => {
      if (state.tracks !== previous.tracks || state.projectName !== previous.projectName) question.answer('cancel')
    })
  }, [question, busy])

  const ask = () =>
    new Promise<CloseAnswer>((resolve) =>
      setQuestion({
        text: unsavedChangesText(),
        answer(a) {
          setQuestion(null)
          resolve(a)
        },
      }),
    )
  const run = async (action: (ask: () => Promise<CloseAnswer>) => Promise<void>) => {
    setClosing(true)
    try {
      await action(ask)
    } finally {
      setClosing(false)
    }
  }

  return (
    <section className="settings project" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="section-title settings__title">
        {t('project.panel.title')}
      </h2>

      {question ? (
        <>
          <p className="field__hint" role="alert">
            <strong>{t('project.library.closeQuestion')}</strong> {question.text}
          </p>
          <div className="project__row">
            <Button autoFocus onClick={() => question.answer('save')}>
              {t('common.save')}
            </Button>
          </div>
          <div className="project__row">
            <Button onClick={() => question.answer('close')}>
              {t('project.library.closeNoSave')}
            </Button>
          </div>
          <div className="project__row">
            <Button onClick={() => question.answer('cancel')}>
              {t('common.cancel')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="project__row">
            <Button onClick={() => void run(newProject)} disabled={busy || closing}>
              <Icon name="plus" size={18} />
              {t('project.panel.new')}
            </Button>
          </div>
          <div className="project__row">
            <Tip text={withShortcut(t('topbar.openTip'), 'open')}>
              <Button
                onClick={() => void chooseFilesToOpen()}
                disabled={busy || closing}
              >
                <Icon name="folder-open" size={18} />
                {t('project.panel.open')}
              </Button>
            </Tip>
          </div>
          <div className="project__row">
            <Tip text={withShortcut(t('project.panel.saveTip'), 'save')}>
              <Button
                onClick={() => void saveProject()}
                disabled={busy || closing}
              >
                <Icon name="save" size={18} />
                {t('common.save')}
              </Button>
            </Tip>
          </div>
          <div className="project__row">
            <Tip text={withShortcut(t('project.panel.saveAsTip'), 'save-as')}>
              <Button
                onClick={() => void saveProjectAs()}
                disabled={busy || closing}
              >
                <Icon name="save" size={18} />
                {t('project.panel.saveAs')}
              </Button>
            </Tip>
          </div>
          <div className="project__row">
            <Button onClick={() => void run(closeProject)} disabled={busy || closing || !open}>
              <Icon name="x" size={18} />
              {t('project.panel.close')}
            </Button>
          </div>
          <p className="field__hint">{t('project.panel.closeHint')}</p>
        </>
      )}
    </section>
  )
}

/** « Mes projets »: the projects kept by the app, most recent first; the open one is highlighted and saved automatically. */
function LibrarySection() {
  const t = useT()
  const platform = getPlatform()
  const entries = useLibraryStore((s) => s.entries)
  const currentId = useLibraryStore((s) => s.currentId)
  const hasTracks = useAppStore((s) => s.tracks.length > 0)
  /** entry being renamed, with the name typed so far */
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  /** entry whose « Supprimer » waits for its confirmation */
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const id = useId()

  useEffect(() => {
    void refreshLibrary()
  }, [])

  const open = async (entry: ProjectEntry) => {
    const file = await libraryFile(entry)
    if (file) await openProject(file, entry)
  }

  const rename = async () => {
    const entry = entries.find((e) => e.id === renaming?.id)
    if (!entry || !renaming) return
    await renameEntry(entry, renaming.name)
    setRenaming(null)
  }

  return (
    <section className="settings project" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="section-title settings__title">
        {t('project.panel.library')}
      </h2>

      {!platform.projectLibrary ? (
        <p className="tracks__empty">{t('project.panel.noLibrary')}</p>
      ) : (
        <>
          <p className="field__hint">{t(platform.capabilities.isDesktop ? 'project.panel.keptDesktop' : 'project.panel.keptBrowser')}</p>
          {currentId === null ? (
            <Button onClick={() => void keepOpenProject()} disabled={!hasTracks}>
              {t('project.panel.keep')}
            </Button>
          ) : (
            <p className="field__hint">{t('project.panel.keepOpen')}</p>
          )}

          {entries.length === 0 ? (
            <p className="tracks__empty">{t('project.panel.empty')}</p>
          ) : (
            <ul className="library">
              {entries.map((entry) => {
                const current = entry.id === currentId
                return (
                  <li key={entry.id} className={current ? 'library__item library__item--current' : 'library__item'} aria-current={current || undefined}>
                    {/* the view at the last save; an empty frame for older entries */}
                    {entry.thumbnail ? (
                      <img className="library__thumb" src={entry.thumbnail} alt="" />
                    ) : (
                      <span className="library__thumb" aria-hidden="true" />
                    )}
                    {renaming?.id === entry.id ? (
                      <form
                        className="project__row"
                        onSubmit={(e) => {
                          e.preventDefault()
                          void rename()
                        }}
                      >
                        <input
                          className="input"
                          type="text"
                          aria-label={t('project.panel.newName')}
                          value={renaming.name}
                          maxLength={120}
                          autoFocus
                          onChange={(e) => setRenaming({ id: entry.id, name: e.currentTarget.value })}
                          onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                        />
                        <Button type="submit" disabled={!renaming.name.trim()}>
                          {t('project.panel.rename')}
                        </Button>
                      </form>
                    ) : (
                      <span className="library__name">
                        {entry.name}
                        {current && <span className="library__badge">{t('project.panel.badgeOpen')}</span>}
                      </span>
                    )}
                    <span className="field__hint">{entry.summary}</span>
                    <span className="field__hint">
                      {formatDate(entry.updatedAt, { dateStyle: 'medium', timeStyle: 'short' })} · {formatProjectSize(entry.sizeBytes)}
                    </span>
                    {confirmingId === entry.id ? (
                      <div className="project__row">
                        <Button
                          onClick={() => {
                            setConfirmingId(null)
                            void deleteEntry(entry)
                          }}
                        >
                          {t('project.panel.deleteForever')}
                        </Button>
                        <Button onClick={() => setConfirmingId(null)}>
                          {t('common.cancel')}
                        </Button>
                      </div>
                    ) : (
                      <div className="project__row">
                        <Button onClick={() => void open(entry)} disabled={current}>
                          {t('project.panel.openEntry')}
                        </Button>
                        <Button onClick={() => setRenaming({ id: entry.id, name: entry.name })}>
                          {t('project.panel.rename')}
                        </Button>
                        <Button onClick={() => setConfirmingId(entry.id)}>
                          {t('common.delete')}
                        </Button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

/** Presets of the settings. */
function PresetSection() {
  const t = useT()
  const history = getSettingsHistory()
  const presetStore = getPresetStore()
  const [presets, setPresets] = useState(() => presetStore.list())
  const [selectedPreset, setSelectedPreset] = useState('')
  const [presetName, setPresetName] = useState('')
  const [presetScope, setPresetScope] = useState<PresetScope>('tout')
  const id = useId()

  const selected = presets.find((p) => p.name === selectedPreset)

  const applyPreset = () => {
    if (!selected) return
    history.transaction(() => applySettings(presetSettings(selected, useAppStore.getState().settings)))
    showToast({ kind: 'success', text: translate('project.panel.presetApplied', { name: selected.name }) })
  }

  const savePreset = () => {
    try {
      const stored = presetStore.save(presetName, useAppStore.getState().settings, presetScope)
      const name = normalizePresetName(presetName)
      setPresets(presetStore.list())
      setSelectedPreset(name)
      setPresetName('')
      showToast(
        stored
          ? { kind: 'success', text: translate('project.panel.presetSaved', { name }) }
          : { kind: 'error', text: translate('project.panel.presetFull') },
      )
    } catch (err) {
      showToast({ kind: 'error', text: errorMessage(err) })
    }
  }

  const deletePreset = () => {
    if (!selected) return
    presetStore.remove(selected.name)
    setPresets(presetStore.list())
    setSelectedPreset('')
  }

  return (
    <section className="settings project" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="section-title settings__title">
        {t('project.panel.presets')}
      </h2>

      <p className="field__hint">{t(getPlatform().capabilities.isDesktop ? 'project.panel.presetsHintDesktop' : 'project.panel.presetsHintBrowser')}</p>

      {presets.length === 0 ? (
        <p className="tracks__empty">{t('project.panel.noPreset')}</p>
      ) : (
        <>
          <div className="field">
            <label className="field__label" htmlFor={`${id}-preset`}>
              {t('project.panel.preset')}
            </label>
            <select id={`${id}-preset`} className="select" value={selectedPreset} onChange={(e) => setSelectedPreset(e.currentTarget.value)}>
              <option value="">{t('project.panel.choose')}</option>
              {presets.map((preset) => (
                <option key={preset.name} value={preset.name}>
                  {preset.scope && preset.scope !== 'tout' ? t('project.panel.presetOption', { name: preset.name, scope: PRESET_SCOPE_LABELS[preset.scope] }) : preset.name}
                </option>
              ))}
            </select>
          </div>
          <div className="project__row">
            <Button onClick={applyPreset} disabled={!selected}>
              {t('project.panel.apply')}
            </Button>
            <Button onClick={deletePreset} disabled={!selected}>
              {t('common.delete')}
            </Button>
          </div>
        </>
      )}

      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault()
          savePreset()
        }}
      >
        <label className="field__label" htmlFor={`${id}-preset-scope`}>
          {t('project.panel.newPreset')}
        </label>
        <select
          id={`${id}-preset-scope`}
          className="select project__scope"
          value={presetScope}
          onChange={(e) => setPresetScope(e.currentTarget.value as PresetScope)}
        >
          {PRESET_SCOPES.map((scope) => (
            <option key={scope} value={scope}>
              {PRESET_SCOPE_LABELS[scope]}
            </option>
          ))}
        </select>
        <div className="project__row">
          <input
            id={`${id}-preset-name`}
            aria-label={t('project.panel.presetName')}
            className="input"
            type="text"
            value={presetName}
            placeholder={t('project.panel.presetName')}
            maxLength={PRESET_NAME_MAX}
            onChange={(e) => setPresetName(e.currentTarget.value)}
          />
          <Button type="submit" disabled={!presetName.trim()}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </section>
  )
}
