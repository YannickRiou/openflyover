import { useState } from 'react'
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
import { Button, Disclosure } from './primitives'

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

/*
 * A render of the list: a hairline above it, its head (name and facts) pressed to unfold the details under it. The head's
 * hover bleeds 8 px past the hairline, as in the setting rows.
 */
const ENTRY_HEAD =
  'group -mx-2 flex min-h-control-lg w-[calc(100%+16px)] cursor-pointer items-start gap-2 rounded-sm px-2 py-2 text-left transition-ui hover:bg-surface-card'
const ENTRY_META = 'type-hint tabular-nums wrap-anywhere'
/** Two buttons side by side. */
const ACTIONS = 'flex gap-2 *:min-w-0 *:flex-1'

function Rows({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <dl className="flex flex-col gap-0.5 text-hint [&+&]:border-t [&+&]:border-edge [&+&]:pt-2" data-testid="history-rows">
      {rows.map(({ label, value }) => (
        <div key={label} className="flex justify-between gap-3">
          <dt className="flex-none text-text-2">{label}</dt>
          <dd className="min-w-0 text-right text-text-1 tabular-nums wrap-anywhere">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function Entry({ entry, busy }: { entry: HistoryEntry; busy: boolean }) {
  const t = useT()
  const remove = useExportHistory((s) => s.remove)
  const outcome = entry.outcome === 'error' && entry.error ? t('export.history.outcomeError', { outcome: OUTCOME_LABELS.error, error: entry.error }) : OUTCOME_LABELS[entry.outcome]
  const speed = formatSpeed(entry)
  return (
    <li className="border-t border-edge" data-testid="history-item">
      <Disclosure
        headClassName={ENTRY_HEAD}
        bodyClassName="flex flex-col gap-3 pb-3"
        headTestId="history-head"
        bodyTestId="history-body"
        head={
          <>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="type-label truncate" data-testid="history-name">{entry.name}</span>
              <span className={ENTRY_META} data-testid="history-meta">
                {formatWhen(entry.at)} · {outcome} · {formatWall(entry.wallMs)}
                {speed && ` · ${speed}`}
              </span>
              <span className={ENTRY_META} data-testid="history-meta">
                {entry.width} × {entry.height} · {t('export.history.fps', { fps: entry.fps })} · {settingsSummary(entry.settings)}
              </span>
            </span>
            <span className="mt-1 flex flex-none text-text-2 transition-ui group-hover:text-text-1 group-aria-[expanded=false]:-rotate-90">
              <Icon name="chevron-down" size={16} />
            </span>
          </>
        }
      >
        <Rows rows={entryDetails(entry)} />
        <Rows rows={settingsDetails(entry.settings)} />
        <p className="type-hint">{t('export.history.reuseHint')}</p>
        <div className={ACTIONS}>
          <Button onClick={() => reuse(entry)} disabled={busy}>
            {t('export.history.reuse')}
          </Button>
          <Button onClick={() => remove(entry.id)}>
            {t('export.history.delete')}
          </Button>
        </div>
      </Disclosure>
    </li>
  )
}

/**
 * « Historique des rendus »: the last renders (src/export/history.ts) with their output, real duration and the settings
 * that change the render time; reuse puts those settings back. Open when there is something to show. Last child of the
 * « Vidéo » and « Plusieurs formats » panels (on a phone each child of the sheet scrolls on its own). Its header is not
 * sticky: the panel's own title is.
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
    <details className="group" data-testid="export-history" open={open}>
      <summary className="panel-bar cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <h2 className="panel-title flex-1">{t('export.history.title')}</h2>
        {entries.length > 0 && <span className="type-hint">{entries.length}</span>}
        <span className="flex text-text-2 transition-ui group-hover:text-text-1 group-[:not([open])]:-rotate-90">
          <Icon name="chevron-down" size={16} />
        </span>
      </summary>
      <div className="flex flex-col gap-3">
        {entries.length === 0 ? (
          <p className="type-hint">{t('export.history.empty')}</p>
        ) : (
          <>
            <ul className="flex flex-col">
              {entries.map((entry) => (
                <Entry key={entry.id} entry={entry} busy={busy} />
              ))}
            </ul>
            <p className="type-hint">{t('export.history.privacy')}</p>
            {confirming ? (
              <div className={ACTIONS}>
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
