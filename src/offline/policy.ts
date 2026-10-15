import { t } from '../i18n'
/**
 * Which tile sources may be downloaded ahead for offline use, read from each provider's terms (October 2026, links
 * and reasons in docs/sources.md, « Attributions, licenses and offline use »). A source missing from this table is refused.
 */

export interface OfflinePolicy {
  /** sources of one provider share its daily limit */
  provider: string
  allowed: boolean
  /** why (shown when refused, or as a caution when allowed for personal use only) */
  reason: string
  /** allowed for a personal, non-commercial use only, at a gentle pace (the reason is shown as a caution) */
  personalUse?: boolean
  /** tiles per day and per device at most; absent = no limit beyond the polite pace */
  dailyLimit?: number
  /** average tile size measured around Chamonix (bytes), for the estimate */
  typicalTileBytes: number
}

// The reasons are read when shown (getters), so they follow the language of the interface
const ign = (typicalTileBytes: number): OfflinePolicy => ({
  provider: 'ign',
  allowed: true,
  get reason() { return t('offline.policy.ign') },
  dailyLimit: 50_000,
  typicalTileBytes,
})
// Personal, non-commercial project: these providers discourage bulk downloads, so they are allowed with a low daily
// cap (a short corridor, once) and the caution is shown in the panel.
const swisstopo = (typicalTileBytes: number): OfflinePolicy => ({
  provider: 'swisstopo',
  allowed: true,
  personalUse: true,
  get reason() { return t('offline.policy.swisstopo') },
  dailyLimit: 10_000,
  typicalTileBytes,
})

export const OFFLINE_POLICIES: Readonly<Record<string, OfflinePolicy>> = {
  mapterhorn: {
    provider: 'mapterhorn',
    allowed: true,
    get reason() { return t('offline.policy.mapterhorn') },
    dailyLimit: 20_000,
    typicalTileBytes: 150_000,
  },
  'aws-terrarium': {
    provider: 'aws',
    allowed: true,
    get reason() { return t('offline.policy.aws') },
    typicalTileBytes: 105_000,
  },
  'ign-ortho': ign(16_000),
  'ign-plan': ign(45_000),
  swisstopo: swisstopo(20_000),
  'swisstopo-carte': swisstopo(30_000),
  'arcgis-world-imagery': {
    provider: 'esri',
    allowed: false,
    get reason() { return t('offline.policy.esri') },
    typicalTileBytes: 14_000,
  },
  opentopomap: {
    provider: 'opentopomap',
    allowed: true,
    personalUse: true,
    get reason() { return t('offline.policy.opentopomap') },
    dailyLimit: 2_000,
    typicalTileBytes: 30_000,
  },
}

export function offlinePolicy(sourceId: string): OfflinePolicy {
  return (
    OFFLINE_POLICIES[sourceId] ?? {
      provider: sourceId,
      allowed: false,
      get reason() { return t('offline.policy.unknown') },
      typicalTileBytes: 30_000,
    }
  )
}
