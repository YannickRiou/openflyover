import type { Messages } from '../messages'

const messages: Messages['status'] = {
  chipSr: ': {tip}',
  mapTip: 'Terrain and imagery of the current view',
  mapLoading: 'Loading the map',
  map: 'Loading the map… {value}',
  failedTip: 'Network or server: automatic retry',
  failedTiles: { one: '{count} tile failed', other: '{count} tiles failed' },
  importing: 'Importing…',
  perfTitle: 'Performance',
  layersLoading: 'Loading: {layers}',
  layersFailed: 'Loading failed: {layers}',
  creditSources: 'Sources {name}',
  about: 'About and updates',
  sourcesTitle: 'Sources and licences',
  version: 'Version: {version}',
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
  // --- 4.1.0: « Forêts » chip, waiting for the other OpenStreetMap requests ---
  'source.forest': 'Forests (OpenStreetMap)',
  'chip.queued': '{source}: waiting, the other OpenStreetMap loads go first',
  forestError: 'Forests (OpenStreetMap): loading failed, there will be no trees. Tried again with the next track or the next setting change.',
  // 4.1 — Glaciers
  'source.glacier': 'Glaciers (OpenStreetMap)',
}

export default messages
