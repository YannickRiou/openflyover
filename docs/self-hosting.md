# Self-hosting OpenFlyover

How to run your **own copy** of the OpenFlyover website, on your server, under your domain, for you, your club or your
company. No account, no database and no licence key are involved. For the technical details of web servers (nginx,
Apache, cache headers), see [`deploying.md`](deploying.md); this page is the whole path, from nothing to a working site.

- [What you are hosting](#what-you-are-hosting)
- [What you need](#what-you-need)
- [Three ways to serve it](#three-ways-to-serve-it)
- [Updating](#updating)
- [Domain, subfolder, Strava](#domain-subfolder-strava)
- [What leaves the browser](#what-leaves-the-browser)
- [Using your own map, landmark and weather servers](#using-your-own-map-landmark-and-weather-servers)
- [Check that it works](#check-that-it-works)
- [When something does not work](#when-something-does-not-work)
- [What you do not need](#what-you-do-not-need)

## What you are hosting

A **static website**: a folder of files (about 18 MB) that your server hands out as they are. There is no program
running on your server, no database, no upload and no login.

Everything else happens **in each visitor's browser**: the 3D view, the clouds, the video export. The tracks, the photos
and the projects of your visitors **never reach your server**; they stay on their computer. Your server only sees the
requests for the site's own files.

The visitor's browser also contacts a few public services by itself for the maps, the landmarks and the weather (see
[What leaves the browser](#what-leaves-the-browser)). You do not host those; the site works without any server of
yours for them.

## What you need

- A server, a VPS, a NAS or hosting that serves static files, and a **domain name**.
- **HTTPS.** This is not optional. Outside `localhost`, a browser only enables the video encoder, the installable app
  mode and track import on a secure (HTTPS) page. Over plain HTTP the site loads but you cannot import a track or
  export a film. A free [Let's Encrypt](https://letsencrypt.org/) certificate is enough, and the Caddy and Docker routes
  below give you one almost for free.
- **Node.js 24**, only on the machine where you build the site (it can be your own laptop; the server needs none).
- Visitors with a recent **Chrome or Edge** (Firefox and Safari work for most things but are not tested for the
  video export, see the [README](../README.md#quick-start)).

## Three ways to serve it

All three start the same way: build the site once.

```bash
git clone https://github.com/YannickRiou/openflyover.git
cd openflyover
npm ci
npm run build        # the site is now in dist/
```

(To serve it from a subfolder such as `https://example.org/flyover/`, build with `BASE_PATH=/flyover/ npm run build`:
the trailing slash matters.)

### 1. Caddy: the simplest, HTTPS included

[Caddy](https://caddyserver.com/) gets and renews the certificate for you. Copy `dist/` to `/var/www/openflyover` on the
server, then put this in `/etc/caddy/Caddyfile` (replace the domain by yours, which must point to the server):

```caddy
flyover.example.org {
	root * /var/www/openflyover
	encode zstd gzip
	file_server

	# files with a fingerprint in their name: cached for a year
	@assets path /assets/*
	header @assets Cache-Control "public, max-age=31536000, immutable"

	# these two must always be checked again, or visitors miss new versions
	@fresh path /sw.js /manifest.webmanifest
	header @fresh Cache-Control "no-cache"
	header /manifest.webmanifest Content-Type "application/manifest+json"

	# the sky and cloud textures
	header *.exr Content-Type "image/x-exr"
}
```

Then `sudo systemctl reload caddy`. Open `https://flyover.example.org`.

### 2. Docker

Put these two files at the root of the repository (next to `package.json`), or anywhere you build images from.

`Dockerfile`:

```dockerfile
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# the site is served from the root of its domain; for a subfolder: --build-arg BASE_PATH=/flyover/
ARG BASE_PATH=/
ENV BASE_PATH=$BASE_PATH
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

`nginx.conf`:

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml application/manifest+json;

    location / {
        try_files $uri =404;
    }
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
    location = /sw.js {
        add_header Cache-Control "no-cache";
    }
    location = /manifest.webmanifest {
        types { application/manifest+json webmanifest; }
        add_header Cache-Control "no-cache";
    }
    location ~ ^/(atmosphere|clouds)/ {
        types { image/x-exr exr; application/octet-stream bin; image/png png; }
    }
}
```

Build and run:

```bash
docker build -t openflyover .
docker run -d --name openflyover --restart unless-stopped -p 8080:80 openflyover
```

The container speaks plain HTTP on port 8080: **put a proxy that does HTTPS in front of it** (Caddy with
`reverse_proxy localhost:8080`, Traefik, nginx Proxy Manager, your hosting panel…), as browsers need HTTPS.

### 3. nginx or Apache already running, or shared hosting

Copy `dist/` into the web root and use the ready-made `server` block (nginx) or `.htaccess` (Apache) of
[`deploying.md`](deploying.md#nginx). On shared hosting (OVH and the like) that is simply: upload the *contents* of
`dist/` to the site folder and add the `.htaccess` of that page.

Any **static host** (Netlify, Cloudflare Pages, an S3 bucket behind a CDN…) also works: build command
`npm ci && npm run build`, publish folder `dist`, Node 24. Two things to check there: `sw.js` and
`manifest.webmanifest` are served with `Cache-Control: no-cache`, and the host is HTTPS (they all are).

## Updating

The site is the same files until you replace them. To follow a new version of OpenFlyover:

```bash
git pull
npm ci
npm run build
# then copy dist/ over the site folder (or rebuild the Docker image)
```

A visitor who comes back gets the new version on their next visit: the installed app shows « Nouvelle version
disponible » and updates when they accept. Nothing to restart on the server.

## Domain, subfolder, Strava

- **Your own domain** needs nothing special: the build makes no assumption about the address. Visitors' preferences,
  projects and offline packs are kept **per address** by the browser, so moving the site to another domain starts
  everyone with an empty list (they can reopen their `.opnflvr` files).
- **A subfolder** (`https://example.org/flyover/`): build with `BASE_PATH=/flyover/`, then serve `dist/` at that path.
- **« Importer depuis Strava »** is optional and needs nothing from you: each visitor creates their own Strava
  application and pastes its identifiers into OpenFlyover (they stay in their browser). They only have to enter your
  **domain** (the app shows exactly which one) as the *Authorization Callback Domain* of their Strava application.

## What leaves the browser

Your server sees only requests for the site's files. A visitor's browser, on the other hand, talks to these services by
itself while they use the app; knowing them is also useful to decide whether you must say something to your visitors.

| Service | What for | What it receives | Needed? |
|---|---|---|---|
| Terrain tiles (`tiles.mapterhorn.com`, or AWS open data) | the relief | the tile numbers of the area looked at, and the visitor's IP address | yes, for the 3D view |
| Imagery (IGN, swisstopo, Esri, basemap.at, GSI, USGS, OpenTopoMap) | the map draped on the relief | the same | yes (the visitor picks one, a default is chosen by country) |
| Overpass (`overpass-api.de`, then `maps.mail.ru`) | landmarks, water, the region | a box around the track (no track points) | no: without it there are no labels |
| Open-Meteo | the weather of the outing | about ten places along the track, rounded to ~1 km, and the dates | no: without it there is no weather |
| Strava | the import | the visitor's own credentials, to Strava only | no |

There is no analytics, no tracking and no advertising in the site, and nothing is stored on your server. The browser
keeps the visitor's preferences, projects and caches on their own device.

## Using your own map, landmark and weather servers

By default the site uses the public services above. They are free but have **fair-use limits**: a public site with many
visitors, or a company that blocks outside services, may want its own. This is possible, with these limits:

- There is **no setting for it in the app**: the addresses are constants in the code. You change them and rebuild
  (`npm run build`).
- Your servers must allow the site to call them from the browser (CORS: the header `Access-Control-Allow-Origin`).

| To replace | Where (in the repository) | Notes |
|---|---|---|
| Terrain tiles | `TERRAIN_SOURCES` in `src/terrain/sources.ts` | Terrarium-encoded XYZ tiles (`{z}/{x}/{y}`). Mapterhorn publishes area downloads; the AWS ones are an open-data bucket. |
| Imagery | `IMAGERY_SOURCES` in `src/terrain/sources.ts` | `{z} {x} {y}` placeholders (and `{s}` for subdomains). Mind each provider's terms: see [`sources.md`](sources.md). |
| Landmarks | `OVERPASS_ENDPOINTS` in `src/osm/overpass.ts` | Your own [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API/Installation) instance. It must accept a plain form `POST` without a preflight request. |
| Weather | the two addresses at the top of `src/weather/openMeteo.ts` | [Open-Meteo is open source](https://github.com/open-meteo/open-meteo) with the same `/v1/…` interface. |

After editing, run `npm test` and `npm run build`, then redeploy.

On a network with no access to the public services at all, the 3D view has nothing to draw: there is no runtime
switch to point the site elsewhere, only the rebuild above. The desktop application can also use **offline packs** of
tiles prepared beforehand (see the [user guide](user-guide.html)).

## Check that it works

After deploying, in Chrome or Edge:

1. Open `https://your-domain/`: the home screen appears. The padlock of the address bar is closed (HTTPS).
2. Click « Essayer avec l'exemple »: the relief and the map appear around a hike (tiles are reaching the browser).
3. Press play, then open the export drawer and start a short export: a video is produced (the secure context works).
4. Reload the page, then go offline (browser tools, *Network*, *Offline*): the home screen still opens (the service
   worker works). The map needs a connection again as soon as you move.
5. In the browser's *Network* tool, look at `sw.js` and `manifest.webmanifest`: `Cache-Control: no-cache`.

## When something does not work

| You see | Probably | What to do |
|---|---|---|
| Importing a track or exporting a film does nothing, or an error about identifiers or the encoder | the page is not on HTTPS | serve it over HTTPS (a proxy, Caddy, Let's Encrypt) |
| White page, errors about files not found in the browser console | the site was built for the root but served from a subfolder (or the other way round) | rebuild with the right `BASE_PATH` |
| Visitors keep seeing the old version | `sw.js` or `index.html` cached for a long time | `Cache-Control: no-cache` on `sw.js` and `manifest.webmanifest`; clear the CDN's cache |
| The sky or the clouds stay black or flat | the `.exr` / `.bin` files of `atmosphere/` and `clouds/` are not served (wrong type or blocked) | add the types of the server block above; check the folders are in the web root |
| No relief or no map, errors mentioning CORS in the console | a tile server of yours does not send `Access-Control-Allow-Origin`, or a firewall blocks the public ones | allow the origin, or see [your own servers](#using-your-own-map-landmark-and-weather-servers) |
| No labels (landmarks) | Overpass is busy or blocked | wait and retry, or use your own instance |
| « Nouvelle version disponible » never appears | `sw.js` is cached | see above |

## What you do not need

The **desktop application**, its installers, the signing keys, the update feed (`latest.json`), Rust, Tauri and
ffmpeg are only for the desktop version: [`deploying.md`](deploying.md#desktop-application) and
[`installers.md`](installers.md). A website needs none of it, and no GitHub secret.
