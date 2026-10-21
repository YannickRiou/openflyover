import { useState } from 'react'
import { useT } from '../i18n'
import { getPlatform, type ProjectEntry } from '../platform'
import { useAppStore } from '../state/store'
import { Icon, type IconName } from './icons'
import { libraryFile, useLibraryStore } from './library'
import { setPreferences } from './preferences'
import { chooseProjectToOpen, chooseTracksToImport, loadSample, openProject } from './projectActions'
import { StravaImport } from './StravaImport'
import { Button } from './primitives'
import { LATEST_NEWS, WHATS_NEW } from './whatsNew'
import { WhatsNewDialog } from './WhatsNewDialog'

/** The thumbnail of a project of the list, an empty frame for an older entry that has none. */
const THUMB = 'library-thumb row-span-2'
/** A project of the list: its view, then its name over its summary. */
const PROJECT =
  'grid w-full cursor-pointer grid-cols-[64px_minmax(0,1fr)] items-center gap-x-3 rounded-md p-2 text-left text-text-1 transition-ui ' +
  'enabled:hover:bg-surface-card disabled:cursor-not-allowed disabled:opacity-45'
/** « Ouvrir un projet… »: a link-like button under the actions. */
const LINK =
  'cursor-pointer rounded-sm px-2 py-1 text-body font-semibold text-text-1 underline underline-offset-[3px] transition-ui ' +
  'enabled:hover:text-(--accent-hover) disabled:cursor-not-allowed disabled:opacity-45'

/** A link of the foot of the home screen (opens a new tab, the system browser on the desktop). */
const FOOT_LINK =
  'inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-hint text-text-2 no-underline underline-offset-[3px] transition-ui hover:text-text-1 hover:underline'

/** Projects of « Mes projets » offered on the home screen, most recent first. */
const RECENT_COUNT = 3
/** Titles of the newest « Nouveautés » named on the home screen. */
const NEWS_TITLES = 3

/** The user guide, published with the website (pages.yml), and the desktop installers of the latest release. */
export const GUIDE_URL = 'https://yannickriou.github.io/openflyover/docs/user-guide.html'
export const DOWNLOAD_URL = 'https://github.com/YannickRiou/openflyover/releases/latest'

/** What the app promises, under the title. */
const POINTS: { icon: IconName; key: 'home.empty.pointFree' | 'home.empty.pointNoAccount' | 'home.empty.pointLocal' }[] = [
  { icon: 'github', key: 'home.empty.pointFree' },
  { icon: 'lock', key: 'home.empty.pointNoAccount' },
  { icon: 'eye-off', key: 'home.empty.pointLocal' },
]

/**
 * Home screen until a track is loaded, over the whole view: what the app does, import (drop anywhere or the file
 * picker), Strava, the sample, open a project, what is new (« Nouveautés »), the latest projects of « Mes projets », and
 * links to the user guide, the desktop app (on the website) and the sources.
 */
export function EmptyState() {
  const t = useT()
  const loading = useAppStore((s) => s.loading)
  // the list is read by the « Projet » tab, always mounted; the open entry (emptied of its tracks) is not offered
  const entries = useLibraryStore((s) => s.entries)
  const currentId = useLibraryStore((s) => s.currentId)
  const recent = entries.filter((e) => e.id !== currentId).slice(0, RECENT_COUNT)
  const [newsOpen, setNewsOpen] = useState(false)
  const news = WHATS_NEW[0]
  const openNews = () => {
    setNewsOpen(true)
    setPreferences({ whatsNewSeen: LATEST_NEWS })
  }
  const web = !getPlatform().capabilities.isDesktop

  const open = async (entry: ProjectEntry) => {
    const file = await libraryFile(entry)
    if (file) await openProject(file, entry)
  }

  return (
    <section className="home-page" data-testid="empty-state" aria-labelledby="empty-title" aria-busy={loading}>
      <div className="home-column">
        <img className="mb-2 size-16 rounded-[14px] shadow-pop" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={64} height={64} />
        <h2 id="empty-title" className="home-title">
          {t('home.empty.title')}
        </h2>
        <p className="max-w-[36ch] text-title text-text-1">{t('home.empty.pitch')}</p>
        <ul className="mb-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-hint text-text-2">
          {POINTS.map(({ icon, key }) => (
            <li key={key} className="inline-flex items-center gap-1.5">
              <Icon name={icon} size={14} />
              {t(key)}
            </li>
          ))}
        </ul>
        <p className="mb-3 max-w-[32ch] text-body text-text-2">{t('home.empty.hint')}</p>
        <Button variant="primary" block className="min-h-12 text-title" onClick={() => void chooseTracksToImport()} disabled={loading}>
          {loading ? t('home.empty.importing') : t('home.empty.chooseFile')}
        </Button>
        <div className="home-actions">
          <StravaImport />
          <Button onClick={loadSample} disabled={loading}>
            {t('home.empty.sample')}
          </Button>
        </div>
        <button type="button" className={LINK} onClick={() => void chooseProjectToOpen()} disabled={loading}>
          {t('home.empty.openProject')}
        </button>

        <button
          type="button"
          className="mt-3 flex w-full cursor-pointer items-start gap-2 rounded-md border border-edge bg-surface-card p-3 text-left transition-ui hover:border-text-1"
          onClick={openNews}
          data-testid="home-news"
        >
          <Icon name="sparkles" size={18} />
          <span className="min-w-0">
            <span className="block font-semibold text-text-1">{t('home.empty.news', { version: news.version })}</span>
            <span className="type-hint block">{news.items.slice(0, NEWS_TITLES).map((item) => item.title).join(' · ')}</span>
          </span>
        </button>
        <WhatsNewDialog open={newsOpen} onClose={() => setNewsOpen(false)} />

        {recent.length > 0 && (
          <section className="mt-6 w-full border-t border-edge pt-4 text-left" aria-labelledby="empty-recent">
            <h3 id="empty-recent" className="mb-2 font-body text-body font-semibold text-text-2">
              {t('home.empty.recent')}
            </h3>
            <ul className="grid gap-1">
              {recent.map((entry) => (
                <li key={entry.id}>
                  <button type="button" className={PROJECT} onClick={() => void open(entry)} disabled={loading}>
                    {entry.thumbnail ? <img className={THUMB} src={entry.thumbnail} alt="" /> : <span className={THUMB} aria-hidden="true" />}
                    <span className="truncate font-semibold">{entry.name}</span>
                    <span className="type-hint truncate">{entry.summary}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <nav className="mt-3 flex flex-wrap justify-center gap-x-2" aria-label={t('home.empty.links')}>
          <a className={FOOT_LINK} href={GUIDE_URL} target="_blank" rel="noreferrer" data-testid="home-guide">
            <Icon name="circle-help" size={14} />
            {t('home.empty.guide')}
          </a>
          {web && (
            <a className={FOOT_LINK} href={DOWNLOAD_URL} target="_blank" rel="noreferrer" data-testid="home-download">
              <Icon name="download" size={14} />
              {t('home.empty.download')}
            </a>
          )}
          <a className={FOOT_LINK} href="https://github.com/YannickRiou/openflyover" target="_blank" rel="noreferrer" data-testid="home-github">
            <Icon name="github" size={14} />
            {t('home.empty.github')}
          </a>
        </nav>
      </div>
    </section>
  )
}
