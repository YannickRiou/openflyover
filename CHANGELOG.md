# Changelog

Notable changes to OpenFlyover. The desktop installers of each version are on the
[Releases](https://github.com/YannickRiou/openflyover/releases) page (`docs/installers.md`).

## Unreleased

- **The « Projet » and « Réglages » tabs, the home screen, the status bar, the dialogs, the messages and the menus on the same look**: the two tabs (« Projet », « Mes projets », « Préréglages », the appearance, status bar and timeline preferences), the home screen, the status bar, the four dialogs (shortcuts, sources, Strava, diagnostic report), the messages, the tooltips, the menus and panels that open over the page, the language list and the phone sheet header are rewritten in Tailwind utilities on the scales of the pilot (section headers of 48 px, one type scale, hairlines); the hand-written rules and the `menu`, `popover`, `overlay`, `tip`, `modal` and `toast` stylesheets are removed. The numbered steps of the Strava dialog are back, and the phone rules of the bar, dialogs and sheets now also apply on a phone held sideways. Same features, labels, shortcuts and test ids.
- **The export drawer, the track cards and the view overlays in Tailwind utilities**: the export drawer and its bottom sheet (« Vidéo », « Plusieurs formats », the render history), the track cards and « Plusieurs traces » (cards, colour dot, handle, delete, stages, race board), the « Recadrer » and « Zones de sécurité » buttons, the safe zones, the colour legend, the render weight and the export-quality badge now follow the pilot's scales (48 px title bar, 40 px rows, label and hint type roles); the hand-written rules they used are removed. Same features, labels, shortcuts and data-testids; the history rows now rest on the same `Disclosure` as the setting rows.
- **The timeline and the film inspector in Tailwind utilities**: the transport bar, the lanes, the blocks, the keys, the ruler, the centred phone timeline, the height handle, the key buttons (◀ ◇ ▶), the « modifié » marker and the film inspector follow the pilot's scales (type, 4 px spacing, 32 / 44 px controls, `white/10` hairlines and hovers, the light-accent focus ring on the dark strip); the hand-written rules of `.film-tl*` and `.film-inspector*` and four CSS files are removed. Same features, labels, shortcuts and drag behaviour; the bar buttons are 32 px (28 px before) and the « modifié » marker of « Options du film » no longer overlaps its title.
- **A calmer look for the top bar, the rail and the « Trace » tab (pilot)**: one type scale and one spacing scale (4 px; the compact density follows), control heights of 32 / 40 px (44 px on a touch screen), softer hairlines, one hover, pressed and focus style, and 150 ms transitions that stop under reduced motion. The top bar, the rail and the phone tab bar, and the « Trace » tab (« Traces », « Trace » and « Marqueur » sections, setting rows) are rewritten in Tailwind utilities; the hand-written rules they used are removed. Same features, labels and shortcuts.
- **Tailwind utilities for « Survol », « Objectif » and « Habillage »**: the camera preset tiles and « Plus de préréglages » (a shared `MoreOptions` toggle), the duration slider with its « − » / « + » buttons, the position grid, the overlay widget groups, « Étiquettes », the card fields and the poster panel now use the same scales, hints and sections as the « Trace » tab; the hand-written rules they used (`.step-btn`, `.range-row`, `.style-tile`, `.anchor-picker`, `.overlay-widget`, `poster.css`…) are removed. Same features, labels and shortcuts.
- **HeroUI under the sliders and the fields**: the sliders (« Exposition », the solar hour, the grading, the camera and pacing settings, the film duration, the timeline zoom, the landmark limits, the pace), the number fields (stop duration, position of a widget, timing of a block) and the text fields (project name, rename, preset name, card and poster texts, point-of-interest name) now come from HeroUI 3 (`Slider`, `NumberField`, `TextField` in `src/ui/primitives/`), with the same look and labels. A slider still shows its value next to it, moves with the arrows, Home / End and Page Up / Down, and a drag stays one undo step; on a touch screen the thumb is dragged, a tap on the rail puts it there and a vertical swipe from the rail scrolls the panel. A number is now settled on Enter or when leaving the field (a number typed in range still applies at once where it did), rounded to the field's step and kept in its range.
- **HeroUI under the colour fields and the dialogs**: every colour (accent, bar, overlay, track, marker and key colours) is now a button showing the colour that opens a panel with a saturation / brightness area, a hue slider and a hex field for any colour, next to the same presets (now one tab stop, arrows move between them), through the `ColorField` wrapper; on a phone the panel is a bottom sheet and was checked with touch. The four dialogs (« Raccourcis clavier », « Sources et licences », « Importer depuis Strava », « Rapport de diagnostic ») rest on HeroUI's modal (`Modal` wrapper): same look, sizes and full-screen layout on a phone, Escape and a click beside them close them, the focus goes back to what opened them, and menus, tooltips and panels opened from inside still show over them. The native colour pickers and `<dialog>` elements are gone; a dialog no longer puts the focus on its close button when it opens.
- **HeroUI under the last choices**: the « Plusieurs traces » mode and its two switches, the « Arrêts automatiques » box of « Options du film », the output format of the top bar, the Strava activity rows, the export proportion tiles and the camera preset tiles (one radio group each, same tile look), and the preset pills of « Lumière », « Étalonnage » and the speed inspector (now a single choice, the chosen one ticked) go through the same `Switch`, `Checkbox` and `RadioGroup` wrappers. Same labels, tooltips and arrow keys; the hand-made radio, checkbox and `:has()` styles they used are gone.
- **HeroUI under the drop-down lists**: the 33 drop-down lists of the panels, the inspector, the export drawer, the poster and the timeline bar (speed, « Arrêt sur un point fort ») now come from a `Select` wrapper over HeroUI's Select in `src/ui/primitives/`: on a computer a button that opens a list over the page (arrows, Home / End, typed letters, Escape closes the list first, the list opens in front of any open dialog), on a touch screen the phone's own native picker as before. Same labels, options and look; the list is the dark one of the menus.
- **HeroUI under the switches, tick boxes, choices and pills**: the on / off switches, the tick boxes, the « segmented » choices (one among a few, side by side), the pills (landmark kinds, counters, poster figures, export resolutions) and the 3 × 3 position picker of the panels, the export drawer and the poster now come from HeroUI 3 (React Aria inside), themed with the same palette. Same labels and look; the arrows still move and choose in a group, a disabled choice still says why in its tooltip, and the options of a group are announced as a radio group to screen readers. A disabled ticked box is now faded instead of grey.
- **HeroUI under the rail tabs and the setting rows**: the nine tabs of the rail (arrows, Home / End, one tab stop, a press on the open tab folds the panel, tooltips on the labels) and the folding setting rows (« Exposition »…) now rest on HeroUI's Tabs and Disclosure, behind wrappers in `src/ui/primitives/`; the hand-written arrow-key and unfolding code is gone. The interface looks the same; the arrows now follow the direction of the tab list (up and down in the side rail, left and right in the phone's bottom bar).
- **HeroUI under the menus and the options panel**: « Plus d'actions », « + Ajouter », the right-click (or long-press) menu on the track in the 3D view and « Options du film » now rest on HeroUI's menu and popover (wrappers `Menu` and `Popover` in `src/ui/primitives/`): arrow keys, Home / End and typed letters move in a menu, Escape closes the menu first and the app's own Escape comes after, a click or tap outside closes it, and the focus goes back to its button. They open in front of everything, so a scrolling panel no longer clips them. The interface looks the same.
- **HeroUI under the buttons and tooltips**: the interface now uses HeroUI 3 (MIT, build time only, nothing downloaded at run time) for its buttons and tooltips, themed with the same palette in the light and dark themes, through wrappers in `src/ui/primitives/`. Tooltips keep their texts and the 450 ms pause, are no longer cut off by a scrolling panel and still open on a long press on a touch screen. The interface looks the same.
- **HeroUI under the messages**: the short messages over the view (« Projet enregistré », « Réglages remis par défaut · Annuler »...) now go through HeroUI's Toast behind the same `showToast`, with the same texts, durations (5 s, up to 12 s for a long text; errors stay until closed), dismiss button, action button and place above the timeline. Their timers now pause while the pointer or the focus is on any message. The interface looks the same.
- **Tailwind CSS under the interface**: Tailwind 4 (MIT, build time only, nothing downloaded or added at run time) is set up with the same palette, fonts, radii and shadows, a `dark` variant that follows the theme setting, and its reset; the existing styles move into a lower layer so utility classes win. The interface looks the same.

## 1.0.0 (October 2026)

- **English interface, and a language selector**: the whole interface, the texts drawn into the films and posters (counter labels, units, card wording, weather words, dates, credits), the messages and the errors now exist in French and English. A flag button in the top bar, between « ? » and « Exporter », opens the list of languages (arrows and Escape work); the choice is a device preference kept with the appearance. A first run follows the browser's language (English, else French). The French interface is unchanged. No text is left in the code any more: everything goes through `t('domain.key')` with one file per domain and language in `src/i18n` (a missing key in a language fails the build, a test checks that both languages use the same placeholders); numbers and dates follow the language (« 1 234,5 » / « 1,234.5 »). The diagnostic report stays in French (it is pasted into bug reports), the user guide stays in French.
- **Tile requests by priority**: the tiles fetched ahead of time (export prefetch) are requested at a low network priority, so the browser serves the tiles of the current frame first.
- **Timeline, « À la suite »: duration per stage and light across the junctions**: a stage can have its own flight time (stage inspector « Durée du vol », or drag the right edge of its block; « Durée automatique » takes it back): it then lasts exactly that long, stops included and junctions not, the other stages keep their share of « Durée du survol » and the film grows or shrinks by the difference. The sun follows each stage at its recorded hour and **blends smoothly across a fade junction** (dusk, night, dawn through the pause) instead of switching at the cut. The « Lumière » settings are simpler: « Source de la lumière » (« Heure de la trace » or « Heure fixe » for all stages), and « Jours et nuits » is a single switch (the dusk / night / dawn seconds move to the inspector of a « Nuit » junction for stages « À la suite »). Older projects and single-track films open unchanged.
- **« Flou de bougé » only on the sides**: the blur no longer shows in the middle of the image. One radial mask (sharp around the centre of travel, full in the corners, the profile of the speed streaks) now rules the three parts: the export averages its sub-frames with a weight that, in the middle, keeps only the ones nearest to the frame instant (so the centre is the frame itself and the sides the full blur), and the preview trail fades out towards the centre. Stills and stops are unchanged.
- **Timeline, « À la suite »: reorder the stages**: drag a track by its handle in « Traces » (mouse, or a finger after a short press; the panel scrolls at its edges), move it with Alt+↑ / Alt+↓ (announced to screen readers), drag a stage block of the « Étapes » lane, or press « Ordonner par date ». Everything placed on a stage follows it (stops, speed sections, camera, parameter and marker keys, its junction settings, its card; texts attached to a stop too), and one undo puts the order and all of it back. The order is saved in the project (`race.order`); older projects open unchanged.
- **No text highlighting**: dragging in the interface (timeline, panels, sliders) no longer selects text; fields, the diagnostic report and the other texts meant to be copied stay selectable.
- **Timeline, closing**: dragging the start of « Clôture » now moves its start (the end of the film stays and the flight takes the difference) instead of pulling its end back.
- **Timeline, « À la suite »: junctions between stages**: an « Étapes » lane shows each stage and, between two stages, a junction block (« Coupe », « Fondu au noir », « Fondu au blanc » or « Nuit »). A fade now **holds the film** for its « Durée » (1.5 s by default, on top of the flight duration; stretch the right edge of the block to change it, « Appliquer à toutes les jonctions » for all), instead of a dip over a flight that kept running. Each stage's card is a block of « Textes » (own text with `{name} {n} {count} {date} {distance} {ascent}`, position, size, colours, duration), drawn inside the dip. The default transition and cards are in « Plusieurs traces »; an old project's choice there becomes the default (a project with « Coupe » keeps its film length, one with a fade grows by the holds). The timeline is also **magnetic** on every lane: blocks catch the edges and centres of the others, keys, junctions, ruler marks and the playhead, with a labelled alignment line, a hold distance so it does not flicker, a magnet button in the bar and Alt to invert it.
- **Marker keys carry their colours and size**: a key of the « Marqueur » lane can have its own ball / badge colours and size (inspector: « Couleur », « Taille », « Reprendre couleurs et taille du panneau »), cross-faded with the look; a new key takes those of the key before it (the first one keeps following the panel), so adding it changes nothing on screen. Its dot on the timeline is drawn in its colour (title: shape, colour, size), and the inspector recalls what stays the panel's (label, stick, animation). Older projects open unchanged.
- **Shorter opening and closing**: the opening and closing shots can go down to 0.5 s (it was 1 s), and the opening title can end at 1 % of the flight (it was 3 %) and the closing card appear at 99 % (it was 97 %), so the film can open and close quickly without a card hiding the start of the track.
- **« Position libre » typed digit by digit**: the pixel fields of a widget can be cleared and a negative number typed (they jumped back while typing); a value in range applies at once, Enter or leaving the field rounds and clamps it, an empty entry or Escape puts the previous value back, and a whole edit is one undo step.
- **Opening and closing shots: no dive, no skimming the relief** (#106): between the wide view and the flight view the camera stays on a glide slope over the flight camera (it no longer drops far from the start of the track) and clears the ground under it, and the line to its aim, by a share of its distance instead of 80 m under the camera only, so it no longer flies just over a ridge on the way in.
- **Landmarks under control**: « Nombre maximal » (5 to 80, 40 by default) caps the landmarks per track and the 3D labels; the pin of a row keeps a landmark whatever the cap, and « Garder les épinglés » dismisses all the others at once (one undo step). Dismissing a landmark with the cross no longer brings another one in its place.
- **Faster video export**: while a frame waits for its terrain tiles, the tiles of the next frames are now requested too (before, only once every 5 frames), so the network no longer sits mostly idle during the export.
- **Timeline, « À la suite »**: the stage blocks keep their place while a block is being dragged (they collapsed during the drag), and the junctions between stages are snap targets.
- **Smaller cards and widgets**: the size of the opening title, the closing card and the other widgets can go down to ×0.2 (it was ×0.5), so a card no longer has to hide the start of the track.
- **Landmarks: one way to pause the film**: « Ralentir et titrer aux repères » is removed from « Repères et points d'intérêt » (it overlapped « Arrêt »): the film no longer slows down or adds a title card at landmarks by itself; use « Arrêt » (or « Arrêts automatiques »). A project saved with the option still opens as it was: the slow-downs and titles it had written stay on the timeline as ordinary sections and texts, which you can edit or delete.
- **Project file `.opnflvr`**: projects are saved as `<name>.opnflvr` (compressed, with a signature; older `.json` projects still open). « Enregistrer » (Ctrl+S) rewrites the same file once it has been saved or opened (Chrome, Edge, desktop app), « Enregistrer sous… » (Ctrl+Maj+S) always asks; the desktop installers register the file type, a double-click opens the project.
- **Lakes**: the water surface of a lake sits higher over the relief (90th percentile of the heights inside the lake, a polygon offset towards the camera), so the relief no longer shows through as dark patches with jagged edges.
- **Branded desktop installers**: Windows NSIS and MSI in French with header, sidebar and banner images, macOS disk image with a background, a licence page (MIT licence plus a reminder of the third-party licences and data attributions) on the Windows and macOS installers and as the Debian copyright file, all in the colours of the application. `npm run installer-assets` regenerates the images; `npm run notices` also regenerates the licence pages. The Windows MSI is now built in French (`…_x64_fr-FR.msi`).
- **Lighter top bar**: « Ouvrir » and « Enregistrer » are icons; the « Modifié / Enregistré » text is replaced by a dot on the save icon while changes are unsaved, and by the accent colour on that icon for a few seconds once saved.
- **Interface appearance**: dark theme (or follow the system), accent colour, top bar and rail colour, compact density; « Apparence » section of the « Réglages » tab, per device.
- **Timeline size**: a handle between the 3D view and the timeline sets their proportion (mouse, touch and keyboard; double-click resets), remembered on the device.
- **Space on the ruler**: Space plays / pauses even when the timeline ruler (the row of times) was the last thing clicked or moved with the arrows.
- **Landmark ranking**: « Repères et points d'intérêt » lists the landmarks from the most to the least important with ▲ ▼ arrows (the higher one keeps its label when two overlap); a cross on hidden landmarks dismisses them, and « Relancer la recherche » asks OpenStreetMap again and brings the dismissed ones back.
- **No more climb display**: the climb cards, the climb labels in the 3D view and the « Sommets des montées » option are gone; the Trace tab section is now « Étiquettes ». Climbs still slow the film down (« Ralentir sur »).
- **Label colours**: « Couleurs des étiquettes » is now a list to pick the label type, then one colour for it (instead of a grid of unnamed swatches).
- **Labels under the cards**: the 3D labels stay visible while the opening title and the closing card are shown (they no longer fade out behind them).
- **Label keys**: « Habillage » › « Étiquettes 3D » has the ◀ ◇ ▶ keys to hide the 3D labels and bring them back with a fade along the track (an « Étiquettes » lane on the timeline once keyed).
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
- **Inspector over the export drawer** (#69): selecting a block on the timeline now shows its inspector in place of the open export drawer (an export in progress keeps its drawer).
- **Titles on the timeline** (#65): the opening title and the closing card show as blocks on the « Textes » lane (while the overlay and the card are on): click to edit them in the inspector, drag the inner edge to set how long they show, Delete switches them off. The « Habillage » panel keeps their switch and a « Modifier » button.
- **Keys harmonised** (#63): camera keys and speed keys are set from the header of their timeline track (◀ ◇ ▶); exposure, sun, saturation, contrast, warmth and vignette from under their slider in the panels; marker keys from the Marqueur section. The « Réglages » track and the « Ajouter un réglage » / « Ajouter un changement de marqueur » buttons are gone; each keyed setting gets its own track, and a « Marqueur » track appears with marker keys.
- **Marker keys** (#40): change the marker (ball, figure, own picture) along the track with keys on the timeline,
  cross-faded in under a second of film; « Un marqueur par jour / par étape » for chained tracks and « À la suite ».
  Same in the export.
- **Memory at start-up**: reopening a project with a large embedded clip uses about half the memory (saved projects are read as a Blob, no raw string kept beside the parsed document).
- **Keys on more than the camera** (#24): speed, exposure, sun hour and colour grading can be keyed along the track in a
  new « Réglages » lane of the timeline.
- **More overlay styles** (#19): « Néon nuit », « Cinéma » (letterbox bars, the figures as a subtitle line), « Journal de bord » (a paper sheet on the left with the figures as a list, the map and the profile) and « Tableau sportif » (a dark band with big figures over the profile) for the film and the poster, each with its own layout and structure, not only other colours; choosing one of the last three places the widgets (you can still move them); 3D labels follow the overlay style with one editable colour per label type; the text backing of styles without a panel is a discreet blurred rounded rectangle, or the text's shadow or outline only. Projects saved with a dropped style (Sportif, Minimal mono, Topo, Magazine) open in Diffusion or Éditorial.
- **Relief at sea** (#28): optional « Nettoyer le relief en mer » removes the isolated spikes elevation data leaves over
  the sea (the 3D track follows), with « Ramener la mer à 0 m » as a sub-option.
- **Marker** (#21, #30): free or track colour, ring / halo / pulse styles; six new figures, figure chosen from the
  activity, pin / rounded square / silhouette badges, a label and a stick with its ground shadow.

- **Export in memory** (Firefox, Safari, phones): the film is no longer copied two more times at the end, which lowers the peak memory.
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

- **Imagery memory** (phones): the canvas of a terrain imagery texture is freed once the texture is uploaded to the GPU; the tiles are redrawn after a lost WebGL context.
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

The checks that need a GPU are listed in `docs/tests-gpu.md`.
