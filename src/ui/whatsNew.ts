/**
 * « Nouveautés »: what changed, in the words of the people who use the application (features, not code), newest version
 * first. A minor version stands for its patches. Each item is an icon, a title and a sentence; the texts are in
 * `i18n/<language>/news.ts`. Adding a version: its items first in `WHATS_NEW` and its keys in the five languages; the
 * dot of the « i » button shows again until the new version is opened (`Preferences.whatsNewSeen`).
 */
import { t } from '../i18n'
import type { IconName } from './icons'

export interface NewsItem {
  icon: IconName
  readonly title: string
  readonly text: string
}

export interface NewsVersion {
  version: string
  items: readonly NewsItem[]
}

export const WHATS_NEW: readonly NewsVersion[] = [
  {
    version: '2.2',
    items: [
      { icon: 'map-pin', get title() { return t('news.v22.landmarks.title') }, get text() { return t('news.v22.landmarks.text') } },
      { icon: 'diamond', get title() { return t('news.v22.keys.title') }, get text() { return t('news.v22.keys.text') } },
      { icon: 'sliders-horizontal', get title() { return t('news.v22.keysFollow.title') }, get text() { return t('news.v22.keysFollow.text') } },
      { icon: 'route', get title() { return t('news.v22.route.title') }, get text() { return t('news.v22.route.text') } },
      { icon: 'navigation', get title() { return t('news.v22.figurine.title') }, get text() { return t('news.v22.figurine.text') } },
      { icon: 'satellite', get title() { return t('news.v22.imagery.title') }, get text() { return t('news.v22.imagery.text') } },
      { icon: 'plus', get title() { return t('news.v22.more.title') }, get text() { return t('news.v22.more.text') } },
    ],
  },
  {
    version: '2.1',
    items: [
      { icon: 'download', get title() { return t('news.v21.update.title') }, get text() { return t('news.v21.update.text') } },
      { icon: 'type', get title() { return t('news.v21.languages.title') }, get text() { return t('news.v21.languages.text') } },
      { icon: 'cloud-sun', get title() { return t('news.v21.weather.title') }, get text() { return t('news.v21.weather.text') } },
    ],
  },
  {
    version: '2.0',
    items: [{ icon: 'layers', get title() { return t('news.v20.interface.title') }, get text() { return t('news.v20.interface.text') } }],
  },
]

/** The newest version of the list: what `Preferences.whatsNewSeen` is compared with. */
export const LATEST_NEWS = WHATS_NEW[0].version
