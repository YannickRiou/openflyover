import type { Messages } from '../messages'

const messages: Messages['status'] = {
  chipSr: ': {tip}',
  mapTip: 'Terrain and imagery of the current view',
  mapLoading: 'Loading the map',
  map: 'Map · {value}',
  mapReadyTip: 'All the tiles of the current view are loaded',
  mapReady: 'Map ready',
  failedTip: 'Network or server: automatic retry',
  failedTiles: { one: '{count} tile failed', other: '{count} tiles failed' },
  importing: 'Importing…',
  perfTip: 'Performance (choose in “Settings”)',
  creditSources: 'Sources {name}',
  sources: 'Sources and licences',
  sourcesUpdates: 'Desktop app: GitHub (github.com) is contacted only when you press “Check for updates” (Settings), to read the version file.',
  sourcesProject: 'OpenFlyover is open source: code, documentation and downloads on',
  sourcesNote: 'These credits are burned into the exported films (Overlay, “Source credits”). Fonts: Fraunces and IBM Plex (SIL Open Font License 1.1). Icons: Lucide (ISC licence). OpenFlyover is published under the MIT licence.',
  'source.weather': 'Weather of the outing (Open-Meteo)',
  'source.landmarks': 'Landmarks (OpenStreetMap)',
  'source.region': 'Locator map region (OpenStreetMap)',
  'source.water': 'Water (OpenStreetMap)',
  'chip.loading': '{source}: loading…',
  'chip.ready': '{source}: loaded',
  'chip.error': '{source}: loading failed',
  'chip.none': '{source}: nothing around the track',
  'perf.fps': '{value} fps',
  'perf.idle': '3D idle',
  'perf.gpu': '{textures} textures · {geometries} geometries',
  'perf.tiles': '{value} tiles',
  'perf.js': 'JS {value}',
  'perf.ram': 'RAM {used} / {total}',
  'perf.cpu': 'CPU {value}%',
  // 4.1 — Glaciers
  'source.glacier': 'Glaciers (OpenStreetMap)',
}

export default messages
