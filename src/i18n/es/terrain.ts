import type { Messages } from '../messages'

const messages: Messages['terrain'] = {
  'layer.elevation': 'elevación',
  'layer.imagery': 'imágenes',
  'cause.network': 'error de red ({detail})',
  'cause.unknown': 'causa desconocida',
  'cause.incompleteImagery': 'imágenes incompletas',
  'dates.unknown': 'fecha de actualización no comunicada por el servicio',
  'dates.updated': 'datos actualizados el {date}',
  'sources.mapterhorn.name': 'Mapterhorn (mundial, alta resolución)',
  'sources.mapterhorn.attribution': '© Mapterhorn (datos abiertos, lista de fuentes: mapterhorn.com/attribution)',
  'sources.aws-terrarium.attribution': 'Terrain Tiles (Mapzen / AWS Open Data) — SRTM, GMTED2010, ETOPO1 courtesy of USGS/NOAA, EU-DEM © Copernicus, ArcticDEM y otras fuentes abiertas',
  'sources.ign-ortho.attribution': '© IGN — Géoplateforme (BD ORTHO, licencia abierta Etalab 2.0)',
  'sources.swisstopo.name': 'swisstopo SWISSIMAGE (Suiza)',
  'sources.arcgis-world-imagery.name': 'Esri World Imagery (mundial)',
  'sources.ign-plan.name': 'IGN — mapa Plan IGN (Francia)',
  'sources.ign-plan.attribution': '© IGN — Géoplateforme (Plan IGN, licencia abierta Etalab 2.0)',
  'sources.swisstopo-carte.name': 'swisstopo — mapa nacional (Suiza)',
  'sources.opentopomap.name': 'OpenTopoMap — mapa topográfico (mundial)',
  'sources.opentopomap.attribution': 'Datos: © colaboradores de OpenStreetMap, SRTM | Renderizado: © OpenTopoMap (CC BY-SA)',
}

export default messages
