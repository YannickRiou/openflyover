import type { Messages } from '../messages'

const messages: Messages['status'] = {
  chipSr: ': {tip}',
  mapTip: 'Rilievo e immagini della vista attuale',
  mapLoading: 'Caricamento della mappa',
  map: 'Mappa · {value}',
  mapReadyTip: 'Tutte le tile della vista attuale sono caricate',
  mapReady: 'Mappa pronta',
  failedTip: 'Rete o server: nuovo tentativo automatico',
  failedTiles: { one: '{count} tile in errore', other: '{count} tile in errore' },
  importing: 'Importazione in corso…',
  perfTip: 'Prestazioni (scelta in «Impostazioni»)',
  creditSources: 'Fonti {name}',
  sources: 'Fonti e licenze',
  sourcesProject: 'OpenFlyover è open source: codice, documentazione e download su',
  sourcesNote: 'Queste indicazioni sono incorporate nei film esportati (Overlay, «Crediti delle fonti»). Caratteri: Fraunces e IBM Plex (SIL Open Font License 1.1). Icone: Lucide (licenza ISC). OpenFlyover è pubblicato con licenza MIT.',
  'source.weather': 'Meteo dell’uscita (Open-Meteo)',
  'source.landmarks': 'Riferimenti (OpenStreetMap)',
  'source.region': 'Regione dell’inquadratura d’insieme (OpenStreetMap)',
  'source.water': 'Acqua (OpenStreetMap)',
  'chip.loading': '{source}: caricamento…',
  'chip.ready': '{source}: caricamento completato',
  'chip.error': '{source}: caricamento non riuscito',
  'chip.none': '{source}: nulla attorno alla traccia',
  'perf.fps': '{value} fps',
  'perf.idle': '3D a riposo',
  'perf.gpu': '{textures} texture · {geometries} geometrie',
  'perf.tiles': '{value} tile',
  'perf.js': 'JS {value}',
  'perf.ram': 'RAM {used} / {total}',
  'perf.cpu': 'CPU {value}%',
  sourcesUpdates: 'Applicazione desktop: GitHub (github.com) viene contattato solo quando premi «Cerca aggiornamenti» (Impostazioni), per leggere il file delle versioni.',
  // 4.1 — Glaciers
  'source.glacier': 'Ghiacciai (OpenStreetMap)',
}

export default messages
