import { useEffect, useRef, useState } from 'react'
import { closeDiagnostic, copyText, showDiagnostic, useDiagnosticStore } from '../export/diagnostic'
import { currentReport } from '../export/guard'
import { Icon } from './icons'
import { SettingRow } from './PanelSection'

/** « Diagnostic », last row of the Projet tab: the report made now, with the last export's (« mode debug »). */
export function DiagnosticRow() {
  return (
    <section className="settings project" aria-label="Diagnostic">
      <SettingRow label="Diagnostic" value="Rapport">
        <p className="field__hint">Appareil, réglages et dernier export, à joindre à un signalement. Sans position ni nom.</p>
        <button type="button" className="btn btn--secondary" onClick={() => showDiagnostic(currentReport())}>
          Afficher le rapport
        </button>
      </SettingRow>
    </section>
  )
}

/**
 * « Rapport de diagnostic » (native modal dialog, Escape closes it), opened by « Détails » of an interrupted export or
 * « Afficher le rapport » (Projet tab). Mounted once in App.
 */
export function DiagnosticDialog() {
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
          Rapport de diagnostic
        </h2>
        <button type="button" className="icon-btn" aria-label="Fermer" data-tip="Fermer (Échap)" data-tip-side="left" onClick={() => dialog.current?.close()}>
          <Icon name="x" size={18} />
        </button>
      </div>
      <p className="field__hint">
        Réglages, appareil et dernières étapes de l’export, sans position, nom de trace ni de projet. Copiez-le dans votre
        signalement.
      </p>
      <pre ref={report} className="diagnostic__text" tabIndex={0} aria-label="Rapport">
        {text}
      </pre>
      <div className="diagnostic__actions">
        <button type="button" className="btn btn--primary" onClick={() => void onCopy()}>
          {copy === 'copied' ? 'Copié' : 'Copier le rapport'}
        </button>
        <p className="field__hint" role="status">
          {copy === 'selected' ? 'Copie refusée par le navigateur : le texte est sélectionné, copiez-le.' : ''}
        </p>
      </div>
    </dialog>
  )
}
