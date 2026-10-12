# Changelog

Notable changes to OpenFlyover. The desktop installers of each version are on the
[Releases](https://github.com/YannickRiou/openflyover/releases) page (`docs/installers.md`).

## Unreleased

- **Export: every image waits for its tiles, or the export stops** (#36): more retries with growing delays (up to about
  2 min per tile), 5 minutes at most per image; a tile that never comes stops the export with an error naming the
  server, the tile and the cause, instead of delivering incomplete images.
- **Diagnostic** (#64): the diagnostic report and the test export without encoding moved from the Projet tab to « Réglages ».
- **Export: faster and lighter** (#35, #37): the interface stays responsive during an export; render-time breakdown (GPU
  when the browser measures it, composing, video frame, encoder wait, renders per image) in the console, the history and
  the diagnostic report; hardware video encoder when available; one render instead of two per image with clouds when
  the tiles are ready; encoding overlaps the next image.
- **Export settings** (#33): manual video bitrate, codec and container, key frame interval and audio bitrate; the Vidéo
  tab is grouped in Format, Encodage and Rendu. The Linux desktop encoder targets the same bitrate as the browser.
- **Affiche** (#34): current camera view or overview, PNG or JPEG, an approximate live preview, tile progress and missing
  tiles reported; « Image fixe » moves to the Affiche tab.
- **Position dot colour** (#66): the dot of the elevation profile and of the mini-map has its own colour setting in the Habillage tab, the 3D marker's colour by default (was the style's).
- **Camera and visibility** (#18, #41): markers and labels hidden by the relief disappear completely (never
  half-transparent); the flyover camera checks its sight line to the marker itself and turns around it when the slope
  is too steep; « Poursuite » and the other chase cameras no longer shake on noisy or zigzag tracks.
- **Light** (#31, #42, #27): « Soleil » offered for every opening and closing style; volumetric clouds faintly moonlit
  at night instead of black; on a multi-day track each night is a pause with settable dusk, night and dawn, and
  « Jour n » cards can be added.
- **Elevation from the terrain** (#32): a track without elevation gets it from the terrain source, automatically at
  import for usual outings, otherwise with « Calculer l'altitude »; saved in the project.
- **OpenStreetMap places** (#29): cities and places mapped as areas are found; towns, villages and hamlets shown by
  default (chips « Villes », « Villages », « Hameaux »), ranked by population.
- **« Repères et points d'intérêt »** (#23): one list in the Carte tab, each row with an eye and an « Arrêt »;
  « Tout afficher » / « Tout masquer »; landmarks found later marked « nouveau ». The « Temps forts » section is
  removed and automatic stops no longer stop at climb tops.
- **Interface** (#22, #25, #26): track and marker settings in the Trace tab (« Trace », « Marqueur »); new « Réglages »
  tab; status bar with fetch states, performance (desktop: RAM and CPU) and always-visible short credits, IGN update
  date in « Sources et licences »; fixed-width timecode and icon-only timeline tools, so the view no longer resizes.
- **Flyover duration** (#68): « − » and « + » buttons around the slider, and the acceleration it gives over the recorded outing (« accélération × 24 (sortie de 4 h 00) »).
- **Project** (#20): « Nouveau projet » and « Fermer le projet » in the Projet tab, which gathers every project action.
- **Overlay positions** (#39, #38): one 3 × 3 grid for every position, a free position in pixels of the exported
  video, logo opacity.
- **Style picker** (#61): the eight overlay styles (and the poster's) wrap onto several rows instead of scrolling sideways.
- **Recorded clock time** (#62): « Afficher l’heure enregistrée » (Réglages) now shows the hour with a side panel open too: it is no longer hidden with the distance and altitude readout when the timeline is narrow.
- **Export diagnostic** (#52): the `[export]` console line and the diagnostic report give the tiles and triangles drawn in
  the shadow pass per render, with the off-screen share, to measure what an off-screen caster filter could save.
- **Keys harmonised** (#63): camera keys and speed keys are set from the header of their timeline track (◀ ◇ ▶); exposure, sun, saturation, contrast, warmth and vignette from under their slider in the panels; marker keys from the Marqueur section. The « Réglages » track and the « Ajouter un réglage » / « Ajouter un changement de marqueur » buttons are gone; each keyed setting gets its own track, and a « Marqueur » track appears with marker keys.
- **Marker keys** (#40): change the marker (ball, figure, own picture) along the track with keys on the timeline,
  cross-faded in under a second of film; « Un marqueur par jour / par étape » for chained tracks and « À la suite ».
  Same in the export.
- **Keys on more than the camera** (#24): speed, exposure, sun hour and colour grading can be keyed along the track in a
  new « Réglages » lane of the timeline.
- **More overlay styles** (#19): five new styles (Sportif, Minimal mono, Topo, Néon nuit, Magazine) for the film and the
  poster; 3D labels follow the overlay style with one editable colour per label type; the text backing of styles without
  a panel is a discreet blurred rounded rectangle, or the text's shadow or outline only.
- **Relief at sea** (#28): optional « Nettoyer le relief en mer » removes the isolated spikes elevation data leaves over
  the sea (the 3D track follows), with « Ramener la mer à 0 m » as a sub-option.
- **Marker** (#21, #30): free or track colour, ring / halo / pulse styles; six new figures, figure chosen from the
  activity, pin / rounded square / silhouette badges, a label and a stick with its ground shadow.

- **Export and preview: fewer visible tile swaps** (an iPhone export of a track near a border showed, while zooming
  and moving, large parts of the terrain changing colour from one image to the next, white patches coming and going, and
  the detail of whole bands jumping): the white tile IGN answers outside France from z13 is no longer drawn (the coarser
  tile's picture is, so the terrain keeps its colours instead of turning white and flipping back when the level of detail
  changes); on a phone or tablet the level of detail that holds the tile cap changes in steps of ×1.1 instead of ×1.25 (a
  flip between two levels redrew a third of the view, now a few tiles; a computer has no such cap).

- **Export: every image shows its final terrain** (reports of coarse terrain for one image, then fine, and of pale tiles that
  turn to terrain colour seconds later, including when the tiles were already cached): the export now waits, up to 45 s per
  image instead of 5, for the tiles it draws, their imagery and the retries of failed ones (after 0.75 s, not 5 s, and a
  tile that had given up is tried again); imagery that failed or lost a sub-tile (a bitmap closed by the tile cache while it
  waited for its siblings) is loaded again instead of staying grey for the life of the tile, in the preview too, the parent
  keeping its imagery meanwhile. Images still rendered before the end of the loading (tiles that never arrive) are counted
  while the export runs and in its result and history.

- **Export diagnostic, more counters**: each step of the export now also gives the decoded tile bitmaps and their size,
  the height grids, the frames waiting in the video encoder, the re-drapes and the seconds since the step before; a step
  every 10 images from image 50 to 200, and the last 25 steps kept. « Export de test sans encodage » (Projet ›
  « Diagnostic », this tab only) renders a film without encoding it, to tell whether a phone runs out of memory in the
  encoder or in the render.
- **Phones: a low view no longer exhausts the memory** (an iPhone 12 export was killed during the opening « descente »,
  and earlier with the camera low from the start: the view alone needed 160–224 tiles over a cap of 120): on a phone or
  tablet the level of detail now gives way so the view fits the cap, distant terrain coarser first, the ground under the
  camera as detailed as before; the cap counts the tiles still loading, and a phone loads 6 tiles at a time instead of
  24. Unchanged on a computer.

- **Phones: the export's terrain tiles reach a plateau** (an iPhone 12 export was killed after ~100 images with the loaded
  tiles growing 68 → 244 and no end): during an export a phone or tablet keeps the tiles for a number of film frames
  instead of 30 seconds, prefetches fewer frames ahead, never holds more than 120 tiles (160 tablet) and frees an
  unloaded tile's imagery canvas; the frames are unchanged, a computer behaves as before. The diagnostic steps also
  give the tiles still loading.
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
