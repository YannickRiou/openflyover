/**
 * The offer to resume an export, as the interface sees it: what is stored (read when the app starts, deleted when too
 * old) and the abandon.
 */
import { cleanupDecision, type ResumeManifest } from './resume'
import { openStorage } from './storage'

/** The stored export that can be offered, or null (none, too old and deleted, damaged, or no storage here). */
export async function findStoredExport(now = Date.now()): Promise<ResumeManifest | null> {
  const storage = await openStorage()
  if (!storage) return null
  const manifest = await storage.readManifest()
  if (cleanupDecision(manifest, now) === 'delete') {
    await storage.clear().catch(() => undefined)
    return null
  }
  return manifest
}

/** « Abandonner »: the stored export is deleted. */
export async function abandonStoredExport(): Promise<void> {
  await (await openStorage())?.clear().catch(() => undefined)
}
