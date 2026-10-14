import { useId, useState } from 'react'
import { useBatchStore } from '../export/batch'
import { useT, t } from '../i18n'
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
import { Button } from './primitives'

/** Put the export options and render settings of a past render back, as one undo step. */
function reuse(entry: HistoryEntry): void {
  const { settings, setFreeFraming } = useAppStore.getState()
  const next = reuseSettings(entry, settings)
  if ((Object.keys(next) as (keyof typeof next)[]).every((key) => Object.is(next[key], settings[key]))) {
    showToast({ kind: 'info', text: t('export.history.reuseNoop') })
    return
  }
  const history = getSettingsHistory()
  history.transaction(() => applySettings(next))
  if (next.video.aspect !== settings.video.aspect) setFreeFraming(false)
  showToast({ kind: 'success', text: t('export.history.reused', { name: entry.name }), action: { label: t('common.undo'), run: () => history.undo() } })
}

function Rows({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <dl className="history__rows" data-testid="history-rows">
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
  const t = useT()
  const id = useId()
  const [open, setOpen] = useState(false)
  const remove = useExportHistory((s) => s.remove)
  const outcome = entry.outcome === 'error' && entry.error ? t('export.history.outcomeError', { outcome: OUTCOME_LABELS.error, error: entry.error }) : OUTCOME_LABELS[entry.outcome]
  const speed = formatSpeed(entry)
  return (
    <li className="setting-row history__item" data-testid="history-item">
      <button type="button" className="setting-row__head history__head" data-testid="history-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span className="history__main">
          <span className="history__name" data-testid="history-name">{entry.name}</span>
          <span className="history__meta" data-testid="history-meta">
            {formatWhen(entry.at)} · {outcome} · {formatWall(entry.wallMs)}
            {speed && ` · ${speed}`}
          </span>
          <span className="history__meta" data-testid="history-meta">
            {entry.width} × {entry.height} · {t('export.history.fps', { fps: entry.fps })} · {settingsSummary(entry.settings)}
          </span>
        </span>
        <Icon name="chevron-down" size={16} />
      </button>
      <div id={id} className="setting-row__body" data-testid="history-body" hidden={!open}>
        <Rows rows={entryDetails(entry)} />
        <Rows rows={settingsDetails(entry.settings)} />
        <div className="project__row">
          <Button onClick={() => reuse(entry)} disabled={busy}>
            {t('export.history.reuse')}
          </Button>
          <Button onClick={() => remove(entry.id)}>
            {t('export.history.delete')}
          </Button>
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
  const t = useT()
  const entries = useExportHistory((s) => s.entries)
  const clear = useExportHistory((s) => s.clear)
  const exporting = useExportStore((s) => isExportBusy(s.phase))
  const batching = useBatchStore((s) => s.phase === 'running')
  const busy = exporting || batching
  // read once: the element then keeps its own state
  const [open] = useState(() => entries.length > 0)
  const [confirming, setConfirming] = useState(false)
  return (
    <details className="fold panel-section export-history" data-testid="export-history" open={open}>
      <summary className="fold__summary">
        <h2 className="section-title fold__title">{t('export.history.title')}</h2>
        {entries.length > 0 && <span className="field__hint">{entries.length}</span>}
        <Icon name="chevron-down" size={16} />
      </summary>
      <div className="panel-section__body">
        {entries.length === 0 ? (
          <p className="field__hint">{t('export.history.empty')}</p>
        ) : (
          <>
            <ul className="history">
              {entries.map((entry) => (
                <Entry key={entry.id} entry={entry} busy={busy} />
              ))}
            </ul>
            <p className="field__hint">{t('export.history.privacy')}</p>
            {confirming ? (
              <div className="project__row">
                <Button
                  onClick={() => {
                    setConfirming(false)
                    clear()
                  }}
                >
                  {t('export.history.clearConfirm')}
                </Button>
                <Button onClick={() => setConfirming(false)}>
                  {t('common.cancel')}
                </Button>
              </div>
            ) : (
              <Button onClick={() => setConfirming(true)}>
                {t('export.history.clear')}
              </Button>
            )}
          </>
        )}
      </div>
    </details>
  )
}
