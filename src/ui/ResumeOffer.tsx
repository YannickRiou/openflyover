import { useEffect, useState } from 'react'
import { useExportStore } from '../export/store'
import { abandonStoredExport, findStoredExport } from '../export/resume/offer'
import { keptShare, type ResumeManifest } from '../export/resume/resume'
import { projectKey } from '../export/resume/session'
import { getLanguage, useT, type LanguageCode } from '../i18n'
import { useAppStore } from '../state/store'
import { Button, Modal } from './primitives'

type Texts = Record<'title' | 'body' | 'resume' | 'abandon', string>

/** The texts of the dialog, one small module per language, fetched with it (the French catalog of the first screen stays as it is). */
const TEXTS: Record<LanguageCode, () => Promise<{ default: Texts }>> = {
  fr: () => import('../i18n/resume/fr'),
  en: () => import('../i18n/resume/en'),
  es: () => import('../i18n/resume/es'),
  it: () => import('../i18n/resume/it'),
  de: () => import('../i18n/resume/de'),
}

/**
 * « Reprendre l'export ? »: at start, when an export left unfinished on this device (screen locked, tab closed, crash)
 * belongs to the project now open. « Reprendre » opens the export panel, which starts the film again from the last
 * frame kept; « Abandonner » deletes what was kept. Loaded on demand (`App`): nothing of it in the first screen.
 */
export function ResumeOffer({ onOpenExport }: { onOpenExport: () => void }) {
  const t = useT()
  const [stored, setStored] = useState<ResumeManifest | null>(null)
  const [texts, setTexts] = useState<Texts | null>(null)
  const [open, setOpen] = useState(false)
  const tracks = useAppStore((s) => s.tracks)

  useEffect(() => {
    void findStoredExport().then(setStored)
  }, [])
  // the project of the last visit opens after the start: the offer waits for it, and only a project that is the same
  useEffect(() => {
    if (!stored || open || tracks.length === 0 || projectKey() !== stored.key) return
    void TEXTS[getLanguage()]().then((m) => {
      setTexts(m.default)
      setOpen(true)
    })
  }, [stored, tracks, open])

  const close = () => {
    setOpen(false)
    setStored(null)
  }
  if (!stored || !texts) return null
  const body = texts.body.replace('{name}', t('common.quoted', { text: stored.name })).replace('{percent}', String(Math.round(keptShare(stored) * 100)))
  return (
    <Modal open={open} onClose={close} title={texts.title} closeLabel={t('common.close')} closeTip={t('common.closeEsc')} width={480}>
      <p className="type-hint mb-3 wrap-anywhere">{body}</p>
      <div className="flex flex-col gap-2">
        <Button
          variant="primary"
          block
          autoFocus
          onClick={() => {
            useExportStore.setState({ resumeRequested: true })
            close()
            onOpenExport()
          }}
        >
          {texts.resume}
        </Button>
        <Button
          block
          onClick={() => {
            void abandonStoredExport()
            close()
          }}
        >
          {texts.abandon}
        </Button>
      </div>
    </Modal>
  )
}
