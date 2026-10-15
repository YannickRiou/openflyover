import { useT } from '../i18n'
import type { ProjectEntry } from '../platform'
import { useAppStore } from '../state/store'
import { Icon } from './icons'
import { libraryFile, useLibraryStore } from './library'
import { chooseProjectToOpen, chooseTracksToImport, loadSample, openProject } from './projectActions'
import { StravaImport } from './StravaImport'
import { Button } from './primitives'

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

/** Projects of « Mes projets » offered on the home screen, most recent first. */
const RECENT_COUNT = 3

/**
 * Home screen until a track is loaded, over the whole view: import (drop anywhere or the file picker), Strava, the
 * sample, open a project, and the latest projects of « Mes projets ».
 */
export function EmptyState() {
  const t = useT()
  const loading = useAppStore((s) => s.loading)
  // the list is read by the « Projet » tab, always mounted; the open entry (emptied of its tracks) is not offered
  const entries = useLibraryStore((s) => s.entries)
  const currentId = useLibraryStore((s) => s.currentId)
  const recent = entries.filter((e) => e.id !== currentId).slice(0, RECENT_COUNT)

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
        <p className="mb-3 max-w-[32ch] text-title text-text-2">{t('home.empty.hint')}</p>
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

        <a
          className="mt-3 inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-hint text-text-2 no-underline underline-offset-[3px] transition-ui hover:text-text-1 hover:underline"
          href="https://github.com/YannickRiou/openflyover"
          target="_blank"
          rel="noreferrer"
          data-testid="home-github"
        >
          <Icon name="github" size={14} />
          {t('home.empty.github')}
        </a>
      </div>
    </section>
  )
}
