import type { Messages } from '../messages'

const messages: Messages['status'] = {
  chipSr: ': {tip}',
  mapTip: 'Gelände und Luftbilder der aktuellen Ansicht',
  mapLoading: 'Karte wird geladen',
  map: 'Karte · {value}',
  mapReadyTip: 'Alle Kacheln der aktuellen Ansicht sind geladen',
  mapReady: 'Karte bereit',
  failedTip: 'Netzwerk oder Server: automatischer neuer Versuch',
  failedTiles: { one: '{count} Kachel mit Fehler', other: '{count} Kacheln mit Fehler' },
  importing: 'Import läuft…',
  perfTip: 'Leistung (Auswahl unter „Einstellungen“)',
  creditSources: 'Quellen {name}',
  sources: 'Quellen und Lizenzen',
  sourcesProject: 'OpenFlyover ist quelloffen: Code, Dokumentation und Downloads auf',
  sourcesNote: 'Diese Angaben werden in die exportierten Filme eingeblendet (Overlay, „Quellenangaben“). Schriften: Fraunces und IBM Plex (SIL Open Font License 1.1). Icons: Lucide (ISC-Lizenz). OpenFlyover wird unter der MIT-Lizenz veröffentlicht.',
  'source.weather': 'Wetter der Tour (Open-Meteo)',
  'source.landmarks': 'Landmarken (OpenStreetMap)',
  'source.region': 'Region der Übersicht (OpenStreetMap)',
  'source.water': 'Wasser (OpenStreetMap)',
  'chip.loading': '{source}: wird geladen…',
  'chip.ready': '{source}: Laden abgeschlossen',
  'chip.error': '{source}: Laden fehlgeschlagen',
  'chip.none': '{source}: nichts rund um den Track',
  'perf.fps': '{value} fps',
  'perf.idle': '3D im Ruhezustand',
  'perf.gpu': '{textures} Texturen · {geometries} Geometrien',
  'perf.tiles': '{value} Kacheln',
  'perf.js': 'JS {value}',
  'perf.ram': 'RAM {used} / {total}',
  'perf.cpu': 'CPU {value} %',
  sourcesUpdates: 'Desktop-App: GitHub (github.com) wird nur kontaktiert, wenn Sie „Nach Updates suchen“ (Einstellungen) drücken, um die Versionsdatei zu lesen.',
  // --- 4.1.0: « Forêts » chip, waiting for the other OpenStreetMap requests ---
  'source.forest': 'Wälder (OpenStreetMap)',
  'chip.queued': '{source}: wartet, die anderen OpenStreetMap-Ladevorgänge kommen zuerst',
  forestError: 'Wälder (OpenStreetMap): Laden fehlgeschlagen, es gibt keine Bäume. Neuer Versuch bei der nächsten Strecke oder der nächsten Einstellungsänderung.',
  // 4.1 — Glaciers
  'source.glacier': 'Gletscher (OpenStreetMap)',
}

export default messages
