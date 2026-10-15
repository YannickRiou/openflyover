import type { CSSProperties } from 'react'
import { create } from 'zustand'
import type { VideoAspect } from '../export/schedule'
import { useLanguage } from '../i18n'
import { safeZones } from './safeZoneLayout'
import type { FrameBox } from './safeZoneLayout'

/** Shown or not (preview only: neither saved nor undoable, off at start-up); « G » or the button of the view. */
export const useSafeZonesStore = create<{ visible: boolean; toggle(): void }>()((set) => ({
  visible: false,
  toggle: () => set((s) => ({ visible: !s.visible })),
}))

const percent = (box: FrameBox): CSSProperties => ({
  left: `${box.left * 100}%`,
  top: `${box.top * 100}%`,
  width: `${box.width * 100}%`,
  height: `${box.height * 100}%`,
})

/** Hidden areas shaded in diagonal stripes of the ink, outlined in white. */
const COVERED =
  'absolute box-border outline outline-1 -outline-offset-1 outline-white/50 ' +
  '[background:repeating-linear-gradient(135deg,color-mix(in_srgb,var(--color-ink)_42%,transparent)_0_6px,color-mix(in_srgb,var(--color-ink)_30%,transparent)_6px_12px)]'
/** Margins: a dashed white line with a thin ink halo, readable on any picture. */
const GUIDE = 'absolute box-border border border-dashed border-white/85 shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-ink)_35%,transparent)]'
/** The label of an area, in the corner given: tiny, white on ink. */
const LABEL = 'absolute rounded-[3px] bg-ink/70 px-1 text-caption leading-3.5 font-semibold whitespace-nowrap text-white'

/**
 * « Zones de sécurité » over the framed preview (`data-stage`): margins of the landscape formats, areas hidden by
 * the vertical video apps (geometry in safeZones.ts). DOM over the canvas: the export never sees it.
 */
export function SafeZones({ aspect }: { aspect: VideoAspect }) {
  useLanguage()
  const { guides, covered } = safeZones(aspect)
  return (
    <div className="pointer-events-none absolute inset-0 z-3" aria-hidden="true">
      {covered.map(({ label, box }) => (
        <div key={label} className={COVERED} style={percent(box)}>
          {/* right-aligned: the narrow band of the buttons is on the right edge, its label may overhang to the left */}
          <span className={`${LABEL} top-0.5 right-1`}>{label}</span>
        </div>
      ))}
      {/* the outer margin is labelled in its top left corner, the inner one in its bottom right corner */}
      {guides.map(({ label, box }, i) => (
        <div key={label} className={GUIDE} style={percent(box)}>
          <span className={`${LABEL} ${i === 0 ? 'top-0.5 left-1' : 'right-1 bottom-0.5'}`}>{label}</span>
        </div>
      ))}
    </div>
  )
}
