import { useT } from '../i18n'
import { useOpenChoiceStore } from './openChoice'
import { Button, Modal } from './primitives'

/**
 * « Que faire de ce fichier ? » (modal dialog, Escape cancels): GPX / FIT files opened while the project holds tracks go
 * to that project or to a new one. Then « Fermer sans enregistrer ? » when the new project would lose changes. Mounted
 * once in App.
 */
export function OpenChoiceDialog() {
  const t = useT()
  const choice = useOpenChoiceStore((s) => s.choice)
  const unsaved = useOpenChoiceStore((s) => s.unsaved)
  const count = choice?.names.length ?? 1
  return (
    <>
      <Modal
        open={choice !== null}
        onClose={() => choice?.answer('cancel')}
        title={t('project.openAsk.title', { count })}
        closeLabel={t('common.close')}
        closeTip={t('common.closeEsc')}
        width={480}
      >
        <p className="type-hint mb-3 wrap-anywhere">{choice?.names.map((name) => t('common.quoted', { text: name })).join(', ')}</p>
        <div className="flex flex-col gap-2">
          <Button variant="primary" block autoFocus onClick={() => choice?.answer('add')}>
            {t('project.openAsk.add', { count })}
          </Button>
          <Button block onClick={() => choice?.answer('new')}>
            {t('project.openAsk.new')}
          </Button>
          <Button block onClick={() => choice?.answer('cancel')}>
            {t('common.cancel')}
          </Button>
        </div>
      </Modal>
      <Modal
        open={unsaved !== null}
        onClose={() => unsaved?.answer('cancel')}
        title={t('project.library.closeQuestion')}
        closeLabel={t('common.close')}
        closeTip={t('common.closeEsc')}
        width={480}
      >
        <p className="type-hint mb-3">{unsaved?.text}</p>
        <div className="flex flex-col gap-2">
          <Button variant="primary" block autoFocus onClick={() => unsaved?.answer('save')}>
            {t('common.save')}
          </Button>
          <Button block onClick={() => unsaved?.answer('close')}>
            {t('project.library.closeNoSave')}
          </Button>
          <Button block onClick={() => unsaved?.answer('cancel')}>
            {t('common.cancel')}
          </Button>
        </div>
      </Modal>
    </>
  )
}
