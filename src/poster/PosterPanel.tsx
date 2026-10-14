/**
 * « Affiche » mode of the export drawer: format, style, title, subtitle, figures, weather, « Carte à plat » and the 3D
 * view of the poster, its image type, a live thumbnail of its layout (2D only: the last rendered view, else a flat map
 * at a low zoom as an approximation, else a placeholder with the track's outline), the button that renders it and the
 * still image of the playback position (« Image fixe »). The result is saved like the other exports (export drawer,
 * `getPlatform().saveUrl`).
 */
import { errorMessage } from '../core/errors'
import { useLanguage, useT } from '../i18n'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { isExportBusy, useExportStore } from '../export/store'
import type { ExportResult } from '../export/store'
import { buildTrackPath } from '../flyover/path'
import { useLandmarkStore } from '../osm/store'
import { loadOverlayFonts } from '../overlay/assets'
import { miniMapOutline } from '../overlay/data'
import { OVERLAY_STYLE_LABELS } from '../overlay/settings'
import { getPlatform } from '../platform'
import { useAppStore } from '../state/store'
import { ModifiedMarker } from '../ui/ModifiedMarker'
import { formatNumber } from '../ui/format'
import { Icon } from '../ui/icons'
import { withShortcut } from '../ui/shortcuts'
import { effectiveProjectName } from '../ui/shell'
import { showToast } from '../ui/toast'
import { useWeatherStore } from '../weather/store'
import { availableFigures, posterStats } from './content'
import { drawPoster } from './draw'
import { currentPosterContent, posterRows, previewKey, previewMap, startPoster, startStill, usePosterPreview } from './export'
import { posterLayout } from './layout'
import { POSTER_FIGURES, POSTER_FIGURE_LABELS, POSTER_FORMATS, POSTER_STYLES, POSTER_VIEWS, POSTER_VIEW_LABELS, posterSize } from './settings'
import type { PosterSettings, PosterType } from './settings'
import './poster.css'
import { Button, Checkbox, Chip, Radio, RadioGroup, TextField, Tip } from '../ui/primitives'

/** Largest size of the thumbnail in the drawer (CSS px). */
const PREVIEW_MAX_W = 260
const PREVIEW_MAX_H = 220
/** The approximate view waits for the settings to rest this long (ms) before fetching its tiles. */
const PREVIEW_DEBOUNCE_MS = 400

const IMAGE_TYPES: { value: PosterType; label: string }[] = [
  { value: 'image/png', label: 'PNG' },
  { value: 'image/jpeg', label: 'JPEG' },
]

/**
 * Live thumbnail of the poster: the same drawing as the export, scaled down, without rendering the 3D view. Its view is
 * the last one rendered for these tracks and this view, else a flat map at a low zoom (debounced), else the placeholder.
 */
function PosterPreview({ poster }: { poster: PosterSettings }) {
  const t = useT()
  const language = useLanguage()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tracks = useAppStore((s) => s.tracks)
  const track = tracks[0]
  // what the content reads besides the poster settings: redraw when they change
  const race = useAppStore((s) => s.settings.race.enabled)
  const projectName = useAppStore((s) => s.projectName)
  const terrain = useAppStore((s) => s.settings.terrainSourceId)
  const imagery = useAppStore((s) => s.settings.imagerySourceId)
  const bounds = useAppStore((s) => s.bounds)
  const weather = useWeatherStore((s) => s.series)
  const landmarks = useLandmarkStore((s) => s.landmarks)
  const view = usePosterPreview((s) => s.view)
  const [fontsReady, setFontsReady] = useState(false)
  /** size of the layout's view box, for the approximate view */
  const [viewBox, setViewBox] = useState<{ w: number; h: number } | null>(null)
  const [approx, setApprox] = useState<{ key: string; image: OffscreenCanvas } | null>(null)
  const outline = useMemo(() => (track ? miniMapOutline(buildTrackPath(track)) : undefined), [track])

  useEffect(() => {
    let alive = true
    void loadOverlayFonts().then(() => alive && setFontsReady(true))
    return () => {
      alive = false
    }
  }, [])

  const { width, height } = posterSize(poster.format)
  const scale = Math.min(PREVIEW_MAX_W / width, PREVIEW_MAX_H / height)
  const cssW = Math.round(width * scale)
  const cssH = Math.round(height * scale)
  const exact = view && view.key === previewKey(tracks, poster) ? view : null
  // the approximate view of these tracks, this imagery, this box and this page colour (the casing of the lines)
  const approxKey = viewBox ? `${tracks.map((tr) => tr.id).join()}|${imagery}|${poster.style}|${viewBox.w}x${viewBox.h}` : ''
  const shownApprox = !exact && approx?.key === approxKey ? approx : null

  useEffect(() => {
    if (!approxKey || !viewBox || !bounds || exact) return undefined
    const abort = new AbortController()
    const timer = setTimeout(() => {
      previewMap(viewBox, abort.signal).then(
        ({ view: image }) => !abort.signal.aborted && setApprox({ key: approxKey, image }),
        // no tile: the placeholder stays
        () => undefined,
      )
    }, PREVIEW_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [approxKey, viewBox, bounds, exact])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const content = currentPosterContent()
    if (!canvas || !ctx || !content) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    const k = canvas.width / width
    ctx.setTransform(k, 0, 0, k, 0, 0)
    const layout = posterLayout(width, height, poster.style, posterRows(content))
    setViewBox((box) => (box?.w === layout.view.w && box.h === layout.view.h ? box : { w: layout.view.w, h: layout.view.h }))
    const image = exact ?? (shownApprox && { image: shownApprox.image, width: shownApprox.image.width, height: shownApprox.image.height })
    drawPoster(ctx, layout, content, poster.style, image ? { image: image.image, width: image.width, height: image.height } : null, outline)
  }, [poster, tracks, race, projectName, terrain, imagery, weather, landmarks, exact, shownApprox, fontsReady, outline, width, height, cssW, cssH, language])

  return (
    <>
      <canvas
        ref={canvasRef}
        className="poster__preview"
        style={{ width: cssW, height: cssH }}
        role="img"
        aria-label={t('poster.preview.aria')}
      />
      {!exact && (
        <p className="field__hint">
          {shownApprox ? t('poster.preview.approxFlat') : t('poster.preview.approx')} {poster.flat ? t('poster.preview.flatLoaded') : t('poster.preview.rendered')}
        </p>
      )}
    </>
  )
}

/**
 * The poster settings and its export. `modes` is the « Vidéo / Affiche » switch of the drawer, shown under the title.
 */
export function PosterPanel({ modes, onClose, hidden }: { modes: ReactNode; onClose?: () => void; hidden: boolean }) {
  const t = useT()
  const id = useId()
  const poster = useAppStore((s) => s.settings.poster)
  const setSetting = useAppStore((s) => s.setSetting)
  const tracks = useAppStore((s) => s.tracks)
  const track = tracks[0]
  const race = useAppStore((s) => s.settings.race.enabled)
  const projectName = useAppStore((s) => s.projectName)
  // a set of outings is summed: no weather of a single day
  const outings = tracks.length > 1 && !race
  const hasWeather = useWeatherStore((s) => s.status === 'ready' && s.trackId === track?.id) && !outings
  // only what the panel draws: the frames and timings of a film do not redraw it
  const { phase, result, tiles, still } = useExportStore(
    useShallow((s) => ({ phase: s.phase, result: s.result, tiles: s.tiles, still: s.request?.still })),
  )
  const busy = isExportBusy(phase)
  /** the last poster or still image made here (shown while it is still the last export) */
  const [done, setDone] = useState<ExportResult | null>(null)
  /** an export started here is running: its progress belongs to this panel */
  const [running, setRunning] = useState(false)
  /** why the last one started here failed */
  const [failed, setFailed] = useState<string | null>(null)

  const available = useMemo(() => (track ? availableFigures(posterStats(tracks, race)) : null), [track, tracks, race])
  const set = (patch: Partial<PosterSettings>) => setSetting('poster', { ...poster, ...patch })
  const { width, height } = posterSize(poster.format)
  const defaultTitle = effectiveProjectName(projectName, track?.name)

  /** follow an export started here until it ends */
  const follow = (started: boolean) => {
    if (!started || !isExportBusy(useExportStore.getState().phase)) return
    setRunning(true)
    const stop = useExportStore.subscribe((s) => {
      if (isExportBusy(s.phase)) return
      stop()
      setRunning(false)
      if (s.phase === 'done') setDone(s.result)
      if (s.phase === 'error') setFailed(s.error)
    })
  }
  const create = () => {
    setDone(null)
    setFailed(null)
    void startPoster().then(follow)
  }
  const createStill = () => {
    setDone(null)
    setFailed(null)
    follow(startStill())
  }

  const saveAgain = (r: ExportResult) => {
    if (!r.url) return
    void getPlatform()
      .saveUrl(r.url, { fileName: r.fileName })
      .catch((err: unknown) => showToast({ kind: 'error', text: t('poster.saveFailed', { file: r.fileName, error: errorMessage(err) }) }))
  }

  const flatMap = Boolean(still?.drawView)
  const progressLabel =
    phase === 'finalizing'
      ? still?.compose
        ? t('poster.progress.compose')
        : t('poster.progress.save')
      : tiles && tiles.total > 0
        ? t(flatMap ? 'poster.progress.tilesMap' : 'poster.progress.tiles3d', { done: formatNumber(tiles.done), total: formatNumber(tiles.total) })
        : flatMap
          ? t('poster.progress.loadingMap')
          : t('poster.progress.rendering')

  return (
    <section className="settings export poster" aria-labelledby={`${id}-title`} aria-busy={busy} hidden={hidden}>
      <h2 id={`${id}-title`} className="section-title settings__title">
        {t('export.panel.title')}
      </h2>
      <ModifiedMarker keys={['poster']} label={t('poster.panel.modified')} disabled={busy} />
      {onClose && (
        <Tip text={withShortcut(t('common.close'), 'export')} align="end">
          <Button
            variant="icon"
            className="settings__close"
            onClick={onClose}
            aria-label={t('poster.panel.closeAria')}
          >
            <Icon name="x" size={18} />
          </Button>
        </Tip>
      )}
      {modes}

      {track ? <PosterPreview poster={poster} /> : <p className="field__hint">{t('poster.panel.addTrack')}</p>}

      <div className="field">
        <label className="field__label" htmlFor={`${id}-format`}>
          {t('poster.panel.format')}
        </label>
        <select
          id={`${id}-format`}
          className="select"
          value={poster.format}
          disabled={busy}
          aria-describedby={`${id}-size`}
          onChange={(e) => {
            const format = POSTER_FORMATS.find((f) => f.id === e.currentTarget.value)
            if (format) set({ format: format.id })
          }}
        >
          {POSTER_FORMATS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <p id={`${id}-size`} className="field__hint">
          {t(poster.format === 'square' ? 'poster.panel.size' : 'poster.panel.sizeDpi', { width: formatNumber(width), height: formatNumber(height) })}
        </p>
      </div>

      <fieldset className="field fieldset" disabled={busy}>
        <legend className="field__label">{t('poster.panel.style')}</legend>
        <RadioGroup wrap aria-label={t('poster.panel.style')} value={poster.style} onChange={(style) => set({ style })}>
          {POSTER_STYLES.map((style) => (
            <Radio key={style} value={style}>
              {OVERLAY_STYLE_LABELS[style]}
            </Radio>
          ))}
        </RadioGroup>
      </fieldset>

      <TextField label={t('poster.panel.title')} value={poster.title} placeholder={defaultTitle} disabled={busy} onChange={(title) => set({ title })} />
      <TextField label={t('poster.panel.subtitle')} value={poster.subtitle} placeholder={t('poster.panel.subtitlePlaceholder')} disabled={busy} onChange={(subtitle) => set({ subtitle })} />

      <fieldset className="field fieldset" disabled={busy}>
        <legend className="field__label">{t('poster.panel.figures')}</legend>
        <div className="chips">
          {POSTER_FIGURES.map((figure) => {
            const present = available?.[figure] ?? false
            return (
              <Chip
                key={figure}
                checked={poster.figures[figure] && present}
                disabled={!present}
                title={present ? undefined : t('poster.panel.figureAbsent')}
                onChange={(on) => set({ figures: { ...poster.figures, [figure]: on } })}
              >
                {POSTER_FIGURE_LABELS[figure]}
              </Chip>
            )
          })}
        </div>
      </fieldset>

      <Checkbox
        checked={poster.weather && hasWeather}
        disabled={busy || !hasWeather}
        title={hasWeather ? undefined : outings ? t('poster.panel.weatherOutings') : t('poster.panel.weatherNotLoaded')}
        onChange={(on) => set({ weather: on })}
      >
        {t('poster.panel.weather')}
      </Checkbox>
      <Checkbox checked={poster.flat} disabled={busy} onChange={(on) => set({ flat: on })}>{t('poster.panel.flat')}</Checkbox>
      <fieldset className="field fieldset" disabled={busy || poster.flat}>
        <legend className="field__label">{t('poster.panel.view3d')}</legend>
        <RadioGroup aria-label={t('poster.panel.view3d')} value={poster.view} onChange={(view) => set({ view })}>
          {POSTER_VIEWS.map((view) => (
            <Radio key={view} value={view}>
              {POSTER_VIEW_LABELS[view]}
            </Radio>
          ))}
        </RadioGroup>
      </fieldset>
      <p className="field__hint">
        {poster.flat
          ? t('poster.panel.flatHint', { scope: tracks.length > 1 ? t('poster.panel.scopeAll') : t('poster.panel.scopeOne') })
          : poster.view === 'camera'
            ? t('poster.panel.cameraHint')
            : t('poster.panel.overviewHint', { scope: tracks.length > 1 ? t('poster.panel.scopeAll') : t('poster.panel.scopeOne') })}{' '}
        {t('poster.panel.credits')}
      </p>

      <fieldset className="field fieldset" disabled={busy}>
        <legend className="field__label">{t('poster.panel.imageType')}</legend>
        <RadioGroup aria-label={t('poster.panel.imageType')} value={poster.type} onChange={(type) => set({ type })}>
          {IMAGE_TYPES.map((type) => (
            <Radio key={type.value} value={type.value}>
              {type.label}
            </Radio>
          ))}
        </RadioGroup>
        <p className="field__hint">{t('poster.panel.imageTypeHint')}</p>
      </fieldset>

      {!busy && (
        <div className="export__actions">
          <Button variant="primary" onClick={create} disabled={!track}>
            <Icon name="map" size={18} />
            {t('poster.panel.create')}
          </Button>
          <Button
            onClick={createStill}
            disabled={!track}
            title={t('poster.panel.stillTip')}
          >
            <Icon name="image" size={18} />
            {t('poster.panel.still')}
          </Button>
        </div>
      )}
      {busy && running && still && (
        <div className="field">
          <progress
            className="export__progress"
            aria-label={t('poster.progress.aria')}
            {...(tiles && tiles.total > 0 && { max: tiles.total, value: phase === 'finalizing' ? tiles.total : tiles.done })}
          />
          <p className="field__hint" role="status">
            {progressLabel}
          </p>
          <Button
            block
            onClick={() => useExportStore.getState().cancel()}
            disabled={phase === 'finalizing'}
          >
            {t('common.cancel')}
          </Button>
        </div>
      )}
      {!busy && failed && (
        <p className="field__hint export__error" role="alert">
          {t('poster.panel.failed', { error: failed })}
        </p>
      )}
      {!busy && done && done === result && (
        <p className="field__hint">
          {t('poster.panel.done', { file: done.fileName, size: t('format.megabytes', { value: formatNumber(done.sizeBytes / 1e6, 1) }) })}{' '}
          <button type="button" className="poster__again" onClick={() => saveAgain(done)}>
            {t('poster.panel.saveAgain')}
          </button>
          {done.missingTiles !== undefined && done.missingTiles > 0 && (
            <span className="export__warning">
              {' '}
              {t('poster.panel.missingTiles', { count: done.missingTiles, n: formatNumber(done.missingTiles) })}
            </span>
          )}
        </p>
      )}
    </section>
  )
}
