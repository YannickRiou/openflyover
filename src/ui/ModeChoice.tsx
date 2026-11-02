import { useState } from 'react'
import { useT } from '../i18n'
import { getPlatform } from '../platform'
import { PREFERENCES_KEY, setPreferences, usePreferences } from './preferences'
import { UI_MODES } from './shell'
import type { UiMode } from './shell'
import { tourSeen } from './tourSteps'
import { Button, Modal, Radio, RadioGroup } from './primitives'

/** Label of a mode in the top bar: text in a frame, lit when chosen, with the focus ring of the ink chrome (as the output format). */
const MODE_LABEL =
  'inline-flex h-7 cursor-pointer items-center rounded-sm px-2.5 text-caption font-semibold whitespace-nowrap text-glacier transition-ui ' +
  'hover:bg-white/10 hover:text-white data-[selected=true]:bg-white data-[selected=true]:text-ink ' +
  'data-[focus-visible=true]:outline-2 data-[focus-visible=true]:outline-offset-1 data-[focus-visible=true]:outline-accent-light'

/** « Débutant / Confirmé / Expert » in the top bar; a phone keeps the choice in « Réglages » only (no room on the bar). */
export function ModeSwitcher() {
  const t = useT()
  const mode = usePreferences((s) => s.uiMode)
  return (
    <RadioGroup
      look="plain"
      className="flex flex-row flex-nowrap gap-0.5 rounded-md border border-white/15 p-0.5 bar-condensed:hidden"
      aria-label={t('shell.mode.title')}
      value={mode}
      onChange={(uiMode: UiMode) => setPreferences({ uiMode })}
    >
      {UI_MODES.map((m) => (
        <Radio key={m} value={m} className="block" labelClassName={MODE_LABEL}>
          {t(`shell.mode.${m}`)}
        </Radio>
      ))}
    </RadioGroup>
  )
}

/** A mode of the first-launch question: its name over its one-line description, framed, the chosen one in the accent. */
const CHOICE =
  'flex w-full cursor-pointer flex-col gap-0.5 rounded-md border border-edge p-3 transition-ui hover:bg-surface-card ' +
  'data-[selected=true]:border-brand data-[selected=true]:bg-surface-card data-[focus-visible=true]:outline-2 data-[focus-visible=true]:outline-brand'

/** The device has never been set up: no preference stored, the tour not seen, no automated browser (the tour's own rule). */
function isFirstLaunch(): boolean {
  try {
    return getPlatform().storage.get(PREFERENCES_KEY) === null && !tourSeen() && !navigator.webdriver
  } catch {
    return false
  }
}

/**
 * « Combien de réglages voulez-vous voir ? »: asked once, at the first launch, before the tour. Débutant is preselected; the
 * choice is stored with the other preferences, so the question does not come back. Devices that already stored preferences
 * (installed before the modes) are not asked: they stay in Expert.
 */
export function ModeQuestion() {
  const t = useT()
  const [open, setOpen] = useState(isFirstLaunch)
  const [mode, setMode] = useState<UiMode>('debutant')
  const done = () => {
    setPreferences({ uiMode: mode })
    setOpen(false)
  }
  return (
    <Modal open={open} onClose={done} title={t('shell.mode.question')} closeLabel={t('common.close')} closeTip={t('common.closeEsc')} width={480}>
      <p className="type-hint mb-3">{t('shell.mode.questionHint')}</p>
      <RadioGroup look="plain" className="mb-4 flex flex-col gap-2" aria-label={t('shell.mode.title')} value={mode} onChange={(next: UiMode) => setMode(next)}>
        {UI_MODES.map((m) => (
          <Radio key={m} value={m} className="block" labelClassName={CHOICE}>
            <strong>{t(`shell.mode.${m}`)}</strong>
            <span className="type-hint">{t(`shell.mode.${m}.hint`)}</span>
          </Radio>
        ))}
      </RadioGroup>
      <Button variant="primary" className="w-full" onClick={done}>
        {t('shell.mode.continue')}
      </Button>
    </Modal>
  )
}
