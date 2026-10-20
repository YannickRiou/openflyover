/**
 * The blocks copied with Ctrl+C, waiting for Ctrl+V (`film/timeline.ts` `copyBlocks`, `pasteBlocks`): kept in memory for
 * the session, not in the system clipboard (a block is not text) and not in the project.
 */
import type { BlockClip } from '../film/timeline'

let clip: BlockClip | null = null

export const getBlockClip = (): BlockClip | null => clip
export const setBlockClip = (next: BlockClip | null): void => {
  clip = next
}
