import type { Messages } from '../messages'

const messages: Messages['terrain'] = {
  'layer.elevation': 'elevation',
  'layer.imagery': 'imagery',
  'cause.network': 'network error ({detail})',
  'cause.unknown': 'unknown cause',
  'cause.incompleteImagery': 'incomplete imagery',
  'dates.unknown': 'update date not provided by the service',
  'dates.updated': 'data updated on {date}',
  'sources.mapterhorn.name': 'Mapterhorn (worldwide, high resolution)',
  'sources.mapterhorn.attribution': '© Mapterhorn (open data, list of sources: mapterhorn.com/attribution)',
  'sources.aws-terrarium.attribution': 'Terrain Tiles (Mapzen / AWS Open Data) — SRTM, GMTED2010, ETOPO1 courtesy of USGS/NOAA, EU-DEM © Copernicus, ArcticDEM and other open sources',
  'sources.ign-ortho.attribution': '© IGN — Géoplateforme (BD ORTHO, Etalab Open Licence 2.0)',
  'sources.swisstopo.name': 'swisstopo SWISSIMAGE (Switzerland)',
  'sources.arcgis-world-imagery.name': 'Esri World Imagery (worldwide)',
  'sources.ign-plan.name': 'IGN — Plan IGN map (France)',
  'sources.ign-plan.attribution': '© IGN — Géoplateforme (Plan IGN, Etalab Open Licence 2.0)',
  'sources.swisstopo-carte.name': 'swisstopo — national map (Switzerland)',
  'sources.opentopomap.name': 'OpenTopoMap — topographic map (worldwide)',
  'sources.opentopomap.attribution': 'Data: © OpenStreetMap contributors, SRTM | Rendering: © OpenTopoMap (CC BY-SA)',
}

export default messages
