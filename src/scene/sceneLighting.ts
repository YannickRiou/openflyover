/**
 * Sky and lighting constants of the viewer without the atmosphere (FlyoverCanvas), shared with the thumbnail.
 * Kept out of FlyoverCanvas.tsx so that file only exports its component (fast refresh).
 */

export const SKY_TOP_COLOR = '#A9CCD9'
export const SKY_HORIZON_COLOR = '#F5F2EA'

export const HEMISPHERE_SKY = '#ffffff'
export const HEMISPHERE_GROUND = '#6b7a8f'
export const HEMISPHERE_INTENSITY = 1.2
/** Sun direction: south-east (+X east, +Z south), ~52° above the horizon; far enough to behave as a directional light. */
export const SUN_POSITION: readonly [number, number, number] = [0.6e5, 1e5, 0.5e5]
export const SUN_INTENSITY = 2.0
