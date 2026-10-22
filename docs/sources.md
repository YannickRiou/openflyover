# Data sources: attributions, licenses and verification

The first section lists what the app displays and allows for each source; the rest of the document records how the
sources were checked.

## Attributions, licenses and offline use

| Source | Used for | Address | Displayed attribution |
|---|---|---|---|
| Mapterhorn | terrain (default) | `tiles.mapterhorn.com` | "© Mapterhorn (données ouvertes, liste des sources : mapterhorn.com/attribution)" |
| AWS Terrain Tiles | terrain | `s3.amazonaws.com/elevation-tiles-prod` | "Terrain Tiles (Mapzen / AWS Open Data) — SRTM, GMTED2010, ETOPO1 courtesy of USGS/NOAA, EU-DEM © Copernicus, ArcticDEM et autres sources ouvertes" |
| IGN Géoplateforme | orthophotos and Plan IGN in France | `data.geopf.fr/wmts` | "© IGN — Géoplateforme (BD ORTHO, licence ouverte Etalab 2.0)", and variants per layer |
| swisstopo | orthophotos and national map in Switzerland | `wmts.geo.admin.ch` | "© swisstopo (SWISSIMAGE, OGD)", "© swisstopo (carte nationale, OGD)" |
| Esri World Imagery | world orthophotos (default imagery outside France and Switzerland) | `services.arcgisonline.com` | "Powered by Esri — Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community" |
| basemap.at | aerial photos of Austria (orthophoto 30 cm) | `mapsneu.wien.gv.at` | "Datenquelle: basemap.at" |
| GSI Japan | aerial photos of Japan | `cyberjapandata.gsi.go.jp` | "Source: GSI Japan (Geospatial Information Authority of Japan), GSI Tiles" |
| USGS The National Map | aerial photos of the United States | `basemap.nationalmap.gov` | "USDA, USGS The National Map: Orthoimagery" |
| OpenTopoMap | world topographic map | `tile.opentopomap.org` | "Données : © contributeurs OpenStreetMap, SRTM \| Rendu : © OpenTopoMap (CC BY-SA)" |
| Open-Meteo | historical weather, forecast for an upcoming outing | `archive-api.open-meteo.com`, `api.open-meteo.com` | "Données météo : Open-Meteo.com (CC BY 4.0)" |
| OpenStreetMap (Overpass API) | landmarks, water (the sea, lakes, rivers and streams, reflective) | `overpass-api.de`, fallback `maps.mail.ru` | "© contributeurs OpenStreetMap (ODbL)" |

The service worker of the website (installable app) caches only the app's own files: it never stores a tile, a weather
answer, an Overpass answer nor a Strava call, so third-party data is kept only where its terms are checked (offline
packs, see below; the weather and landmark caches of the app, in its local storage).

The status bar, at the bottom of the screen, shows the attributions of the current terrain and imagery. Those of Open-Meteo and OpenStreetMap
are added when the weather or the landmarks are loaded. The same lines are burned into exported videos and images
([README, "Licenses"](../README.md#licenses)).

The desktop application can check for a new version of itself, on demand: it contacts `github.com` (the release feed
`latest.json`, then the update package if you install it) only when you press « Rechercher une mise à jour »
(« Réglages »), from its Rust side (the page's content security policy lists no GitHub host). Nothing else is sent; the
website has no such button. Setup: [`installers.md`](installers.md#automatic-updates-maintainer-setup).

The optional Strava import is not one of these sources: it reads your own activities through your own Strava
application ([user guide](user-guide.html#import)). No Strava key or account is in the code. It goes through
`www.strava.com` only (authorization, token, API v3) and falls under the [Strava API Agreement](https://www.strava.com/legal/api)
and its [API policy](https://www.strava.com/legal/api_policy) (effective 2026-06-01, read 2026-10-09):

- Data may be displayed only to the Strava user it belongs to (§ 2.3, 6.1) and kept in a cache for 7 days at most (§ 6.2);
  a user's deletion request must be honoured within 48 hours (§ 6.3) and after revocation within 30 days (§ 7.4);
  a standard-tier application is limited to 10 Strava users (§ 3.3).
- Attribution is optional, but when given it must follow the [brand guidelines](https://developers.strava.com/guidelines/):
  the text "Powered by Strava" or "Compatible with Strava", no Strava mark in the application's name or icon, no
  implied endorsement. The "Connect with Strava" button image is only needed if that image is used.

What the application does: each user brings their own Strava application (10-user limit not an issue); the dialog shows
the text mark "Powered by Strava" and warns that the Strava terms reserve the display of the data to the user, so a film
made from a Strava activity should not be published without thinking; "Déconnecter Strava" and "Oublier ces
identifiants" erase the tokens and the application from the device. The list of activities is kept in memory only. An
imported activity becomes a track of the project like a GPX file: it stays in the project file the user saves on their
own device. Strictly read, that is longer than the 7-day cache of § 6.2; accepted (decision of 9 October 2026) because the
data is the user's own, kept on their device and shown only to them, as with a GPX file they export from Strava. Revoking the access at Strava (strava.com/settings/apps) is up to the user.

| Source | License | Note |
|---|---|---|
| Mapterhorn, AWS Terrain Tiles | open data (CC BY 4.0, OGL, public domain…) | credit the sources |
| IGN | Licence Ouverte Etalab 2.0 | commercial use allowed |
| swisstopo | open data (OGD) | credit the source, reasonable use |
| basemap.at | CC BY 4.0 (Open Government Data Österreich) | free for private and commercial use; credit "Datenquelle: basemap.at" with `basemap.at` linked to https://basemap.at/ |
| GSI Japan | Public Data License 1.0 (compatible with CC BY 4.0) | credit GSI with a link to the tile list; say so when the tiles are edited; the seamless photo is a compilation (Landsat, GRUS pieces: the GRUS credit is only needed around Okinotorishima, outside the catalogue box) |
| USGS The National Map | public domain (USGS-authored data; the NAIP photos are USDA) | credit "USDA, USGS The National Map"; the 10 m SPOT imagery of Alaska is **viewable only** (its licence forbids downloading it from The National Map) |
| Esri | Esri terms (ArcGIS Online terms of use) | "Powered by Esri" and the data credits are mandatory; **no offline copy** (tiles cannot be harvested outside Esri Content Packages); keyless use in a distributed application is not covered by what Esri publishes: the owner nevertheless made it the **default outside France and Switzerland** on 15 October 2026 (§ Esri) |
| OpenTopoMap | CC BY-SA | volunteer-run server: moderate use; a video made with this base map must stay under the same license |
| Open-Meteo | CC BY 4.0 | free **non-commercial** API, 10,000 requests per day max |
| OpenStreetMap | ODbL | public Overpass server: moderate use |

OpenFlyover is a personal, non-commercial project: all sources can go into an offline pack, with a lower daily limit for those that discourage bulk downloads, except Esri, whose terms forbid it:

| Source | Offline | Why |
|---|---|---|
| Mapterhorn | yes, 20,000 tiles per day | open data; Mapterhorn itself offers area downloads ([data access](https://mapterhorn.com/data-access)) |
| AWS Terrain Tiles | yes | AWS Open Data public archive, made to be downloaded ([registry](https://registry.opendata.aws/terrain-tiles/)) |
| IGN Géoplateforme | yes, 50,000 tiles per day (all layers) | Licence Ouverte Etalab 2.0; public service to be used sparingly |
| swisstopo | yes, personal use, 10,000 tiles / day | its terms ask to avoid automated bulk downloads ([terms](https://www.geo.admin.ch/en/general-terms-of-use-fsdi)): keep the corridor short |
| basemap.at | yes, 20,000 tiles per day | CC BY 4.0; the site offers offline products itself and points to downloaders, the infrastructure is shared: stay reasonable |
| GSI Japan | yes, personal use, 10,000 tiles / day | Public Data License 1.0 allows copying with credit; no rule on bulk downloads is published ([terms](https://www.gsi.go.jp/ENGLISH/page_e30286.html)): keep the corridor short |
| USGS The National Map | yes, personal use, 10,000 tiles / day | public domain for the NAIP photos; the 10 m Alaska imagery is viewable only: avoid packing Alaska |
| Esri World Imagery | **no**: the imagery stays online, the pack holds the terrain only | basemap tiles may only be taken offline with Esri Content Packages and Esri software; systematic harvesting is prohibited ([terms summary](https://downloads2.esri.com/arcgisonline/docs/tou_summary.pdf)) |
| OpenTopoMap | yes, personal use, 2,000 tiles / day | volunteer-run server that asks to avoid bulk downloads ([about](https://opentopomap.org/about)) |

A source whose terms have not been checked stays online. The daily limits
count per device.

To spare these services, the application:

- keeps the last ~600 tiles in memory and requests only those in the view;
- sends **one** weather request per track (up to 12 places along it, all its days), and keeps the days older than a week in
  the browser (the last 7 days and forecasts stay in memory only, forecasts for 3 h at most). One request is not one call
  for Open-Meteo: its quota counts heavier requests as several calls (more than 10 variables, more than 2 weeks), and the
  weight of each extra place is not documented, so count one call per place. The stages of « À la suite » are fetched one
  at a time, and a refusal (HTTP 429) is shown with the quota it names (minute, hour or day) and when to try again;
- sends **one** landmark request per track, kept for 30 days, and retries only once if the server is overloaded;
- downloads an offline pack only once, 4 tiles at a time, and never requests a tile that is already stored;
- sends **two** water requests per track (the lakes and river areas in an 8 km corridor; the coastline in the same corridor and
  the river, canal and stream lines in a 4 km one), in the same queue and the same cache, only if reflective water is checked.

The track itself is never sent. These services receive only an approximate position: the tile area, a few
points rounded to 1 km with their dates for the weather, the rectangle around the track for the landmarks.

Verification date: **2026-10-05** (independent review the same day: extra probes at the borders, § "Border probes");
dated topographic maps and orthophotos added on **2026-10-07** (§ "Old maps and photos"; the dated orthophotos were removed on
**2026-10-15**); basemap.at, GSI and USGS added on **2026-10-15**, as hand-picked sources only (never chosen automatically). Tools: `curl.exe` with the header `Origin: http://127.0.0.1:5173`
(status, `content-type`, `access-control-allow-origin`), reading of image headers (IHDR / SOF / VP8L)
and minimal PNG decoding in Node (zlib) for the Terrarium check, providers' GetCapabilities documents.
`src/terrain/sources.ts` is the only source of truth for the code; this document justifies it.

Reference tiles (XYZ, y = 0 at the north): Chamonix (6.87, 45.92) → z12 = 2126/1458, z15 = 17009/11668,
z17 = 68037/46672, z19 = 272149/186689; Paris (2.35, 48.86) → z12 = 2074/1409, z19 = 265566/180362;
Zermatt (7.75, 46.02) → z12 = 2136/1456, z20 = 546861/372959; New York (−74.0, 40.7) → z12 = 1206/1540.

## Summary table

| id | URL template | Zooms | Tile | Encoding / format | CORS | Coverage | License | Attribution to display |
|---|---|---|---|---|---|---|---|---|
| `mapterhorn` | `https://tiles.mapterhorn.com/{z}/{x}/{y}.webp` | 0–17 (variable: 12 to 17 depending on the region) | **512 px** | Terrarium, lossless WebP (VP8L) | `*` | worldwide | open data (CC BY 4.0, OGL, public domain… 151 sources, `download.mapterhorn.com/attribution.json`); code BSD-3 | `© Mapterhorn` (tiles.json) + link `mapterhorn.com/attribution` |
| `aws-terrarium` | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | 0–15 | 256 px | Terrarium, 8-bit RGB PNG | `*` | worldwide | public sources (USGS 3DEP/SRTM/GMTED2010, NOAA ETOPO1, EU-DEM Copernicus, ArcticDEM, CC BY NZ/AT/NO/AU/UK OGL…) — see `tilezen/joerd/docs/attribution.md` | "Terrain Tiles (Mapzen / AWS Open Data) — SRTM, GMTED2010, ETOPO1 courtesy of USGS/NOAA, EU-DEM © Copernicus, ArcticDEM…" |
| `ign-ortho` | `https://data.geopf.fr/wmts?…LAYER=ORTHOIMAGERY.ORTHOPHOTOS&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg` | 0–19 (`PM_0_19`) | 256 px | JPEG | `*` | Metropolitan France + Corsica (box −5.6/41.2 → 10.0/51.3, **over-approximation**: the border strip inside the box returns a white 200 tile or a 404); z ≤ 12 available everywhere (low-resolution worldwide mosaic) | Etalab Open Licence 2.0 (BD ORTHO), terms of use `cartes.gouv.fr/cgu`, `Fees: none` | `© IGN — Géoplateforme (BD ORTHO)` |
| `swisstopo` | `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg` | 0–20 (`3857_20`) | 256 px | JPEG | `*` | box 5.140242/45.398181 → 11.47757/48.230651 (WGS84BoundingBox from the GetCapabilities); real tiles up to z20 over the whole box, but **much lower resolution outside Switzerland/Liechtenstein** | swisstopo OGD, free of charge, "fair use" (~20,000 users/day) | `© swisstopo` |
| `arcgis-world-imagery` | `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | 0–19 (the service declares 24 LODs, z0–23; above 19, a 200 placeholder is returned where there is no imagery) | 256 px | JPEG | `*` | worldwide | Esri Master Agreement; see § Esri | `Powered by Esri — Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community` (service `copyrightText` field) |
| `basemap-at` | `https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg` | 1–19 (z0 and z20 → 404) | 256 px | JPEG | `*` | Austria (box 9.5–17.2°E, 46.35–49.02°N; the border strips answer too, Italy and France 404) | CC BY 4.0 | `Datenquelle: basemap.at` |
| `gsi-photo` | `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg` | 2–18 (z0, z1, z19 → 404; GSI documents z14–18 as the photo, coarser levels are a mosaic) | 256 px | JPEG | `*` | Japan (404 outside, no blank tile) | Public Data License 1.0 | `Source: GSI Japan (Geospatial Information Authority of Japan), GSI Tiles` |
| `usgs-imagery` | `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}` | 0–16 (z17 → 404) | 256 px | JPEG (PNG at some low levels) | `*` | the States, Alaska (10 m SPOT), Hawaii, Puerto Rico; Canada answers with a near-blank 200 tile | public domain | `USDA, USGS The National Map: Orthoimagery` |
| `ign-plan` | `https://data.geopf.fr/wmts?…LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&…&FORMAT=image/png` | 0–19 (`PM_0_19`) | 256 px | RGB PNG | `*` | France (same box as `ign-ortho`); 404 outside France from z13 | Etalab Open Licence 2.0 | `© IGN — Géoplateforme (Plan IGN)` |
| `swisstopo-carte` | `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg` | 0–19 (`3857_19`) | 256 px | JPEG | `*` | swisstopo box; outside Switzerland + border strip, **white tile** (668 B) from z16 | swisstopo OGD, "fair use" | `© swisstopo` |
| `opentopomap` | `https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png` (`{s}` = a, b, c) | 0–17 (z18: "max zoom layer = 17" image without CORS) | 256 px | palette PNG | `*` | worldwide | ODbL data (OSM) + SRTM, rendering **CC BY-SA**; volunteer-run server, no bulk downloading | `Kartendaten: © OpenStreetMap-Mitwirkende, SRTM \| Kartendarstellung: © OpenTopoMap (CC-BY-SA)` (translated in the UI) |

All sources respond with a CORS header for the origin `http://127.0.0.1:5173`: **no Vite proxy is needed**;
`TILE_PROXIES` stays empty in `vite.config.ts`.

## Details per source

### Mapterhorn (terrain)

- `https://tiles.mapterhorn.com/tiles.json`: `{"scheme":"xyz","tiles":["https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"],"encoding":"terrarium","tileSize":512,"attribution":"<a href='https://mapterhorn.com/attribution'>© Mapterhorn</a>"}`.
  The GitHub README presents it as a drop-in replacement for the AWS Elevation Tiles (same Terrarium encoding).
- File header: `RIFF…WEBPVP8L`, 512 × 512, lossless (essential for a DEM: no compression artifacts).
- Maximum zoom **depends on the region** (best local open source):
  Chamonix 200 up to z17, 404 at z18; New York z16 OK, z17 404; Sahara (10 E, 25 N) and Everest: z12 OK, z13 404 (Copernicus 30 m).
  The catalog declares `maxZoom: 17`; a 404 at z ≥ 13 means "no finer data here".
- Licenses: 151 sources listed in `attribution.json` (e.g. BEV Austria CC BY 4.0, Latvia CC BY 4.0, Taiwan OGDL 1.0…). Code BSD-3.
- Results: z12 200 `image/webp` 158,396 B, ACAO `*`, `cache-control: public, max-age=604800`; z13–17 200; z18 404 `text/plain`.

### AWS Terrain Tiles / Tilezen (terrain)

- Public bucket `elevation-tiles-prod` (us-east-1), prefix `terrarium/`. 8-bit RGB PNG 256 × 256 (`colorType 2`), z0–15; z16 → S3 XML 404.
- Check of the Terrarium encoding `h = R·256 + G + B/256 − 32768` with a minimal PNG decoder (inflate + unfilter):
  tile z12 2126/1458, center pixel RGB (135,137,134) → **1929.5 m** (min 1022 m, max 3555 m on the tile: Chamonix valley → Aiguilles);
  tile z15 17009/11668, center pixel → **1046.3 m** (Chamonix center ≈ 1035 m). Consistent.
- CORS: `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET`.
- Attribution: the registry.opendata.aws page asks for the citation "Terrain Tiles was accessed on DATE from https://registry.opendata.aws/terrain-tiles";
  the per-source credits (USGS, NOAA, Copernicus, LINZ CC BY 3.0 NZ, Kartverket CC BY 4.0, Environment Agency OGL v3, BEV CC BY 3.0 AT, Geoscience Australia CC BY 4.0, INEGI, NRCan) are in `tilezen/joerd/docs/attribution.md`.

### IGN BD ORTHO — Géoplateforme (imagery)

- GetCapabilities (`https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&VERSION=1.0.0`, 2.9 MB): layer `ORTHOIMAGERY.ORTHOPHOTOS`,
  title "Photographies aériennes" (aerial photographs), `Format image/jpeg`, `TileMatrixSetLink PM_0_19` with `TileMatrixLimits` from 0 to **19** (z19: rows 58856–465431, columns 0–524287).
  The `PM` TileMatrixSet itself goes up to 21 (`TileWidth 256`), but the layer stops at 19.
- Chamonix results: z12–z19 200 `image/jpeg`; z20 and z21 → 404 `text/xml`. Paris z12 and z19 200.
- Coverage: New York z12 200 (worldwide mosaic), z13/14/15/16 → 404; Zermatt z12 200, z13–19 → 404. Hence the metropolitan France `coverage` box;
  the overseas territories (DROM-COM; layer bbox −180/−80 → 180/80) are not included in the catalog's single box.
- **Border strip (review)**: inside the box but outside France, the server does not always answer 404: Courmayeur, Champex,
  Geneva and Basel receive at z13–z17 an **HTTP 200 `image/jpeg` of 1,651 B, entirely white** (md5 `cb33c7de`, identical everywhere),
  then 404 from z17–z19; Zermatt, Milan and Lugano receive 404 from z13. Basel still has a real tile at z13 (9,873 B) but white from z14 to z17.
  `imagery.ts` used to draw this white tile as a real one (white areas outside France, flipping to the z12 mosaic's colours
  and back with the level of detail in an export); it now recognises a plain white sub-tile of a source with a `coverage` and
  draws the coarser tile's picture instead (`isBlank`). Real tiles are still the better choice where they exist: swisstopo for a
  cross-border track. The French border tiles (Annecy, Menton, Mulhouse, Ouessant, Dunkerque, Bastia, Bonifacio) are real.
- CORS: `access-control-allow-origin: *` (+ `allow-credentials: true`). `Fees: none`, `AccessConstraints` → terms of use `https://cartes.gouv.fr/cgu`.
  BD ORTHO is distributed under the Etalab Open Licence 2.0 (IGN data open since 2021); credit "© IGN".

### swisstopo SWISSIMAGE (imagery)

- GetCapabilities EPSG:3857 (`https://wmts.geo.admin.ch/EPSG/3857/1.0.0/WMTSCapabilities.xml`): layer `ch.swisstopo.swissimage`,
  `Format image/jpeg`, `TileMatrixSet 3857_20`, dimension `Time = current`,
  `ResourceURL …/default/{Time}/3857/{TileMatrix}/{TileCol}/{TileRow}.jpeg` (so `{z}/{x}/{y}`),
  `WGS84BoundingBox 5.140242 45.398181 → 11.47757 48.230651`.
- Zermatt results: z12/14/16/18/19/**20** 200 `image/jpeg`; z21 → 400 JSON `Unsupported zoom level 21`.
  Chamonix z12 and z16 → 200 (inside the box, imagery present); Paris z12 → 400 JSON `Tile out of bounds`.
- Docs (`docs.geo.admin.ch`, WMTS): 256 px tiles, 3857 from z0 to 28, but only a few layers go beyond 20.
- **Outside Switzerland (review)**: the whole box returns real, distinct tiles (different md5) from z15 to z20 — Annecy, Chamonix, Courmayeur,
  Geneva, Besançon, Mulhouse, Milan, Como, Innsbruck, Bregenz, Vaduz. But outside Switzerland/Liechtenstein it is an
  upsampled mosaic, visibly blurrier (Annecy z16: swisstopo 20,568 B blurry vs IGN 21,496 B sharp; z20 sizes ≈ 3.4–5 kB outside Switzerland
  vs 11.9 kB at Zermatt). swisstopo is therefore a good **fallback** source for a cross-border track (full Tour du Mont-Blanc,
  Courmayeur and Champex included), not a detail source in France.
- Terms (`geo.admin.ch/en/general-terms-of-use-fsdi`): "The acquisition and use of data or services is free of charge, subject to the provisions on fair use";
  source credit mandatory ("© Data: swisstopo" in the viewer); mass use (bots) prohibited; ~20,000 users/day is considered fair use.
- CORS: `access-control-allow-origin: *`.

### Esri World Imagery (imagery)

- `MapServer?f=pjson`: `tileInfo` 256 × 256 JPEG, 24 LODs (z0–23), `copyrightText: "Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community"`.
- Segment order: `tile/{z}/{y}/{x}` (row before column).
- Chamonix results: z12–z19 200 with normal sizes (11–19 kB); **z20 and z21 → 200 but 2,521 B, identical md5** ("no data" placeholder).
  Zermatt z20 → real tile (10,851 B); Paris z20 → the same placeholder. New York z16 200.
  Since the server does not return 404 beyond the data, the catalog sets `maxZoom: 19` (available everywhere);
  the "crop the deepest tile" strategy in `imagery.ts` cannot detect this placeholder.
- CORS: `Access-Control-Allow-Origin: *`.
- Terms (read 2026-10-09; the full terms, `esri.com/en-us/legal/terms/full-master-agreement` and the product terms E300, could not be
  read in full, the points below come from the [terms summary](https://downloads2.esri.com/arcgisonline/docs/tou_summary.pdf), the
  [attribution guide](https://developers.arcgis.com/documentation/mapping-apis-and-services/deployment/basemap-attribution/) and
  Esri's developer licensing pages):
  - attribution is mandatory: "Powered by Esri" and the names of the data providers (the service `copyrightText`, which says
    "Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community"), always visible with the map. The status bar,
    the film credits and the poster show both (`attribution` in `sources.ts`).
  - offline: basemap tiles may only be taken offline with Esri Content Packages, for Esri software; systematic harvesting
    and redistribution are prohibited. Hence Esri is **refused in offline packs** (`policy.ts`); temporary caching while
    online (the in-memory tile cache) is fine.
  - keyless use: `services.arcgisonline.com` still answers without a key (checked 2026-10-09), but Esri's current documentation
    sends applications to an ArcGIS Location Platform account and token (`ibasemaps-api.arcgis.com`), and nothing published
    says that anonymous use of the legacy host is granted to a distributed application. Decision (9 October 2026): Esri stays
    an optional source the user picks. Revised on 15 October 2026 (the owner's decision): Esri World Imagery is the default imagery
    outside France and Switzerland (EOX Sentinel-2 cloudless was removed), replaced by IGN or swisstopo when the track lies in
    France or Switzerland; the licence caveat above (keyless use of the legacy host not granted) stays.

### basemap.at, GSI Japan and USGS (imagery, added 2026-10-15)

- **basemap.at**: layer `bmaporthofoto30cm`, WMTS REST `…/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg`. Terms read on
  https://basemap.at/ (15 October 2026): "Open Government Data Österreich Lizenz CC-BY 4.0", free for private and commercial use;
  attribution "Datenquelle: basemap.at" (or "Grundkarte: basemap.at"), the name linked to https://basemap.at/. Third-party apps are welcome,
  no quota or cache rule is published; the site offers offline products and downloaders and notes that the infrastructure is shared.
  Chamonix and Cortina: 404; Zugspitze (Bavaria): 200, the border strips are served.
- **GSI Japan**: tile list https://maps.gsi.go.jp/development/ichiran.html, layer `seamlessphoto` (全国最新写真（シームレス）), classified
  "usable with attribution only". Content terms (https://www.gsi.go.jp/ENGLISH/page_e30286.html): Public Data License 1.0; credit
  「国土地理院」 or 「地理院タイル」 with a link to the tile list, English example "Source: GSI website (URL)"; say so when the content is edited.
  The catalogue shows the English form (the Japanese characters would need a font in the films). The GRUS images (© Axelspace) of
  Okinotorishima (20°24′–20°27′N, 136°04′–136°08′E) need an extra credit: outside the catalogue box (south 24°N). No rule on bulk
  downloads is published, hence "personal use" in offline packs. Tiles z2–z18; 404 outside Japan (Chamonix, Seoul).
- **USGS Imagery Only** (The National Map): ArcGIS cache `USGSImageryOnly`, EPSG:3857, 24 levels advertised; NAIP 1 m (2017–2021) over the
  conterminous States, Blue Marble and Landsat at small scales, 10 m SPOT in Alaska, copyright text "USDA, USGS The National Map: Orthoimagery".
  Public domain ([USGS policy](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits): credit "U.S. Geological Survey"); the 10 m
  Alaska imagery is viewable only. Real tiles stop at z16 (z17 and above → 404). Canada (Banff z12): a 2.4 kB near-blank 200 tile.

### EOX Sentinel-2 cloudless (removed)

Removed from the catalogue on 15 October 2026 (the images were judged not good-looking enough; CC BY-NC-SA 4.0 and no offline
alternative worldwide were further drawbacks). A saved project that used it opens with Esri World Imagery.

## Request log (2026-10-05, Origin http://127.0.0.1:5173)

| Source | Tile | Status | content-type | Size | ACAO |
|---|---|---|---|---|---|
| mapterhorn | 12/2126/1458 | 200 | image/webp | 158,396 (512×512 VP8L) | `*` |
| mapterhorn | 13…17 Chamonix | 200 | image/webp | 156,556 … 79,328 | `*` |
| mapterhorn | 18/136074/93344 | 404 | text/plain | 14 | — |
| mapterhorn | NYC z16 / z17 | 200 / 404 | | | |
| mapterhorn | Sahara z12 / z13, Everest z12 / z13 | 200 / 404 | | | |
| aws-terrarium | 12/2126/1458 | 200 | image/png | 137,461 (256×256) | `*` |
| aws-terrarium | 14, 15 Chamonix | 200 | image/png | 105,948, 84,538 | `*` |
| aws-terrarium | 16/34018/23336 | 404 | application/xml | 319 | — |
| ign-ortho | 12/2126/1458 | 200 | image/jpeg | 18,072 (256×256) | `*` |
| ign-ortho | 14…19 Chamonix | 200 | image/jpeg | 18,093 … 11,007 | `*` |
| ign-ortho | 20, 21 Chamonix | 404 | text/xml | 137 | — |
| ign-ortho | Paris z12 / z19 | 200 / 200 | image/jpeg | 27,869 / 12,256 | `*` |
| ign-ortho | NYC z12 / z13–16 | 200 / 404 | | | |
| ign-ortho | Zermatt z12 / z16 | 200 / 404 | | | |
| swisstopo | 12/2136/1456 (Zermatt) | 200 | image/jpeg | 25,216 (256×256) | `*` |
| swisstopo | 12/2136/1457 | 200 | image/jpeg | 23,184 | `*` |
| swisstopo | Zermatt z14/16/18/19/20 | 200 | image/jpeg | 31,321 … 11,857 | `*` |
| swisstopo | Zermatt z21 | 400 | application/json | 93 | — |
| swisstopo | Chamonix z12 / z16 | 200 / 200 | image/jpeg | 24,364 / 24,958 | `*` |
| swisstopo | Paris z12 | 400 | application/json | 83 | — |
| arcgis-world-imagery | 12/1458/2126 | 200 | image/jpeg | 17,642 (256×256) | `*` |
| arcgis-world-imagery | 14…19 Chamonix | 200 | image/jpeg | 16,566 … 11,507 | `*` |
| arcgis-world-imagery | 20, 21 Chamonix | 200 | image/jpeg | 2,521 (identical placeholder) | `*` |
| arcgis-world-imagery | Zermatt z20 / Paris z20 | 200 / 200 | image/jpeg | 10,851 / 2,521 (placeholder) | |
| arcgis-world-imagery | Paris z19 / NYC z16 | 200 / 200 | image/jpeg | 16,632 / 8,215 | |
| basemap-at | Grossglockner z0 / 1 / 2 / 5 / 8 / 12 / 17 / 19 / 20 | 404 / 200 ×7 / 404 | image/jpeg | 2,472 / 2,602 / 5,959 / 20,185 / 14,865 / 16,499 / 16,092 | `*` |
| basemap-at | Zugspitze z12 / 14 / 16; Cortina z14 / 16; Chamonix z12 / 14 | 200 ×3; 404 ×2; 404 ×2 | image/jpeg | 12,530 / 17,253 / 12,612 | `*` |
| gsi-photo | Fuji z0 / 1 / 2 / 5 / 10 / 13 / 14 / 18 / 19 | 404 ×2 / 200 ×6 / 404 | image/jpeg | 45,183 / 93,812 / 88,583 / 67,620 / 12,832 / 20,596 | `*` |
| gsi-photo | Chamonix z12 / 14 / 16; Seoul z14 / 16 | 404 ×5 | | | |
| usgs-imagery | Yosemite z0 / 2 / 5 / 8 / 12 / 16 / 17 / 18 / 19 | 200 ×6 / 404 ×3 | image/jpeg | 24,379 / 17,799 / 23,959 / 20,313 / 23,455 / 21,885 | `*` |
| usgs-imagery | Banff z12 / 14 / 16; Chamonix z12 / 14; Denali z10 / 13 / 15; Maui z10 / 14 / 16 | 200 / 404 ×2; 404 ×2; 404 / 200 ×2; 200 ×3 | image/jpeg (PNG at Maui z10) | 2,419; 4,381 / 8,955; 95,249 / 11,570 / 13,562 | `*` |

### Border probes (review, 2026-10-05, z15 unless stated)

| Place (lon, lat) | ign-ortho | swisstopo |
|---|---|---|
| Chamonix (6.87, 45.92) | 200, 18,569 B (real) | 200, 24,244 B |
| Courmayeur IT (6.97, 45.79) | 200, **1,651 B white** (z13–z15); 404 at z17, z19 | 200, 26,564 B |
| Champex CH (7.10, 46.03) | 200, 1,651 B white | 200, 29,869 B |
| Zermatt CH (7.75, 46.02) | 404 (z13–z19) | 200, 32,979 B; z20 11,857 B |
| Geneva CH (6.14, 46.20) | 200, 1,651 B white (z13–z15); 404 at z17 | 200, 30,374 B |
| Basel CH (7.59, 47.56) | z13 200 9,873 B (real); z14–z17 1,651 B white; z19 404 | 200, 31,186 B |
| Annecy FR (6.13, 45.90) | 200, 23,770 B (real) | 200, 28,413 B (blurry); z20 3,388 B |
| Besançon FR (6.02, 47.24) | 200, 21,281 B | 200, 29,507 B |
| Mulhouse FR (7.34, 47.75) | 200, 23,806 B | 200, 34,601 B |
| Milan IT (9.19, 45.46) | 404 | 200, 29,199 B; z20 3,843 B |
| Lugano CH (8.95, 46.00) | 404 | 200, 25,747 B |
| Innsbruck AT (11.39, 47.27) | — (outside the box) | 200, 35,788 B; z20 5,056 B |
| Bregenz AT / Vaduz LI / Como IT | — | 200 (24–31 kB) |
| Menton, Bastia, Bonifacio, Ouessant, Dunkerque (FR) | 200, 12–23 kB (real) | — |

## Old maps and photos (2026-10-07)

Same protocol (`curl` with `Origin: http://127.0.0.1:5173`, reading of PNG/JPEG headers, Pillow for transparent or white pixels),
Géoplateforme GetCapabilities (`https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&VERSION=1.0.0`) and swisstopo GetCapabilities (EPSG:3857).
Second control region: Paris (IGN), Zermatt and Bern (swisstopo), New York (OpenTopoMap, Plan IGN). Coverage sampling:
grid of 56 points (7 longitudes −1.5 → 7.0 × 8 latitudes 43.3 → 50.3) at z14.

### IGN — dated orthophotos (removed)

The three historical vintages (`ign-ortho-1950-1965`, `ign-ortho-1965-1980`, `ign-ortho-2000-2005`) were removed from the catalogue on
15 October 2026. A saved project that used one opens with IGN BD ORTHO (`ign-ortho`).

### « Date des photos » (2026-10-21)

Not sources of their own: a setting of `ign-ortho` and `arcgis-world-imagery` (`src/terrain/imageryDates.ts`).

- **IGN, one layer per year** `ORTHOIMAGERY.ORTHOPHOTOS2000` … `ORTHOPHOTOS2024` (GetCapabilities). Each holds only the departments
  flown that year: elsewhere a plain white JPEG of 1,651 B at every zoom (z10–z13 checked at Chamonix for 2022). Chamonix z13: 2020 and
  2023 real (14 kB), 2019, 2021, 2022, 2024 white. Same terms as BD ORTHO (Licence Ouverte). The multi-year mosaics
  (`ORTHOPHOTOS2016-2020`, `2021-2023`) were not used: one year is what tells the season.
- **IGN, day of each flight**: WFS `https://data.geopf.fr/wfs/ows` (CORS `*`), `GetFeature` on the mosaic graphs
  `ORTHOIMAGERY.ORTHOPHOTOS.GRAPHE.<2000-2005|2006-2010|2011-2015|2016-2020|2021-2023>:graphe_bdortho` and
  `ORTHOIMAGERY.ORTHOPHOTOS.GRAPHE-MOSAIQUAGE:graphe_bdortho` (the latest photos), `BBOX=<lon−,lat−,lon+,lat+>,EPSG:4326`
  (lon first with this CRS code), `OUTPUTFORMAT=application/json`: properties `dep`, `pva` (year), `date_vol`. Pic de l'Homme
  (Ariège): latest 2025-07-09/10, then 2022-07-02, 2019-08-16, 2013-08-21, 2008-07-15/22, 2003-01-01 (= year only). Better than
  probing a tile per year: exact at the place, 6 requests, and the season. Where a year did not fly, its layer answers a white
  tile or a 404 (2023 at the pic de l'Homme z13).
- **Esri World Imagery Wayback**: releases listed by `https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json`
  (197 releases, 2014-02-20 → 2026-09-24; CORS `*`). Tiles `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/<release>/{z}/{y}/{x}`
  (301 to the release that holds the tile, CORS `*`). The tilemap `…/World_Imagery/MapServer/tilemap/<release>/<z>/<y>/<x>` answers
  `{"data":[1],"select":[<release>]}` (116 B, `max-age=86400`): walking back from the newest release costs one request per version that
  differs there (22 at Chamonix z15, 19 at the pic de l'Homme). The day the photo was taken: `metadataLayerUrl` of the release, layer 6
  (« 1.2m Resolution Metadata »), `query?geometry=<lon>,<lat>…&outFields=SRC_DATE2` (Chamonix, release of 2023-08-10: 4 August 2019, Maxar
  WV02, 0.5 m). Same attribution as World Imagery. Never in offline packs (Esri refused).

### Plan IGN v2

- Layer `GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2`, "Plan IGN", style `normal`, `Format image/png`, `PM_0_19` (z19 limits: rows 858–523429).
  `IGNF_PLAN-IGN` metadata: "Licence Ouverte / Open License".
- Chamonix z0/z5/z12/z15/z17/z18/z19 200 (RGB PNG 22–100 kB), z20 404; Paris z12/z19 200. Zermatt z12 200, then 404 from z13 to z17;
  Courmayeur z13/z15 200 (border margin), z17 404; New York 404 from z10. z14 grid: 48/56. → France `coverage` box.
- The **SCAN 25 / TOPO 1:25,000** map is not public: `GEOGRAPHICALGRIDSYSTEMS.MAPS` → 400 "Layer unknown" on `/wmts`,
  401 on `/private/wmts` (key required) — **excluded**.

### swisstopo — national map

- Layer `ch.swisstopo.pixelkarte-farbe` "Landeskarten (farbig)" (national maps, color), `image/jpeg`, `3857_19`, `Time = current`, same `WGS84BoundingBox` as SWISSIMAGE.
- Zermatt z6/z12/z15/z17/z18/z19 200 (13–40 kB), z20 → 400 JSON; Bern z12/z19 200; Paris z12 → 400 "Tile out of bounds".
- Chamonix: z12 and z15 = real map (the Swiss map spills over onto the Chamonix valley), **z17 and z19 = white JPEG of 668 B** (z16 too).
  Good source for Switzerland, not for France beyond z15.
- Same terms as SWISSIMAGE (OGD, free of charge, fair use, credit "© swisstopo").

### OpenTopoMap

- `https://{a|b|c}.tile.opentopomap.org/{z}/{x}/{y}.png` (path given on `opentopomap.org/about`). The three subdomains return the same tile (identical md5).
- Chamonix z0/z3/z12/z15/z17 200 (palette PNG 21–51 kB); **z18 → 200 with a "max zoom layer = 17" image (4,343 B) without a CORS header**:
  the catalog stops at 17. New York z12/z17 200. CORS `*`, `cache-control: max-age=604800`.
- Terms (`opentopomap.org/about`, "Verwendung" (usage) section and FAQ): map under **CC-BY-SA**, "kostenlos und frei verwendet" (used free of charge and freely) with the attribution
  "Kartendaten: © OpenStreetMap-Mitwirkende, SRTM | Kartendarstellung: © OpenTopoMap (CC-BY-SA)"; embedding in a website or an application
  "jederzeit gerne möglich, sofern unser Server z.B. durch Massendownloads nicht zu stark beansprucht wird" (welcome at any time, as long as our server is not overloaded, e.g. by mass downloads), with no availability guarantee;
  since 2026-01-05 the rendering runs on a smaller vServer. → **kept for interactive use**, but to be **excluded from future offline packs**
  and from bulk video renders (pre-downloading a whole track at z17).

### Sources examined and not kept

| Source | Finding (2026-10-07) | Reason |
|---|---|---|
| Stadia Maps (Stamen Watercolor, Stamen Terrain) | `tiles.stadiamaps.com/tiles/stamen_watercolor/…`: 200 with `Origin: http://127.0.0.1:5173` (Stadia's "localhost" tolerance), **401** without an Origin header | account / API key required outside local development: **excluded** ("no key, no sign-up" rule) |
| Thunderforest (Landscape, Outdoors) | 200 but tile crossed out "API Key Required" | key required: **excluded** |
| IGN SCAN 25 / TOPO 1:25,000 (`GEOGRAPHICALGRIDSYSTEMS.MAPS`) | 400 "Layer unknown" (public), 401 (`/private/wmts`) | key required: **excluded** |
| IGN photos 1980–1995 | 404 at Chamonix and Paris, 6/56 on the z14 grid | coverage too patchy for now |
| swisstopo SWISSIMAGE HIST 1946 (`ch.swisstopo.swissimage-product_1946`) | JPEG `3857_17`, Zermatt / Bern z8–z17 200, z18 400; Chamonix: white JPEG of 668 B | works without a key; not added to keep the diff small (Swiss equivalent of "photos 1950–1965", to add if needed) |

### Request log (2026-10-07, Origin http://127.0.0.1:5173)

| Source | Tile | Status | content-type | Size | ACAO |
|---|---|---|---|---|---|
| ign-plan | Chamonix z0 / 12 / 15 / 18 / 19 / 20 | 200 ×5 / 404 | image/png (RGB) | 37,484 / 100,548 / 60,738 / 22,500 / 27,705 / — | `*` |
| ign-plan | Paris z12 / z19; Zermatt z12 / z13; NYC z10 | 200 / 200; 200 / 404; 404 | | 48,210 / 26,923; 48,371 | `*` |
| swisstopo-carte | Zermatt z12 / 15 / 17 / 19 / 20 | 200 ×4 / 400 | image/jpeg | 26,508 / 39,613 / 32,720 / 12,969 / 93 (JSON) | `*` |
| swisstopo-carte | Bern z19; Chamonix z15 / z17 / z19; Paris z12 | 200; 200 / 200 white / 200 white; 400 | image/jpeg | 5,275; 35,915 / 668 / 668; 83 | `*` |
| opentopomap | Chamonix z12 (a, b, c) / z15 / z17 | 200 | image/png (palette) | 51,067 / 34,605 / 21,265 | `*` |
| opentopomap | Chamonix z18 | 200 | image/png (RGBA) | 4,343 "max zoom layer = 17" | **missing** |
| opentopomap | NYC z12 / z17 | 200 | image/png | 49,182 / 5,617 | `*` |

Visual check (headless Chromium, sample track Les Houches → Les Contamines): `ign-plan`, `swisstopo-carte` and `opentopomap` display draped over the terrain, with the correct attribution in the status bar.

## Integration notes

1. **Mapterhorn 404 = leaf**: the real max zoom varies from 12 to 17 depending on the region. The engine must treat a 404 on a DEM tile
   as "no refinement possible" (keep the parent displayed), not as an error to retry or a blocking "failed" tile.
2. **Esri placeholder**: beyond z19, Esri returns 200 with a "no data" image; do not exceed the catalog `maxZoom`.
3. **Removed sources**: EOX Sentinel-2 cloudless (CC BY-NC-SA 4.0) and the dated IGN photos were removed on 15 October 2026.
4. **Esri**: never in an offline pack; credit "Powered by Esri" + data credits everywhere the credits are shown; the default outside France and Switzerland since 15 October 2026 (§ Esri).
5. **swisstopo**: the coverage box includes a wide strip outside Switzerland where tiles exist up to z20 but are much blurrier;
   at Chamonix the imagery exists but is less detailed than BD ORTHO.
6. **IGN outside metropolitan France**: the overseas territories (DROM-COM) are not covered by the single `coverage` box; multi-box coverage would require a change to `TileSourceBase` (frozen types).
7. **The IGN box over-approximates France**: `sourceCovers(ign, …)` returns `true` for Courmayeur, Champex, Geneva, Basel or Zermatt, whereas
   the server returns a white tile (200) or a 404 there. Consequence for `store.ts` (`pickRegionalImagery`, which prefers IGN as soon as the track
   is inside its box): a cross-border track (full Tour du Mont-Blanc, Genevois, Swiss Jura, Basel) was rendered with white areas; the white
   tile is now replaced by the coarser z12 picture (blurry, not white) in `imagery.ts`, a 404 is still a gray patch.
   Recommendation: when the track is inside the IGN box **and** inside the swisstopo box, prefer swisstopo (real tiles everywhere, less detailed)
   or Esri (uniform) over IGN, unless the track is entirely west of ~5.9° E or north of ~47.6° N (so surely in France);
   or let the user switch manually.
8. `sourceCovers(source, bounds | point)` (exported from `sources.ts`) lets the UI propose by default the most detailed imagery source
   that fully covers the track; `true` means "worth trying", `false` "pointless".
9. **Maps are never chosen automatically**: `AUTO_IMAGERY_IDS` in `store.ts` lists only `ign-ortho` and `swisstopo`;
   the maps share their coverage boxes, so this list must not be replaced by "any source with `coverage`".
10. **`minZoom` > 0** (no source has one since the dated orthophotos were removed; `imagery.ts` still handles it): coarser terrain tiles stay gray (documented behavior of `imagery.ts`), invisible in practice during a flyover.
11. **OpenTopoMap**: volunteer-run server; no bulk downloading. Offline packs allow it for personal use only, with a warning and a cap of 2,000 tiles per day (`src/offline/policy.ts`).
12. **CC BY-SA (OpenTopoMap)**: a video exported with this basemap must carry the attribution and may be considered an adaptation (share-alike): to be flagged at export.

## Historical weather — Open-Meteo (2026-10-07)

ERA5 archive / reanalyzed regional models, without a key: `https://archive-api.open-meteo.com/v1/archive`. Data
license **CC BY 4.0**, API free for **non-commercial** use (stated limits: ≤ 10,000 requests/day, 5,000/h, 600/min;
no quota header returned). Displayed attribution: "Données météo : Open-Meteo.com (CC BY 4.0)" (weather data). Code: `src/weather/openMeteo.ts`.

| Item checked | Result |
|---|---|
| CORS (Origin `http://127.0.0.1:5173`) | `access-control-allow-origin: *`, GET/POST/OPTIONS, `max-age` 600 |
| Hourly variables | `temperature_2m`, `apparent_temperature`, `precipitation`, `rain`, `snowfall` (cm), `cloud_cover` (+ `_low`/`_mid`/`_high`), `wind_speed_10m`, `wind_direction_10m`, `wind_gusts_10m`, `weather_code`, `is_day`: all filled in |
| `visibility` | accepted but **always `null`** in the archive (unit "undefined"); available only on the forecast API (`api.open-meteo.com/v1/forecast`, `past_days` ≤ 92, no key, CORS `*`), not used |
| Time zone | `timezone=GMT` → UTC hours; `timeformat=unixtime` gives Unix seconds (start of each hour) |
| Range | `start_date` from **1940-01-01** to **today** inclusive (error 400 `{"error":true,"reason":"Parameter 'start_date' is out of allowed range from 1940-01-01 to <today>"}` beyond); the last days are complete (replayed forecasts, revised a few days later: they are only cached persistently after 7 days). 1940: `precipitation`, `wind_gusts_10m`, `weather_code` null for the first 7 hours |
| Several places | `latitude=a,b&longitude=c,d` → JSON array (bare object for a single place); `elevation=e1,e2` accepted per place |
| Grid | ~0.07° in latitude (45.73 / 45.80 / 45.87 / 45.94 / 46.01) and ~0.1–0.14° in longitude in the Alps (≈ 9 km): two points less than ~5 km apart often fall in the same cell |
| Altitude | the `elevation` parameter adjusts the temperature to the requested altitude: at 45.85° N 6.78° E, 12.5 °C without the parameter (cell at 2,316 m) vs 22.8 °C at 1,000 m and 10.6 °C at 2,500 m → we pass the recorded altitude of the track |
| Reversed dates | 400 `{"reason":"Bad Request"}` |
| `snow_depth` (2026-10-22) | accepted by the archive **and** the forecast, hourly, unit `"m"` (metres of snow on the ground), numbers with 2 decimals, `0.00` when there is none; added to the hourly list of the same request (no extra request). Archive `latitude=45.92&longitude=6.87&start_date=end_date=2024-02-10&hourly=temperature_2m,snow_depth,snowfall&elevation=3000` → 2.23 m, −9 °C; the same day with `elevation=1000` → 1.88 m (another cell: 46.01 / 6.71, the grid cell is chosen near the requested elevation); `2024-07-10` at 3,000 m → 0.00 all day; `2024-01-20`, 47.2 N 2.4 E, `elevation=150` → 0.00. Forecast (`api.open-meteo.com/v1/forecast`, `forecast_days=1`, `elevation=2000`, 2026-10-22) → 0.06 m, −2.7 to +2.2 °C. Sample track (Pyrenees) shifted to 2024-02-10: stations at 1,390 m (0.02 m, +1 °C at 12 h) and 2,270 m (0.04 m, −5.7 °C) |
| `elevation` in the answer | each place of the answer carries `elevation` (the requested one, `3000.0`; without the parameter, the cell's own: 1,034 m at 45.92 / 6.87). The app uses the elevation it requested (`WeatherStation.ele`) for the snow line; a track without altitude requests none and gets no snow |
| Quota weight | 14 hourly variables now (13 before): the request is still one per track, but a request of more than 10 variables already counted as several calls, and the 14th adds a little to that |
| Size | ~2.5 kB gzip per place and per day for the 14 variables |

Log (curl, 2026-10-07): `start_date=end_date=2025-07-12`, 2 places (45.89/6.80 and 45.83/6.73) → 200, cells 45.940/6.704 (1,021 m) and
45.870/6.693 (1,109 m); `2026-10-07` (same day) → 24 complete hours; `2026-10-10` → 400 out of range; `1939-12-31` → 400 out of range.

**Forecast** (planned outing, 2026-10-08): `https://api.open-meteo.com/v1/forecast`, without a key, same terms (CC BY 4.0,
non-commercial). Same parameters as the archive (`start_date` / `end_date`, several places, `elevation`, `timezone=GMT`,
`timeformat=unixtime`), same 13 hourly variables and same response shape (24 hours per day from 0:00 UTC). Range: from
92 days back to today + 15 days (on 8 October: `2026-10-23` → 200, `2026-10-24` → 400 "out of allowed range from
2026-07-07 to 2026-10-23"). Kept 3 h at most, in memory only (the forecast changes several times a day).

## OpenStreetMap landmarks — Overpass API (2026-10-07)

Peaks, passes, huts, lakes, waterfalls, populated places, viewpoints, glaciers and water points (drinking water, named springs;
not measured separately, added after the log below) around the track, read from OpenStreetMap through
the public Overpass instance `https://overpass-api.de/api/interpreter` (no key), with fallback to `https://maps.mail.ru/osm/tools/overpass/api/interpreter`
(VK Maps, listed on the OSM wiki with no stated limit). **ODbL** data: displayed attribution "© contributeurs OpenStreetMap (ODbL)" (© OpenStreetMap contributors)
(panel and status bar, link to openstreetmap.org/copyright). Code: `src/osm/overpass.ts`.

**Terms of use of the public instance** (dev.overpass-api.de, "Commons"): stay under ~10,000 requests and ~1 GB per day and per
address; the wiki recommends a hundred times less for a consumer application (≤ 100 requests, ≤ 10 MB per day and per user).
Rate limiting per IP: `/api/status` announces "Rate limit: 2" (two concurrent slots), **429** refusal when they are taken, **504** when the
server is overloaded (HTML body "Dispatcher_Client::request_read_and_idx::timeout / rate_limited"). Patterns considered abusive: repeated
identical requests, sweeping boxes to scrape the planet, a production application using it as its backbone. Hence, here: **a single
request per track** (all types, 3 km corridor), sent alone (queue), cached 30 days in `localStorage` by
request fingerprint, a single retry after `Retry-After` (otherwise 15 s) on 429 / 504, then the other instance; changing the types or the
distance does not send a new request (local filtering).

| Item checked | Result |
|---|---|
| CORS (Origin `http://127.0.0.1:5173`) | `Access-Control-Allow-Origin: *`, `Access-Control-Max-Age: 600` on POST responses; the **OPTIONS preflight answers 406** → "simple" request mandatory (body `application/x-www-form-urlencoded`, field `data`), which is what `URLSearchParams` does |
| User-Agent | 406 "Not Acceptable" for a `curl` imitating a browser and for `/api/status` without an explicit agent; requests from a real (headless) Chromium go through (200) |
| `around:` form on a polyline | 4 vertices, 1.5 km, 5 types → 200 in 2.9 s (14 kB); **50 vertices, 3.1 km, 8 types → HTTP 200 but `remark` "Query timed out … after 80 seconds" and zero elements** (the `[timeout:60]` limit is exceeded on the server side; so a 200 response can be an error) |
| Bounding box form (kept) | a 12 × 15 km box around the sample track, 8 types, `out center tags qt` → 200 in 2.5 to 5.7 s, 44 kB, 175 elements (30 peaks, 14 passes, 14 huts, 8 lakes, 19 glaciers, 2 waterfalls, 3 viewpoints, 84 places) |
| Union of 10 boxes along the track | 200 in 14 s, 33 kB, 134 elements: slower than the single box (80 statements); used only beyond a 40 km extent (`MAX_BOX_SPAN_M`) |
| After these back-to-back tests | the next two requests → **429** (slots taken); `/api/status` details them |
| `maps.mail.ru` | same response (14 kB) in 10 to 14 s from `curl`, full CORS headers (`*`, `GET, POST, OPTIONS, PUT`); 504 once from the browser |
| `overpass.kumi.systems`, `overpass.private.coffee`, `overpass.osm.jp` | unreachable from this network (60 s timeout / connection refused): not kept |
| Useful tags | `ele` as free text ("1650", "1969.1"; elsewhere "1 653 m", "1,653", feet) → `parseEle`; `name:fr` rare in France (fallback `name`); unnamed peaks (e.g. 2,303 m) → `["name"]` filter in the request; lakes as ways / relations → `out center`; the Col de Voza has `natural=saddle` + `mountain_pass=yes`, `ele=1650` (1,653 m in the sample GPX); 81 hamlets within 3 km of 20 km of track → places disabled by default |

**Water bodies (2026-10-08)**: a second request per track, only if "Lacs et rivières reflétants" (reflective lakes and rivers) is checked:
`way` / `relation` (multipolygons) `natural=water`, `waterway=riverbank`, `water=*` in the track corridor widened to
**8 km**, `out geom qt` (full geometry). Same queue, same 30-day cache (for the reduced result: polygons simplified to
4 m, at most 300, coordinates to 1e-6°), same retry policy. Measurement (curl, box 45.81–45.98 N × 6.66–6.90 E around the
sample track): **200 in 3.7 s, 593 kB, 232 elements** (220 ways, 12 relations: the Arve, the Lac de Passy, reservoirs,
streams and ponds) → 80 polygons kept. The same request sent by `curl` without a `User-Agent` receives 406.

**The sea and the waterway lines (2026-10-22)**: a second request per track, in the same cases:
`way["natural"="coastline"]` in the track corridor widened to **8 km**, and `way["waterway"="river"]`, `"canal"`, `"stream"` in the
corridor widened to **4 km**, `out geom qt`. Same queue, same 30-day cache (reduced result: sea polygons built from the coast, with
the corridor cut into rectangles and the coast simplified to 8 m, at most 20,000 coast points; lines simplified to 4 m, at most
200 km), same retry policy. Measurements (curl with a `User-Agent`, public instance busy: part of the time is queueing), then
the reduction run on the answer (`parseWaterShapes`):

| Track (corridor box) | Answer | Elements | Reduced and cached |
|---|---|---|---|
| Côte de granit rose, Brittany (6 km coast walk; 48.74–48.90 N, −3.63…−3.33 E) | **200 in 30.1 s, 775 kB** | 138 coast ways, 119 waterways | 2 sea polygons (2,358 vertices, 69 islands as holes), 67 streams; **71 kB**, 54 ms |
| Marseille, Calanques coast (43.1–43.3 N) | **200 in 39.4 s, 1,070 kB** | 147 coast ways, 61 waterways | 1 sea polygon (2,502 vertices, 43 holes), 32 lines (8 rivers, 18 canals, 6 streams); **57 kB**, 47 ms |
| Mont-Blanc massif, Chamonix valley (45.77–45.99 N) | **200 in 30.0 s, 636 kB** | no coast, 354 waterways | 136 lines (9 rivers, 126 streams); **76 kB**, 10 ms |
| Polder coast, Dunkerque – De Panne (50.9–51.2 N) | **200 in 20.9 s, 547 kB** | 28 coast ways, 504 waterways | 1 sea polygon (154 vertices), 148 lines (4 rivers, 48 canals, 96 streams); **40 kB**, 9 ms |

The coastline alone, in a 20 × 30 km box on the Côte de granit rose: 200 in 26.2 s, 653 kB, 144 ways. The same request sent without
a `User-Agent` receives 406; a busy server answers 502 (`BUSY_STATUSES`: retried, then the next endpoint). The sea is built from
the answer in the browser (no new request), the polder case shows land at 0 m behind the dike staying land.

**Forests (2026-10-22)**: a third request per track, only if « Forêts » is checked: `way` / `relation` (multipolygons)
`landuse=forest` and `natural=wood` in the track corridor widened to **5 km**, `out geom qt` (full geometry, `leaf_type` among the
tags). Same queue, same 30-day cache (for the reduced result: polygons simplified to 8 m, at least 5,000 m², at most 600, coordinates to
1e-5°), same retry policy, same licence as the landmarks and the water (ODbL, credit « © contributeurs OpenStreetMap »; the credit
line shows as soon as forests are drawn). Measurement (curl with an explicit `User-Agent` and `Accept: */*`, 406 without, as for the
water; sample track Pic de l'Homme, Pyrénées, 4.3 × 1.6 km), boxes of the corridor:

| Corridor | Box | Answer | Elements | Reduced result (cache) |
|---|---|---|---|---|
| 8 km | 42.5664–42.7496 N × 1.772–1.987 E | 200 in 36.6 s, **2.96 MB** | not counted | 164 polygons, 261 kB, 13,400 vertices |
| 5 km (kept) | 42.5935–42.7220 N × 1.809–1.950 E | 200 in 34.6 to 39.3 s (two runs), **804 kB** | 85 (79 ways, 6 relations; `leaf_type`: 58 needleleaved, 11 mixed, 9 broadleaved, 7 none) | 64 polygons, 130 kB, 6,700 vertices |

The 8 km corridor of the water was too heavy for forests (3 MB), so the corridor is narrower; 5 km covers what the camera sees (trees
are drawn up to 6 km from the camera, thinner beyond 2 km from the track). The time is the server's: the same day, the water query alone
(`natural=water` ways of the 5 km box, 211 kB) took 27 s, against 3.7 s on 2026-10-08, so the public server was slow; the 60 s limit of
the query (`QUERY_TIMEOUT_S`) leaves room, but a very long track (several boxes) may time out: the forests are then missing, without
a message (no status chip), and tried again on the next track or setting change.

**Glaciers (2026-10-22)**: a request per track, only if « Neige » is not « Aucune »: `way` / `relation` (multipolygons) `natural=glacier` in the track
corridor widened to **5 km**, `out geom qt`. Same queue, same 30-day cache (for the reduced result: polygons simplified to 8 m, at least 20,000 m², at most
200 and 20,000 vertices, coordinates to 1e-5°), same retry policy, same licence as the landmarks (ODbL, credit « © contributeurs OpenStreetMap », shown as soon as
glaciers are drawn). The query (`glacierQuery`), for the box of the Chamonix test track:

```
[out:json][timeout:60];
(
  way["natural"="glacier"](45.85108,6.80484,45.97822,7.04956);
  relation["natural"="glacier"]["type"="multipolygon"](45.85108,6.80484,45.97822,7.04956);
);
out geom qt;
```

Measurement (curl-like request from Node with an explicit `User-Agent` and `Accept: */*`, as for the water; the public server was busy, several requests of other
layers in parallel):

| Track | Box | Answer | Elements | Reduced result |
|---|---|---|---|---|
| Chamonix – Mer de Glace – Couvercle (10.7 km, 1,035 to 2,680 m) | 45.8511–45.9782 N × 6.8048–7.0496 E | 200 in 37.6 s, **658 kB** | 70 (ways and relations; the Mer de Glace, Argentière, Leschaux, Talèfre, Bossons…) | 72 polygons, 5,949 vertices, 115 kB in the cache; mesh 39,930 triangles |
| Pic de l'Homme sample (Pyrenees) | 42.5936–42.7219 N × 1.8097–1.9503 E | 200 in 52.2 s (a 502 once before), **287 bytes** | 0 | 0 polygons (nothing is drawn, the chip says « prêt ») |

The time is the server's (the empty answer took longer than the full one: queue and dispatch); the 60 s limit of the query (`QUERY_TIMEOUT_S`) leaves room, a
very long track (several boxes) may time out: the chip then says « erreur » and the glaciers are missing, tried again on the next track or setting change.

Log (curl, 2026-10-07): `[out:json][timeout:60]; ( node["natural"~"^(peak|volcano|saddle)$"]["name"](45.79485,6.68680,45.91881,6.83916); … 8 statements … ); out center tags qt;`
→ 200, 5.7 s, 44,447 bytes; same request from headless Chromium (origin `http://127.0.0.1:5184`) → 200 in 3.6 s.
