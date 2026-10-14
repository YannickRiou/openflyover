/**
 * What the status bar reads from the 3D view without importing it: three.js and React Three Fiber stay in the 3D chunk,
 * out of the first screen. The scene registers the probe when its canvas is created (FlyoverCanvas.tsx).
 */
export interface PerfProbe {
  /** Calls `count` after every frame drawn (the export's included); the returned function stops it. */
  onFrame(count: () => void): () => void
  /** Textures and geometries held by the renderer. */
  memory(): { textures: number; geometries: number }
}

let probe: PerfProbe | undefined

/** The scene registers how to read its renderer. */
export function setPerfProbe(next: PerfProbe | undefined): void {
  probe = next
}

/** The probe of the 3D view; undefined until its chunk is loaded and its canvas created. */
export function getPerfProbe(): PerfProbe | undefined {
  return probe
}
