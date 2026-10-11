import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './ui/fonts.css'
import './index.css'
import './ui/theme.css'
import App from './App.tsx'
import { installExportHistory } from './export/historyStore'
import { installOfflineTiles } from './offline/store'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { installExternalLinks } from './platform/externalLinks'
import { installWebApp } from './platform/webApp'
import { openFiles } from './ui/projectActions'

// offline packs: the tile fetcher reads them before the network
installOfflineTiles()
installExternalLinks()
// renders ended (done, canceled, failed) are written to the history of the export panel
installExportHistory()
// website: service worker, update prompt, iOS install hint, tracks shared to the installed app
installWebApp((files) => void openFiles(files))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
