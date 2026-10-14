import { useEffect, useRef, useState } from 'react'
import { closeDiagnostic, copyText, noEncodingTest, setNoEncodingTest, showDiagnostic, useDiagnosticStore } from '../export/diagnostic'
import { currentReport } from '../export/guard'
import { useT } from '../i18n'
import { Icon } from './icons'
import { SettingRow } from './PanelSection'
import { Button, Tip } from './primitives'

/** « Diagnostic », last row of the Réglages tab: the report made now, with the last export's (« mode debug »). */
export function DiagnosticRow() {
  const t = useT()
  // debug only: kept in the tab's sessionStorage, never in the project
  const [noEncoding, setNoEncoding] = useState(noEncodingTest)
  return (
    <section className="settings project" aria-label={t('settings.diagnostic.title')}>
      <SettingRow label={t('settings.diagnostic.title')} value={t('settings.diagnostic.value')}>
        <p className="field__hint">{t('settings.diagnostic.hint')}</p>
        <Button onClick={() => showDiagnostic(currentReport())}>
          {t('settings.diagnostic.show')}
        </Button>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={noEncoding}
            onChange={(e) => {
              setNoEncodingTest(e.currentTarget.checked)
              setNoEncoding(e.currentTarget.checked)
            }}
          />
          {t('settings.diagnostic.noEncoding')}
        </label>
      </SettingRow>
    </section>
  )
}

/**
 * « Rapport de diagnostic » (native modal dialog, Escape closes it), opened by « Détails » of an interrupted export or
 * « Afficher le rapport » (Projet tab). Mounted once in App.
 */
export function DiagnosticDialog() {
  const t = useT()
  const text = useDiagnosticStore((s) => s.text)
  const dialog = useRef<HTMLDialogElement>(null)
  const report = useRef<HTMLPreElement>(null)
  const [copy, setCopy] = useState<'idle' | 'copied' | 'selected'>('idle')

  useEffect(() => {
    const el = dialog.current
    if (text !== null && el && !el.open) el.showModal()
    else if (text === null && el?.open) el.close()
  }, [text])

  useEffect(() => {
    if (copy !== 'copied') return undefined
    const timer = setTimeout(() => setCopy('idle'), 2000)
    return () => clearTimeout(timer)
  }, [copy])

  const onCopy = async () => {
    // writeText is called within the click (before any await): Safari needs the gesture
    if (await copyText(text ?? '')) return setCopy('copied')
    // refused: the text is selected for a copy by hand
    const pre = report.current
    if (pre) globalThis.getSelection?.()?.selectAllChildren(pre)
    setCopy('selected')
  }

  return (
    <dialog
      ref={dialog}
      className="sources diagnostic"
      aria-labelledby="diagnostic-title"
      onClose={() => {
        setCopy('idle')
        closeDiagnostic()
      }}
    >
      <div className="sources__head">
        <h2 id="diagnostic-title" className="sources__title">
          {t('settings.diagnostic.dialogTitle')}
        </h2>
        <Tip text={t('common.closeEsc')} side="left">
          <Button variant="icon" aria-label={t('common.close')} onClick={() => dialog.current?.close()}>
            <Icon name="x" size={18} />
          </Button>
        </Tip>
      </div>
      <p className="field__hint">{t('settings.diagnostic.dialogHint')}</p>
      <pre ref={report} className="diagnostic__text" tabIndex={0} aria-label={t('settings.diagnostic.report')}>
        {text}
      </pre>
      <div className="diagnostic__actions">
        <Button variant="primary" onClick={() => void onCopy()}>
          {copy === 'copied' ? t('settings.diagnostic.copied') : t('settings.diagnostic.copy')}
        </Button>
        <p className="field__hint" role="status">
          {copy === 'selected' ? t('settings.diagnostic.copyRefused') : ''}
        </p>
      </div>
    </dialog>
  )
}
