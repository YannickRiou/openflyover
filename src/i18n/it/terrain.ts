import type { Messages } from '../messages'

const messages: Messages['terrain'] = {
  'layer.elevation': 'elevazione',
  'layer.imagery': 'immagini',
  'cause.network': 'errore di rete ({detail})',
  'cause.unknown': 'causa sconosciuta',
  'cause.incompleteImagery': 'immagini incomplete',
  'dates.unknown': 'data di aggiornamento non comunicata dal servizio',
  'dates.updated': 'dati aggiornati il {date}',
  'sources.mapterhorn.name': 'Mapterhorn (mondiale, alta risoluzione)',
  'sources.mapterhorn.attribution': '© Mapterhorn (dati aperti, elenco delle fonti: mapterhorn.com/attribution)',
  'sources.aws-terrarium.attribution': 'Terrain Tiles (Mapzen / AWS Open Data) — SRTM, GMTED2010, ETOPO1 courtesy of USGS/NOAA, EU-DEM © Copernicus, ArcticDEM e altre fonti aperte',
  'sources.ign-ortho.attribution': '© IGN — Géoplateforme (BD ORTHO, licenza aperta Etalab 2.0)',
  'sources.swisstopo.name': 'swisstopo SWISSIMAGE (Svizzera)',
  'sources.arcgis-world-imagery.name': 'Esri World Imagery (mondiale)',
  'sources.eox-s2cloudless.name': 'Sentinel-2 cloudless 2025 (EOX, mondiale, 10 m)',
  'sources.ign-plan.name': 'IGN — carta Plan IGN (Francia)',
  'sources.ign-plan.attribution': '© IGN — Géoplateforme (Plan IGN, licenza aperta Etalab 2.0)',
  'sources.swisstopo-carte.name': 'swisstopo — carta nazionale (Svizzera)',
  'sources.opentopomap.name': 'OpenTopoMap — carta topografica (mondiale)',
  'sources.opentopomap.attribution': 'Dati: © contributori di OpenStreetMap, SRTM | Rendering: © OpenTopoMap (CC BY-SA)',
  'sources.ign-ortho-2000-2005.name': 'IGN — foto 2000–2005 (Francia)',
  'sources.ign-ortho-2000-2005.attribution': '© IGN — Géoplateforme (BD ORTHO 2000–2005, licenza aperta Etalab 2.0)',
  'sources.ign-ortho-1965-1980.name': 'IGN — foto 1965–1980 (Francia, parziale)',
  'sources.ign-ortho-1965-1980.attribution': '© IGN — Géoplateforme (BD ORTHO storica 1965–1980, licenza aperta Etalab 2.0)',
  'sources.ign-ortho-1950-1965.name': 'IGN — foto 1950–1965 (Francia)',
  'sources.ign-ortho-1950-1965.attribution': '© IGN — Géoplateforme (BD ORTHO storica 1950–1965, licenza aperta Etalab 2.0)',
}

export default messages
