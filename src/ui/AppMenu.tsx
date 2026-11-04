import { useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { useBatchStore } from '../export/batch'
import { isExportBusy, useExportStore } from '../export/store'
import { useLanguage, useT } from '../i18n'
import type { LanguageCode } from '../i18n'
import { useAppStore } from '../state/store'
import { AboutDialog } from './AboutDialog'
import { Icon } from './icons'
import { unsavedChangesText } from './library'
import { askUnsavedChanges } from './openChoice'
import { Button, Menu, Tip } from './primitives'
import type { MenuItem } from './primitives'
import { setPreferences, usePreferences } from './preferences'
import { closeProject } from './projectActions'
import { BOTTOM_SHEET_QUERY, matchesQuery } from './shell'
import { LATEST_NEWS } from './whatsNew'
import { WhatsNewDialog } from './WhatsNewDialog'

/** The user guide in `language`, published with the website (pages.yml): English at user-guide.html, the others at user-guide.<code>.html. */
export function guideUrl(language: LanguageCode): string {
  return `https://yannickriou.github.io/openflyover/docs/user-guide${language === 'en' ? '' : `.${language}`}.html`
}

/** Opens `url` in a new tab (the system browser on the desktop, see `platform/externalLinks.ts`, which listens to such links): a menu row is not a link. */
function openInNewTab(url: string) {
  const link = Object.assign(document.createElement('a'), { href: url, target: '_blank', rel: 'noreferrer' })
  document.body.append(link)
  link.click()
  link.remove()
}

const subscribePhone = (onChange: () => void) => {
  const query = window.matchMedia?.(BOTTOM_SHEET_QUERY)
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}
/** The portrait phone layout: the logo is hidden there, the menu goes to « Plus d'actions ». */
export const usePortraitPhone = () => useSyncExternalStore(subscribePhone, () => matchesQuery(BOTTOM_SHEET_QUERY))

export interface AppMenu {
  /** « Mes projets », « Nouveautés », « Guide d'utilisation », « Raccourcis clavier », « À propos et mises à jour » */
  items: MenuItem[]
  /** the newest « Nouveautés » have not been opened yet */
  newsUnseen: boolean
  /** the dialogs the entries open: render them once, next to the menu */
  dialogs: ReactNode
}

/**
 * The entries of the OpenFlyover menu: what is about the application itself and not used all the time. The top bar shows
 * them under the logo, and at the top of « Plus d'actions » on a portrait phone. `onHelp` opens « Raccourcis clavier ».
 */
export function useAppMenu(onHelp: () => void): AppMenu {
  const t = useT()
  const language = useLanguage()
  const [newsOpen, setNewsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const newsUnseen = usePreferences((s) => s.whatsNewSeen !== LATEST_NEWS)
  // « Mes projets » is the home screen: nothing to leave without a track, nor while a film renders
  const hasTracks = useAppStore((s) => s.tracks.length > 0)
  const exporting = useExportStore((s) => isExportBusy(s.phase))
  const batchRunning = useBatchStore((s) => s.phase === 'running')

  const items: MenuItem[] = [
    {
      id: 'projects',
      label: t('project.panel.library'),
      icon: <Icon name="folder" size={18} />,
      disabled: !hasTracks || exporting || batchRunning,
      // the waiting change is written first; the question comes only when changes would still be lost
      onSelect: () => void closeProject(() => askUnsavedChanges(unsavedChangesText())),
    },
    {
      id: 'news',
      label: t('news.title'),
      icon: <Icon name="sparkles" size={18} />,
      onSelect: () => {
        setNewsOpen(true)
        setPreferences({ whatsNewSeen: LATEST_NEWS })
      },
    },
    { id: 'guide', label: t('topbar.menu.guide'), icon: <Icon name="circle-help" size={18} />, onSelect: () => openInNewTab(guideUrl(language)) },
    { id: 'shortcuts', label: t('topbar.shortcuts'), icon: <Icon name="keyboard" size={18} />, onSelect: onHelp },
    { id: 'about', label: t('status.about'), icon: <Icon name="info" size={18} />, onSelect: () => setAboutOpen(true) },
  ]
  const dialogs = (
    <>
      <WhatsNewDialog open={newsOpen} onClose={() => setNewsOpen(false)} />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </>
  )
  return { items, newsUnseen, dialogs }
}

/**
 * The dot that tells of news, at the bottom right corner of the button that holds it (`relative`). Not the accent orange: next
 * to the logo, whose summit is that orange, it would read as a second sun. The ring of the bar detaches it from what is under it.
 */
export function NewsDot() {
  return <span className="absolute right-0.5 bottom-0.5 size-2.5 rounded-full bg-moss-light ring-2 ring-chrome" data-testid="news-dot" aria-hidden="true" />
}

/**
 * The logo and a chevron in one button of the bar: it opens the OpenFlyover menu. A dot tells that there is something new.
 * Not a drag region of the desktop title bar: a click on it must open the menu.
 */
export function LogoMenu({ items, newsUnseen }: Pick<AppMenu, 'items' | 'newsUnseen'>) {
  const t = useT()
  return (
    <Menu
      label={t('topbar.menu')}
      placement="bottom start"
      items={items}
      trigger={
        <Tip text={t('topbar.menu')}>
          <Button
            variant="icon"
            className="btn-chrome relative w-auto gap-0.5 px-1.5 phone:hidden"
            data-testid="logo-menu"
            aria-label={newsUnseen ? `${t('topbar.menu')} · ${t('news.title')}` : t('topbar.menu')}
          >
            <img className="size-6 flex-none" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={24} height={24} />
            <Icon name="chevron-down" size={14} />
            {newsUnseen && <NewsDot />}
          </Button>
        </Tip>
      }
    />
  )
}
