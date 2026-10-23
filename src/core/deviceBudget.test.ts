import { describe, expect, it } from 'vitest'
import { DEFAULT_VIDEO_SETTINGS, exportLodHeight, exportResolutionNote, videoSize } from '../export/schedule'
import { CLOUD_SETTLE_FRAMES } from '../scene/renderOnDemand'
import { DEFAULT_TUNING } from '../terrain/engine'
import { DEFAULT_CLOUDS } from '../weather/sceneClouds'
import { DESKTOP_BUDGET, budgetFor, canvasAntialias, deviceBudget, isModestGpu, readDeviceTraits, readGpuRenderer } from './deviceBudget'

const scope = (coarse: boolean, width: number, height: number, deviceMemory?: number, hardwareConcurrency?: number) => ({
  matchMedia: (query: string) => ({ matches: coarse && query === '(pointer: coarse)' }),
  screen: { width, height },
  navigator: { deviceMemory, hardwareConcurrency },
})

describe('budgetFor', () => {
  it('keeps the values a computer always had', () => {
    expect(budgetFor({ coarsePointer: false, shortSidePx: 1080 })).toEqual({
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
      maxTrees: 250_000,
    })
    expect(budgetFor({ coarsePointer: false, shortSidePx: 1080, memoryGb: 8, cores: 8 })).toEqual(DESKTOP_BUDGET)
  })

  it('a modest computer (4 cores or 4 GB) lowers its preview only, nothing the export uses', () => {
    const preview = { maxPixelRatio: 1.5, movingPixelRatio: 1, cloudResolutionScale: 0.5, cloudSettleFrames: 16 }
    expect(budgetFor({ coarsePointer: false, shortSidePx: 768, memoryGb: 4 })).toEqual({ ...DESKTOP_BUDGET, ...preview })
    expect(budgetFor({ coarsePointer: false, shortSidePx: 768, cores: 4 })).toEqual({ ...DESKTOP_BUDGET, ...preview })
    // an i7 laptop with 16 threads and 16 GB, but Intel graphics only
    const irisXe = 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x0000A7A0) Direct3D11 vs_5_0 ps_5_0, D3D11)'
    expect(budgetFor({ coarsePointer: false, shortSidePx: 1080, memoryGb: 8, cores: 16, gpu: irisXe })).toEqual({ ...DESKTOP_BUDGET, ...preview })
    expect(budgetFor({ coarsePointer: false, shortSidePx: 1080, memoryGb: 8, cores: 16, gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' })).toEqual(DESKTOP_BUDGET)
    // still a computer: the tablet's limits do not apply, even with 2 GB
    expect(budgetFor({ coarsePointer: false, shortSidePx: 768, memoryGb: 2 })).toMatchObject({ kind: 'desktop', shadowMapSize: 4096, tileBitmaps: 600 })
  })

  it('lowers the limits of a phone', () => {
    expect(budgetFor({ coarsePointer: true, shortSidePx: 393, memoryGb: 8 })).toEqual({
      kind: 'phone',
      maxPixelRatio: 2,
      movingPixelRatio: 1.5,
      tileBitmaps: 200,
      heightGrids: 160,
      maxImageryZoomOffset: 1,
      cloudSettleFrames: 16,
      cloudResolutionScale: 0.5,
      seaRender: 'surface',
      maxExportShortSide: 1080,
      maxLodHeightPx: 720,
      maxVideoBitrate: 8e6,
      memoryWarnBytes: 250e6,
      maxResidentTiles: 120,
      maxTileLoads: 6,
      exportTileKeepFrames: 6,
      exportPrefetchAhead: [5, 10, 20],
      shadowMapSize: 2048,
      maxTrees: 60_000,
    })
  })

  it('a tablet exports up to 1440p', () => {
    expect(budgetFor({ coarsePointer: true, shortSidePx: 820 })).toMatchObject({ kind: 'tablet', maxExportShortSide: 1440, tileBitmaps: 200, maxResidentTiles: 160, maxTileLoads: 12 })
  })

  it('lower still with 2 GB or less (Chrome tells, Safari does not)', () => {
    expect(budgetFor({ coarsePointer: true, shortSidePx: 360, memoryGb: 2 })).toMatchObject({
      maxPixelRatio: 1.5,
      movingPixelRatio: 1,
      tileBitmaps: 120,
      heightGrids: 100,
      shadowMapSize: 1024,
      maxTrees: 30_000,
      maxResidentTiles: 90,
    })
  })

  it('a touch device draws a smaller shadow map, a computer keeps 4096', () => {
    expect(budgetFor({ coarsePointer: true, shortSidePx: 820 }).shadowMapSize).toBe(2048)
    expect(budgetFor({ coarsePointer: false, shortSidePx: 1080 }).shadowMapSize).toBe(4096)
  })
})

describe('canvasAntialias', () => {
  it('only a phone or tablet with the atmosphere (composer + SMAA) goes without MSAA', () => {
    const phone = budgetFor({ coarsePointer: true, shortSidePx: 393 })
    expect(canvasAntialias(phone, true)).toBe(false)
    expect(canvasAntialias(phone, false)).toBe(true)
    expect(canvasAntialias(budgetFor({ coarsePointer: true, shortSidePx: 820 }), true)).toBe(false)
    expect(canvasAntialias(DESKTOP_BUDGET, true)).toBe(true)
    expect(canvasAntialias(DESKTOP_BUDGET, false)).toBe(true)
  })
})

describe('isModestGpu', () => {
  it('Intel integrated graphics and software rendering, not the Arc cards nor the other GPUs', () => {
    expect(isModestGpu('Mesa Intel(R) UHD Graphics 620 (KBL GT2)')).toBe(true)
    expect(isModestGpu('Intel(R) Iris(TM) Plus Graphics 655')).toBe(true)
    expect(isModestGpu('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true)
    expect(isModestGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)')).toBe(true)
    expect(isModestGpu('ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(false)
    expect(isModestGpu('ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(false)
    expect(isModestGpu('Apple M2')).toBe(false)
  })
})

describe('readDeviceTraits', () => {
  it('reads the pointer, the screen and the memory', () => {
    expect(readDeviceTraits(scope(true, 390, 844, 4, 6))).toEqual({ coarsePointer: true, shortSidePx: 390, memoryGb: 4, cores: 6 })
    expect(budgetFor(readDeviceTraits(scope(false, 1366, 768, undefined, 4))).movingPixelRatio).toBe(1)
    expect(budgetFor(readDeviceTraits(scope(true, 1024, 1366))).kind).toBe('tablet')
    expect(budgetFor(readDeviceTraits(scope(false, 1920, 1080))).kind).toBe('desktop')
  })

  it('reads the GPU from a throwaway WebGL context, and releases it', () => {
    let lost = false
    const gl = {
      RENDERER: 1,
      getExtension: (name: string) =>
        name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 2 } : { loseContext: () => (lost = true) },
      getParameter: (p: number) => (p === 2 ? 'Mesa Intel(R) UHD Graphics 620' : 'WebKit WebGL'),
    }
    const document = { createElement: () => ({ getContext: () => gl }) }
    expect(readGpuRenderer({ document, WebGLRenderingContext: class {} })).toBe('Mesa Intel(R) UHD Graphics 620')
    expect(lost).toBe(true)
    expect(budgetFor(readDeviceTraits({ ...scope(false, 1920, 1080, 8, 16), document, WebGLRenderingContext: class {} })).movingPixelRatio).toBe(1)
    // no WebGL (jsdom has none): nothing said, a full computer
    expect(readGpuRenderer({ document })).toBeUndefined()
    expect(readGpuRenderer({ document: { createElement: () => ({ getContext: () => null }) }, WebGLRenderingContext: class {} })).toBeUndefined()
  })

  it('a scope without a screen is a computer', () => {
    expect(budgetFor(readDeviceTraits({})).kind).toBe('desktop')
    // Node tells its cores: the tests keep the full computer's values on a 4-core runner
    expect(budgetFor(readDeviceTraits({ navigator: { hardwareConcurrency: 2 } }))).toEqual(DESKTOP_BUDGET)
  })
})

describe('where the limits live (computer)', () => {
  it('unchanged on a computer', () => {
    expect(deviceBudget().kind).toBe('desktop')
    expect(DEFAULT_TUNING.heightCacheEntries).toBe(400)
    expect(DEFAULT_TUNING.maxResidentTiles).toBe(Infinity)
    expect(DEFAULT_TUNING.maxConcurrentLoads).toBe(24)
    expect(CLOUD_SETTLE_FRAMES).toBe(32)
    expect(DEFAULT_CLOUDS.seaRender).toBe('volume')
    expect(videoSize('16:9', '4k')).toEqual({ width: 3840, height: 2160 })
    expect(exportResolutionNote('4k')).toBeNull()
    expect(exportLodHeight(1920)).toBe(1920)
    expect(deviceBudget().shadowMapSize).toBe(4096)
    expect(DEFAULT_VIDEO_SETTINGS.resolution).toBe('1080p')
  })

  it('only a phone picks its export tiles for a lower view', () => {
    expect(exportLodHeight(1920, budgetFor({ coarsePointer: true, shortSidePx: 393 }).maxLodHeightPx)).toBe(720)
    expect(exportLodHeight(540, budgetFor({ coarsePointer: true, shortSidePx: 393 }).maxLodHeightPx)).toBe(540)
    expect(exportLodHeight(1920, budgetFor({ coarsePointer: true, shortSidePx: 820 }).maxLodHeightPx)).toBe(1920)
    expect(exportLodHeight(2160, DESKTOP_BUDGET.maxLodHeightPx)).toBe(2160)
  })

  it('a phone renders 4K and 1440p at 1080p, and says so', () => {
    expect(videoSize('16:9', '4k', 1080)).toEqual({ width: 1920, height: 1080 })
    expect(videoSize('9:16', '1440p', 1080)).toEqual({ width: 1080, height: 1920 })
    expect(videoSize('16:9', '720p', 1080)).toEqual({ width: 1280, height: 720 })
    expect(exportResolutionNote('4k', 1080)).toMatch(/limité à 1080p/)
    expect(exportResolutionNote('1080p', 1080)).toBeNull()
  })
})
