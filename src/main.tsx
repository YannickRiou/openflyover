import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './ui/fonts.css'
import './index.css'
import './ui/theme.css'
import './ui/appearance.css'
import App from './App.tsx'
import { installExportGuard, reportInterruptedExport } from './export/guard'
import { installExportHistory } from './export/historyStore'
import { installOfflineTiles } from './offline/store'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { installExternalLinks } from './platform/externalLinks'
import { installWebApp } from './platform/webApp'
import { installAppearance } from './ui/preferences'
import { openFiles } from './ui/projectActions'

// theme, accent and density of the stored preferences, before anything is drawn
installAppearance()
// offline packs: the tile fetcher reads them before the network
installOfflineTiles()
installExternalLinks()
// renders ended (done, canceled, failed) are written to the history of the export panel
installExportHistory()
// screen kept on during an export; an export the browser cut short (tab killed) is reported at the next start
reportInterruptedExport()
installExportGuard()
// website: service worker, update prompt, iOS install hint, tracks shared to the installed app
installWebApp((files) => void openFiles(files))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
