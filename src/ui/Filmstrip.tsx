import { useEffect, useState } from 'react'
import { readFilmstrip } from '../film/video'
import type { MediaAsset } from '../film/media'

/** Tiles by width of the block (pixels each): a frame is about 36 px wide at the block's height. */
export const FILMSTRIP_TILE_PX = 40
/** The counts of tiles drawn: a clip is read once for each, not at every zoom step. */
const COUNTS = [2, 4, 8, 12] as const

/** How many tiles a block `widthPx` wide shows: the largest of `COUNTS` that fits, 0 when it is too narrow for a strip. */
export function filmstripCount(widthPx: number): number {
  const fit = Math.floor(widthPx / FILMSTRIP_TILE_PX)
  return [...COUNTS].reverse().find((n) => n <= fit) ?? 0
}

const cache = new WeakMap<MediaAsset, Map<string, Promise<string[]>>>()

/** The frames of `asset` over `inS`–`outS` (read once per clip, stretch and count, kept for the session). */
function frames(asset: MediaAsset, inS: number, outS: number, count: number): Promise<string[]> {
  let perClip = cache.get(asset)
  if (!perClip) cache.set(asset, (perClip = new Map()))
  const key = `${inS.toFixed(2)}:${outS.toFixed(2)}:${count}`
  let found = perClip.get(key)
  if (!found) perClip.set(key, (found = readFilmstrip(asset, inS, outS, count)))
  return found
}

/**
 * The frames of a clip along its block on the timeline, behind its label: `count` tiles over `inS`–`outS` of the file. Nothing
 * until they are read (the block shows its first-frame thumbnail meanwhile), nothing for a clip that cannot be read.
 */
export function Filmstrip({ asset, inS, outS, count }: { asset: MediaAsset | undefined; inS: number; outS: number; count: number }) {
  const [urls, setUrls] = useState<readonly string[]>([])
  useEffect(() => {
    if (!asset || count < 1) return
    let alive = true
    void frames(asset, inS, outS, count).then((list) => alive && setUrls(list))
    return () => {
      alive = false
    }
  }, [asset, inS, outS, count])
  if (!asset || count < 1 || urls.length === 0) return null
  return (
    <span className="pointer-events-none absolute inset-0 flex opacity-80" data-testid="filmstrip" aria-hidden="true">
      {urls.map((url, i) => (
        <img key={i} className="h-full min-w-0 flex-1 object-cover" src={url} alt="" draggable={false} />
      ))}
    </span>
  )
}
