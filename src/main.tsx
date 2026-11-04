import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './ui/fonts.css'
import './ui/theme.css'
import './index.css'
import './ui/appearance.css'
import App from './App.tsx'
import { loadLanguage } from './i18n'
import { applyGpuWaitParam } from './export/diagnostic'
import { installExportGuard, reportInterruptedExport } from './export/guard'
import { installExportHistory } from './export/historyStore'
import { installOfflineTiles } from './offline/store'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { installExternalLinks } from './platform/externalLinks'
import { installWebApp } from './platform/webApp'
import { installAppearance, installLanguage, usePreferences } from './ui/preferences'
import { openFiles } from './ui/projectActions'

// theme and accent of the stored preferences, before anything is drawn
installAppearance()
// language of the stored preferences (the browser's on a first run)
installLanguage()
// offline packs: the tile fetcher reads them before the network
installOfflineTiles()
installExternalLinks()
// renders ended (done, canceled, failed) are written to the history of the export panel
installExportHistory()
// screen kept on during an export; an export the browser cut short (tab killed) is reported at the next start
reportInterruptedExport()
installExportGuard()
// `?export-gpu-wait=on|off|default`: compare two exports on a phone, which has no console (diagnostic.ts)
applyGpuWaitParam(location.search)
// website: service worker, update prompt, iOS install hint, tracks shared to the installed app
installWebApp((files) => void openFiles(files))

// a touch screen: Safari zooms the page through its own gesture events, which `touch-action` does not stop (theme.css)
if (window.matchMedia?.('(pointer: coarse)').matches) document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false })

// first render once the catalog of the language is in (French is bundled; another is a small chunk, precached by the
// service worker): no text in the wrong language, no missing one. If it cannot be fetched the app starts in French.
void loadLanguage(usePreferences.getState().language)
  .catch(() => undefined)
  .then(() =>
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </StrictMode>,
    ),
  )
