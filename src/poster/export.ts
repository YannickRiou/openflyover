/**
 * The poster from the stores: its content (every track, weather of the first one's outing, credits of the sources in
 * use), its export (a still of the 3D view, the overview framing every track or the camera as it is, or the flat map,
 * at the size of the layout's view box, composed into the poster by `drawPoster`), the still image of the playback
 * position, and the views of the live preview of the panel: the last rendered one, kept small, else a flat map at a
 * low zoom (`previewMap`).
 */
import { create } from 'zustand'
import type { TileFetcher, Track } from '../core/types'
import { videoSize } from '../export/schedule'
import { stillBaseName, useExportStore } from '../export/store'
import { climbsOf } from '../flyover/climbs'
import { trackPathOf } from '../flyover/path'
import { useLandmarkStore, useWaterStore } from '../osm/store'
import { loadOverlayFonts } from '../overlay/assets'
import { overlayCredits } from '../overlay/data'
import { useAppStore } from '../state/store'
import type { AppState } from '../state/store'
import { effectiveProjectName } from '../ui/shell'
import { summarizeOuting } from '../weather/series'
import { createTileFetcher } from '../terrain/fetch'
import { getImagerySource } from '../terrain/sources'
import { useWeatherStore } from '../weather/store'
import { posterContent } from './content'
import type { PosterContent } from './content'
import { POSTER_THEMES, drawPoster } from './draw'
import { posterLayout } from './layout'
import type { Box, PosterRows } from './layout'
import { posterSize } from './settings'
import type { PosterSettings } from './settings'
import { framingPath, renderFlatMap, type FlatMap } from './view'
import { t } from '../i18n'

/** Longest side of the view kept for the preview (px). */
const PREVIEW_VIEW_PX = 480
/** Simultaneous tile requests of a flat map (the imagery servers are shared). */
const FLAT_MAP_CONCURRENCY = 6
/** Longest side of the approximate view of the preview (px): a flat map of a handful of low-zoom tiles. */
const PREVIEW_MAP_PX = 360
/** Thinnest track line of a flat map (px): the small preview keeps it visible. */
const MIN_LINE_PX = 1.5

/** Rows of the layout for a content. */
export function posterRows(content: PosterContent): PosterRows {
  return {
    subtitle: content.subtitle !== '',
    figures: content.figures.length,
    profile: content.profile !== undefined,
    weather: content.weather !== '',
    tracks: content.tracks.length,
    map: content.outline !== undefined,
  }
}

/** File name without extension: « <projet> – affiche ». */
function posterBaseName(projectName: string): string {
  return `${projectName} – affiche`
}

/** The poster of the tracks with the current settings, null without a track. */
export function currentPosterContent(): PosterContent | null {
  const { tracks, settings, projectName } = useAppStore.getState()
  const track = tracks[0]
  if (!track) return null
  const weatherState = useWeatherStore.getState()
  const series = weatherState.status === 'ready' && weatherState.trackId === track.id ? weatherState.series : null
  // rebuilt on every preview redraw (each keystroke in the title): built once for the profile and the weather
  const path = trackPathOf(track)
  return posterContent({
    tracks,
    race: settings.race.enabled,
    path,
    poster: settings.poster,
    projectName: effectiveProjectName(projectName, track.name),
    climbs: tracks.map((t) => climbsOf(t).length),
    weather: series ? summarizeOuting(series, path) : undefined,
    credits: overlayCredits({
      terrainSourceId: settings.terrainSourceId,
      imagerySourceId: settings.imagerySourceId,
      weather: series !== null,
      // OpenStreetMap credited for its landmarks and, on the 3D view, its water
      landmarks:
        Object.values(useLandmarkStore.getState().landmarks).some((list) => list.length > 0) ||
        (!settings.poster.flat && useWaterStore.getState().polygons > 0),
      water: !settings.poster.flat && useWaterStore.getState().polygons > 0,
    }),
  })
}

export interface PosterPreviewState {
  /** last rendered view, scaled down, and what it shows (`previewKey`) */
  view: { key: string; image: ImageBitmap; width: number; height: number } | null
}

/** What a rendered view shows: these tracks, as a flat map, the 3D overview or the camera's view. */
export function previewKey(tracks: readonly Track[], poster: Pick<PosterSettings, 'flat' | 'view'>): string {
  return `${poster.flat ? 'plat' : poster.view === 'camera' ? 'camera' : '3d'}:${tracks.map((t) => t.id).join(',')}`
}

export const usePosterPreview = create<PosterPreviewState>()(() => ({ view: null }))

async function rememberView(key: string, view: OffscreenCanvas): Promise<void> {
  const scale = Math.min(1, PREVIEW_VIEW_PX / Math.max(view.width, view.height))
  const width = Math.max(1, Math.round(view.width * scale))
  const height = Math.max(1, Math.round(view.height * scale))
  try {
    const image = await createImageBitmap(view, { resizeWidth: width, resizeHeight: height, resizeQuality: 'medium' })
    usePosterPreview.getState().view?.image.close()
    usePosterPreview.setState({ view: { key, image, width, height } })
  } catch {
    // the preview keeps its placeholder
  }
}

/**
 * The flat map of every track for a view box of `width` × `height` px, from the imagery source in use. With no
 * `fetcher`, one of its own, cleared afterwards.
 */
async function drawFlatView(
  { w: width, h: height }: Pick<Box, 'w' | 'h'>,
  { tracks, bounds, settings }: Pick<AppState, 'tracks' | 'bounds' | 'settings'>,
  signal: AbortSignal,
  onProgress?: (done: number, total: number) => void,
  shared?: TileFetcher,
): Promise<FlatMap> {
  if (!bounds) throw new Error(t('poster.error.noTrack'))
  const fetcher = shared ?? createTileFetcher({ concurrency: FLAT_MAP_CONCURRENCY, maxEntries: 32 })
  try {
    return await renderFlatMap({
      width,
      height,
      bounds,
      source: getImagerySource(settings.imagerySourceId),
      tracks,
      // the width of the 3D line (`trackStyle.width` on a 1080 px frame)
      lineWidth: Math.max(MIN_LINE_PX, (settings.trackStyle.width * Math.min(width, height)) / 1080),
      casing: POSTER_THEMES[settings.poster.style].page,
      fetcher,
      signal,
      onProgress,
    })
  } finally {
    if (!shared) fetcher.clear()
  }
}

/** Tiles of the previews, kept from one to the next (a few at low zoom). */
let previewFetcher: TileFetcher | null = null

/**
 * Approximate view of the preview, without any 3D render: the flat map of every track at a low zoom, `box` scaled down
 * to PREVIEW_MAP_PX. Readable enough to judge the layout; the 3D view itself is rendered when the poster is made.
 */
export function previewMap(box: Pick<Box, 'w' | 'h'>, signal: AbortSignal): Promise<FlatMap> {
  const scale = Math.min(1, PREVIEW_MAP_PX / Math.max(box.w, box.h))
  const small = { w: Math.max(1, Math.round(box.w * scale)), h: Math.max(1, Math.round(box.h * scale)) }
  previewFetcher ??= createTileFetcher({ concurrency: 4, maxEntries: 64 })
  return drawFlatView(small, useAppStore.getState(), signal, undefined, previewFetcher)
}

/**
 * Ask the export controller for the poster: its fonts loaded first (the text is fitted with them), the view (the 3D
 * overview of every track, the camera's view as it is, or the flat map) at the size of the layout's view box, then the
 * whole poster composed as a PNG or a JPEG. False without a track.
 */
export async function startPoster(): Promise<boolean> {
  const content = currentPosterContent()
  const state = useAppStore.getState()
  const { tracks, settings, projectName, playback } = state
  const track = tracks[0]
  if (!content || !track) return false
  await loadOverlayFonts()
  const { format, style, flat, view: shot, type } = settings.poster
  const { width, height } = posterSize(format)
  const layout = posterLayout(width, height, style, posterRows(content))
  useExportStore.getState().start({
    width: layout.view.w,
    height: layout.view.h,
    fps: 30,
    quality: 'high',
    durationS: 0,
    holdStartS: 0,
    holdEndS: 0,
    baseName: posterBaseName(effectiveProjectName(projectName, track.name)),
    still: {
      progress: playback.progress,
      type,
      ...(shot === 'camera' ? { camera: true } : { overview: true, framing: framingPath(tracks) }),
      drawView: flat ? (signal, progress) => drawFlatView(layout.view, state, signal, progress) : undefined,
      async compose(view) {
        const poster = new OffscreenCanvas(width, height)
        const ctx = poster.getContext('2d', { alpha: false })
        if (!ctx) throw new Error(t('poster.error.posterImage'))
        drawPoster(ctx, layout, content, style, { image: view, width: view.width, height: view.height })
        await rememberView(previewKey(tracks, settings.poster), view)
        return poster
      },
    },
  })
  return true
}

/**
 * « Image fixe »: the film's view at the playback position, at the size of the film (« Vidéo »), with its overlay, in
 * the image type of the poster. False without a track.
 */
export function startStill(): boolean {
  const { tracks, settings, playback } = useAppStore.getState()
  const track = tracks[0]
  if (!track) return false
  const { aspect, resolution, fps, quality } = settings.video
  useExportStore.getState().start({
    ...videoSize(aspect, resolution),
    fps,
    quality,
    durationS: 0,
    holdStartS: 0,
    holdEndS: 0,
    baseName: stillBaseName(track.name, playback.progress),
    still: { progress: playback.progress, type: settings.poster.type },
  })
  return true
}
