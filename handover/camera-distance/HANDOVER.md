# Handover: camera distance and tilt study (8.0)

This folder is a working file for whoever continues the 8.0 camera work, in a cloud session or elsewhere. It is not
meant to be merged: delete `handover/` before any merge to master. Written on 2026-11-11 from a local session.

How to run the scripts and what each output holds: `AGENT-NOTES.md` (written by the agent that ran the study). The
temporary app hook the scripts need: `study-hook.patch`.

## Why this study exists

The owner benchmarks OpenFlyover against MapDirector, a paid tool. Reference film, made by the owner with MapDirector
from their own multi-day glacier tour around Arolla (Valais), unlisted on YouTube:
https://www.youtube.com/watch?v=Xo20A_Inb3E (« Arolla glacier tour 1920x1080 », 130 s, 3911 frames, rendered in 1080p
in 3 min, that is about 46 ms per image). The owner's words (2026-11-10): « J'ai l'impression que ma caméra n'est pas
faite pour aller aussi près avec l'inclinaison ». The owner does not have the GPX of that tour.

What the MapDirector film shows (judgement from stills of its first 55 s; the frames are not committed because the
repo is public and they carry MapDirector's branding):

- The camera is not low: it stands several hundred metres above the relief and about 1 to 2 km from the marker.
- It is little tilted: the view axis is about 20° below the horizontal, the sky fills the top 10 to 15 % of the frame,
  distant peaks are named on the horizon. That is what reads as "low and close".
- It is not always behind the marker: one night shot looks at it from the side and from higher (35 to 40°).
- Glowing track line, one colour per day, grading, low sun with long hard shadows, a night scene.
- Its credits name Mapterhorn (our elevation source) and MapTiler: the difference is not the data.

## Owner decisions so far (2026-11-10)

- Chosen for 8.0: (1) a camera that stays low and close in a "logical" way, (2) sharp shadows near the camera,
  (3) glowing line and contrasted grade on by default. Export supersampling only if it does not need a powerful GPU
  (« Si il faut que la personne ait une carte graphique de fou ça vaut pas le coup ! »): not started.
- Camera, in the owner's words: « Il faudrait que ce soit logique ! Si c'était pas logique de calculer la hauteur en
  fonction de toute la trace au lieu de localement, changeons cela ! Le but est d'avoir un rendu similaire à ce que fait
  mapdirector mais avec des réglages cohérents et compréhensibles ».
- Look: « Allumé par défaut » (no new button). See the PR of `feat/default-look`.
- Relief: try first WITHOUT a sideways detour of the camera around the relief, decide after seeing the result.
- « Focale » was removed in #524 (merged): the field of view is always 50° (`CAMERA_FOV_DEG`).
- Product rules that apply: no planning features, simple and straightforward (no duplicated setting, no silent
  override, no wrong hint), realistic but pretty, free, static, light on an ordinary computer, flawless automatic
  render measured by the app rather than handed to the user.
- Machine rule for renders: one headless Chrome render at a time on the GPU (the owner said no to two at once on
  2026-11-11, the machine froze once with several).

## The code as it is on master (c7f228ed)

- Flyover distance: `autoDistanceM(path) = clamp(0.04 × track length, 600 m, 4000 m)` (`src/flyover/camera.ts`,
  `CHASE_DISTANCE_FRACTION`, `CHASE_DISTANCE_MIN_M`, `CHASE_DISTANCE_MAX_M`), times `camera.distance` (slider 0.3 to
  4, `CAMERA_RANGES` in `src/flyover/cameraSettings.ts`, also the validity range of a saved project) and a style factor.
- « Hauteur » stops (`CAMERA_HEIGHTS`): « Au ras » distance 0.5, pitch 20°; « Proche » 1, 30°; « Hélicoptère » 1.3, 25°;
  « Drone haut » 1.8, 55°; « Avion » 3, 35°; « Satellite » 4, 85°. Default camera: distance 1, pitch 30°, lead room 15 %,
  bank 3°.
- Clearance: 80 m over the smoothed ground (`MIN_GROUND_CLEARANCE_M`), 40 m over the real terrain
  (`MIN_TERRAIN_CLEARANCE_M`); line of sight: the camera is raised so the relief does not hide the marker
  (`lowestClearY`, `LINE_OF_SIGHT_SAMPLES` 48, `LINE_OF_SIGHT_END_M` 100, `LINE_OF_SIGHT_MIN_CLEARANCE_M` 20,
  `LINE_OF_SIGHT_MAX_GAIN` 20); the film camera (`src/flyover/filmCamera.ts`) anticipates raises by taking the maximum
  of the raises at nearby film instants.
- Other scales tied to the track length (a new distance rule must stay consistent with them): `HEADING_WINDOW_FRACTION`
  0.02 (150 to 1500 m) through `turnSmoothingM`; `GROUND_WINDOW_FRACTION` 0.25 of it capped at 150 m, `GROUND_SPEED_S`,
  `GROUND_SPEED_MAX_M` 500; `aimSigmaM` capped at 6 % of autoDistance × distance (`AIM_LINE_MAX_SHARE`); heading, slope
  and camera-line radii use `speedMps` = length / duration; `LINE_OF_SIGHT_MAX_GAIN` × distance; in `filmCamera.ts`
  and `cameraKeys.ts`, `autoDistanceM` is the unit of the camera keys and `cameraKeyEaseM` scales with speed;
  `FlyoverRig` (`flightDistanceM`) sets the marker size reference; `ExportController` (about line 668) and
  `OfflinePanel` (about line 42) use `autoDistanceM` for the tile area and height.

## Study 1: five distances on a stand-in track (measured)

Stand-in track `arolla.gpx`: 58.1 km, 1170 points about 50 m apart, 6 days of 7 h, D+ 9468 m, Arolla, Pas de Chèvres,
Dix, La Luette, Serpentine, Vignettes, Pigne, Évêque, Bertol, Arolla. Hand-placed waypoints, not real paths, but real
glacier relief at the right scale. Real app on the GPU (GTX 1060 via D3D12), canvas 1460×821 (16:9), flyover 130 s,
atmosphere and other settings at their defaults; the film is 181 s because 5 nights add pauses. Moments: 15, 35, 50,
70, 90 % of the flight (film t = 32.3, 68.7, 95, 127.4, 163.8 s). autoDistanceM = 2326 m; ground speed 477 to 510 m
per film second.

| Variant | Real distance (m) | Height above ground (m) | Pitch to marker | Raised by relief (m) | Frame heights/s |
| --- | --- | --- | --- | --- | --- |
| V1 « Proche » (1.0, 30°) | 2379 / 3268 / 2555 / 2386 / 2716 | 1117 / 2311 / 1739 / 1563 / 2254 | 32 / 52 / 38 / 32 / 42° | 0 / 1360 / 0 / 633 / 0 | 0.21 / 0.16 / 0.21 / 0.23 / 0 |
| V2 « Au ras » (0.5, 20°) | 1316 / 2240 / 1334 / 1267 / 1489 | 518 / 2167 / 785 / 1100 / 1328 | 34 / 61 / 35 / 30 / 42° | 326 / 2 / 0 / 626 / 4 | 0.42 / 0.24 / 0.41 / 0.43 / 0 |
| V3 300 m (0.129, 20°) | 373 / 609 / 359 / 344 / 442 | 186 / 518 / 330 / 599 / 346 | 41 / 62 / 38 / 35 / 48° | 106 / 34 / 6 / 181 / 9 | 1.47 / 0.90 / 1.52 / 1.59 / 0 |
| V4 600 m (0.258, 15°) | 700 / 1178 / 700 / 672 / 809 | 304 / 1216 / 489 / 912 / 500 | 34 / 60 / 34 / 30 / 43° | 220 / 34 / 0 / 380 / 70 | 0.78 / 0.46 / 0.78 / 0.81 / 0 |
| V5 1000 m (0.430, 15°) | 1151 / 1951 / 1164 / 1114 / 1318 | 469 / 1922 / 655 / 1070 / 1094 | 33 / 60 / 34 / 30 / 42° | 365 / 45 / 0 / 633 / 64 | 0.48 / 0.28 / 0.47 / 0.49 / 0 |

"Frame heights per second": track metres per film second divided by the ground height the frame shows at the
marker's depth (2 × distance × tan 25°). The 0 at 90 % is a pause of the film. V3 and V4 are below the 0.3 minimum of
the slider; they were set through `setSetting` (the camera code has no clamp; `isValidCamera` would reject them in a
saved file). `auditFilmCamera` with the app's terrain sampler: 0 issues for V1 to V5 over the whole flight and over
±3 s at each moment, but the sampler had full detail only near the last view.

Reading (judgement): the ground does not streak at 600 m or more; at 300 m it is clearly too fast. No variant shows
the horizon. Sheets: `sheets/sheet-ALL.jpg` (variants as rows), `sheets/sheet-V1.jpg` to `sheet-V5.jpg`.

## Study 2: why the camera does not stay low (measured)

View-axis pitch (from the app camera's forward vector), same five moments. Horizon position from the top of the frame
= (25° − axis pitch) / 50°, negative = above the frame. Rules switched off one at a time with temporary flags
(`study-hook.patch`): a = line-of-sight rule off (the 40 m check under the camera kept), b = 80 m clearance off,
c = lead room 0, e = raise anticipation off, d = a+b+c, f = a+b+c+e.

| V5 (asked 15°) | 15 / 35 / 50 / 70 / 90 % |
| --- | --- |
| base | 27 / 56 / 31 / 26 / 42 (horizon −4 % to −62 %, above the frame) |
| a | 13 / 24 / 12 / 23 / 15 |
| b | 27 / 56 / 31 / 25 / 42 (no effect) |
| c | 31 / 60 / 35 / 30 / 42 (4° worse) |
| d | 15 / 26 / 15 / 24 / 15 |
| e | 14 / 14 / 12 / 39 / 18 |
| f | 15 / 15 / 15 / 15 / 15 (horizon 20 % from the top) |

V4 (asked 15°): base 28 / 56 / 31 / 26 / 43, f 15 everywhere. V2 (asked 20°): base 28 / 57 / 32 / 26 / 42, f 20
everywhere (horizon 10 % from the top).

- Main cause: the line-of-sight rule (`lowestClearY`): alone it brings V5 from 26 to 56° down to 12 to 24°, mean error
  about 4.6°. The anticipation explains the 56° at 35 % (14° without it) but helps at 70 % (39° without it). The 80 m
  clearance does nothing alone. Lead room makes the axis about 4° shallower. The aim point is within 18 m of the marker
  height (not the cause). The marker sits 51 to 59 % from the top of the frame and stayed in frame in all 105 states.
- A horizon at 12 % from the top needs an axis of about 19°: 15 to 20° is right; the horizon leaves the frame only
  because the axis is pushed to 25° or more.
- With all four rules off: the marker was hidden in 0 of 105 states (a sampled line to the marker centre, not a render
  check), the camera never came below 40 m (minimum 90 m, V4 at 15 %); the smallest clearance of the camera-to-marker
  line over the relief was 4 to 9 m at 15, 35 and 70 % for V4 and V5, 17 to 30 m at 50 %. Only these states were
  sampled: nothing is known about the rest of the flight.
- Sheets: `sheets/sheetW-V5-compare.jpg` (V5 today above V5 with the line-of-sight rule off), `sheetW-V5-a.jpg`,
  `sheetW-V4-d.jpg`, `sheetW-V5-d.jpg`, `sheetW-V4-f.jpg`, `sheetW-V5-f.jpg`, `sheetW-V5-base.jpg`. Reading
  (judgement): with the line-of-sight rule off, the horizon and distant peaks appear at 15, 35, 50 and 90 %, like the
  competitor; at 70 % the camera is still steep; V4 and V5 frame alike.

## What follows from it

1. **Tilt (in progress):** keep the asked tilt and rise only as much as the marker's visibility needs. Branch
   `feat/camera-keeps-tilt`, its own PR and `handover/camera-keeps-tilt/`. The sideways detour is probably not needed.
2. **Distance rule (open decision, nothing built):** proposal made to the owner, not agreed yet: base distance =
   clamp(about 2.4 s of marker travel in the film, 600 m, 4000 m) instead of 4 % of the track length. For a 60 s
   flyover (the default) it gives today's distance; for the owner's 130 s film, « Proche » goes from 2.3 to 1.1 km and
   « Au ras » from 1.2 km to 540 m, in the zone where the ground does not streak (0.5 to 0.8 frame heights per second).
   Show the distance in metres next to « Hauteur ». Saved projects must keep their framing (freeze the old rule for
   them, see `docs/project-format.md`). Must stay consistent with the scales listed above. Distance matters less than
   the tilt: at 600 m and 1000 m the stills look alike.
3. **Not investigated:** the snow looks burnt out (nearly white) in many stills of the stand-in track (July, midday):
   exposure or imagery, unknown.

## What a cloud session can and cannot do

No GPU there: the scripts here need the real app in Chrome on a GPU. What can be done without one: replay the film
camera with the pure functions (`computeFilmView`, `replayFilm`, `auditFilmCamera` in `src/flyover/filmAudit.ts`,
with a height sampler such as the fixtures of `src/flyover/__fixtures__/`), count frames, compute pitches, horizon
positions and line-of-sight clearances. Renders and stills must be redone on the owner's machine (one at a time).
