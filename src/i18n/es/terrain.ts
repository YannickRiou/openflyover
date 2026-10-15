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
  'sources.eox-s2cloudless.name': 'Sentinel-2 cloudless 2025 (EOX, mundial, 10 m)',
  'sources.ign-plan.name': 'IGN — mapa Plan IGN (Francia)',
  'sources.ign-plan.attribution': '© IGN — Géoplateforme (Plan IGN, licencia abierta Etalab 2.0)',
  'sources.swisstopo-carte.name': 'swisstopo — mapa nacional (Suiza)',
  'sources.opentopomap.name': 'OpenTopoMap — mapa topográfico (mundial)',
  'sources.opentopomap.attribution': 'Datos: © colaboradores de OpenStreetMap, SRTM | Renderizado: © OpenTopoMap (CC BY-SA)',
  'sources.ign-ortho-2000-2005.name': 'IGN — fotos 2000–2005 (Francia)',
  'sources.ign-ortho-2000-2005.attribution': '© IGN — Géoplateforme (BD ORTHO 2000–2005, licencia abierta Etalab 2.0)',
  'sources.ign-ortho-1965-1980.name': 'IGN — fotos 1965–1980 (Francia, parcial)',
  'sources.ign-ortho-1965-1980.attribution': '© IGN — Géoplateforme (BD ORTHO histórico 1965–1980, licencia abierta Etalab 2.0)',
  'sources.ign-ortho-1950-1965.name': 'IGN — fotos 1950–1965 (Francia)',
  'sources.ign-ortho-1950-1965.attribution': '© IGN — Géoplateforme (BD ORTHO histórico 1950–1965, licencia abierta Etalab 2.0)',
}

export default messages
