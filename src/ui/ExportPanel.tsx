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
import { CLOUD_QUALITY_NAMES, QUALITY_NAMES, effectiveRender, isCustomised } from '../export/qualityTier'
import { t, t as translate, useT } from '../i18n'
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
import { shareSaveLabel } from '../platform/platform'
import { canPickFolder, pickFolder, pickReadableFolder, type ReadableFolder, type WritableFolder } from '../platform/folder'
import { startPoster } from '../poster/export'
import { PosterPanel } from '../poster/PosterPanel'
import { useFilmClock } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import type { Settings } from '../state/store'
import { ExportHistory } from './ExportHistory'
import { ModifiedMarker } from './ModifiedMarker'
import { RangeField, RenderWeight, SettingRow } from './PanelSection'
import { formatBytes, formatNumber } from './format'
import { saveExportedFile } from './projectActions'
import { effectiveProjectName } from './shell'
import { AspectIcon, Icon } from './icons'
import { withShortcut } from './shortcuts'
import { showToast } from './toast'
import './exportPanel.css'
import { Button, Checkbox, Chip, Radio, RadioGroup, Select, Tip } from './primitives'

const QUALITIES: { value: VideoQuality; label: string }[] = [
  { value: 'standard', get label() { return QUALITY_NAMES.standard } },
  { value: 'high', get label() { return QUALITY_NAMES.high } },
  { value: 'max', get label() { return QUALITY_NAMES.max } },
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

/** bytes -> "12,3 Mo" ("12.3 MB") */
function formatMegabytes(bytes: number): string {
  return t('format.megabytes', { value: formatNumber(bytes / 1e6, 1) })
}

/** bytes -> "1,5 Go" or "250 Mo" (limit of the in-memory warning) */
const formatLimit = formatBytes

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
  get auto() { return t('export.panel.codec.auto') },
  avc: 'H.264 (MP4)',
  hevc: 'HEVC (MP4)',
  vp9: 'VP9 (WebM)',
}

/** « 0,5 s », « 2 s » */
const seconds = (s: number) => `${formatNumber(s, s % 1 === 0 ? 0 : 1)} s`

/** The panel of a mode in the dock: its fields in a column under a sticky header (the dock scrolls). */
const PANEL = 'flex flex-col gap-3 px-4 pb-4 *:shrink-0'
/** « Format », « Encodage », « Rendu »: a small caps heading over a hairline, the fields of the group under it. */
const GROUP = 'mt-3 border-t border-edge pt-2 font-body text-hint font-semibold tracking-wider text-text-2 uppercase'
/** The buttons of the panel, one per line. */
const ACTIONS = 'flex flex-col gap-2 *:min-w-0'
/** Duration, images, codec and size on one tinted line. */
const SUMMARY = 'rounded-sm bg-surface-card px-3 py-2 text-body font-semibold text-text-1 tabular-nums'
/** The export stopped (encoder, tiles): kept in view with its report, not only in a toast. */
const ERROR = 'rounded-sm border-l-[3px] border-brand bg-accent-tint px-3 py-2'
/** A proportion of the picture: a framed icon over its ratio, tinted when chosen. */
const TILE = 'group block min-w-0 data-[disabled=true]:opacity-45 in-[fieldset:disabled]:opacity-45'
const TILE_LABEL =
  'relative flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-start gap-0.5 rounded-sm border border-edge bg-surface-control px-1 pt-2 pb-1.5 text-text-1 transition-ui ' +
  'hover:border-text-1 data-[selected=true]:border-brand data-[selected=true]:bg-accent-tint data-[selected=true]:shadow-[inset_0_0_0_1px_var(--accent)] ' +
  'data-[focus-visible=true]:outline-2 data-[focus-visible=true]:outline-offset-2 data-[focus-visible=true]:outline-brand ' +
  'group-data-[disabled=true]:cursor-not-allowed in-[fieldset:disabled]:cursor-not-allowed'

/**
 * Header of a mode panel (title, « modifié » marker of `modified` if given, close): the one bar of the drawer that stays
 * in sight. The close button gives way to the sheet handle's « Terminé » on a phone.
 */
function DockHead({ id, modified, busy, onClose }: { id: string; modified?: (keyof Settings)[]; busy: boolean; onClose?: () => void }) {
  const t = useT()
  return (
    <div className="panel-head [&_.modified]:static">
      <h2 id={id} className="panel-title flex-1">
        {t('export.panel.title')}
      </h2>
      {modified && <ModifiedMarker keys={modified} label={t('export.panel.title')} disabled={busy} />}
      {onClose && (
        <Tip text={withShortcut(t('common.close'), 'export')} align="end">
          <Button variant="icon" className="-mr-1.5 phone:hidden" onClick={onClose} aria-label={t('export.panel.close')}>
            <Icon name="x" size={18} />
          </Button>
        </Tip>
      )}
    </div>
  )
}

/**
 * "Exporter" drawer, « Vidéo » mode, in sections: « Format » (aspect tiles, resolution, frame rate), « Encodage »
 * (bitrate of the quality or chosen by hand, codec and container, key frames, sound), « Rendu » (the quality's render
 * tier), then the overlay alone, the estimate, start / cancel, progress, error and download. The still image is in the
 * « Affiche » mode.
 */
function VideoExportPanel({ onClose, modes, hidden }: { onClose?: () => void; modes: ReactNode; hidden: boolean }) {
  const t = useT()
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
    if (url === null) return void showToast({ kind: 'success', text: translate('export.panel.readyDisk', { fileName }) })
    const share = sharesFiles()
    if (!share) download(url, fileName)
    const image = result.mimeType.startsWith('image/')
    const label = share ? shareSaveLabel() : getPlatform().capabilities.isDesktop ? translate('export.panel.save') : translate('export.panel.downloadAgain')
    const action = { label, run: () => download(url, fileName) }
    if (image && !share) showToast({ kind: 'success', text: translate('export.panel.imageReady') })
    else showToast({ kind: 'success', text: image ? translate('export.panel.imageReady') : translate('export.panel.videoReady'), action })
  }, [result])

  useEffect(() => {
    if (useBatchStore.getState().phase === 'running') return
    if (phase === 'error' && error) showToast({ kind: 'error', text: translate('export.panel.failed', { error }) })
    else if (phase === 'canceled') showToast({ kind: 'info', text: translate('export.panel.canceled') })
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
      ? t('export.panel.announceRunning')
      : phase === 'finalizing'
        ? t('export.panel.announceFinalizing')
        : ''

  return (
    <section className={PANEL} aria-labelledby={`${id}-title`} aria-busy={busy} hidden={hidden}>
      <DockHead id={`${id}-title`} modified={['video']} busy={busy} onClose={onClose} />
      {modes}

      <h3 className={GROUP}>{t('export.panel.formatGroup')}</h3>
      <fieldset className="field min-w-0" disabled={busy}>
        <legend id={`${id}-proportions`} className="type-label">
          {t('export.panel.proportions')}
        </legend>
        <RadioGroup
          look="plain"
          className="grid grid-cols-3 gap-2"
          aria-labelledby={`${id}-proportions`}
          value={video.aspect}
          disabled={busy}
          onChange={(aspect) => {
            update({ aspect })
            useAppStore.getState().setFreeFraming(false)
          }}
        >
          {VIDEO_ASPECTS.map((a) => (
            <Radio key={a.id} value={a.id} className={TILE} labelClassName={TILE_LABEL} title={a.label}>
              <AspectIcon x={a.x} y={a.y} size={28} />
              <span className="text-hint font-semibold tabular-nums">{a.id}</span>
            </Radio>
          ))}
        </RadioGroup>
      </fieldset>

      <div className="field">
        <div className="flex items-center gap-1">
          <label className="type-label" htmlFor={`${id}-resolution`}>
            {t('export.panel.resolution')}
          </label>
          <RenderWeight weight="resolution" />
        </div>
        <Select
          id={`${id}-resolution`}
          value={video.resolution}
          disabled={busy}
          aria-describedby={`${id}-size`}
          options={VIDEO_RESOLUTIONS.map((r) => ({ value: r.id, label: r.label }))}
          onChange={(resolution) => update({ resolution })}
        />
        <p id={`${id}-size`} className="type-hint">
          {[t('export.panel.size', { width: formatNumber(width), height: formatNumber(height) }), resolutionNote].filter(Boolean).join(' · ')}
        </p>
      </div>

      <fieldset className="field min-w-0" disabled={busy}>
        <legend className="type-label">
          {t('export.panel.fps')} <RenderWeight weight="fps" />
        </legend>
        <RadioGroup aria-label={t('export.panel.fps')} value={video.fps} onChange={(fps) => update({ fps })}>
          {VIDEO_FPS.map((fps) => (
            <Radio key={fps} value={fps}>
              {fps}
            </Radio>
          ))}
        </RadioGroup>
      </fieldset>

      <h3 className={GROUP}>{t('export.panel.encodingGroup')}</h3>
      <fieldset className="field min-w-0" disabled={busy || overlayOnly}>
        <legend className="type-label">{t('export.panel.bitrate')}</legend>
        <RadioGroup
          aria-label={t('export.panel.bitrate')}
          value={video.manualBitrate ? 'manual' : 'quality'}
          // the manual one starts from the quality's bitrate, on the slider's steps
          onChange={(by) => update(by === 'manual' ? { manualBitrate: true, bitrateMbps: snapBitrate(presetBitrate / 1e6) } : { manualBitrate: false })}
        >
          <Radio value="quality">{t('export.panel.byQuality')}</Radio>
          <Radio value="manual">{t('export.panel.manual')}</Radio>
        </RadioGroup>
      </fieldset>
      {video.manualBitrate && !overlayOnly && (
        <RangeField
          label={t('export.panel.manualBitrate')}
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
        <p className="type-hint">
          {[
            video.manualBitrate
              ? t('export.panel.bitrateSuggest', { value: formatNumber(presetBitrate / 1e6, 1) })
              : t('export.panel.bitrateFromQuality', { value: formatNumber(bitrate / 1e6, 1) }),
            bitrateCapped && t('export.panel.bitrateCapped', { value: formatNumber(bitrate / 1e6, 1) }),
          ]
            .filter(Boolean)
            .join(' ')}
        </p>
      )}

      <SettingRow label={t('export.panel.codec')} value={overlayOnly ? 'VP9 (WebM)' : CODEC_CHOICE_LABELS[video.codec]} paths={['video.codec']}>
        <div className="field">
          <label className="type-label" htmlFor={`${id}-codec`}>
            {t('export.panel.codecContainer')}
          </label>
          <Select
            id={`${id}-codec`}
            value={video.codec}
            disabled={busy || overlayOnly}
            options={VIDEO_CODEC_CHOICES.filter((c) => offered.includes(c) || c === video.codec).map((c) => ({ value: c, label: CODEC_CHOICE_LABELS[c] }))}
            onChange={(codec) => update({ codec })}
          />
          <p className="type-hint">
            {overlayOnly
              ? t('export.panel.codecOverlay')
              : t('export.panel.codecHint')}
          </p>
        </div>
      </SettingRow>
      <SettingRow label={t('export.panel.keyframes')} value={t('export.panel.keyframesValue', { value: seconds(video.keyframeIntervalS) })} paths={['video.keyframeIntervalS']}>
        <div className="field">
          <label className="type-label" htmlFor={`${id}-keyframes`}>
            {t('export.panel.keyframesLabel')}
          </label>
          <Select
            id={`${id}-keyframes`}
            value={video.keyframeIntervalS}
            disabled={busy}
            options={KEYFRAME_INTERVALS_S.map((s) => ({ value: s, label: seconds(s) }))}
            onChange={(keyframeIntervalS) => update({ keyframeIntervalS })}
          />
          <p className="type-hint">{t('export.panel.keyframesHint')}</p>
        </div>
      </SettingRow>
      <SettingRow label={t('export.panel.sound')} value={`${video.audioKbps} kbit/s`} paths={['video.audioKbps']}>
        <div className="field">
          <label className="type-label" htmlFor={`${id}-audio`}>
            {t('export.panel.audioBitrate')}
          </label>
          <Select
            id={`${id}-audio`}
            value={video.audioKbps}
            disabled={busy}
            options={AUDIO_BITRATES_KBPS.map((k) => ({ value: k, label: `${k} kbit/s` }))}
            onChange={(audioKbps) => update({ audioKbps })}
          />
          <p className="type-hint">{t('export.panel.audioHint')}</p>
        </div>
      </SettingRow>

      <h3 className={GROUP}>{t('export.panel.renderGroup')}</h3>
      <fieldset className="field min-w-0" disabled={busy}>
        <legend className="type-label">{customised ? t('export.panel.renderQualityCustom') : t('export.panel.renderQuality')}</legend>
        <RadioGroup
          aria-label={customised ? t('export.panel.renderQualityCustom') : t('export.panel.renderQuality')}
          value={video.quality}
          onChange={(quality) => update({ quality })}
        >
          {QUALITIES.map((q) => (
            <Radio key={q.value} value={q.value}>
              {q.label}
            </Radio>
          ))}
        </RadioGroup>
        <p className="type-hint">
          {t(video.manualBitrate ? 'export.panel.tierHint' : 'export.panel.tierHintBitrate', {
            clouds: CLOUD_QUALITY_NAMES[tier.cloudsQuality].toLowerCase(),
            n: tier.maxSubFrames,
          })}
        </p>
        {customised && (
          <Button onClick={() => setSetting('clouds', { ...clouds, quality: 'auto' })}>
            {t('light.clouds.backToPreset')}
          </Button>
        )}
      </fieldset>

      <div className="field">
        <Checkbox checked={overlayOnly} disabled={busy} onChange={(on) => setOverlayOnly(on)}>{t('export.panel.overlayOnly')}</Checkbox>
        {overlayOnly && <p className="type-hint">{t('export.panel.overlayOnlyHint')}</p>}
      </div>

      <p className={SUMMARY} title={t('export.panel.summaryTip')}>
        {[
          t('export.panel.summary', { duration: formatClock(totalFrames / video.fps), frames: formatNumber(totalFrames) }),
          codec && CODEC_LABELS[`${codec.container}/${codec.codec}`],
          estimatedBytes > 0 && `≈ ${formatMegabytes(estimatedBytes)}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {codec && streams && <p className="type-hint">{t('export.panel.direct')}</p>}
      {codec && warnsInMemory(estimatedBytes, streams) && (
        <p className="type-hint">
          {t(deviceBudget().kind === 'desktop' ? 'export.panel.memoryDesktop' : 'export.panel.memoryOther', { limit: formatLimit(deviceBudget().memoryWarnBytes) })}
        </p>
      )}
      {codec === null && overlayOnly && (
        <p className="type-hint" role="alert">
          {t('export.panel.noWebm', {
            width: formatNumber(width),
            height: formatNumber(height),
            hint: videoEncoderMissingHint() ?? t('export.panel.noWebmHint'),
          })}
        </p>
      )}
      {codec === null && !overlayOnly && (
        <p className="type-hint" role="alert">
          {video.codec === 'auto'
            ? t('export.panel.noCodecAuto', {
                width: formatNumber(width),
                height: formatNumber(height),
                hint: videoEncoderMissingHint() ?? t('export.panel.noCodecAutoHint'),
              })
            : t('export.panel.noCodecChosen', { codec: CODEC_CHOICE_LABELS[video.codec], width: formatNumber(width), height: formatNumber(height) })}
        </p>
      )}

      {!busy && (
        <div className={ACTIONS}>
          <Button variant="primary" onClick={start} disabled={!trackName || !codec}>
            <Icon name="download" size={18} />
            {overlayOnly ? t('export.panel.exportOverlay') : t('export.panel.exportVideo')}
          </Button>
        </div>
      )}

      {busy && (
        <div className="field">
          <progress
            className="progress-bar"
            aria-label={t('export.panel.progressAria')}
            max={Math.max(1, frameCount)}
            value={phase === 'finalizing' ? frameCount : frame}
          />
          <p className="type-hint">
            {phase === 'finalizing'
              ? t('export.panel.announceFinalizing')
              : phase === 'starting'
                ? t('export.panel.preparing')
                : [
                    t('export.panel.progress', { frame: formatNumber(frame), total: formatNumber(frameCount) }),
                    secondsPerImage !== null && t('export.panel.speedPerImage', { value: formatNumber(secondsPerImage, 1) }),
                    etaS !== null && t('export.panel.eta', { time: formatClock(etaS) }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
          </p>
          <p className="type-hint">{t('export.panel.frozen')}</p>
          <Button
            block
            onClick={() => useExportStore.getState().cancel()}
            disabled={phase === 'finalizing'}
          >
            {t('export.panel.cancel')}
          </Button>
        </div>
      )}

      {phase === 'error' && error && (
        <div className={`field ${ERROR}`} role="alert">
          <p className="mb-2 text-hint text-text-1">{t('export.panel.failed', { error })}</p>
          <Button size="sm" onClick={() => showDiagnostic(currentReport())}>
            {t('export.panel.diagnostic')}
          </Button>
        </div>
      )}

      {phase === 'done' && result && (
        <p className="type-hint">
          {result.url === null ? (
            t('export.panel.savedTo', { fileName: result.fileName })
          ) : getPlatform().capabilities.isDesktop || sharesFiles() ? (
            <Button size="sm" onClick={() => result.url && download(result.url, result.fileName)}>
              {sharesFiles() ? t('export.panel.shareFile', { label: shareSaveLabel(), fileName: result.fileName }) : t('export.panel.saveFile', { fileName: result.fileName })}
            </Button>
          ) : (
            <a href={result.url} download={result.fileName}>
              {t('export.panel.downloadFile', { fileName: result.fileName })}
            </a>
          )}{' '}
          {t('export.panel.resultInfo', {
            parts: [formatMegabytes(result.sizeBytes), CODEC_LABELS[result.codec] ?? result.codec, result.hardware && t('export.panel.hardwareEncoder'), result.note]
              .filter(Boolean)
              .join(', '),
          })}
        </p>
      )}

      <ExportHistory />

      <p className="sr-only" role="status">
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
  if (status === 'pending') return t('export.panel.status.pending')
  if (status === 'running') return t('export.panel.status.running')
  if (status === 'canceled') return t('export.panel.status.canceled')
  if (status === 'error') return t('export.panel.status.failed', { error: error ?? t('export.panel.status.unknown') })
  if (!result) return t('export.panel.status.done')
  return t(result.url === null ? 'export.panel.status.savedFile' : 'export.panel.status.file', { fileName: result.fileName, size: formatMegabytes(result.sizeBytes) })
}

/** Message at the end of a batch. */
function announceBatch(states: readonly BatchJobState[], folderName: string | null): void {
  const { done, failed, canceled } = batchSummary(states)
  if (failed > 0) {
    showToast({
      kind: 'error',
      text: t('export.panel.batchFailed', { files: t('export.panel.filesCount', { count: done }), total: states.length, failed: t('export.panel.failureCount', { count: failed }) }),
    })
  } else if (canceled > 0) showToast({ kind: 'info', text: t('export.panel.batchCanceled', { ready: t('export.panel.readyCount', { count: done }) }) })
  else {
    const exported = t('export.panel.batchDone', { count: done })
    showToast({ kind: 'success', text: folderName ? t('export.panel.batchDoneIn', { done: exported, folder: folderName }) : exported })
  }
}

/** Line of a track in the result list of « Un film par trace ». */
function trackStatusText({ status, error, jobs }: TrackRunState): string {
  if (status === 'pending') return t('export.panel.status.pending')
  if (status === 'running') return t('export.panel.status.running')
  if (status === 'canceled') return t('export.panel.status.canceled')
  if (status === 'error') return t('export.panel.status.failed', { error: error ?? t('export.panel.status.unknown') })
  return t('export.panel.status.savedTracks', { files: jobs.map((j) => j.result?.fileName).join(', ') })
}

/** Message at the end of « Un film par trace ». */
function announceTrackFilms(tracks: readonly TrackRunState[], folderName: string): void {
  const { done, failed, canceled } = batchSummary(tracks)
  if (failed > 0) {
    showToast({
      kind: 'error',
      text: t('export.panel.tracksFailed', { tracks: t('export.panel.tracksCount', { count: done }), total: tracks.length, failed: t('export.panel.failureCount', { count: failed }) }),
    })
  } else if (canceled > 0) showToast({ kind: 'info', text: t('export.panel.tracksCanceled', { done: t('export.panel.madeCount', { count: done }) }) })
  else showToast({ kind: 'success', text: t('export.panel.tracksDone', { count: done, folder: folderName }) })
}

/** « 3 traces dans « Saison » : a.gpx, b.fit, c.gpx… » */
function trackFolderText(folder: ReadableFolder, files: readonly { name: string }[]): string {
  if (files.length === 0) return t('export.panel.folderEmpty', { folder: folder.name })
  const names = files.slice(0, 3).map((f) => f.name).join(', ')
  return t('export.panel.folderTracks', { count: files.length, folder: folder.name, names: `${names}${files.length > 3 ? '…' : ''}` })
}

/**
 * « Plusieurs formats »: films ticked as aspect × resolution, plus a still image and the poster, with the total
 * estimate and one « Tout exporter » (src/export/batch.ts). Frame rate and quality are those of the « Vidéo » mode.
 * Source « Un film par trace »: the films ticked for each GPX / FIT file of a folder, into an output folder.
 */
function BatchExportPanel({ onClose, modes, hidden }: { onClose?: () => void; modes: ReactNode; hidden: boolean }) {
  const t = useT()
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
  const filesCount = (count: number) => t('export.panel.filesCount', { count })

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
      (error: unknown) => showToast({ kind: 'error', text: t('export.panel.folderReadFailed', { error: errorMessage(error) }) }),
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
      (error: unknown) => showToast({ kind: 'error', text: t('export.panel.folderWriteFailed', { error: errorMessage(error) }) }),
    )
  }

  return (
    <section className={PANEL} aria-labelledby={`${id}-title`} aria-busy={busy} hidden={hidden}>
      <DockHead id={`${id}-title`} busy={busy} onClose={onClose} />
      {modes}

      <fieldset className="field min-w-0" disabled={busy}>
        <legend className="type-label">{t('export.panel.source')}</legend>
        <RadioGroup aria-label={t('export.panel.source')} value={perTrack ? 'tracks' : 'film'} onChange={(source) => setPerTrack(source === 'tracks')}>
          <Radio value="film">{t('export.panel.thisFilm')}</Radio>
          <Radio value="tracks" disabled={!toFolder} title={toFolder ? undefined : t('export.panel.browsersTip')}>
            {t('export.panel.perTrack')}
          </Radio>
        </RadioGroup>
      </fieldset>
      {perTrack && (
        <div className="field">
          <Button block onClick={chooseTrackFolder} disabled={busy}>
            <Icon name="folder-open" size={18} />
            {trackFolder ? t('export.panel.changeFolder') : t('export.panel.chooseFolder')}
          </Button>
          <p className="type-hint">{trackFolder ? trackFolderText(trackFolder, sources) : t('export.panel.perTrackHint')}</p>
        </div>
      )}

      <fieldset className="field min-w-0" disabled={busy}>
        <legend className="type-label">{t('export.panel.formats')}</legend>
        <div className="grid gap-2">
          {VIDEO_ASPECTS.map((a) => (
            <div key={a.id} className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-2" role="group" aria-label={a.label}>
              <span className="inline-flex items-center gap-1 text-hint font-semibold" title={a.label}>
                <AspectIcon x={a.x} y={a.y} size={20} />
                {a.id}
              </span>
              <div className="chips">
                {VIDEO_RESOLUTIONS.map((r) => {
                  const key = formatKey(a.id, r.id)
                  return (
                    <Chip key={r.id} checked={selection.formats.includes(key)} onChange={(on) => toggle(key, on)}>{r.label}</Chip>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="field min-w-0" disabled={busy}>
        <legend className="type-label">{t('export.panel.also')}</legend>
        <Checkbox checked={selection.still} onChange={(on) => select({ still: on })}>{t('export.panel.still', { label: stillLabel })}</Checkbox>
        <Checkbox checked={selection.poster} onChange={(on) => select({ poster: on })}>{t('export.panel.poster')}</Checkbox>
      </fieldset>

      {perTrack ? (
        <p className={SUMMARY}>
          {t('export.panel.perTrackSummary', {
            tracks: t('export.panel.tracksCount', { count: sources.length }),
            files: filesCount(jobs.length),
            total: filesCount(sources.length * jobs.length),
          })}
        </p>
      ) : (
        <p className={SUMMARY}>
          {[
            `${filesCount(estimate.files)} · ${t('export.panel.framesCount', { count: formatNumber(estimate.frames) })}`,
            estimate.bytes > 0 && `≈ ${formatMegabytes(estimate.bytes)}`,
            estimate.seconds !== null && t('export.panel.renderTime', { time: formatClock(estimate.seconds) }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      <p className="type-hint">
        {[
          t('export.panel.batchHint', { fps: video.fps, quality: QUALITIES.find((q) => q.value === video.quality)?.label.toLowerCase() ?? '' }),
          t(toFolder ? 'export.panel.folderAsked' : 'export.panel.downloadEach'),
          !perTrack && estimate.seconds === null && films.length > 0 && t('export.panel.estimateLater'),
        ]
          .filter(Boolean)
          .join(' ')}
      </p>
      {warnsInMemory(estimate.bytes, toFolder) && (
        <p className="type-hint">{t('export.panel.memoryBatch', { limit: formatLimit(deviceBudget().memoryWarnBytes) })}</p>
      )}
      {unencodable.length > 0 && (
        <p className="type-hint" role="alert">
          {t('export.panel.unencodable', { formats: unencodable.map((j) => j.label).join(', ') })} {videoEncoderMissingHint() ?? ''}
        </p>
      )}

      {!busy && (
        <div className={ACTIONS}>
          <Button
            variant="primary"
            onClick={perTrack ? startPerTrack : start}
            disabled={jobs.length === 0 || (perTrack ? sources.length === 0 : !track)}
          >
            <Icon name="download" size={18} />
            {t('export.panel.exportAll')}
          </Button>
        </div>
      )}

      {running && (
        <div className="field">
          {trackRuns.length > 0 ? (
            <>
              <progress
                className="progress-bar"
                aria-label={t('export.panel.perTrackProgress')}
                max={trackRuns.length}
                value={tracksFinished + (runningTrack ? trackFraction(runningTrack, fraction) : 0)}
              />
              <p className="type-hint">{trackProgressLabel(trackRuns, fraction)}</p>
            </>
          ) : (
            <>
              <progress
                className="progress-bar"
                aria-label={t('export.panel.batchProgress')}
                max={Math.max(1, states.length)}
                value={finished + (states.some((s) => s.status === 'running') ? fraction : 0)}
              />
              <p className="type-hint">{batchProgressLabel(states, fraction) || t('export.panel.preparing')}</p>
            </>
          )}
          <Button
            block
            onClick={() => useBatchStore.getState().cancel()}
            disabled={cancelRequested}
          >
            {t('export.panel.cancelAll')}
          </Button>
        </div>
      )}

      {trackRuns.length > 0 && (
        <div className="field">
          {folderName && <p className="type-hint">{t('export.panel.folderName', { folder: folderName })}</p>}
          <ul className="grid gap-2">
            {trackRuns.map((t, i) => (
              <li key={i} className="grid justify-items-start gap-0.5 wrap-anywhere">
                <span className="text-body font-semibold text-text-1">{t.name}</span>
                <span className="type-hint">{trackStatusText(t)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {states.length > 0 && (
        <div className="field">
          {folderName && <p className="type-hint">{t('export.panel.folderName', { folder: folderName })}</p>}
          <ul className="grid gap-2">
            {states.map((s) => (
              <li key={s.job.key} className="grid justify-items-start gap-0.5 wrap-anywhere">
                <span className="text-body font-semibold text-text-1">{s.job.label}</span>
                <span className="type-hint">{jobStatusText(s)}</span>
                {s.result?.url && (
                  <Button
                    size="sm"
                    onClick={() => s.result?.url && download(s.result.url, s.result.fileName)}
                  >
                    {t('export.panel.saveAgain')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ExportHistory />

      <p className="sr-only" role="status">
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
  const t = useT()
  const [mode, setMode] = useState<ExportMode>('video')
  const exporting = useExportStore((s) => isExportBusy(s.phase))
  const batching = useBatchStore((s) => s.phase === 'running')
  const busy = exporting || batching
  const modes = (
    <fieldset className="field min-w-0" disabled={busy}>
      <legend className="sr-only">{t('export.panel.modeType')}</legend>
      <RadioGroup aria-label={t('export.panel.modeType')} value={mode} onChange={(next) => setMode(next)}>
        {(
          [
            ['video', t('export.panel.modeVideo')],
            ['batch', t('export.panel.modeBatch')],
            ['poster', t('export.panel.modePoster')],
          ] as const
        ).map(([value, label]) => (
          <Radio key={value} value={value}>
            {label}
          </Radio>
        ))}
      </RadioGroup>
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
