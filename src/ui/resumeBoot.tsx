import { createRoot } from 'react-dom/client'
import { isRenderWindow } from '../export/renderWindow'
import { ResumeOffer } from './ResumeOffer'

/**
 * Starts the offer to resume an export (ResumeOffer.tsx) in a root of its own: started by `ExportController` (loaded with the scene, not in the first screen).
 * « Reprendre » opens the export panel through its button of the top bar.
 */
const openExport = () => {
  const button = document.querySelector<HTMLElement>('[aria-controls="export-dock"]')
  if (button?.getAttribute('aria-expanded') === 'false') button.click()
}
let mounted = false

/** Mounts the offer, once; not in the window that renders films for the command line (no one to ask). */
export function mountResumeOffer(): void {
  if (mounted || isRenderWindow()) return
  mounted = true
  createRoot(document.body.appendChild(document.createElement('div'))).render(<ResumeOffer onOpenExport={openExport} />)
}
