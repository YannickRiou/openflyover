# Camera distance study: notes for the next agent

Question: how should the flyover camera distance be set on a long track shown in a short film, and why does the camera not stay low with a low pitch asked. Nothing here is a product change.

## Run order

All commands from the repo root, Node 24 (`export PATH=~/.nvm/versions/node/v24.22.0/bin:$PATH`), `node_modules` linked or installed. Pick one output folder `OUT` (any writable directory). Every script reads and writes inside `OUT`.

1. `node handover/camera-distance/gen-gpx.mjs OUT/arolla.gpx` writes the stand-in track (58.1 km, 1170 points, 6 days). Or copy the supplied `arolla.gpx` to `OUT`.
2. `git apply handover/camera-distance/study-hook.patch` adds the temporary hook and rule flags (see below). Never commit it. `git checkout src` removes it.
3. `node handover/camera-distance/study.mjs REPO OUT` (REPO = absolute repo path). Add `probe` as third argument to only load the track and write `probe-ui.png`. Starts Vite on port 5301 (cache `node_modules/.vite-study`) and headless Chrome. Runs V1 to V5 at 5 moments. Writes `V<n>-<i>.png`, `results.json`.
4. `node handover/camera-distance/study2.mjs REPO OUT` runs V2, V4, V5 under 7 rule configurations at the same 5 moments. Writes `W-<variant>-<config>-<i>.png` for the configs listed in `SHOTS`, and `results2.json`.
5. `python3 sheets.py` (contact sheets `sheet-V1..V5.jpg`, `sheet-ALL.jpg`), `python3 sheets2.py` (`sheetW-*.jpg`), `python3 an2.py` (prints the results2 table). These three scripts take the output folder as first argument (`python3 sheets.py <OUT>`, default the current folder); the `FONT` path is the system DejaVu font. They need ffmpeg (drawtext) and DejaVu fonts.

Headless Chrome must use the real GPU, never SwiftShader: args `--no-sandbox --ignore-gpu-blocklist --use-gl=angle --use-angle=gl`, env `MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA GALLIUM_DRIVER=d3d12 LD_LIBRARY_PATH=/usr/lib/wsl/lib` (WSL). The scripts already set them. Adapt for another machine. The page is forced to French through `navigator.language`. On a shared machine run under `flock` on a GPU lock. A full run took about 25 min (study.mjs) and 15 min (study2.mjs).

## The patch (`study-hook.patch`)

Applies on c7f228ed with `git apply`. Three files, 11 lines added:
- `src/scene/FlyoverRig.tsx`: `window.__study = { path, clock, frame, engine, follow, getThree }` (`getThree` is the react-three-fiber `get`, so `getThree().camera` and `.size` are the live ones).
- `src/flyover/camera.ts` (`lowestClearY`), reads `globalThis.__ovr`: `noLos` checks only the sample at the camera (f = 0), so the 80 m check under the camera stays and the rest of the sight line is ignored; `noClear` replaces the 80 m taper by 0, leaving the 20 m minimum and the 40 m terrain rule.
- `src/flyover/filmCamera.ts` (`flightAt`), `__ovr.noAnticip` skips the anticipated raise (the camera then uses its own raise at that instant).
Lead room off is a setting (`leadRoomPct` 0), not a patch.
Configurations in study2: base; a = noLos; b = noClear; c = leadRoomPct 0; d = a+b+c; e = noAnticip; f = a+b+c+e.

## Setup used by both scripts

The track is loaded through `importTrackFiles` (`/src/ui/projectActions.ts`), the activity dialog is skipped, `flyoverDurationS` is set to 130, atmosphere and other settings stay default, canvas about 1460 x 821 (16:9). Moments are progress 0.15, 0.35, 0.5, 0.7, 0.9, converted with `clock.timeAtProgress` (film t = 32.3, 68.7, 95, 127.4, 163.8 s; the film is 181 s because 5 nights are added pauses; the 0.9 moment is inside a pause, so ground speed is 0 there). Each state: set `camera` settings (new object each time, so the raise table resets), nudge the progress by 1e-6 and back, wait until `terrainStats.pendingVisibleTiles` is 0 and the camera stays put, repeat until the app camera equals `filmViewAt` within 1 m (the preview only re-places the camera when the progress changes, not when tiles arrive), then screenshot and measure.

Variants: V1 distance 1 pitch 30; V2 0.5 / 20; V3 fixed 300 m (camera.distance 0.129) / 20; V4 600 m (0.258) / 15; V5 1000 m (0.430) / 15. camera.distance = metres / autoDistanceM (2325.8 m for this track). V3 and V4 are below the slider minimum 0.3 and `isValidCamera` would reject them; they were set directly with `setSetting`, `camera.ts` has no clamp.

## results.json (study.mjs)

`{ info, auto, times, results }`. `info`: lengthM, openingS, flightS, total, settings, tracks. `auto`: autoDistanceM. `results[]`: `{ id, name, setDistance, pitchAsked, moments[], audit }`. Each moment:
- `dist`: distance app camera to marker (m); `horizM`: horizontal part.
- `heightAbove`: camera height above `engine.sampleHeight` under it (m); `heightAboveMarker`.
- `pitch`: asin((cam.y - marker.y) / dist), camera-to-marker pitch, degrees.
- `raiseM`: `view.raiseM` from `filmViewAt`, how far the clearance rules lifted the camera (its own raise, before the time anticipation).
- `speed`: m of track per film second, (length x (progress(t+0.25) - progress(t-0.25))) / 0.5.
- `frameM`: 2 x dist x tan(25 deg), height of ground the 50 degree frame shows at the marker depth. `framesPerS` = speed / frameM.
- `engineVsView`: gap between the app camera and a fresh `filmViewAt` (0 after settling), `pending`, `state`, `progress`, `timeS`, `fraction`, `file`.
- `audit`: `{ windows: [5 arrays], whole }` of `auditFilmCamera` issues (`kind`, `startS`, `endS`, `worst`), 30 fps, windows +-3 s around each moment, `whole` the flight. All empty in the run.

## results2.json (study2.mjs)

`{ times, results[] }`, one entry per variant x config x moment: `variant`, `config`, `moment`, `fraction`, `timeS`, `file` (null when no screenshot) and
- `axisPitch`: pitch of the view axis, degrees below horizontal, from the app camera's forward vector, -asin(forward.y).
- `horizonFromTop`: (25 - axisPitch) / 50. Share of the frame height from the top edge to the horizon for the 50 degree vertical field of view. Negative: the horizon is above the top edge. For a horizon 12 % from the top the axis must be 19 degrees. Roll (bank 3 degrees) and Earth curvature are ignored.
- `camToMarkerPitch`, `dist`, `heightAbove`, `camY`, `hAboveMarker`, `hAboveAim`.
- `markerY`, `aimY` (`view.aim`, the aim before lead room, smoothed ground + lift), `targetY` (aim after lead room).
- `markerShareFromTop`, `markerShareX`, `markerInFrame`: marker projected with the app camera, NDC.
- `losMinClear`, `hidden`: 201 samples on the camera-marker line, all but the last 3 %, minimum of line height minus the loaded terrain height (m); `hidden` = minimum below 0. A small positive minimum is a skim.
- `low`: camera less than 39 m above the loaded terrain under it (the 40 m rule).
- `raiseM`.

## Caveats

- The track is a stand-in: hand-picked waypoints around Arolla, 25 m wobble, not real paths. Real relief, wrong routes.
- `engine.sampleHeight` has full detail only where tiles were loaded for the last view. The audit and the sight-line check read it as it was, so "0 issues" and "never hidden" are not proof for the unvisited parts of the flight.
- Only 5 moments per configuration (25 states per variant). Pitch values at other moments may differ, especially where the relief raise is large.
- The roll of the camera is ignored in the horizon position and the marker position.
- The hidden-marker check is a sampled line to the marker centre, not a render test.
- The 90 % moment is a pause of the film (speed 0).
- Pitch of the camera-to-marker line differs from the pitch asked even with raise 0: the camera is placed around the smoothed aim, not around the marker, and lead room shifts the aim. The cause was not isolated.

## Raw PNGs

The raw stills (`V<n>-<i>.png`, `W-*-<i>.png`, `probe-ui.png`) exist only on the owner's machine, in the scratchpad folder `/tmp/claude-1000/-home-madcreator-openflyover/409e43d3-d080-4ea2-b0c1-ceb874dbf522/scratchpad/camera-study/`. They are not in this folder. `sheets/` holds the contact sheets built from them (640 px per still), which is enough to read the study. Rerun steps 3 and 4 to regenerate the stills; `sheets2.py` needs `V5-<i>.png` (from study.mjs) for the V5 as-today row.
