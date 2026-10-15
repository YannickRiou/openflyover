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
  'sources.basemap-at.name': 'basemap.at — Orthofoto (Österreich)',
  'sources.gsi-photo.name': 'GSI — Luftbilder (Japan)',
  'sources.usgs-imagery.name': 'USGS — Luftbilder (USA)',
  'sources.ign-plan.name': 'IGN — Karte Plan IGN (Frankreich)',
  'sources.ign-plan.attribution': '© IGN — Géoplateforme (Plan IGN, offene Lizenz Etalab 2.0)',
  'sources.swisstopo-carte.name': 'swisstopo — Landeskarte (Schweiz)',
  'sources.opentopomap.name': 'OpenTopoMap — Topokarte (weltweit)',
  'sources.opentopomap.attribution': 'Daten: © OpenStreetMap-Mitwirkende, SRTM | Darstellung: © OpenTopoMap (CC BY-SA)',
}

export default messages
