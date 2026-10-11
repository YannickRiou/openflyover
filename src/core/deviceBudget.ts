/**
 * GPU and memory budget of the device, read once at start-up where the limits live (canvas pixel ratio, tile caches,
 * imagery texture size, preview clouds, export resolution). Phones and tablets (touch screen as the main pointer) get
 * lower limits; computers keep the values they always had. iOS gives no per-tab WebGL budget and reloads a page that
 * holds too many textures (WebKit bug 300782): the mobile values are conservative. See ARCHITECTURE.md "Device budget".
 */

export type DeviceKind = 'desktop' | 'tablet' | 'phone'

export interface DeviceBudget {
  kind: DeviceKind
  /** pixel ratio cap of the 3D view */
  maxPixelRatio: number
  /** same while the film plays */
  movingPixelRatio: number
  /** decoded tile bitmaps kept by the fetcher (256 px: ~256 KB each) */
  tileBitmaps: number
  /** height grids kept by the terrain engine, in 256 px tiles (~256 KB each) */
  heightGrids: number
  /** finest imagery (`imageryZoomOffset`: texture of 256 × 2^k px per terrain tile) */
  maxImageryZoomOffset: 0 | 1 | 2
  /** still frames the preview clouds average */
  cloudSettleFrames: number
  /** resolution of the preview cloud pass (fraction of the canvas) */
  cloudResolutionScale: number
  /** default rendering of the sea of clouds: « Nappe » ('surface', one draw call) is far cheaper than the ray march */
  seaRender: 'volume' | 'surface'
  /** largest short side of an exported film or still, px */
  maxExportShortSide: number
  /** tallest viewport (px) the terrain LOD is evaluated at during an export: tiles are chosen as for a view this high */
  maxLodHeightPx: number
  /** ceiling of the video bitrate (bit/s) when the film is kept in memory (no direct disk write): its size is the RAM it takes */
  maxVideoBitrate: number
  /** estimated size (bytes) above which a film kept in memory is flagged as likely to exhaust the tab */
  memoryWarnBytes: number
  /**
   * most terrain tiles the engine keeps loaded or loading (~2.6 MB each: texture, canvas, DEM grid, geometry); the view's
   * level of detail coarsens to fit. Without it a phone's export grows by ~1.2 tiles per frame until iOS ends the tab.
   */
  maxResidentTiles: number
  /** terrain tiles loading at the same time: each holds its fetches and decode copies (bitmaps, DEM pixels, canvas) */
  maxTileLoads: number
  /** export: film frames a tile of the view is kept after the last frame that needed it; 0 = wall time (the preview's) */
  exportTileKeepFrames: number
  /** export: frames ahead whose tiles are prefetched (every few rendered frames) */
  exportPrefetchAhead: readonly number[]
  /** texels per side of the relief's shadow map (memory grows with its square: estimated ~128 MB at 4096², ~32 MB at 2048²) */
  shadowMapSize: number
}

export const DESKTOP_BUDGET: Readonly<DeviceBudget> = {
  kind: 'desktop',
  maxPixelRatio: 2,
  movingPixelRatio: 2,
  tileBitmaps: 600,
  heightGrids: 400,
  maxImageryZoomOffset: 2,
  cloudSettleFrames: 32,
  cloudResolutionScale: 1,
  seaRender: 'volume',
  maxExportShortSide: 2160,
  maxLodHeightPx: Infinity,
  maxVideoBitrate: Infinity,
  memoryWarnBytes: 1.5e9,
  maxResidentTiles: Infinity,
  maxTileLoads: 24,
  exportTileKeepFrames: 0,
  exportPrefetchAhead: [5, 10, 15, 20, 30, 40],
  shadowMapSize: 4096,
}

const MOBILE_BUDGET: Omit<DeviceBudget, 'kind' | 'maxExportShortSide' | 'maxLodHeightPx' | 'maxVideoBitrate' | 'memoryWarnBytes' | 'maxResidentTiles' | 'maxTileLoads'> = {
  maxPixelRatio: 2,
  movingPixelRatio: 1.5,
  tileBitmaps: 200,
  heightGrids: 160,
  maxImageryZoomOffset: 1,
  cloudSettleFrames: 16,
  cloudResolutionScale: 0.5,
  seaRender: 'surface',
  // a quarter of the computer's memory; the map is refitted to the view every frame and a phone screen is small
  shadowMapSize: 2048,
  // counted in film frames, not seconds: a phone renders a few frames a second, 30 s of wall time hold hundreds of them
  exportTileKeepFrames: 6,
  exportPrefetchAhead: [5, 10, 20],
}

/** Below this short side (CSS px), a touch device is a phone. */
export const PHONE_MAX_SHORT_SIDE = 600
/** `navigator.deviceMemory` (GB, Chrome only, rounded down) at or below which the limits drop further */
export const LOW_MEMORY_GB = 2

export interface DeviceTraits {
  /** touch screen as the main pointer */
  coarsePointer: boolean
  /** short side of the screen, CSS px */
  shortSidePx: number
  /** `navigator.deviceMemory`, undefined where the browser does not tell (Safari, Firefox) */
  memoryGb?: number
}

export function budgetFor({ coarsePointer, shortSidePx, memoryGb }: DeviceTraits): DeviceBudget {
  if (!coarsePointer) return { ...DESKTOP_BUDGET }
  const phone = shortSidePx < PHONE_MAX_SHORT_SIDE
  const budget: DeviceBudget = {
    ...MOBILE_BUDGET,
    kind: phone ? 'phone' : 'tablet',
    maxExportShortSide: phone ? 1080 : 1440,
    // about the height of the phone's preview: a 1080p or portrait export keeps the tiles the preview already holds
    maxLodHeightPx: phone ? 720 : Infinity,
    // 1 MB/s: a 5 minute film is ~300 MB in memory, and the muxer's copies make the peak 2.5-3 times that
    maxVideoBitrate: phone ? 8e6 : 12e6,
    // iOS ends a tab well before the computers' 1.5 GB: the film, its copies at the end and the scene add up
    memoryWarnBytes: 250e6,
    // the preview holds ~70 tiles; the export (400-500 MB of tiles at most) never needs more
    maxResidentTiles: phone ? 120 : 160,
    // an iPhone 12 held ~94 tiles pending at once in a low view: their decode copies pile up before the cap applies
    maxTileLoads: phone ? 6 : 12,
  }
  if (memoryGb !== undefined && memoryGb <= LOW_MEMORY_GB) {
    return { ...budget, maxPixelRatio: 1.5, movingPixelRatio: 1, tileBitmaps: 120, heightGrids: 100, shadowMapSize: 1024, maxResidentTiles: 90 }
  }
  return budget
}

/**
 * MSAA of the canvas's default framebuffer. A phone or tablet with the atmosphere drops it: the picture then goes
 * through the composer (SMAA, no multisampling) and the default framebuffer's samples (~75 MB at 1080p) are never used.
 * Without the atmosphere the scene is drawn straight to it, so it stays. Fixed when the context is created.
 */
export function canvasAntialias(budget: Pick<DeviceBudget, 'kind'>, atmosphere: boolean): boolean {
  return budget.kind === 'desktop' || !atmosphere
}

/** Traits of the device running `scope` (window); a scope without a screen (tests, workers) reads as a computer. */
export function readDeviceTraits(scope: object): DeviceTraits {
  const s = scope as {
    matchMedia?: (query: string) => MediaQueryList
    screen?: { width: number; height: number }
    navigator?: { deviceMemory?: number }
  }
  return {
    coarsePointer: typeof s.matchMedia === 'function' && s.matchMedia.call(scope, '(pointer: coarse)').matches,
    shortSidePx: s.screen ? Math.min(s.screen.width, s.screen.height) : Infinity,
    memoryGb: s.navigator?.deviceMemory,
  }
}

let current: DeviceBudget | null = null

/** Budget of this device (read once). */
export function deviceBudget(): DeviceBudget {
  current ??= budgetFor(readDeviceTraits(globalThis))
  return current
}
