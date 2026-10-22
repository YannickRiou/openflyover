import { useState } from 'react'
import { useBatchStore } from '../export/batch'
import { MAX_QUEUE_ITEMS, addOpenProject, askNotificationPermission, formatLabel, runRenderQueue, useQueueStore } from '../export/queue'
import type { QueueItem } from '../export/queue'
import { isExportBusy, useExportStore } from '../export/store'
import type { ExportResult } from '../export/store'
import { t as translate, useT } from '../i18n'
import { getPlatform } from '../platform'
import { canPickFolder, pickFolder } from '../platform/folder'
import { useAppStore } from '../state/store'
import { Icon } from './icons'
import { confirmClose, flushAutosave, projectCloseLoss, unsavedChangesText } from './library'
import { Button } from './primitives'
import { saveProject } from './projectActions'
import type { CloseAnswer } from './projectActions'
import { showToast } from './toast'

const ACTIONS = 'flex flex-col gap-2 *:min-w-0'

/** Status line of an item; `fraction` is the part of the film being rendered that is done. */
function statusText(item: QueueItem, fraction: number): string {
  if (item.status === 'pending') return item.interrupted ? translate('export.queue.interrupted') : translate('export.panel.status.pending')
  if (item.status === 'running') {
    const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100)
    const progress = translate('export.queue.progress', { index: item.step ?? 1, total: item.formats.length, percent })
    return `${translate('export.panel.status.running')} ${progress}`
  }
  if (item.status === 'error') return translate('export.panel.status.failed', { error: item.error ?? translate('export.panel.status.unknown') })
  return translate('export.panel.status.savedTracks', { files: (item.files ?? []).join(', ') })
}

/**
 * « File de rendus »: projects added with the formats ticked above, rendered one after the other (src/export/queue.ts).
 * `formats` are the films ticked in « Plusieurs formats »; `save` receives a film when no folder could be asked.
 */
export function RenderQueue({ formats, save }: { formats: readonly string[]; save(result: ExportResult): void }) {
  const t = useT()
  const items = useQueueStore((s) => s.items)
  const running = useQueueStore((s) => s.running)
  const hasTrack = useAppStore((s) => s.tracks.length > 0)
  const exporting = useExportStore((s) => isExportBusy(s.phase))
  const batching = useBatchStore((s) => s.phase === 'running')
  const busy = exporting || batching
  const cancelRequested = useBatchStore((s) => s.cancelRequested)
  const fraction = useExportStore((s) => (s.phase === 'finalizing' ? 1 : s.frameCount > 0 ? s.frame / s.frameCount : 0))
  // read once: the element then keeps its own state
  const [open] = useState(() => items.length > 0)
  /** the question of « Lancer la file » when the open project has changes saved nowhere */
  const [question, setQuestion] = useState<{ answer(a: CloseAnswer): void } | null>(null)
  const capabilities = getPlatform().capabilities
  const toFolder = capabilities.canStreamToDisk && canPickFolder(capabilities)
  const waiting = items.filter((i) => i.status === 'pending')

  const add = () => {
    const name = addOpenProject(formats)
    showToast(name ? { kind: 'success', text: t('export.queue.added', { name }) } : { kind: 'error', text: t('export.queue.full', { max: MAX_QUEUE_ITEMS }) })
  }

  const ask = () =>
    new Promise<CloseAnswer>((resolve) =>
      setQuestion({
        answer(a) {
          setQuestion(null)
          resolve(a)
        },
      }),
    )

  const start = () => {
    // asked now: the browser's folder picker needs this click; null = closed (nothing starts), undefined = films downloaded
    askNotificationPermission()
    const folder = toFolder
      ? pickFolder(capabilities).catch((error: unknown) => {
          console.warn('[file de rendus] dossier impossible, films téléchargés un par un :', error)
          showToast({ kind: 'info', text: t('export.queue.folderFailed') })
          return undefined
        })
      : Promise.resolve(undefined)
    void folder.then(async (picked) => {
      if (picked === null) return
      // the open project is replaced by those of the queue (and put back at the end): its changes are asked about first
      const proceed = await confirmClose({ flush: flushAutosave, loss: projectCloseLoss, ask, save: saveProject })
      if (proceed && !(await runRenderQueue({ folder: picked ?? null, save }))) showToast({ kind: 'error', text: t('export.queue.busy') })
    })
  }

  return (
    <details className="group" data-testid="render-queue" open={open}>
      <summary className="panel-bar cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <h2 className="panel-title flex-1">{t('export.queue.title')}</h2>
        {items.length > 0 && <span className="type-hint">{items.length}</span>}
        <span className="flex text-text-2 transition-ui group-hover:text-text-1 group-[:not([open])]:-rotate-90">
          <Icon name="chevron-down" size={16} />
        </span>
      </summary>
      <div className="flex flex-col gap-3">
        <p className="type-hint">{t('export.queue.hint')}</p>
        <Button block onClick={add} disabled={busy || !hasTrack || formats.length === 0}>
          <Icon name="plus" size={18} />
          {t('export.queue.add')}
        </Button>

        {items.length === 0 ? (
          <p className="type-hint">{t('export.queue.empty')}</p>
        ) : (
          <ul className="grid gap-2">
            {items.map((item) => (
              <li key={item.id} className="grid justify-items-start gap-0.5 wrap-anywhere">
                <span className="text-body font-semibold text-text-1">
                  {t('export.queue.formats', { name: item.name, formats: item.formats.map(formatLabel).join(', ') })}
                </span>
                <span className="type-hint">{statusText(item, fraction)}</span>
                {item.status !== 'running' && (
                  <Button size="sm" disabled={running} aria-label={t('export.queue.removeLabel', { name: item.name })} onClick={() => useQueueStore.getState().remove(item.id)}>
                    {t('export.queue.remove')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {question && (
          <>
            <p className="type-hint" role="alert">
              <strong>{translate('project.library.closeQuestion')}</strong> {unsavedChangesText()}
            </p>
            <div className={ACTIONS}>
              <Button autoFocus onClick={() => question.answer('save')}>
                {translate('common.save')}
              </Button>
              <Button onClick={() => question.answer('close')}>{translate('project.library.closeNoSave')}</Button>
              <Button onClick={() => question.answer('cancel')}>{translate('common.cancel')}</Button>
            </div>
          </>
        )}

        {!running && !question && waiting.length > 0 && (
          <Button variant="primary" block onClick={start} disabled={busy}>
            <Icon name="download" size={18} />
            {waiting.some((i) => i.interrupted) ? t('export.queue.resume') : t('export.queue.start')}
          </Button>
        )}
        {running && (
          <Button block onClick={() => useBatchStore.getState().cancel()} disabled={cancelRequested}>
            {t('export.queue.cancel')}
          </Button>
        )}
        <p className="type-hint">{t('export.queue.help')}</p>
        {running && <p className="type-hint">{t('export.queue.background')}</p>}
      </div>
    </details>
  )
}
