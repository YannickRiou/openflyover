import { useState } from 'react'
import { errorMessage } from '../core/errors'
import { isExportBusy, useExportStore } from '../export/store'
import { useBatchStore } from '../export/batch'
import { formatDate } from '../i18n/format'
import { useT } from '../i18n'
import { getPlatform } from '../platform'
import { canCheckUpdate, canInstallUpdate, percentOf, shortNotes } from '../platform/updater'
import type { UpdateState } from '../platform/updater'
import { flushAutosave, projectCloseLoss, unsavedChangesText } from './library'
import { PanelSection } from './PanelSection'
import { Button } from './primitives'

/** package.json version, set by vite.config.ts (the same number as the desktop installer's) */
declare const __APP_VERSION__: string

/**
 * « Mises à jour » (« Réglages » tab, desktop only): the check runs only when the button is pressed, and the
 * installation only after a question; the platform does the work (`checkForUpdate`, `installUpdate`).
 */
export function UpdatesSection() {
  const t = useT()
  const platform = getPlatform()
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  // a batch keeps the shell locked between its jobs too
  const exportBusy = useExportStore((s) => isExportBusy(s.phase))
  const batchRunning = useBatchStore((s) => s.phase === 'running')
  const exporting = exportBusy || batchRunning

  const check = async () => {
    setState({ status: 'checking' })
    setState((await platform.checkForUpdate?.()) ?? { status: 'unavailable' })
  }

  const install = async () => {
    if (state.status !== 'available' || !canInstallUpdate(state, exporting)) return
    // restarting does not go through the close guard: write the waiting change, then ask, naming what would be lost
    await flushAutosave()
    const unsaved = projectCloseLoss() === 'changes'
    const text = t('settings.updates.confirmText', { version: state.update.version })
    const answer = await platform.ask?.({
      title: t('settings.updates.confirmTitle'),
      text: unsaved ? `${text}\n\n${unsavedChangesText()}` : text,
      yes: t('settings.updates.install'),
      cancel: t('common.cancel'),
    })
    if (answer !== 'yes') return
    setState({ status: 'installing', percent: null })
    try {
      await platform.installUpdate?.((progress) => setState({ status: 'installing', percent: percentOf(progress) }))
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) })
    }
  }

  const status = (() => {
    switch (state.status) {
      case 'checking':
        return t('settings.updates.checking')
      case 'current':
        return t('settings.updates.current')
      case 'unavailable':
        return t('settings.updates.unavailable')
      case 'offline':
        return t('settings.updates.offline')
      case 'error':
        return t('settings.updates.error', { error: state.message })
      case 'installing':
        return state.percent === null ? t('settings.updates.installingUnknown') : t('settings.updates.installing', { percent: state.percent })
      case 'available': {
        const { version, date } = state.update
        const published = date && !Number.isNaN(Date.parse(date)) ? ` ${t('settings.updates.published', { date: formatDate(Date.parse(date), { dateStyle: 'long' }) })}` : ''
        return `${t('settings.updates.available', { version })}${published}`
      }
      default:
        return null
    }
  })()

  return (
    <PanelSection title={t('settings.updates.title')}>
      <p className="type-hint">{t('settings.updates.version', { version: __APP_VERSION__ })}</p>
      <Button disabled={!canCheckUpdate(state)} onClick={() => void check()}>
        {t('settings.updates.check')}
      </Button>
      {status && (
        <p className="text-body text-text-1" role="status">
          {status}
        </p>
      )}
      {state.status === 'available' && (
        <>
          {state.update.notes && (
            <div className="flex flex-col gap-1">
              <span className="type-label">{t('settings.updates.notes')}</span>
              <p className="type-hint whitespace-pre-line">{shortNotes(state.update.notes)}</p>
            </div>
          )}
          <Button variant="primary" disabled={!canInstallUpdate(state, exporting)} onClick={() => void install()}>
            {t('settings.updates.install')}
          </Button>
          {exporting && <p className="type-hint">{t('settings.updates.exportBusy')}</p>}
        </>
      )}
      <p className="type-hint">{t('settings.updates.hint')}</p>
    </PanelSection>
  )
}
