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
  'sources.eox-s2cloudless.name': 'Sentinel-2 cloudless 2025 (EOX, worldwide, 10 m)',
  'sources.ign-plan.name': 'IGN — Plan IGN map (France)',
  'sources.ign-plan.attribution': '© IGN — Géoplateforme (Plan IGN, Etalab Open Licence 2.0)',
  'sources.swisstopo-carte.name': 'swisstopo — national map (Switzerland)',
  'sources.opentopomap.name': 'OpenTopoMap — topographic map (worldwide)',
  'sources.opentopomap.attribution': 'Data: © OpenStreetMap contributors, SRTM | Rendering: © OpenTopoMap (CC BY-SA)',
  'sources.ign-ortho-2000-2005.name': 'IGN — 2000–2005 photos (France)',
  'sources.ign-ortho-2000-2005.attribution': '© IGN — Géoplateforme (BD ORTHO 2000–2005, Etalab Open Licence 2.0)',
  'sources.ign-ortho-1965-1980.name': 'IGN — 1965–1980 photos (France, partial)',
  'sources.ign-ortho-1965-1980.attribution': '© IGN — Géoplateforme (historical BD ORTHO 1965–1980, Etalab Open Licence 2.0)',
  'sources.ign-ortho-1950-1965.name': 'IGN — 1950–1965 photos (France)',
  'sources.ign-ortho-1950-1965.attribution': '© IGN — Géoplateforme (historical BD ORTHO 1950–1965, Etalab Open Licence 2.0)',
}

export default messages
