import type { Messages } from '../messages'

const messages: Messages['terrain'] = {
  'layer.elevation': 'Höhe',
  'layer.imagery': 'Luftbilder',
  'cause.network': 'Netzwerkfehler ({detail})',
  'cause.unknown': 'unbekannte Ursache',
  'cause.incompleteImagery': 'unvollständige Luftbilder',
  'dates.unknown': 'Aktualisierungsdatum vom Dienst nicht mitgeteilt',
  'dates.updated': 'Daten aktualisiert am {date}',
  'sources.mapterhorn.name': 'Mapterhorn (weltweit, hohe Auflösung)',
  'sources.mapterhorn.attribution': '© Mapterhorn (offene Daten, Liste der Quellen: mapterhorn.com/attribution)',
  'sources.aws-terrarium.attribution': 'Terrain Tiles (Mapzen / AWS Open Data) — SRTM, GMTED2010, ETOPO1 courtesy of USGS/NOAA, EU-DEM © Copernicus, ArcticDEM und weitere offene Quellen',
  'sources.ign-ortho.attribution': '© IGN — Géoplateforme (BD ORTHO, offene Lizenz Etalab 2.0)',
  'sources.swisstopo.name': 'swisstopo SWISSIMAGE (Schweiz)',
  'sources.arcgis-world-imagery.name': 'Esri World Imagery (weltweit)',
  'sources.eox-s2cloudless.name': 'Sentinel-2 cloudless 2025 (EOX, weltweit, 10 m)',
  'sources.ign-plan.name': 'IGN — Karte Plan IGN (Frankreich)',
  'sources.ign-plan.attribution': '© IGN — Géoplateforme (Plan IGN, offene Lizenz Etalab 2.0)',
  'sources.swisstopo-carte.name': 'swisstopo — Landeskarte (Schweiz)',
  'sources.opentopomap.name': 'OpenTopoMap — Topokarte (weltweit)',
  'sources.opentopomap.attribution': 'Daten: © OpenStreetMap-Mitwirkende, SRTM | Darstellung: © OpenTopoMap (CC BY-SA)',
  'sources.ign-ortho-2000-2005.name': 'IGN — Fotos 2000–2005 (Frankreich)',
  'sources.ign-ortho-2000-2005.attribution': '© IGN — Géoplateforme (BD ORTHO 2000–2005, offene Lizenz Etalab 2.0)',
  'sources.ign-ortho-1965-1980.name': 'IGN — Fotos 1965–1980 (Frankreich, teilweise)',
  'sources.ign-ortho-1965-1980.attribution': '© IGN — Géoplateforme (BD ORTHO historique 1965–1980, offene Lizenz Etalab 2.0)',
  'sources.ign-ortho-1950-1965.name': 'IGN — Fotos 1950–1965 (Frankreich)',
  'sources.ign-ortho-1950-1965.attribution': '© IGN — Géoplateforme (BD ORTHO historique 1950–1965, offene Lizenz Etalab 2.0)',
}

export default messages
