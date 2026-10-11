# Changelog

Notable changes to OpenFlyover. The desktop installers of each version are on the
[Releases](https://github.com/YannickRiou/openflyover/releases) page (`docs/installers.md`).

## Unreleased

- **Diagnostic report**: « Détails » of an interrupted export, and « Diagnostic › Afficher le rapport » at the bottom of the
  « Projet » tab, open a report to copy (« Copier le rapport »): app version, device and its memory budget, GPU, the export
  asked (size, quality, effective render, bitrate, memory or disk, estimated size), every setting that weighs on memory,
  the media of the film by kind and size, and the last 15 steps of the export with the memory counters. No position, no
  track, place or project name.
- **Phones: fewer crashes in editing and export** (iOS ends a tab that uses too much memory): the relief's shadow map is
  2048² (1024² with 2 GB or less), the unused MSAA of the canvas is gone when the atmosphere is on, a phone exports at
  720p by default and picks its terrain tiles for a 720 px view, a film kept in memory is capped at 8 Mbit/s with the
  warning from 250 MB, the screen stays on during an export and an export cut short by the browser is reported at the
  next start; the autosave no longer re-serialises the photos, clips and music of the project at every change.
- **Export quality sets the render quality**: « Standard / Haute / Maximale » now also picks, at export time only, the clouds'
  export quality (Rapide / Moyenne / Fine) and the most motion-blur renders per image (4 / 8 / 8), with an « Imposé par Haute »
  pill on those settings. A value chosen by hand wins (« Personnalisé », « Revenir au préréglage »); the project and the
  preview do not change, and the render history records what was really used. A project saved before keeps its clouds quality.
- **Faster export with clouds**: the volumetric clouds' noise slices are computed once per image (once per
  shutter sub-frame), in the final render only, not again at each render that waits for tiles; the frames are identical.
- **Motion blur export**: the shutter's 8 renders per image become 1–8 by how far the picture moves on screen (1 at
  stops, held frames and slow or high cameras, 8 as before when the camera is fast and low): same look, shorter export.
- **Render history**: the export drawer lists the last 20 renders (done, canceled or failed) with their real duration,
  speed per image, output and the settings that change the render time; « Réutiliser ces réglages » puts them back
  as one undo step. Kept on the device only (no track, no video).
- **Render weight**: a three-bar pictogram next to the settings that lengthen the export (clouds quality, motion blur,
  depth of field, resolution, frame rate; the tooltip gives the factor), and a dot on the tab of a setting at its
  heaviest tier.
- **Keyframes** (« Image clé », formerly « Garder ce cadrage ici »): keep the 3D view exactly as framed, shown at that
  point of the film; ◁◆ / ◆▷ in the transport row, Alt+← / Alt+→ or a click on the ◆ to go from one to the next;
  the ◆ between the arrows adds a keyframe at the playhead, or removes the one under it.
- **Space bar**: plays / pauses again after a click on a button or a slider (the focused control used to keep it).
- **Grainy exports**: the video bitrate of each quality is about 2.8× higher (1080p24 « élevée »: 13.9 Mbit/s, was
  5), and « Qualité » shows its Mbit/s.
- **Marker behind the relief**: the marker (and the ghost race markers) fade out when a mountain hides them, like
  the track and the labels.
- **Marker kept in sight**: the flight camera now clears the relief down to the marker (« Plan cinématique »,
  « Montgolfière » and the other styles), so a ridge just before the marker no longer hides it on twisty mountain
  roads; keyframes are unchanged.
- **Mes projets**: a project with a track is kept and saved by itself, and the project left open comes back at the
  next start (« Projet … rouvert »), also when a phone has discarded the tab in the background.
- **Phone layout like a video editor**: the 3D preview always on top, the timeline always open below it with its
  playhead in the middle (slide to move through the film, pinch to zoom), settings in a half panel with « ✓ », a
  selected block's actions in place of the tab bar.
- **Phones and tablets**: bottom sheets, tab bar, touch gestures, installable web app (offline shell, Android share
  target, « Partager / Enregistrer »), device budget for mobile GPUs.
- **Flyover camera**: smooth on long, fast or sparsely recorded tracks (a 540 km raid in 4 min 30 s no longer swings
  around the marker nor jolts at each corner): heading, aim and height smoothed at the film's ground speed.
- **Phones, follow-ups**: lower pixel ratio while fingers move the 3D view; offline packs no finer than the phone
  shows; no hover style left on a button after a tap; an open app looks for a new version every hour and when
  shown again.
- **Home screen**: a calm welcome page with the latest projects; until a track is loaded only « Projet » is in the rail.
- **Status bar**: the map state is clear: a ring and « Carte · 72 % » while the view loads, then « Carte prête »;
  tiles in error stay visible.
- **Video export**: no rendering while a frame waits for its tiles (only the tile requests go on), so clouds and
  motion blur no longer keep the graphics card busy with frames that are thrown away; a tile that failed is retried
  in the background instead of holding the frames.
- **Situation shot**: « Soleil » › « Plein jour » (default) lights the region view in daylight whatever the time of
  the outing, then joins the flight's sun; « Heure du survol » and « Accéléré » (the former « Faire bouger le soleil »).
- **Timeline**: a narrow block (a 4 s stop on a phone) pressed in its middle is moved, no longer stretched by its edge.
- **OpenStreetMap**: the memory cache of Overpass results keeps the 32 most recently used, no longer every track of the session.
- **Track glow**: « Halo de la trace » (formerly « Halo lumineux », the name of the lens bloom too) is clearly visible
  and has its intensity, width and colour.
- **Track behind the relief**: a ridge or a spur between the camera and the track hides it (the faint « ghost » of
  the hidden parts piled up into a full line in the distance and is gone).
- **Track on the relief**: the line, the marker and the labels lie on the terrain as drawn, without the jumps up and
  down (or down to sea level) of a long track without elevation while tiles came and went.
- **Simpler panels**: camera presets as the one choice (six shown, the rest under « Plus de préréglages »), the style
  as a row of « Caméra »; Strava import in the « + Ajouter » menu of the track list.
- **« Temps forts »** (Survol tab) replaces the « Feuille de route » roadbook: the film's highlights at a glance, each
  stop on or off with its duration, your own added or deleted, in sync with the timeline.
- **Clearer tabs**: eight tabs in montage order, with the new « Météo », « Lumière » and « Objectif »; secondary
  settings are one row with their name and value, the control shown on a tap (no more « Plus de réglages »).
- **Mes projets**: removing the last track no longer writes an empty project over the one kept in « Mes projets »
  (the autosave waits for a track).
- **Fixes**: tooltips stay whole near the edge of a panel or of the screen (shifted, or above); « Lieu » lists the
  areas as soon as they are found, and a failed region search offers « Réessayer ».
- **Faster tabs on a phone**: switching tabs no longer redraws every panel nor goes through the 3D scene.

## 0.1.0 (October 2026)

First release: the website and the Windows, macOS and Linux desktop applications, from the same code, 100 % local.

- **Import**: GPX and FIT (in-house decoder; heart rate, cadence, power, temperature), several tracks at once, Strava
  activities through the user's own Strava application; planned outings without times (date, start, pace).
- **Terrain and imagery**: Mapterhorn / AWS Terrain Tiles; IGN and swisstopo orthophotos chosen automatically, Esri
  (optional) and Sentinel-2 elsewhere, topographic maps, historical IGN photos; exaggeration; lakes and rivers from
  OpenStreetMap rendered as reflecting water; offline packs along the track.
- **Flyover**: five camera styles and twelve presets, opening and closing shots including the situation shot
  (place among the areas around the track, hold then push-in, framing, moving sun), camera smoothing in space and in
  film time, pacing with slow-motion and pauses at highlights, stops with their own camera.
- **Light and weather**: physically based sky and haze with the real sun, terrain shadows, starry night; historical
  or forecast weather (Open-Meteo); volumetric clouds and a sea of clouds, volumetric or as a lit surface (« Nappe »).
- **Look**: colour grading presets; lens effects off by default: speed blur, bloom, lens flare, depth of field.
- **Landmarks and roadbook**: summits, passes, huts, lakes from OpenStreetMap; categorised climbs; 3D labels; points
  of interest; roadbook of the outing.
- **Several tracks**: ghost race with leaderboard; stages flown one after the other, each with its own colour, name,
  figures, sun and weather; chaining into a single route.
- **Timeline and overlay**: texts, photos and videos (with their sound) on a timeline, music tracks with fades;
  overlay with titles, counters, profile, mini-map, weather, logo, credits, in three styles.
- **Export**: MP4 or WebM up to 4K and 60 fps in five aspect ratios, still image, overlay alone with transparency,
  several formats in one go, poster (A4, A3, square, 300 dpi); on the desktop, one film per track of a folder and a
  command line, hardware H.264 encoder on Linux (NVENC, VAAPI) with a software fallback.
- **Projects**: project files, undo / redo, presets, « Mes projets » with thumbnails; projects of earlier formats
  still open.
- **Quality**: French interface with tips, error messages in French, error screen, WebGL loss handled; about 1,600
  unit tests, end-to-end tests in a real browser, coverage badge; third-party notices shipped with the installers.

Known limits are listed in `docs/handover.md` ("Limits and open points") and the checks that need a GPU in
`docs/tests-gpu.md`.
