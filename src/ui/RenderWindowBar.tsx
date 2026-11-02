import { useBatchStore } from '../export/batch'
import { jobCount, useQueueStore } from '../export/queue'
import { useExportStore } from '../export/store'
import { useT } from '../i18n'
import { Button } from './primitives'

/**
 * Top of the « File de rendus » window (export/renderWindow.ts), in place of the top bar: the project being rendered,
 * which of its films, how far, and the cancel button; the 3D view under it shows the image being made.
 */
export function RenderWindowBar() {
  const t = useT()
  const item = useQueueStore((s) => s.items.find((i) => i.status === 'running'))
  const left = useQueueStore((s) => s.items.filter((i) => i.status === 'pending').length)
  const running = useQueueStore((s) => s.running)
  const fraction = useExportStore((s) => (s.phase === 'finalizing' ? 1 : s.frameCount > 0 ? s.frame / s.frameCount : 0))
  const cancelRequested = useBatchStore((s) => s.cancelRequested)
  const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100)

  return (
    <header className="flex flex-col gap-1 bg-chrome px-3 py-2 text-white" data-testid="render-window-bar">
      <div className="flex items-center gap-2">
        <p className="m-0 min-w-0 flex-1 truncate text-body font-semibold" aria-live="polite">
          {item ? item.name : running ? t('export.queue.windowStarting') : t('export.queue.windowDone')}
        </p>
        {running && (
          <Button size="sm" onClick={() => useBatchStore.getState().cancel()} disabled={cancelRequested}>
            {t('common.cancel')}
          </Button>
        )}
      </div>
      {item && (
        <>
          <progress className="h-1.5 w-full" max={100} value={percent} aria-label={t('export.queue.windowProgress')} />
          <p className="m-0 text-hint text-glacier">
            {t('export.queue.progress', { index: item.step ?? 1, total: jobCount(item), percent })}
            {left > 0 && ` · ${t('export.queue.windowLeft', { count: left })}`}
          </p>
        </>
      )}
    </header>
  )
}
