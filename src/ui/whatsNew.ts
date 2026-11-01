/**
 * « Nouveautés »: what changed, in the words of the people who use the application (features, not code), newest version
 * first. A minor version stands for its patches, unless a patch has its own entry. Each item is an icon, a title and a
 * sentence; the texts are in `i18n/<language>/news.ts`. Adding a version: its items first in `WHATS_NEW` and its keys
 * in the five languages; the dot of the « i » button shows again until the new version is opened
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
    version: '4.7',
    items: [
      { icon: 'spline', get title() { return t('news.v47.draw.title') }, get text() { return t('news.v47.draw.text') } },
      { icon: 'sparkles', get title() { return t('news.v47.comet.title') }, get text() { return t('news.v47.comet.text') } },
      { icon: 'layers', get title() { return t('news.v47.contours.title') }, get text() { return t('news.v47.contours.text') } },
      { icon: 'gauge', get title() { return t('news.v47.value.title') }, get text() { return t('news.v47.value.text') } },
      { icon: 'layers', get title() { return t('news.v47.ribbon.title') }, get text() { return t('news.v47.ribbon.text') } },
      { icon: 'navigation', get title() { return t('news.v47.models.title') }, get text() { return t('news.v47.models.text') } },
      { icon: 'map-pin', get title() { return t('news.v47.summits.title') }, get text() { return t('news.v47.summits.text') } },
      { icon: 'sliders-horizontal', get title() { return t('news.v47.search.title') }, get text() { return t('news.v47.search.text') } },
      { icon: 'circle-help', get title() { return t('news.v47.tour.title') }, get text() { return t('news.v47.tour.text') } },
    ],
  },
  {
    version: '4.6',
    items: [
      { icon: 'moon', get title() { return t('news.v46.nights.title') }, get text() { return t('news.v46.nights.text') } },
      { icon: 'image', get title() { return t('news.v46.stage.title') }, get text() { return t('news.v46.stage.text') } },
      { icon: 'map-pin', get title() { return t('news.v46.places.title') }, get text() { return t('news.v46.places.text') } },
    ],
  },
  {
    version: '4.5',
    items: [
      { icon: 'clapperboard', get title() { return t('news.v45.camera.title') }, get text() { return t('news.v45.camera.text') } },
      { icon: 'map-pin', get title() { return t('news.v45.marker.title') }, get text() { return t('news.v45.marker.text') } },
      { icon: 'sparkles', get title() { return t('news.v45.records.title') }, get text() { return t('news.v45.records.text') } },
      { icon: 'plane', get title() { return t('news.v45.flight.title') }, get text() { return t('news.v45.flight.text') } },
      { icon: 'aperture', get title() { return t('news.v45.focal.title') }, get text() { return t('news.v45.focal.text') } },
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
      { icon: 'gauge', get title() { return t('news.v43.preview.title') }, get text() { return t('news.v43.preview.text') } },
      { icon: 'gauge', get title() { return t('news.v43.quiet.title') }, get text() { return t('news.v43.quiet.text') } },
      { icon: 'circle-help', get title() { return t('news.v43.guide.title') }, get text() { return t('news.v43.guide.text') } },
    ],
  },
  {
    version: '4.2.1',
    items: [{ icon: 'image', get title() { return t('news.v421.photos.title') }, get text() { return t('news.v421.photos.text') } }],
  },
  {
    version: '4.2',
    items: [
      { icon: 'map-pin', get title() { return t('news.v42.records.title') }, get text() { return t('news.v42.records.text') } },
      { icon: 'route', get title() { return t('news.v42.tools.title') }, get text() { return t('news.v42.tools.text') } },
      { icon: 'route', get title() { return t('news.v42.bilan.title') }, get text() { return t('news.v42.bilan.text') } },
    ],
  },
  {
    version: '4.1',
    items: [
      { icon: 'cloud-sun', get title() { return t('news.v41.glaciers.title') }, get text() { return t('news.v41.glaciers.text') } },
      { icon: 'gauge', get title() { return t('news.v41.speed.title') }, get text() { return t('news.v41.speed.text') } },
      { icon: 'cloud-sun', get title() { return t('news.v41.ice.title') }, get text() { return t('news.v41.ice.text') } },
      { icon: 'clapperboard', get title() { return t('news.v41.auto.title') }, get text() { return t('news.v41.auto.text') } },
      { icon: 'type', get title() { return t('news.v41.credits.title') }, get text() { return t('news.v41.credits.text') } },
    ],
  },
  {
    version: '4.0',
    items: [
      { icon: 'clapperboard', get title() { return t('news.v40.auto.title') }, get text() { return t('news.v40.auto.text') } },
      { icon: 'download', get title() { return t('news.v40.queue.title') }, get text() { return t('news.v40.queue.text') } },
      { icon: 'cloud-sun', get title() { return t('news.v40.snow.title') }, get text() { return t('news.v40.snow.text') } },
      { icon: 'map', get title() { return t('news.v40.forests.title') }, get text() { return t('news.v40.forests.text') } },
      { icon: 'map', get title() { return t('news.v40.water.title') }, get text() { return t('news.v40.water.text') } },
    ],
  },
  {
    version: '3.3.2',
    items: [{ icon: 'map-pin', get title() { return t('news.v332.landmarks.title') }, get text() { return t('news.v332.landmarks.text') } }],
  },
  {
    version: '3.3.1',
    items: [{ icon: 'route', get title() { return t('news.v331.recap.title') }, get text() { return t('news.v331.recap.text') } }],
  },
  {
    version: '3.3',
    items: [
      { icon: 'route', get title() { return t('news.v33.stages.title') }, get text() { return t('news.v33.stages.text') } },
      { icon: 'type', get title() { return t('news.v33.titles.title') }, get text() { return t('news.v33.titles.text') } },
      { icon: 'sliders-horizontal', get title() { return t('news.v33.clear.title') }, get text() { return t('news.v33.clear.text') } },
    ],
  },
  {
    version: '3.2.2',
    items: [
      { icon: 'gauge', get title() { return t('news.v322.counters.title') }, get text() { return t('news.v322.counters.text') } },
      { icon: 'type', get title() { return t('news.v322.cards.title') }, get text() { return t('news.v322.cards.text') } },
      { icon: 'sliders-horizontal', get title() { return t('news.v322.tidy.title') }, get text() { return t('news.v322.tidy.text') } },
      { icon: 'rotate-ccw', get title() { return t('news.v322.reset.title') }, get text() { return t('news.v322.reset.text') } },
    ],
  },
  {
    version: '3.2.1',
    items: [{ icon: 'type', get title() { return t('news.v321.panel.title') }, get text() { return t('news.v321.panel.text') } }],
  },
  {
    version: '3.2',
    items: [
      { icon: 'type', get title() { return t('news.v32.end.title') }, get text() { return t('news.v32.end.text') } },
      { icon: 'type', get title() { return t('news.v32.title.title') }, get text() { return t('news.v32.title.text') } },
      { icon: 'route', get title() { return t('news.v32.fix.title') }, get text() { return t('news.v32.fix.text') } },
    ],
  },
  {
    version: '3.1',
    items: [
      { icon: 'video', get title() { return t('news.v31.free.title') }, get text() { return t('news.v31.free.text') } },
      { icon: 'image', get title() { return t('news.v31.dates.title') }, get text() { return t('news.v31.dates.text') } },
      { icon: 'cloud-sun', get title() { return t('news.v31.wind.title') }, get text() { return t('news.v31.wind.text') } },
      { icon: 'orbit', get title() { return t('news.v31.orbit.title') }, get text() { return t('news.v31.orbit.text') } },
      { icon: 'layers', get title() { return t('news.v31.imagery.title') }, get text() { return t('news.v31.imagery.text') } },
      { icon: 'info', get title() { return t('news.v31.home.title') }, get text() { return t('news.v31.home.text') } },
    ],
  },
  {
    version: '3.0.1',
    items: [{ icon: 'type', get title() { return t('news.v301.cards.title') }, get text() { return t('news.v301.cards.text') } }],
  },
  {
    version: '3.0',
    items: [
      { icon: 'video', get title() { return t('news.v30.camera.title') }, get text() { return t('news.v30.camera.text') } },
      { icon: 'sun', get title() { return t('news.v30.days.title') }, get text() { return t('news.v30.days.text') } },
      { icon: 'type', get title() { return t('news.v30.cards.title') }, get text() { return t('news.v30.cards.text') } },
      { icon: 'move-horizontal', get title() { return t('news.v30.timeline.title') }, get text() { return t('news.v30.timeline.text') } },
      { icon: 'download', get title() { return t('news.v30.export.title') }, get text() { return t('news.v30.export.text') } },
      { icon: 'volume-2', get title() { return t('news.v30.sound.title') }, get text() { return t('news.v30.sound.text') } },
      { icon: 'plus', get title() { return t('news.v30.more.title') }, get text() { return t('news.v30.more.text') } },
    ],
  },
  {
    version: '2.4.1',
    items: [{ icon: 'video', get title() { return t('news.v241.camera.title') }, get text() { return t('news.v241.camera.text') } }],
  },
  {
    version: '2.4',
    items: [{ icon: 'video', get title() { return t('news.v24.camera.title') }, get text() { return t('news.v24.camera.text') } }],
  },
  {
    version: '2.3.2',
    items: [{ icon: 'spline', get title() { return t('news.v232.track.title') }, get text() { return t('news.v232.track.text') } }],
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
