import { deviceBudget } from '../core/deviceBudget'
import { errorMessage } from '../core/errors'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  batchProgressLabel,
  batchSummary,
  buildBatchJobs,
  estimateBatch,
  formatKey,
  trackFiles,
  trackFraction,
  trackProgressLabel,
  useBatchStore,
  type BatchContext,
  type BatchJobState,
  type TrackRunState,
} from '../export/batch'
import { currentReport } from '../export/guard'
import { showDiagnostic } from '../export/diagnostic'
import { targetBitrate, type CodecCandidate } from '../export/encoder'
import { containerFor, encodableCodecs, exportCodec } from '../export/nativeEncoder'
import { CLOUD_QUALITY_NAMES, effectiveRender, isCustomised } from '../export/qualityTier'
import {
  AUDIO_BITRATES_KBPS,
  BITRATE_RANGE_MBPS,
  EXPORT_HOLD_END_S,
  EXPORT_HOLD_START_S,
  KEYFRAME_INTERVALS_S,
  VIDEO_ASPECTS,
  VIDEO_CODEC_CHOICES,
  VIDEO_FPS,
  VIDEO_RESOLUTIONS,
  buildFrameSchedule,
  exportResolutionNote,
  videoEncoding,
  videoSize,
  type VideoCodecChoice,
  type VideoQuality,
  type VideoSettings,
} from '../export/schedule'
import {
  chooseVideoDestination,
  isExportBusy,
  overlayBaseName,
  useExportStore,
  videoFileName,
  warnsInMemory,
  type ExportResult,
} from '../export/store'
import { getPlatform, videoEncoderMissingHint } from '../platform'
import { SHARE_SAVE_LABEL } from '../platform/platform'
import { canPickFolder, pickFolder, pickReadableFolder, type ReadableFolder, type WritableFolder } from '../platform/folder'
import { startPoster } from '../poster/export'
import { PosterPanel } from '../poster/PosterPanel'
import { useFilmClock } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { ExportHistory } from './ExportHistory'
import { ModifiedMarker } from './ModifiedMarker'
import { RangeField, RenderWeight, SettingRow } from './PanelSection'
import { formatNumber } from './format'
import { saveExportedFile } from './projectActions'
import { effectiveProjectName } from './shell'
import { AspectIcon, Icon } from './icons'
import { withShortcut } from './shortcuts'
import { showToast } from './toast'
import './exportPanel.css'

const QUALITIES: { value: VideoQuality; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'high', label: 'Haute' },
  { value: 'max', label: 'Maximale' },
]

const CODEC_LABELS: Record<string, string> = {
  'mp4/avc': 'MP4 (H.264)',
  'mp4/hevc': 'MP4 (HEVC)',
  'webm/vp9': 'WebM (VP9)',
  'webm/vp8': 'WebM (VP8)',
  png: 'PNG',
  jpeg: 'JPEG',
}

/** 75 -> "1 min 15 s", 42 -> "42 s" */
function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} s`
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`
}

/** bytes -> "12,3 Mo" */
function formatMegabytes(bytes: number): string {
  return `${formatNumber(bytes / 1e6, 1)} Mo`
}

/** bytes -> "1,5 Go" or "250 Mo" (limit of the in-memory warning) */
function formatLimit(bytes: number): string {
  return bytes >= 1e9 ? `${formatNumber(bytes / 1e9, 1)} Go` : `${formatNumber(bytes / 1e6)} Mo`
}

/** Phones without a save picker hand the file to the share sheet, which needs a tap: no automatic download there. */
function sharesFiles(): boolean {
  const { isDesktop, sharesFiles } = getPlatform().capabilities
  return !isDesktop && !!sharesFiles
}

/** Start a download of an object URL (the share sheet on phones, from a tap). */
function download(url: string, fileName: string): void {
  if (getPlatform().capabilities.isDesktop) return void saveExportedFile(url, fileName)
  if (sharesFiles()) return void getPlatform().saveUrl(url, { fileName }).catch(() => undefined)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
}

/** Codec the browser would use for a size / rate / quality / encoding (`key`), null when it can encode none. */
interface CodecProbe {
  key: string
  codec: CodecCandidate | null
}

const CODEC_CHOICE_LABELS: Record<VideoCodecChoice, string> = {
  auto: 'Automatique',
  avc: 'H.264 (MP4)',
  hevc: 'HEVC (MP4)',
  vp9: 'VP9 (WebM)',
}

/** « 0,5 s », « 2 s » */
const seconds = (s: number) => `${formatNumber(s, s % 1 === 0 ? 0 : 1)} s`

/**
 * "Exporter" drawer, « Vidéo » mode, in sections: « Format » (aspect tiles, resolution, frame rate), « Encodage »
 * (bitrate of the quality or chosen by hand, codec and container, key frames, sound), « Rendu » (the quality's render
 * tier), then the overlay alone, the estimate, start / cancel, progress, error and download. The still image is in the
 * « Affiche » mode.
 */
function VideoExportPanel({ onClose, modes, hidden }: { onClose?: () => void; modes: ReactNode; hidden: boolean }) {
  const video = useAppStore((s) => s.settings.video)
  const clouds = useAppStore((s) => s.settings.clouds)
  const customised = useAppStore((s) => isCustomised(s.settings))
  // film length and progress at each film time, with the slow-downs and pauses of the preview
  const pacing = useFilmClock()
  const durationS = pacing.totalTime()
  const trackName = useAppStore((s) => s.tracks[0]?.name)
  const setSetting = useAppStore((s) => s.setSetting)
  // only what the panel draws: `cancelRequested`, `request`, `renderScale`… changing does not redraw it
  const { phase, frame, frameCount, etaS, result, error, timings } = useExportStore(
    useShallow((s) => ({ phase: s.phase, frame: s.frame, frameCount: s.frameCount, etaS: s.etaS, result: s.result, error: s.error, timings: s.timings })),
  )
  const id = useId()
  /** « Habillage seul »: the overlay alone, transparent WebM to lay over one's own footage */
  const [overlayOnly, setOverlayOnly] = useState(false)
  const downloadedRef = useRef<ExportResult | null>(null)
  const streams = getPlatform().capabilities.canStreamToDisk

  const busy = isExportBusy(phase)
  const { width, height } = videoSize(video.aspect, video.resolution)
  const resolutionNote = exportResolutionNote(video.resolution)
  const encoding = videoEncoding(video)
  const totalFrames = buildFrameSchedule({
    durationS,
    fps: video.fps,
    holdStartS: EXPORT_HOLD_START_S,
    holdEndS: EXPORT_HOLD_END_S,
  }).length

  // Ask the browser which codec it can use at this size (H.264 may refuse large or tall frames).
  const probeKey = `${width}x${height}@${video.fps}/${video.quality}/${encoding.codec}/${encoding.bitrateMbps ?? ''}${overlayOnly ? '/alpha' : ''}`
  const [probe, setProbe] = useState<CodecProbe | null>(null)
  useEffect(() => {
    let alive = true
    const options = { width, height, fps: video.fps, quality: video.quality, encoding: videoEncoding(video), transparent: overlayOnly }
    void exportCodec(options).then((codec) => {
      if (alive) setProbe({ key: probeKey, codec })
    })
    return () => {
      alive = false
    }
  }, [probeKey, width, height, video, overlayOnly])
  const codec = probe?.key === probeKey ? probe.codec : undefined
  // the codecs « Encodage » offers: those this device encodes at this size
  const codecsKey = `${width}x${height}@${video.fps}/${video.quality}/${encoding.bitrateMbps ?? ''}`
  const [codecs, setCodecs] = useState<{ key: string; list: VideoCodecChoice[] } | null>(null)
  useEffect(() => {
    let alive = true
    void encodableCodecs({ width, height, fps: video.fps, quality: video.quality, encoding: videoEncoding(video) }).then((list) => {
      if (alive) setCodecs({ key: codecsKey, list })
    })
    return () => {
      alive = false
    }
  }, [codecsKey, width, height, video])
  const offered = codecs?.key === codecsKey ? codecs.list : (['auto'] as VideoCodecChoice[])
  const encodeOptions = { width, height, fps: video.fps, quality: video.quality, encoding }
  // no size estimate for the overlay alone: mostly empty frames come out far below the bitrate
  const estimatedBytes = codec && !overlayOnly ? (targetBitrate(encodeOptions, codec.codec) * totalFrames) / video.fps / 8 : 0
  // target video bitrate (H.264 until the codec is known), shown in « Encodage »
  const bitrate = targetBitrate(encodeOptions, codec?.codec ?? 'avc')
  const presetBitrate = targetBitrate({ ...encodeOptions, encoding: { ...encoding, bitrateMbps: null } }, codec?.codec ?? 'avc')
  // phones and tablets keep the film in memory: its bitrate has a ceiling (the line shows the real one)
  const bitrateCapped = bitrate < targetBitrate(encodeOptions, codec?.codec ?? 'avc', Infinity)
  const secondsPerImage =
    timings.rendered > 0 ? (timings.renderMs + timings.waitMs + timings.encodeMs) / timings.rendered / 1000 : null

  // Download the film automatically once it is ready (the link stays available), and say so.
  useEffect(() => {
    if (!result || downloadedRef.current === result) return
    downloadedRef.current = result
    // a batch saves its files itself
    if (useBatchStore.getState().phase === 'running') return
    const { url, fileName } = result
    // written straight to disk: already saved
    if (url === null) return void showToast({ kind: 'success', text: `Vidéo enregistrée dans ${fileName}` })
    const share = sharesFiles()
    if (!share) download(url, fileName)
    const image = result.mimeType.startsWith('image/')
    const label = share ? SHARE_SAVE_LABEL : getPlatform().capabilities.isDesktop ? 'Enregistrer…' : 'Télécharger à nouveau'
    const action = { label, run: () => download(url, fileName) }
    if (image && !share) showToast({ kind: 'success', text: 'Image prête' })
    else showToast({ kind: 'success', text: image ? 'Image prête' : 'Vidéo prête', action })
  }, [result])

  useEffect(() => {
    if (useBatchStore.getState().phase === 'running') return
    if (phase === 'error' && error) showToast({ kind: 'error', text: `Échec de l'export : ${error}` })
    else if (phase === 'canceled') showToast({ kind: 'info', text: 'Export annulé' })
  }, [phase, error])

  const update = (patch: Partial<VideoSettings>) => setSetting('video', { ...video, ...patch })
  // what the quality makes the export use (the clouds chosen by hand win over it)
  const tier = effectiveRender(video.quality, clouds)

  const start = () => {
    if (!trackName || !codec) return
    const baseName = overlayOnly ? overlayBaseName(trackName) : trackName
    // asked now: the browser's save picker needs this click
    const fileName = videoFileName(baseName, `.${codec.container}`)
    void chooseVideoDestination(getPlatform(), fileName).then(({ start: go, destination }) => {
      if (!go) return
      useExportStore.getState().start({
        width,
        height,
        fps: video.fps,
        quality: video.quality,
        encoding,
        durationS,
        progressAt: pacing.progressAtTime,
        holdStartS: EXPORT_HOLD_START_S,
        holdEndS: EXPORT_HOLD_END_S,
        baseName,
        destination,
        overlayOnly,
      })
    })
  }

  const announcement =
    phase === 'starting' || phase === 'rendering'
      ? 'Export en cours…'
      : phase === 'finalizing'
        ? 'Finalisation du fichier…'
        : ''

  return (
    <section className="settings export" aria-labelledby={`${id}-title`} aria-busy={busy} hidden={hidden}>
      <h2 id={`${id}-title`} className="section-title settings__title">
        Exporter
      </h2>
      <ModifiedMarker keys={['video']} label="Exporter" disabled={busy} />
      {onClose && (
        <button
          type="button"
          className="icon-btn settings__close"
          onClick={onClose}
          aria-label="Fermer le panneau d'export"
          data-tip={withShortcut('Fermer', 'export')}
          data-tip-align="end"
        >
          <Icon name="x" size={18} />
        </button>
      )}
      {modes}

      <h3 className="export__group">Format</h3>
      <fieldset className="field fieldset" disabled={busy}>
        <legend className="field__label">Proportions</legend>
        <div className="format-tiles">
          {VIDEO_ASPECTS.map((a) => (
            <label key={a.id} className="format-tile" title={a.label}>
              <input
                type="radio"
                name={`${id}-aspect`}
                value={a.id}
                checked={video.aspect === a.id}
                onChange={() => {
                  update({ aspect: a.id })
                  useAppStore.getState().setFreeFraming(false)
                }}
              />
              <AspectIcon x={a.x} y={a.y} size={28} />
              <span className="format-tile__label">{a.id}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <div className="field__label-row">
          <label className="field__label" htmlFor={`${id}-resolution`}>
            Résolution
          </label>
          <RenderWeight weight="resolution" />
        </div>
        <select
          id={`${id}-resolution`}
          className="select"
          value={video.resolution}
          disabled={busy}
          aria-describedby={`${id}-size`}
          onChange={(e) => {
            const resolution = VIDEO_RESOLUTIONS.find((r) => r.id === e.currentTarget.value)
            if (resolution) update({ resolution: resolution.id })
          }}
        >
          {VIDEO_RESOLUTIONS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <p id={`${id}-size`} className="field__hint">
          {formatNumber(width)} × {formatNumber(height)} px
          {resolutionNote && ` · ${resolutionNote}`}
        </p>
      </div>

      <fieldset className="field fieldset" disabled={busy}>
        <legend className="field__label">
          Images par seconde <RenderWeight weight="fps" />
        </legend>
        <div className="segmented">
          {VIDEO_FPS.map((fps) => (
            <label key={fps} className="segmented__option">
              <input type="radio" name={`${id}-fps`} value={fps} checked={video.fps === fps} onChange={() => update({ fps })} />
              {fps}
            </label>
          ))}
        </div>
      </fieldset>

      <h3 className="export__group">Encodage</h3>
      <fieldset className="field fieldset" disabled={busy || overlayOnly}>
        <legend className="field__label">Débit vidéo</legend>
        <div className="segmented">
          <label className="segmented__option">
            <input type="radio" name={`${id}-bitrate`} checked={!video.manualBitrate} onChange={() => update({ manualBitrate: false })} />
            Selon la qualité
          </label>
          <label className="segmented__option">
            <input
              type="radio"
              name={`${id}-bitrate`}
              checked={video.manualBitrate}
              // starts from the quality's bitrate, on the slider's steps
              onChange={() => update({ manualBitrate: true, bitrateMbps: snapBitrate(presetBitrate / 1e6) })}
            />
            Manuel
          </label>
        </div>
      </fieldset>
      {video.manualBitrate && !overlayOnly && (
        <RangeField
          label="Débit manuel"
          min={BITRATE_RANGE_MBPS.min}
          max={BITRATE_RANGE_MBPS.max}
          step={BITRATE_RANGE_MBPS.step}
          value={video.bitrateMbps}
          disabled={busy}
          format={(v) => `${formatNumber(v, 1)} Mbit/s`}
          onChange={(bitrateMbps) => update({ bitrateMbps })}
        />
      )}
      {!overlayOnly && (
        <p className="field__hint">
          {video.manualBitrate
            ? `La qualité suggère ${formatNumber(presetBitrate / 1e6, 1)} Mbit/s à cette taille.`
            : `${formatNumber(bitrate / 1e6, 1)} Mbit/s, d'après la qualité (section « Rendu »).`}
          {bitrateCapped && ` Plafonné à ${formatNumber(bitrate / 1e6, 1)} Mbit/s : le film reste en mémoire sur cet appareil.`}
        </p>
      )}

      <SettingRow label="Codec" value={overlayOnly ? 'VP9 (WebM)' : CODEC_CHOICE_LABELS[video.codec]} paths={['video.codec']}>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-codec`}>
            Codec et conteneur
          </label>
          <select
            id={`${id}-codec`}
            className="select"
            value={video.codec}
            disabled={busy || overlayOnly}
            onChange={(e) => {
              const choice = VIDEO_CODEC_CHOICES.find((c) => c === e.currentTarget.value)
              if (choice) update({ codec: choice })
            }}
          >
            {VIDEO_CODEC_CHOICES.filter((c) => offered.includes(c) || c === video.codec).map((c) => (
              <option key={c} value={c}>
                {CODEC_CHOICE_LABELS[c]}
              </option>
            ))}
          </select>
          <p className="field__hint">
            {overlayOnly
              ? "L'habillage seul est toujours en VP9 (WebM), pour garder la transparence."
              : 'Seuls les codecs que cet appareil sait encoder à cette taille sont proposés. Automatique : H.264 d’abord, lu partout.'}
          </p>
        </div>
      </SettingRow>
      <SettingRow label="Images clés" value={`toutes les ${seconds(video.keyframeIntervalS)}`} paths={['video.keyframeIntervalS']}>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-keyframes`}>
            Une image clé toutes les
          </label>
          <select
            id={`${id}-keyframes`}
            className="select"
            value={video.keyframeIntervalS}
            disabled={busy}
            onChange={(e) => update({ keyframeIntervalS: Number(e.currentTarget.value) })}
          >
            {KEYFRAME_INTERVALS_S.map((s) => (
              <option key={s} value={s}>
                {seconds(s)}
              </option>
            ))}
          </select>
          <p className="field__hint">Plus rapprochées : navigation plus précise au montage, fichier un peu plus lourd.</p>
        </div>
      </SettingRow>
      <SettingRow label="Son" value={`${video.audioKbps} kbit/s`} paths={['video.audioKbps']}>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-audio`}>
            Débit du son
          </label>
          <select
            id={`${id}-audio`}
            className="select"
            value={video.audioKbps}
            disabled={busy}
            onChange={(e) => update({ audioKbps: Number(e.currentTarget.value) })}
          >
            {AUDIO_BITRATES_KBPS.map((k) => (
              <option key={k} value={k}>
                {k} kbit/s
              </option>
            ))}
          </select>
          <p className="field__hint">Musique et son des vidéos du film (AAC en MP4, Opus en WebM).</p>
        </div>
      </SettingRow>

      <h3 className="export__group">Rendu</h3>
      <fieldset className="field fieldset" disabled={busy}>
        <legend className="field__label">
          Qualité de rendu{customised ? ' · Personnalisé' : ''}
        </legend>
        <div className="segmented">
          {QUALITIES.map((q) => (
            <label key={q.value} className="segmented__option">
              <input
                type="radio"
                name={`${id}-quality`}
                value={q.value}
                checked={video.quality === q.value}
                onChange={() => update({ quality: q.value })}
              />
              {q.label}
            </label>
          ))}
        </div>
        <p className="field__hint">
          Nuages {CLOUD_QUALITY_NAMES[tier.cloudsQuality].toLowerCase()}, flou de bougé {tier.maxSubFrames} rendus par image au plus
          {video.manualBitrate ? '' : ', et le débit vidéo'}. Le projet et l’aperçu ne changent pas.
        </p>
        {customised && (
          <button type="button" className="btn btn--secondary" onClick={() => setSetting('clouds', { ...clouds, quality: 'auto' })}>
            Revenir au préréglage
          </button>
        )}
      </fieldset>

      <div className="field">
        <label className="checkbox">
          <input type="checkbox" checked={overlayOnly} disabled={busy} onChange={(e) => setOverlayOnly(e.currentTarget.checked)} />
          Habillage seul (fond transparent)
        </label>
        {overlayOnly && (
          <p className="field__hint">
            Compteurs, profil, carte, titres et crédits sans la vue 3D, en WebM transparent, à poser sur vos propres images
            dans un logiciel de montage. Mêmes images que la vidéo, sans le son.
          </p>
        )}
      </div>

      <p className="export__summary" title="Chaque image est rendue une fois le relief visible chargé.">
        {formatClock(totalFrames / video.fps)} · {formatNumber(totalFrames)} images
        {codec && ` · ${CODEC_LABELS[`${codec.container}/${codec.codec}`]}`}
        {estimatedBytes > 0 && ` · ≈ ${formatMegabytes(estimatedBytes)}`}
      </p>
      {codec && streams && <p className="field__hint">Enregistrement direct sur le disque</p>}
      {codec && warnsInMemory(estimatedBytes, streams) && (
        <p className="field__hint">
          Au-delà de {formatLimit(deviceBudget().memoryWarnBytes)}, le film gardé en mémoire peut saturer l'onglet :{' '}
          {deviceBudget().kind === 'desktop'
            ? "Chrome et Edge l'écrivent directement sur le disque."
            : 'essayez 720p ou un film plus court.'}
        </p>
      )}
      {codec === null && overlayOnly && (
        <p className="field__hint" role="alert">
          Ce navigateur ne sait pas encoder une vidéo WebM (VP9) de {formatNumber(width)} × {formatNumber(height)} pixels,
          nécessaire à l'habillage transparent :{' '}
          {videoEncoderMissingHint() ?? 'exportez-le depuis Chrome ou Edge, ou choisissez une résolution plus petite.'}
        </p>
      )}
      {codec === null && !overlayOnly && (
        <p className="field__hint" role="alert">
          {video.codec === 'auto'
            ? `Ce navigateur ne sait pas encoder une vidéo de ${formatNumber(width)} × ${formatNumber(height)} pixels : ${videoEncoderMissingHint() ?? 'choisissez une résolution plus petite.'}`
            : `Cet appareil ne sait pas encoder en ${CODEC_CHOICE_LABELS[video.codec]} à ${formatNumber(width)} × ${formatNumber(height)} pixels : choisissez le codec « Automatique ».`}
        </p>
      )}

      {!busy && (
        <div className="export__actions">
          <button type="button" className="btn btn--primary" onClick={start} disabled={!trackName || !codec}>
            <Icon name="download" size={18} />
            {overlayOnly ? "Exporter l'habillage" : 'Exporter la vidéo'}
          </button>
        </div>
      )}

      {busy && (
        <div className="field">
          <progress
            className="export__progress"
            aria-label="Progression de l'export"
            max={Math.max(1, frameCount)}
            value={phase === 'finalizing' ? frameCount : frame}
          />
          <p className="field__hint">
            {phase === 'finalizing'
              ? 'Finalisation du fichier…'
              : phase === 'starting'
                ? 'Préparation…'
                : `Image ${formatNumber(frame)} / ${formatNumber(frameCount)}${
                    secondsPerImage === null ? '' : ` · ≈ ${formatNumber(secondsPerImage, 1)} s / image`
                  }${etaS === null ? '' : ` · reste environ ${formatClock(etaS)}`}`}
          </p>
          <p className="field__hint">L'aperçu reste figé pendant l'export ; chaque image attend que ses tuiles soient chargées.</p>
          <button
            type="button"
            className="btn btn--secondary btn--block"
            onClick={() => useExportStore.getState().cancel()}
            disabled={phase === 'finalizing'}
          >
            Annuler l'export
          </button>
        </div>
      )}

      {phase === 'error' && error && (
        <div className="field export__error" role="alert">
          <p className="field__hint">Échec de l'export : {error}</p>
          <button type="button" className="btn btn--secondary btn--small" onClick={() => showDiagnostic(currentReport())}>
            Rapport de diagnostic
          </button>
        </div>
      )}

      {phase === 'done' && result && (
        <p className="field__hint">
          {result.url === null ? (
            `Enregistrée dans ${result.fileName}`
          ) : getPlatform().capabilities.isDesktop || sharesFiles() ? (
            <button type="button" className="btn btn--secondary btn--small" onClick={() => result.url && download(result.url, result.fileName)}>
              {sharesFiles() ? `${SHARE_SAVE_LABEL} ${result.fileName}` : `Enregistrer ${result.fileName}…`}
            </button>
          ) : (
            <a href={result.url} download={result.fileName}>
              Télécharger {result.fileName}
            </a>
          )}{' '}
          ({formatMegabytes(result.sizeBytes)}, {CODEC_LABELS[result.codec] ?? result.codec}
          {result.hardware && ', encodeur matériel'}
          {result.note && `, ${result.note}`})
        </p>
      )}

      <ExportHistory />

      <p className="visually-hidden" role="status">
        {announcement}
      </p>
    </section>
  )
}

/** A bitrate on the steps of the manual slider, within its range. */
function snapBitrate(mbps: number): number {
  const { min, max, step } = BITRATE_RANGE_MBPS
  return Math.min(max, Math.max(min, Math.round(mbps / step) * step))
}

/** Line of a job in the result list of a batch. */
function jobStatusText(state: BatchJobState): string {
  const { status, result, error } = state
  if (status === 'pending') return 'en attente'
  if (status === 'running') return 'en cours…'
  if (status === 'canceled') return 'annulé'
  if (status === 'error') return `échec : ${error ?? 'inconnu'}`
  if (!result) return 'fait'
  return `${result.url === null ? 'enregistré : ' : ''}${result.fileName} (${formatMegabytes(result.sizeBytes)})`
}

/** Message at the end of a batch. */
function announceBatch(states: readonly BatchJobState[], folderName: string | null): void {
  const { done, failed, canceled } = batchSummary(states)
  const files = `${done} fichier${done > 1 ? 's' : ''}`
  if (failed > 0) showToast({ kind: 'error', text: `Export en lot : ${files} sur ${states.length}, ${failed} échec${failed > 1 ? 's' : ''}` })
  else if (canceled > 0) showToast({ kind: 'info', text: `Export en lot annulé (${files} prêt${done > 1 ? 's' : ''})` })
  else showToast({ kind: 'success', text: `${files} exporté${done > 1 ? 's' : ''}${folderName ? ` dans ${folderName}` : ''}` })
}

/** Line of a track in the result list of « Un film par trace ». */
function trackStatusText({ status, error, jobs }: TrackRunState): string {
  if (status === 'pending') return 'en attente'
  if (status === 'running') return 'en cours…'
  if (status === 'canceled') return 'annulé'
  if (status === 'error') return `échec : ${error ?? 'inconnu'}`
  return `enregistré : ${jobs.map((j) => j.result?.fileName).join(', ')}`
}

/** Message at the end of « Un film par trace ». */
function announceTrackFilms(tracks: readonly TrackRunState[], folderName: string): void {
  const { done, failed, canceled } = batchSummary(tracks)
  const plural = (n: number) => (n > 1 ? 's' : '')
  if (failed > 0) {
    showToast({ kind: 'error', text: `Un film par trace : ${done} trace${plural(done)} sur ${tracks.length}, ${failed} échec${plural(failed)}` })
  } else if (canceled > 0) showToast({ kind: 'info', text: `Un film par trace annulé (${done} trace${plural(done)} faite${plural(done)})` })
  else showToast({ kind: 'success', text: `Films de ${done} trace${plural(done)} exportés dans ${folderName}` })
}

/** « 3 traces dans « Saison » : a.gpx, b.fit, c.gpx… » */
function trackFolderText(folder: ReadableFolder, files: readonly { name: string }[]): string {
  if (files.length === 0) return `Aucun fichier GPX ou FIT dans « ${folder.name} ».`
  const names = files.slice(0, 3).map((f) => f.name).join(', ')
  return `${files.length} trace${files.length > 1 ? 's' : ''} dans « ${folder.name} » : ${names}${files.length > 3 ? '…' : ''}`
}

/**
 * « Plusieurs formats »: films ticked as aspect × resolution, plus a still image and the poster, with the total
 * estimate and one « Tout exporter » (src/export/batch.ts). Frame rate and quality are those of the « Vidéo » mode.
 * Source « Un film par trace »: the films ticked for each GPX / FIT file of a folder, into an output folder.
 */
function BatchExportPanel({ onClose, modes, hidden }: { onClose?: () => void; modes: ReactNode; hidden: boolean }) {
  const video = useAppStore((s) => s.settings.video)
  const pacing = useFilmClock()
  const durationS = pacing.totalTime()
  const track = useAppStore((s) => s.tracks[0])
  const projectName = useAppStore((s) => s.projectName)
  const exportBusy = useExportStore((s) => isExportBusy(s.phase))
  const fraction = useExportStore((s) => (s.phase === 'finalizing' ? 1 : s.frameCount > 0 ? s.frame / s.frameCount : 0))
  const rate = useExportStore((s) => s.secondsPerMegapixel)
  const { phase, selection, jobs: states, tracks: trackRuns, folderName, cancelRequested, select } = useBatchStore()
  const id = useId()
  const running = phase === 'running'
  const busy = running || exportBusy
  const capabilities = getPlatform().capabilities
  const toFolder = capabilities.canStreamToDisk && canPickFolder(capabilities)
  // « Un film par trace »: the track files of the folder picked, the films written into an output folder
  const [perTrack, setPerTrack] = useState(false)
  const [trackFolder, setTrackFolder] = useState<ReadableFolder | null>(null)
  const sources = useMemo(() => (trackFolder ? trackFiles(trackFolder.files) : []), [trackFolder])
  const runningTrack = trackRuns.find((t) => t.status === 'running')
  const tracksFinished = trackRuns.filter((t) => t.status !== 'pending' && t.status !== 'running').length

  const jobs = useMemo(() => buildBatchJobs(selection, video), [selection, video])
  const films = useMemo(() => jobs.flatMap((j) => (j.kind === 'video' ? [j] : [])), [jobs])
  const frames = buildFrameSchedule({
    durationS,
    fps: video.fps,
    holdStartS: EXPORT_HOLD_START_S,
    holdEndS: EXPORT_HOLD_END_S,
  }).length

  // codec of each ticked film, for its size (H.264 may refuse large or tall frames)
  const probeKey = `${films.map((j) => j.key).join()}@${video.fps}/${video.quality}/${video.codec}/${video.manualBitrate ? video.bitrateMbps : ''}`
  const [probe, setProbe] = useState<{ key: string; codecs: Record<string, CodecCandidate | null> } | null>(null)
  useEffect(() => {
    let alive = true
    void Promise.all(
      films.map(async (j) => [j.key, await exportCodec({ width: j.width, height: j.height, fps: video.fps, quality: video.quality, encoding: videoEncoding(video) })] as const),
    ).then((entries) => {
      if (alive) setProbe({ key: probeKey, codecs: Object.fromEntries(entries) })
    })
    return () => {
      alive = false
    }
  }, [probeKey, films, video])
  const codecs = probe?.key === probeKey ? probe.codecs : null
  const estimate = estimateBatch(
    jobs,
    frames,
    (j) => {
      const codec = codecs?.[j.key]
      const options = { width: j.width, height: j.height, fps: video.fps, quality: video.quality, encoding: videoEncoding(video) }
      return codec ? (targetBitrate(options, codec.codec) * frames) / video.fps / 8 : null
    },
    rate,
  )
  const unencodable = codecs ? films.filter((j) => codecs[j.key] === null) : []
  const finished = states.filter((s) => s.status !== 'pending' && s.status !== 'running').length
  const stillLabel = `${video.aspect} ${VIDEO_RESOLUTIONS.find((r) => r.id === video.resolution)?.label ?? ''}`

  const toggle = (key: string, on: boolean) =>
    select({ formats: on ? [...selection.formats, key] : selection.formats.filter((k) => k !== key) })

  /** What both sources share (the folder aside). */
  const shared = (): Pick<BatchContext, 'still' | 'containerOf' | 'startPoster' | 'save'> => ({
    still: { progress: useAppStore.getState().playback.progress, type: 'image/png' },
    containerOf: containerFor({ ...video, encoding: videoEncoding(video) }),
    startPoster,
    save: (r) => r.url && download(r.url, r.fileName),
  })

  const start = () => {
    if (!track || jobs.length === 0) return
    // asked now: the browser's folder picker needs this click; null = closed (no export), undefined = in memory
    const folder: Promise<WritableFolder | null | undefined> = toFolder
      ? pickFolder(capabilities).catch((error: unknown) => {
          console.warn('[export] dossier impossible, fichiers enregistrés un par un :', error)
          return undefined
        })
      : Promise.resolve(undefined)
    void folder.then(async (picked) => {
      if (picked === null) return
      const states = await useBatchStore.getState().run(jobs, {
        projectName: effectiveProjectName(projectName, track.name),
        film: {
          fps: video.fps,
          quality: video.quality,
          encoding: videoEncoding(video),
          durationS,
          progressAt: pacing.progressAtTime,
          holdStartS: EXPORT_HOLD_START_S,
          holdEndS: EXPORT_HOLD_END_S,
        },
        ...shared(),
        folder: picked ?? null,
      })
      announceBatch(states, picked?.name ?? null)
    })
  }


  const chooseTrackFolder = () => {
    // called from the click: the browser's folder picker needs it
    void pickReadableFolder(capabilities).then(
      (folder) => folder && setTrackFolder(folder),
      (error: unknown) => showToast({ kind: 'error', text: `Impossible de lire ce dossier : ${errorMessage(error)}` }),
    )
  }

  const startPerTrack = () => {
    if (sources.length === 0 || jobs.length === 0) return
    // asked now: the browser's folder picker needs this click; null = closed (no export)
    void pickFolder(capabilities).then(
      async (folder) => {
        if (!folder) return
        const tracks = await useBatchStore.getState().runTracks(sources, jobs, { ...shared(), folder })
        announceTrackFilms(tracks, folder.name)
      },
      (error: unknown) => showToast({ kind: 'error', text: `Impossible d'écrire dans ce dossier : ${errorMessage(error)}` }),
    )
  }

  return (
    <section className="settings export" aria-labelledby={`${id}-title`} aria-busy={busy} hidden={hidden}>
      <h2 id={`${id}-title`} className="section-title settings__title">
        Exporter
      </h2>
      {onClose && (
        <button
          type="button"
          className="icon-btn settings__close"
          onClick={onClose}
          aria-label="Fermer le panneau d'export"
          data-tip={withShortcut('Fermer', 'export')}
          data-tip-align="end"
        >
          <Icon name="x" size={18} />
        </button>
      )}
      {modes}

      <fieldset className="field fieldset" disabled={busy}>
        <legend className="field__label">Source</legend>
        <div className="segmented">
          <label className="segmented__option">
            <input type="radio" name={`${id}-source`} checked={!perTrack} onChange={() => setPerTrack(false)} />
            Ce film
          </label>
          <label className="segmented__option" title={toFolder ? undefined : "Avec Chrome, Edge ou l'application de bureau"}>
            <input type="radio" name={`${id}-source`} checked={perTrack} disabled={!toFolder} onChange={() => setPerTrack(true)} />
            Un film par trace
          </label>
        </div>
      </fieldset>
      {perTrack && (
        <div className="field">
          <button type="button" className="btn btn--secondary btn--block" onClick={chooseTrackFolder} disabled={busy}>
            <Icon name="folder-open" size={18} />
            {trackFolder ? 'Changer de dossier…' : 'Choisir le dossier des traces…'}
          </button>
          <p className="field__hint">
            {trackFolder
              ? trackFolderText(trackFolder, sources)
              : "Les fichiers cochés, pour chaque fichier GPX ou FIT du dossier, avec les réglages actuels. Les arrêts sont refaits pour chaque trace ; textes, photos, vidéos et points d'intérêt posés à la main ne sont pas repris, la musique l'est. Vos traces reviennent à la fin."}
          </p>
        </div>
      )}

      <fieldset className="field fieldset" disabled={busy}>
        <legend className="field__label">Formats</legend>
        <div className="batch-formats">
          {VIDEO_ASPECTS.map((a) => (
            <div key={a.id} className="batch-formats__row" role="group" aria-label={a.label}>
              <span className="batch-formats__aspect" title={a.label}>
                <AspectIcon x={a.x} y={a.y} size={20} />
                {a.id}
              </span>
              <div className="chips">
                {VIDEO_RESOLUTIONS.map((r) => {
                  const key = formatKey(a.id, r.id)
                  return (
                    <label key={r.id} className="chip">
                      <input
                        type="checkbox"
                        checked={selection.formats.includes(key)}
                        onChange={(e) => toggle(key, e.currentTarget.checked)}
                      />
                      {r.label}
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="field fieldset" disabled={busy}>
        <legend className="field__label">Aussi</legend>
        <label className="checkbox">
          <input type="checkbox" checked={selection.still} onChange={(e) => select({ still: e.currentTarget.checked })} />
          Image fixe ({stillLabel}, position de lecture)
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={selection.poster} onChange={(e) => select({ poster: e.currentTarget.checked })} />
          Affiche (réglages du mode « Affiche »)
        </label>
      </fieldset>

      {perTrack ? (
        <p className="export__summary">
          {sources.length} trace{sources.length > 1 ? 's' : ''} × {jobs.length} fichier{jobs.length > 1 ? 's' : ''} ·{' '}
          {sources.length * jobs.length} fichier{sources.length * jobs.length > 1 ? 's' : ''} en tout
        </p>
      ) : (
        <p className="export__summary">
          {estimate.files} fichier{estimate.files > 1 ? 's' : ''} · {formatNumber(estimate.frames)} images
          {estimate.bytes > 0 && ` · ≈ ${formatMegabytes(estimate.bytes)}`}
          {estimate.seconds !== null && ` · ≈ ${formatClock(estimate.seconds)} de rendu`}
        </p>
      )}
      <p className="field__hint">
        {video.fps} i/s, qualité {QUALITIES.find((q) => q.value === video.quality)?.label.toLowerCase()} (mode « Vidéo »).{' '}
        {toFolder
          ? 'Un dossier vous est demandé : chaque fichier y est écrit au fur et à mesure.'
          : "Chaque fichier se télécharge dès qu'il est prêt."}
        {!perTrack && estimate.seconds === null && films.length > 0 && ' Durée estimée après un premier film exporté.'}
      </p>
      {warnsInMemory(estimate.bytes, toFolder) && (
        <p className="field__hint">
          Au-delà de {formatLimit(deviceBudget().memoryWarnBytes)} en tout, les films gardés en mémoire peuvent saturer l'onglet.
        </p>
      )}
      {unencodable.length > 0 && (
        <p className="field__hint" role="alert">
          Ce navigateur ne sait pas encoder {unencodable.map((j) => j.label).join(', ')} : ces formats échoueront.{' '}
          {videoEncoderMissingHint() ?? ''}
        </p>
      )}

      {!busy && (
        <div className="export__actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={perTrack ? startPerTrack : start}
            disabled={jobs.length === 0 || (perTrack ? sources.length === 0 : !track)}
          >
            <Icon name="download" size={18} />
            Tout exporter
          </button>
        </div>
      )}

      {running && (
        <div className="field">
          {trackRuns.length > 0 ? (
            <>
              <progress
                className="export__progress"
                aria-label="Progression de l'export par trace"
                max={trackRuns.length}
                value={tracksFinished + (runningTrack ? trackFraction(runningTrack, fraction) : 0)}
              />
              <p className="field__hint">{trackProgressLabel(trackRuns, fraction)}</p>
            </>
          ) : (
            <>
              <progress
                className="export__progress"
                aria-label="Progression de l'export en lot"
                max={Math.max(1, states.length)}
                value={finished + (states.some((s) => s.status === 'running') ? fraction : 0)}
              />
              <p className="field__hint">{batchProgressLabel(states, fraction) || 'Préparation…'}</p>
            </>
          )}
          <button
            type="button"
            className="btn btn--secondary btn--block"
            onClick={() => useBatchStore.getState().cancel()}
            disabled={cancelRequested}
          >
            Tout annuler
          </button>
        </div>
      )}

      {trackRuns.length > 0 && (
        <div className="field">
          {folderName && <p className="field__hint">Dossier : {folderName}</p>}
          <ul className="batch-results">
            {trackRuns.map((t, i) => (
              <li key={i} className="batch-results__item">
                <span className="batch-results__label">{t.name}</span>
                <span className="field__hint">{trackStatusText(t)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {states.length > 0 && (
        <div className="field">
          {folderName && <p className="field__hint">Dossier : {folderName}</p>}
          <ul className="batch-results">
            {states.map((s) => (
              <li key={s.job.key} className="batch-results__item">
                <span className="batch-results__label">{s.job.label}</span>
                <span className="field__hint">{jobStatusText(s)}</span>
                {s.result?.url && (
                  <button
                    type="button"
                    className="btn btn--secondary btn--small"
                    onClick={() => s.result?.url && download(s.result.url, s.result.fileName)}
                  >
                    Enregistrer à nouveau
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ExportHistory />

      <p className="visually-hidden" role="status">
        {running ? (trackRuns.length > 0 ? trackProgressLabel(trackRuns, 0) : batchProgressLabel(states, 0)) : ''}
      </p>
    </section>
  )
}

type ExportMode = 'video' | 'batch' | 'poster'

/**
 * "Exporter" drawer in three modes: « Vidéo » (film), « Plusieurs formats » (batch) and « Affiche » (poster and still
 * image, src/poster). All stay mounted, so the result of a single export is always handled once, by the video mode
 * (download, toast); a batch saves and announces its own files.
 */
export function ExportPanel({ onClose }: { onClose?: () => void }) {
  const [mode, setMode] = useState<ExportMode>('video')
  const exporting = useExportStore((s) => isExportBusy(s.phase))
  const batching = useBatchStore((s) => s.phase === 'running')
  const busy = exporting || batching
  const id = useId()
  const modes = (
    <fieldset className="field fieldset" disabled={busy}>
      <legend className="visually-hidden">Type d'export</legend>
      <div className="segmented">
        {(
          [
            ['video', 'Vidéo'],
            ['batch', 'Plusieurs formats'],
            ['poster', 'Affiche'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="segmented__option">
            <input type="radio" name={`${id}-mode`} value={value} checked={mode === value} onChange={() => setMode(value)} />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  )
  return (
    <>
      <VideoExportPanel onClose={onClose} modes={mode === 'video' && modes} hidden={mode !== 'video'} />
      <BatchExportPanel onClose={onClose} modes={mode === 'batch' && modes} hidden={mode !== 'batch'} />
      <PosterPanel onClose={onClose} modes={mode === 'poster' && modes} hidden={mode !== 'poster'} />
    </>
  )
}
