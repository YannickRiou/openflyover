import { errorMessage } from '../core/errors'
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
import { chooseFilesToOpen, closeProject, newProject, openProject, saveProject } from './projectActions'
import type { CloseAnswer } from './projectActions'
import { withShortcut } from './shortcuts'
import { showToast } from './toast'

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
        Projet
      </h2>

      {question ? (
        <>
          <p className="field__hint" role="alert">
            <strong>Fermer sans enregistrer ?</strong> {question.text}
          </p>
          <div className="project__row">
            <button type="button" className="btn btn--secondary" autoFocus onClick={() => question.answer('save')}>
              Enregistrer
            </button>
          </div>
          <div className="project__row">
            <button type="button" className="btn btn--secondary" onClick={() => question.answer('close')}>
              Fermer sans enregistrer
            </button>
          </div>
          <div className="project__row">
            <button type="button" className="btn btn--secondary" onClick={() => question.answer('cancel')}>
              Annuler
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="project__row">
            <button type="button" className="btn btn--secondary" onClick={() => void run(newProject)} disabled={busy || closing}>
              <Icon name="plus" size={18} />
              Nouveau projet
            </button>
          </div>
          <div className="project__row">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => void chooseFilesToOpen()}
              disabled={busy || closing}
              data-tip={withShortcut('Ouvrir une trace ou un projet', 'open')}
            >
              <Icon name="folder-open" size={18} />
              Ouvrir…
            </button>
          </div>
          <div className="project__row">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => void saveProject()}
              disabled={busy || closing}
              data-tip={withShortcut('Enregistrer le projet dans un fichier', 'save')}
            >
              <Icon name="save" size={18} />
              Enregistrer un fichier…
            </button>
          </div>
          <div className="project__row">
            <button type="button" className="btn btn--secondary" onClick={() => void run(closeProject)} disabled={busy || closing || !open}>
              <Icon name="x" size={18} />
              Fermer le projet
            </button>
          </div>
          <p className="field__hint">Fermer revient à l’écran d’accueil ; un projet gardé reste dans Mes projets.</p>
        </>
      )}
    </section>
  )
}

/** « Mes projets »: the projects kept by the app, most recent first; the open one is highlighted and saved automatically. */
function LibrarySection() {
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
        Mes projets
      </h2>

      {!platform.projectLibrary ? (
        <p className="tracks__empty">Ce navigateur ne peut pas garder de projets (page non sécurisée, sans HTTPS).</p>
      ) : (
        <>
          <p className="field__hint">
            Gardés {platform.capabilities.isDesktop ? 'sur cet ordinateur' : 'dans ce navigateur'}, enregistrés automatiquement à
            chaque changement.
          </p>
          {currentId === null ? (
            <button type="button" className="btn btn--secondary" onClick={() => void keepOpenProject()} disabled={!hasTracks}>
              Garder dans Mes projets
            </button>
          ) : (
            <p className="field__hint">Le projet ouvert est gardé dans Mes projets.</p>
          )}

          {entries.length === 0 ? (
            <p className="tracks__empty">Aucun projet gardé pour l’instant.</p>
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
                          aria-label="Nouveau nom du projet"
                          value={renaming.name}
                          maxLength={120}
                          autoFocus
                          onChange={(e) => setRenaming({ id: entry.id, name: e.currentTarget.value })}
                          onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                        />
                        <button type="submit" className="btn btn--secondary" disabled={!renaming.name.trim()}>
                          Renommer
                        </button>
                      </form>
                    ) : (
                      <span className="library__name">
                        {entry.name}
                        {current && <span className="library__badge">ouvert</span>}
                      </span>
                    )}
                    <span className="field__hint">{entry.summary}</span>
                    <span className="field__hint">
                      {new Date(entry.updatedAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
                      {formatProjectSize(entry.sizeBytes)}
                    </span>
                    {confirmingId === entry.id ? (
                      <div className="project__row">
                        <button
                          type="button"
                          className="btn btn--secondary"
                          onClick={() => {
                            setConfirmingId(null)
                            void deleteEntry(entry)
                          }}
                        >
                          Supprimer définitivement
                        </button>
                        <button type="button" className="btn btn--secondary" onClick={() => setConfirmingId(null)}>
                          Annuler
                        </button>
                      </div>
                    ) : (
                      <div className="project__row">
                        <button type="button" className="btn btn--secondary" onClick={() => void open(entry)} disabled={current}>
                          Ouvrir
                        </button>
                        <button type="button" className="btn btn--secondary" onClick={() => setRenaming({ id: entry.id, name: entry.name })}>
                          Renommer
                        </button>
                        <button type="button" className="btn btn--secondary" onClick={() => setConfirmingId(entry.id)}>
                          Supprimer
                        </button>
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
    showToast({ kind: 'success', text: `Préréglage appliqué : ${selected.name}` })
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
          ? { kind: 'success', text: `Préréglage « ${name} » enregistré` }
          : { kind: 'error', text: 'Préréglage non enregistré : stockage du navigateur plein. Il reste utilisable jusqu’à la fermeture de la page.' },
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
        Préréglages
      </h2>

      <p className="field__hint">
        Tous les réglages ou une seule famille (carte, trace, habillage, prise de vue), sans traces, arrêts, textes ni photos. Gardés {getPlatform().capabilities.isDesktop ? 'sur cet ordinateur' : 'dans ce navigateur'}.
      </p>

      {presets.length === 0 ? (
        <p className="tracks__empty">Aucun préréglage. Donnez un nom ci-dessous pour garder les réglages actuels.</p>
      ) : (
        <>
          <div className="field">
            <label className="field__label" htmlFor={`${id}-preset`}>
              Préréglage
            </label>
            <select id={`${id}-preset`} className="select" value={selectedPreset} onChange={(e) => setSelectedPreset(e.currentTarget.value)}>
              <option value="">Choisir…</option>
              {presets.map((preset) => (
                <option key={preset.name} value={preset.name}>
                  {preset.scope && preset.scope !== 'tout' ? `${preset.name} · ${PRESET_SCOPE_LABELS[preset.scope]}` : preset.name}
                </option>
              ))}
            </select>
          </div>
          <div className="project__row">
            <button type="button" className="btn btn--secondary" onClick={applyPreset} disabled={!selected}>
              Appliquer
            </button>
            <button type="button" className="btn btn--secondary" onClick={deletePreset} disabled={!selected}>
              Supprimer
            </button>
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
          Nouveau préréglage
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
            aria-label="Nom du préréglage"
            className="input"
            type="text"
            value={presetName}
            placeholder="Nom du préréglage"
            maxLength={PRESET_NAME_MAX}
            onChange={(e) => setPresetName(e.currentTarget.value)}
          />
          <button type="submit" className="btn btn--secondary" disabled={!presetName.trim()}>
            Enregistrer
          </button>
        </div>
      </form>
    </section>
  )
}
