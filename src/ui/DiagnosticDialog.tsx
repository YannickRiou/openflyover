import { useEffect, useRef, useState } from 'react'
import { closeDiagnostic, copyText, noEncodingTest, setNoEncodingTest, showDiagnostic, useDiagnosticStore } from '../export/diagnostic'
import { currentReport } from '../export/guard'
import { useT } from '../i18n'
import { SettingRow } from './PanelSection'
import { Button, Checkbox, Modal } from './primitives'

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
        <Checkbox
          checked={noEncoding}
          onChange={(on) => {
              setNoEncodingTest(on)
              setNoEncoding(on)
            }}
        >
          {t('settings.diagnostic.noEncoding')}
        </Checkbox>
      </SettingRow>
    </section>
  )
}

/**
 * « Rapport de diagnostic » (modal dialog, Escape closes it), opened by « Détails » of an interrupted export or
 * « Afficher le rapport » (Projet tab). Mounted once in App.
 */
export function DiagnosticDialog() {
  const t = useT()
  const text = useDiagnosticStore((s) => s.text)
  const report = useRef<HTMLPreElement>(null)
  const [copy, setCopy] = useState<'idle' | 'copied' | 'selected'>('idle')

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
    <Modal
      open={text !== null}
      onClose={() => {
        setCopy('idle')
        closeDiagnostic()
      }}
      title={t('settings.diagnostic.dialogTitle')}
      closeLabel={t('common.close')}
      closeTip={t('common.closeEsc')}
      width={720}
    >
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
    </Modal>
  )
}
