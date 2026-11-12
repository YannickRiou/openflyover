/**
 * « Nouveautés »: what changed, in the words of the people who use the application (features, not code), newest version
 * first. A minor version stands for its patches, unless a patch has its own entry. Each item is an icon, a title and a
 * sentence; the texts are in `i18n/<language>/news.ts`. Adding a version: its items first in `WHATS_NEW` and its keys
 * in the five languages; the dot of the logo button shows again until the new version is opened
 * (`Preferences.whatsNewSeen`).
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
    version: '8.1.3',
    items: [
      { icon: 'gauge', get title() { return t('news.v813.export.title') }, get text() { return t('news.v813.export.text') } },
    ],
  },
  {
    version: '8.1',
    items: [
      { icon: 'map-pin', get title() { return t('news.v812.labels.title') }, get text() { return t('news.v812.labels.text') } },
      { icon: 'video', get title() { return t('news.v81.export.title') }, get text() { return t('news.v81.export.text') } },
      { icon: 'mountain', get title() { return t('news.v811.situation.title') }, get text() { return t('news.v811.situation.text') } },
      { icon: 'gauge', get title() { return t('news.v81.speed.title') }, get text() { return t('news.v81.speed.text') } },
      { icon: 'moon', get title() { return t('news.v81.days.title') }, get text() { return t('news.v81.days.text') } },
    ],
  },
  {
    version: '8.0',
    items: [
      { icon: 'mountain', get title() { return t('news.v80.camera.title') }, get text() { return t('news.v80.camera.text') } },
      { icon: 'sun', get title() { return t('news.v80.shadows.title') }, get text() { return t('news.v80.shadows.text') } },
      { icon: 'sparkles', get title() { return t('news.v80.look.title') }, get text() { return t('news.v80.look.text') } },
      { icon: 'aperture', get title() { return t('news.v80.focal.title') }, get text() { return t('news.v80.focal.text') } },
    ],
  },
  {
    version: '7.2',
    items: [
      { icon: 'cloud-sun', get title() { return t('news.v72.weather.title') }, get text() { return t('news.v72.weather.text') } },
      { icon: 'layers', get title() { return t('news.v72.legend.title') }, get text() { return t('news.v72.legend.text') } },
    ],
  },
  {
    version: '7.1',
    items: [
      { icon: 'moon', get title() { return t('news.v71.nights.title') }, get text() { return t('news.v71.nights.text') } },
    ],
  },
  {
    version: '7.0',
    items: [
      { icon: 'route', get title() { return t('news.v70.activity.title') }, get text() { return t('news.v70.activity.text') } },
      { icon: 'rotate-ccw', get title() { return t('news.v70.export.title') }, get text() { return t('news.v70.export.text') } },
      { icon: 'folder-open', get title() { return t('news.v70.projects.title') }, get text() { return t('news.v70.projects.text') } },
    ],
  },
  {
    version: '6.0',
    items: [
      { icon: 'square', get title() { return t('news.v60.window.title') }, get text() { return t('news.v60.window.text') } },
      { icon: 'sliders-horizontal', get title() { return t('news.v60.panels.title') }, get text() { return t('news.v60.panels.text') } },
      { icon: 'clapperboard', get title() { return t('news.v60.camera.title') }, get text() { return t('news.v60.camera.text') } },
      { icon: 'plus', get title() { return t('news.v60.timeline.title') }, get text() { return t('news.v60.timeline.text') } },
    ],
  },
  {
    version: '5.0',
    items: [
      { icon: 'sliders-horizontal', get title() { return t('news.v50.modes.title') }, get text() { return t('news.v50.modes.text') } },
      { icon: 'maximize', get title() { return t('news.v50.formats.title') }, get text() { return t('news.v50.formats.text') } },
      { icon: 'gauge', get title() { return t('news.v50.tiles.title') }, get text() { return t('news.v50.tiles.text') } },
      { icon: 'image', get title() { return t('news.v50.vivid.title') }, get text() { return t('news.v50.vivid.text') } },
    ],
  },
  {
    version: '4.7',
    items: [
      { icon: 'spline', get title() { return t('news.v47.draw.title') }, get text() { return t('news.v47.draw.text') } },
      { icon: 'sparkles', get title() { return t('news.v47.story.title') }, get text() { return t('news.v47.story.text') } },
      { icon: 'navigation', get title() { return t('news.v47.models.title') }, get text() { return t('news.v47.models.text') } },
      { icon: 'map-pin', get title() { return t('news.v47.stops.title') }, get text() { return t('news.v47.stops.text') } },
      { icon: 'circle-help', get title() { return t('news.v47.help.title') }, get text() { return t('news.v47.help.text') } },
    ],
  },
  {
    version: '4.6',
    items: [
      { icon: 'moon', get title() { return t('news.v46.nights.title') }, get text() { return t('news.v46.nights.text') } },
      { icon: 'image', get title() { return t('news.v46.capture.title') }, get text() { return t('news.v46.capture.text') } },
      { icon: 'map-pin', get title() { return t('news.v46.places.title') }, get text() { return t('news.v46.places.text') } },
    ],
  },
  {
    version: '4.5',
    items: [
      { icon: 'clapperboard', get title() { return t('news.v45.alive.title') }, get text() { return t('news.v45.alive.text') } },
      { icon: 'plane', get title() { return t('news.v45.flight.title') }, get text() { return t('news.v45.flight.text') } },
    ],
  },
  {
    version: '4.4',
    items: [
      { icon: 'sun', get title() { return t('news.v44.night.title') }, get text() { return t('news.v44.night.text') } },
      { icon: 'image', get title() { return t('news.v44.logos.title') }, get text() { return t('news.v44.logos.text') } },
    ],
  },
  {
    version: '4.3',
    items: [
      { icon: 'gauge', get title() { return t('news.v43.gentle.title') }, get text() { return t('news.v43.gentle.text') } },
      { icon: 'circle-help', get title() { return t('news.v43.guide.title') }, get text() { return t('news.v43.guide.text') } },
    ],
  },
  {
    version: '4.2',
    items: [
      { icon: 'map-pin', get title() { return t('news.v42.records.title') }, get text() { return t('news.v42.records.text') } },
      { icon: 'route', get title() { return t('news.v42.tools.title') }, get text() { return t('news.v42.tools.text') } },
      { icon: 'route', get title() { return t('news.v42.bilan.title') }, get text() { return t('news.v42.bilan.text') } },
      { icon: 'image', get title() { return t('news.v42.photos.title') }, get text() { return t('news.v42.photos.text') } },
    ],
  },
  {
    version: '4.1',
    items: [
      { icon: 'cloud-sun', get title() { return t('news.v41.ice.title') }, get text() { return t('news.v41.ice.text') } },
      { icon: 'gauge', get title() { return t('news.v41.speed.title') }, get text() { return t('news.v41.speed.text') } },
      { icon: 'clapperboard', get title() { return t('news.v41.auto.title') }, get text() { return t('news.v41.auto.text') } },
      { icon: 'type', get title() { return t('news.v41.credits.title') }, get text() { return t('news.v41.credits.text') } },
    ],
  },
  {
    version: '4.0',
    items: [
      { icon: 'clapperboard', get title() { return t('news.v40.auto.title') }, get text() { return t('news.v40.auto.text') } },
      { icon: 'download', get title() { return t('news.v40.queue.title') }, get text() { return t('news.v40.queue.text') } },
      { icon: 'map', get title() { return t('news.v40.nature.title') }, get text() { return t('news.v40.nature.text') } },
    ],
  },
  {
    version: '3.3',
    items: [
      { icon: 'route', get title() { return t('news.v33.stages.title') }, get text() { return t('news.v33.stages.text') } },
      { icon: 'type', get title() { return t('news.v33.titles.title') }, get text() { return t('news.v33.titles.text') } },
      { icon: 'sliders-horizontal', get title() { return t('news.v33.clear.title') }, get text() { return t('news.v33.clear.text') } },
      { icon: 'map-pin', get title() { return t('news.v33.landmarks.title') }, get text() { return t('news.v33.landmarks.text') } },
    ],
  },
  {
    version: '3.2',
    items: [
      { icon: 'type', get title() { return t('news.v32.cards.title') }, get text() { return t('news.v32.cards.text') } },
      { icon: 'route', get title() { return t('news.v32.fix.title') }, get text() { return t('news.v32.fix.text') } },
      { icon: 'gauge', get title() { return t('news.v32.counters.title') }, get text() { return t('news.v32.counters.text') } },
      { icon: 'rotate-ccw', get title() { return t('news.v32.tidy.title') }, get text() { return t('news.v32.tidy.text') } },
    ],
  },
  {
    version: '3.1',
    items: [
      { icon: 'image', get title() { return t('news.v31.dates.title') }, get text() { return t('news.v31.dates.text') } },
      { icon: 'orbit', get title() { return t('news.v31.free.title') }, get text() { return t('news.v31.free.text') } },
      { icon: 'cloud-sun', get title() { return t('news.v31.wind.title') }, get text() { return t('news.v31.wind.text') } },
      { icon: 'layers', get title() { return t('news.v31.home.title') }, get text() { return t('news.v31.home.text') } },
    ],
  },
  {
    version: '3.0',
    items: [
      { icon: 'video', get title() { return t('news.v30.camera.title') }, get text() { return t('news.v30.camera.text') } },
      { icon: 'sun', get title() { return t('news.v30.days.title') }, get text() { return t('news.v30.days.text') } },
      { icon: 'type', get title() { return t('news.v30.cards.title') }, get text() { return t('news.v30.cards.text') } },
      { icon: 'move-horizontal', get title() { return t('news.v30.timeline.title') }, get text() { return t('news.v30.timeline.text') } },
      { icon: 'download', get title() { return t('news.v30.export.title') }, get text() { return t('news.v30.export.text') } },
    ],
  },
  {
    version: '2.4',
    items: [
      { icon: 'video', get title() { return t('news.v24.camera.title') }, get text() { return t('news.v24.camera.text') } },
    ],
  },
  {
    version: '2.3',
    items: [
      { icon: 'spline', get title() { return t('news.v23.trail.title') }, get text() { return t('news.v23.trail.text') } },
      { icon: 'layers', get title() { return t('news.v23.legend.title') }, get text() { return t('news.v23.legend.text') } },
      { icon: 'plane', get title() { return t('news.v23.flights.title') }, get text() { return t('news.v23.flights.text') } },
      { icon: 'plus', get title() { return t('news.v23.more.title') }, get text() { return t('news.v23.more.text') } },
    ],
  },
  {
    version: '2.2',
    items: [
      { icon: 'map-pin', get title() { return t('news.v22.landmarks.title') }, get text() { return t('news.v22.landmarks.text') } },
      { icon: 'diamond', get title() { return t('news.v22.keys.title') }, get text() { return t('news.v22.keys.text') } },
      { icon: 'route', get title() { return t('news.v22.route.title') }, get text() { return t('news.v22.route.text') } },
      { icon: 'plus', get title() { return t('news.v22.more.title') }, get text() { return t('news.v22.more.text') } },
    ],
  },
  {
    version: '2.1',
    items: [
      { icon: 'type', get title() { return t('news.v21.languages.title') }, get text() { return t('news.v21.languages.text') } },
      { icon: 'cloud-sun', get title() { return t('news.v21.weather.title') }, get text() { return t('news.v21.weather.text') } },
      { icon: 'download', get title() { return t('news.v21.update.title') }, get text() { return t('news.v21.update.text') } },
    ],
  },
  {
    version: '2.0',
    items: [
      { icon: 'layers', get title() { return t('news.v20.interface.title') }, get text() { return t('news.v20.interface.text') } },
    ],
  },
]

/** The newest version of the list: what `Preferences.whatsNewSeen` is compared with. */
export const LATEST_NEWS = WHATS_NEW[0].version
