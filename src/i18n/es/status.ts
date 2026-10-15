import type { Messages } from '../messages'

const messages: Messages['status'] = {
  chipSr: ': {tip}',
  mapTip: 'Relieve e imágenes de la vista actual',
  mapLoading: 'Cargando el mapa',
  map: 'Mapa · {value}',
  mapReadyTip: 'Todas las teselas de la vista actual están cargadas',
  mapReady: 'Mapa listo',
  failedTip: 'Red o servidor: se reintentará automáticamente',
  failedTiles: { one: '{count} tesela con error', other: '{count} teselas con error' },
  importing: 'Importando…',
  perfTip: 'Rendimiento (se elige en «Ajustes»)',
  creditSources: 'Fuentes {name}',
  sources: 'Fuentes y licencias',
  sourcesNote:
    'Estas menciones se incrustan en las películas exportadas (Gráficos, «Créditos de las fuentes»). Fuentes tipográficas: Fraunces e IBM Plex (SIL Open Font License 1.1). Iconos: Lucide (licencia ISC). OpenFlyover se publica bajo licencia MIT.',
  'source.weather': 'Meteorología de la salida (Open-Meteo)',
  'source.landmarks': 'Referencias (OpenStreetMap)',
  'source.region': 'Región del plano de situación (OpenStreetMap)',
  'source.water': 'Agua (OpenStreetMap)',
  'chip.loading': '{source}: cargando…',
  'chip.ready': '{source}: carga completada',
  'chip.error': '{source}: error de carga',
  'chip.none': '{source}: nada alrededor del track',
  'perf.fps': '{value} fps',
  'perf.idle': '3D en reposo',
  'perf.gpu': '{textures} texturas · {geometries} geometrías',
  'perf.tiles': '{value} teselas',
  'perf.js': 'JS {value}',
  'perf.ram': 'RAM {used} / {total}',
  'perf.cpu': 'CPU {value} %',
}

export default messages
