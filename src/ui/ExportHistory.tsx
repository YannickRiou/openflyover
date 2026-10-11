import { useId, useState } from 'react'
import { useBatchStore } from '../export/batch'
import {
  OUTCOME_LABELS,
  entryDetails,
  formatSpeed,
  formatWall,
  formatWhen,
  reuseSettings,
  settingsDetails,
  settingsSummary,
} from '../export/history'
import type { HistoryEntry } from '../export/history'
import { useExportHistory } from '../export/historyStore'
import { isExportBusy, useExportStore } from '../export/store'
import { applySettings } from '../project/apply'
import { getSettingsHistory } from '../project/history'
import { useAppStore } from '../state/store'
import { Icon } from './icons'
import { showToast } from './toast'

/** Put the export options and render settings of a past render back, as one undo step. */
function reuse(entry: HistoryEntry): void {
  const { settings, setFreeFraming } = useAppStore.getState()
  const next = reuseSettings(entry, settings)
  if ((Object.keys(next) as (keyof typeof next)[]).every((key) => Object.is(next[key], settings[key]))) {
    showToast({ kind: 'info', text: 'Ces réglages sont déjà en place.' })
    return
  }
  const history = getSettingsHistory()
  history.transaction(() => applySettings(next))
  if (next.video.aspect !== settings.video.aspect) setFreeFraming(false)
  showToast({ kind: 'success', text: `Réglages de « ${entry.name} » rétablis`, action: { label: 'Annuler', run: () => history.undo() } })
}

function Rows({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <dl className="history__rows">
      {rows.map(({ label, value }) => (
        <div key={label} className="history__row">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function Entry({ entry, busy }: { entry: HistoryEntry; busy: boolean }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const remove = useExportHistory((s) => s.remove)
  const outcome = entry.outcome === 'error' && entry.error ? `${OUTCOME_LABELS.error} : ${entry.error}` : OUTCOME_LABELS[entry.outcome]
  const speed = formatSpeed(entry)
  return (
    <li className="setting-row history__item">
      <button type="button" className="setting-row__head history__head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span className="history__main">
          <span className="history__name">{entry.name}</span>
          <span className="history__meta">
            {formatWhen(entry.at)} · {outcome} · {formatWall(entry.wallMs)}
            {speed && ` · ${speed}`}
          </span>
          <span className="history__meta">
            {entry.width} × {entry.height} · {entry.fps} i/s · {settingsSummary(entry.settings)}
          </span>
        </span>
        <Icon name="chevron-down" size={16} />
      </button>
      <div id={id} className="setting-row__body" hidden={!open}>
        <Rows rows={entryDetails(entry)} />
        <Rows rows={settingsDetails(entry.settings)} />
        <div className="project__row">
          <button type="button" className="btn btn--secondary" onClick={() => reuse(entry)} disabled={busy}>
            Réutiliser ces réglages
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => remove(entry.id)}>
            Supprimer
          </button>
        </div>
      </div>
    </li>
  )
}

/**
 * « Historique des rendus »: the last renders (src/export/history.ts) with their output, real duration and the settings
 * that change the render time; reuse puts those settings back. Open when there is something to show. Last child of the
 * « Vidéo » and « Plusieurs formats » panels (on a phone each child of the sheet scrolls on its own).
 */
export function ExportHistory() {
  const entries = useExportHistory((s) => s.entries)
  const clear = useExportHistory((s) => s.clear)
  const exporting = useExportStore((s) => isExportBusy(s.phase))
  const batching = useBatchStore((s) => s.phase === 'running')
  const busy = exporting || batching
  // read once: the element then keeps its own state
  const [open] = useState(() => entries.length > 0)
  const [confirming, setConfirming] = useState(false)
  return (
    <details className="fold panel-section export-history" open={open}>
      <summary className="fold__summary">
        <h2 className="section-title fold__title">Historique des rendus</h2>
        {entries.length > 0 && <span className="field__hint">{entries.length}</span>}
        <Icon name="chevron-down" size={16} />
      </summary>
      <div className="panel-section__body">
        {entries.length === 0 ? (
          <p className="field__hint">Aucun rendu pour l’instant. Les films exportés (réussis, annulés ou échoués) apparaîtront ici avec leur durée et leurs réglages.</p>
        ) : (
          <>
            <ul className="history">
              {entries.map((entry) => (
                <Entry key={entry.id} entry={entry} busy={busy} />
              ))}
            </ul>
            <p className="field__hint">Gardé sur cet appareil : durées et réglages, ni trace, ni position, ni vidéo.</p>
            {confirming ? (
              <div className="project__row">
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => {
                    setConfirming(false)
                    clear()
                  }}
                >
                  Vider définitivement
                </button>
                <button type="button" className="btn btn--secondary" onClick={() => setConfirming(false)}>
                  Annuler
                </button>
              </div>
            ) : (
              <button type="button" className="btn btn--secondary" onClick={() => setConfirming(true)}>
                Vider l’historique
              </button>
            )}
          </>
        )}
      </div>
    </details>
  )
}
