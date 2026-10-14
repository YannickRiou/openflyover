import { errorMessage } from '../core/errors'
import { useT } from '../i18n'
import { formatDate } from '../i18n/format'
import { useId, useMemo, useState } from 'react'
import { trackPathOf } from '../flyover/path'
import { autoDistanceM } from '../flyover/camera'
import { offlinePolicy } from '../offline/policy'
import { CORRIDOR_WIDTHS_M, MAX_PACK_TILES, packImageryLevel, planOfflineTiles } from '../offline/plan'
import { cancelPack, deletePack, pausePack, preparePack, resumePack, useOfflineStore } from '../offline/store'
import { getPlatform } from '../platform'
import { useAppStore } from '../state/store'
import { getImagerySource, getTerrainSource } from '../terrain/sources'
import { formatBytes, formatNumber } from './format'
import { showToast } from './toast'
import { Button, Radio, RadioGroup } from './primitives'

const formatSize = formatBytes

/** « Hors ligne » (Projet tab): estimate, download and list of the offline tile packs. */
export function OfflinePanel() {
  const t = useT()
  const id = useId()
  const tracks = useAppStore((s) => s.tracks)
  const bounds = useAppStore((s) => s.bounds)
  const terrainSourceId = useAppStore((s) => s.settings.terrainSourceId)
  const imagerySourceId = useAppStore((s) => s.settings.imagerySourceId)
  const imageryZoomOffset = useAppStore((s) => s.settings.imageryZoomOffset)
  const camera = useAppStore((s) => s.settings.camera)
  const { packs, job, usage } = useOfflineStore()
  const [corridorM, setCorridorM] = useState<number>(CORRIDOR_WIDTHS_M[0])
  const canStore = getPlatform().tileCache !== null

  const terrain = getTerrainSource(terrainSourceId)
  const imagery = getImagerySource(imagerySourceId)
  const terrainPolicy = offlinePolicy(terrain.id)
  const imageryPolicy = offlinePolicy(imagery.id)
  const imageryLevel = packImageryLevel(imageryZoomOffset)

  const plan = useMemo(() => {
    if (!bounds || tracks.length === 0 || !terrainPolicy.allowed) return null
    // the follow camera at its lowest: distance of the shortest track × setting × sin(pitch)
    const distanceM = Math.min(...tracks.map((t) => autoDistanceM(trackPathOf(t)))) * camera.distance
    return planOfflineTiles({
      points: tracks.flatMap((t) => t.segments.flatMap((s) => s.points)),
      bounds,
      corridorM,
      terrain,
      imagery: imageryPolicy.allowed ? imagery : null,
      imageryZoomOffset: imageryLevel.zoomOffset,
      cameraHeightM: distanceM * Math.sin((camera.pitchDeg * Math.PI) / 180),
    })
  }, [tracks, bounds, corridorM, terrain, imagery, imageryLevel.zoomOffset, camera.distance, camera.pitchDeg, terrainPolicy.allowed, imageryPolicy.allowed])

  const tooBig = plan !== null && plan.tiles.length > MAX_PACK_TILES

  const prepare = async () => {
    if (!plan) return
    const name = tracks.length === 1 ? tracks[0].name : t('offline.panel.packName', { name: tracks[0].name, count: tracks.length - 1 })
    try {
      const result = await preparePack({ plan, name, terrain, imagery: imageryPolicy.allowed ? imagery : null, corridorM })
      if (result.state === 'done') {
        showToast(
          result.failed > 0
            ? { kind: 'error', text: t('offline.panel.failed', { count: result.failed, value: formatNumber(result.failed) }) }
            : { kind: 'success', text: t('offline.panel.ready', { name }) },
        )
      } else if (result.state === 'limited') {
        showToast({ kind: 'error', text: t('offline.panel.limited') })
      } else if (result.state === 'failed') {
        showToast({ kind: 'error', text: t('offline.panel.stopped', { error: result.error ?? '' }) })
      }
    } catch (err) {
      showToast({ kind: 'error', text: errorMessage(err) })
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby={`${id}-title`}>
      <p id={`${id}-title`} className="type-hint">
        {t('offline.panel.intro')}
      </p>

      {!canStore ? (
        <p className="rounded-md bg-surface-card p-3 text-center type-hint">{t('offline.panel.noStorage')}</p>
      ) : (
        <>
          <fieldset className="field min-w-0" disabled={job !== null}>
            <legend className="type-label mb-1">{t('offline.panel.corridor')}</legend>
            <RadioGroup aria-label={t('offline.panel.corridor')} value={corridorM} onChange={(width) => setCorridorM(width)}>
              {CORRIDOR_WIDTHS_M.map((width) => (
                <Radio key={width} value={width}>
                  {width / 1000} km
                </Radio>
              ))}
            </RadioGroup>
          </fieldset>

          <p className="type-hint">
            {terrainPolicy.allowed
              ? terrainPolicy.personalUse
                ? t('offline.panel.terrainReason', { name: terrain.name, reason: terrainPolicy.reason })
                : t('offline.panel.terrain', { name: terrain.name })
              : t('offline.panel.terrainBlocked', { name: terrain.name, reason: terrainPolicy.reason })}
            <br />
            {imageryPolicy.allowed
              ? imageryPolicy.personalUse
                ? t('offline.panel.imageryReason', { name: imagery.name, reason: imageryPolicy.reason })
                : t('offline.panel.imagery', { name: imagery.name })
              : t('offline.panel.imageryBlocked', { name: imagery.name, reason: imageryPolicy.reason })}
          </p>

          {plan && (
            <p className="type-hint">
              {[
                t('offline.panel.estimate', { tiles: formatNumber(plan.tiles.length), size: formatSize(plan.estimatedBytes), zoom: plan.maxTerrainZoom }),
                imageryPolicy.allowed && imageryLevel.note,
                tooBig && t('offline.panel.tooBig'),
              ]
                .filter(Boolean)
                .join(' ')}
            </p>
          )}

          {job ? (
            <div className="field">
              <progress className="h-2.5 w-full accent-brand" value={job.progress.done} max={Math.max(1, job.progress.total)} />
              <p className="type-hint">
                {t(job.progress.state === 'paused' ? 'offline.panel.progressPaused' : 'offline.panel.progress', {
                  done: formatNumber(job.progress.done),
                  total: formatNumber(job.progress.total),
                  size: formatSize(job.progress.bytes),
                })}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {job.progress.state === 'paused' ? (
                  <Button block onClick={resumePack}>
                    {t('offline.panel.resume')}
                  </Button>
                ) : (
                  <Button block onClick={pausePack}>
                    {t('offline.panel.pause')}
                  </Button>
                )}
                <Button block onClick={cancelPack}>
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="primary" onClick={() => void prepare()} disabled={!plan || tooBig}>
              {t('offline.panel.prepare')}
            </Button>
          )}

          {packs.length > 0 && (
            <ul className="grid gap-2">
              {packs.map((pack) => (
                <li key={pack.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="type-label block break-words">{pack.name}</span>
                    <span className="type-hint block">
                      {t(pack.complete ? 'offline.panel.pack' : 'offline.panel.packIncomplete', {
                        date: formatDate(pack.createdAt, { year: 'numeric', month: 'numeric', day: 'numeric' }),
                        tiles: formatNumber(pack.tiles),
                        size: formatSize(pack.bytes),
                      })}
                    </span>
                  </span>
                  <Button
                    className="flex-none"
                    onClick={() => void deletePack(pack.id)}
                    disabled={job?.packId === pack.id}
                  >
                    {t('common.delete')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {packs.some((p) => !p.complete) && (
            <p className="type-hint">{t('offline.panel.incompleteHint')}</p>
          )}
          {usage && usage.quotaBytes > 0 && (
            <p className="type-hint">
              {t('offline.panel.usage', { used: formatSize(usage.usedBytes), quota: formatSize(usage.quotaBytes) })}
            </p>
          )}
        </>
      )}
    </section>
  )
}
