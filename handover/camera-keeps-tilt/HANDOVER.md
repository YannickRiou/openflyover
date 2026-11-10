# Handover: the flyover camera keeps the tilt asked

Branch `feat/camera-keeps-tilt` (from origin/master c7f228ed, « Focale » removed, field of view always 50°, `CAMERA_FOV_DEG`).
State: NO source change is committed. Only measurement and notes. Typecheck, lint, vitest and build were NOT run on this branch (nothing to check: `src/` equals master).

## 1. Goal and constraints (as given by the owner)

OpenFlyover turns a GPS track into a 3D flyover film. The owner wants the look of a competitor's films: the camera looks towards the horizon (view axis about 15 to 20° below the horizontal, sky in the top 10 to 20 % of the frame), standing several hundred metres above the relief and about 1 km from the marker. The tilt asked (`camera.pitchDeg`, « Hauteur » › « Au ras » = 20°) is not kept in the mountains.

Goal: the flyover camera keeps the tilt asked wherever the marker can be seen from there, and departs from it only as much as is needed for the marker to stay visible. The promise that the relief never hides the marker and that the marker stays in the frame is kept. Find why the lift is so large and change the rule, not the tests' meaning. Smallest change that works: a smaller margin, a lift only where the line is really blocked, an anticipation that eases instead of taking the worst case. NO sideways detour around the relief (the owner wants to try without it first; if it is needed, stop and report the evidence).

Hard constraints:
- The camera stays a pure function of the film time (no state from frame to frame; `filmAudit.test.ts` tests it).
- No jolt, no whip: limits of `auditFilmCamera` (`src/flyover/filmAudit.ts`) hold; `cameraSmoothness.test.ts`, `camera.test.ts`, `markerVisible.test.ts`, `filmAudit.test.ts`, `filmCamera.test.ts` stay green. Do not weaken an assertion; if one encodes the old over-lift itself, change it and list each change with the reason.
- The 40 m clearance over the real terrain stays (`MIN_TERRAIN_CLEARANCE_M`).
- No new setting, no interface text, no change to `autoDistanceM`, to the « Hauteur » stops or to the camera presets.
- Far views (« Avion », « Satellite », opening and closing shots) must not get worse.

Evidence to deliver (the owner decides on pictures and numbers): whole flights, every frame at 30 fps, before and after, for: Arolla stand-in track with « Au ras » (distance 0.5, pitch 20), « Proche » (1, 30), and distance 0.43 / pitch 15; the home page example (« Essayer avec l'exemple ») with « Au ras » and « Proche »; the fixtures of `markerVisible.test.ts`. Per case: distribution of the gap between view-axis pitch and pitch asked (median, p90, max), share of frames where the relief hides the marker (must be 0; say what the check does not cover), smallest camera clearance over terrain, `auditFilmCamera` issues. Then contact sheets before/after at the same fifteen moments of the Arolla flight (3 rows of 5, moment and measured axis pitch written on each still) for « Au ras » and for 0.43 / 15°.

Finish: unit tests for the changed rule next to the existing ones (no new file), including a marker really behind a ridge (camera must still rise) and a case where the old rule rose for nothing (must not any more). Docs in the same commit: `ARCHITECTURE.md` camera passages (lines ~942-987, 1062-1097 describe sight line and anticipation), `docs/handbook/index.html` if it describes them (line 1312 mentions the film camera), one entry under `## 8.0.0 (unreleased)` of `CHANGELOG.md` (English, bold title, what changes for the person, then identifiers; says films in the mountains are framed lower than before). No em dash, no emoji. Checks: `npm run typecheck`, `npm run lint`, full `npx vitest run` under the heavy lock (242 files, 3833 tests on master), `npm run build`. One commit, French message `feat(caméra) : …`, no Co-Authored-By. Report under 450 words with tables and test changes. If constraints cannot all be met, say which one gives and stop rather than relax it.

Machine rules used: node 24 at `~/.nvm/versions/node/v24.22.0/bin` (system node too old; `npx` fails without PATH, call `node node_modules/vitest/vitest.mjs run ...`); heavy CPU through `flock .../scratchpad/heavy.lock`, GPU renders through `flock .../scratchpad/gpu.lock`; real GPU only (never SwiftShader).

## 2. Why the old rule over-lifts (code reading, then measured)

All in `src/flyover/camera.ts`, function `lowestClearY` (~line 989-1035), called from `computeCameraView` (~line 662):
- For samples `f` (0 = camera, 1 = marker) along camera to marker, the camera height needed is `to.y + (floorY(f) - to.y) / (1 - f)` (`floorAt`). So a shortfall of `s` metres at fraction `f` becomes a camera lift of `s / (1 - f)`: 10x at f = 0.9 (100 m from the marker at 1 km). This is the geometric amplification of a lift applied at the camera end for an obstacle near the marker.
- Clearance asked at `f`: `max(MIN_GROUND_CLEARANCE_M * (1 - f), LINE_OF_SIGHT_MIN_CLEARANCE_M)` = 80 taper, floor 20 m. The 80 m term at f = 0 IS the "80 m over the smoothed ground" rule (only place `MIN_GROUND_CLEARANCE_M` acts). Beyond f = 0.75 the 20 m floor dominates, so a line passing 8 m above ground near the marker (not hidden at all) still asks `(20-8)/0.1` = 120 m of lift.
- Checked end: `left = max(LINE_OF_SIGHT_END_M (100) / dist, 1 / LINE_OF_SIGHT_MAX_GAIN (20))`, samples up to `1 - left`. The app's own hidden test, `lineOfSightClearance` in `src/scene/labelModel.ts` (skip `LINE_OF_SIGHT_SKIP_END_M` = 150 m at the end), ignores the last 150 m, so the camera rule demands more than the app needs between 100 and 150 m from the marker, where amplification is 7 to 10x.
- Anticipation: `anticipatedRaise` in `src/flyover/timeSmoothing.ts` (hold 1 s, reach 3 s, step 0.5 s, `ANTICIPATION_EASE_M` 80) applied in `flightAt` (`src/flyover/filmCamera.ts` ~line 834) takes the soft maximum of the raises of instants within +-3 s. The Arolla stand-in goes at about 450 m/s of ground, so +-1 s is +-450 m of track at full weight: one bad instant lifts a whole stretch. BUT turning it off gives jolts (see 4): the anticipation is also what makes the raw per-frame raise smooth. Any change must keep that smoothing.
- Grid ground, not real ground: floors are checked against `terrainGrid` (cells `cellM`, 37 to 150 m) plus `reliefGround`, and a coarse grid (`LINE_OF_SIGHT_COARSE_CELL_M` 150, 2x2 samples). The 20 m margin also covers what the grids miss: lowering it increases hidden frames (see 4).

## 3. Changes made

None kept in `src/`. Temporary hooks used for the study were saved as `scaffolding/debug-hooks.patch` and reverted:
- `src/scene/FlyoverRig.tsx`: `window.__study = { engine, path, clock, frame, follow, getThree }` after `const aspect`.
- `src/scene/filmView.ts`: `export { viewInputs as __viewInputs }`.
- `src/flyover/camera.ts` `lowestClearY`: `globalThis.__rule` overrides `end`, `maxGain`, `taper`, `minClear`, and `noLos` (skip the floor loop).
- `src/flyover/filmCamera.ts` `flightAt`: `globalThis.__rule.noAnticip` skips the anticipation.
Apply with `git apply handover/camera-keeps-tilt/scaffolding/debug-hooks.patch` before running the scripts, revert before committing.

## 4. Measurements (all MEASURED, in the real app on the GPU unless noted)

Method: `scripts/whole.mjs` loads `arolla.gpx` (stand-in, 58 km, 130 s flyover, film 181 s with opening and closing), sets the camera, sweeps the film every STEP_S s waiting for tiles, then replays every frame at 30 fps with `computeFilmView` for the old code (copy in `scaffolding/flyoverOld`) and the current code with each variant, against the same terrain (`engine.sampleHeight`, fresh sampler per variant, terrainVersion 0). Gap = view-axis pitch (camera to `view.target`) minus pitch asked, over the flight part (5101 frames). The gap includes a few degrees of negative offset from « Espace devant » (lead room 15), so signed median near -3 means "at the asked tilt". Hidden "app" = `lineOfSightClearance(position, marker) < 0` (the app's own test); "dense" = 300 samples to 97 % of the line. unknownFrames was 0 everywhere. No audit issues for old/base.

Arolla, distance 0.5, pitch 20 (« Au ras »), flight frames 5101:
| variant | gap med | p90 | max | hidden app | hidden dense | min camera clearance m | audit |
|---|---|---|---|---|---|---|---|
| old (= master) | 8.8 | 28.4 | 38.0 | 19 | 60 | 129 | none |
| minClear 5 | 6.0 | 25.5 | 36.1 | 42 | 108 | 112 | none |
| taper 0 (flat 20 m) | 8.6 | 28.4 | 38.0 | 19 | 60 | 120 | none |
| minClear 5 + taper 0 | 5.1 | 24.7 | 35.8 | 60 | 134 | 83 | none |
| minClear 5, taper 0, end 150 | 0.3 | 23.3 | 32.7 | 104 | 346 | 48 | none |
| minClear 0, taper 0, end 150 | 0.1 | 22.4 | 32.1 | 129 | 378 | 31 | 1 low (9 m short) |
| end 150 only | 4.0 | 25.9 | 34.5 | 47 | 265 | 129 | none |
| minClear 10 + taper 0 | 6.4 | 25.9 | 36.6 | 44 | 103 | 116 | none |
| minClear 10, taper 0, end 150 | 1.1 | 24.2 | 33.3 | 81 | 320 | 73 | none |
| no line of sight at all | -2.1 | 4.2 | 16.1 | 713 | 1068 | -30 | 11 low (up to 70 m short) |
| no anticipation | -0.3 | 18.5 | 38.1 | 23 | 110 | 57 | 32 jolts (worst 0.19), 1 whip 298 |
| no LOS, no anticipation | -3.8 | 0.0 | 16.3 | 863 | 1210 | 39 | 7 jolts |
| minClear 5, taper 0, no anticipation | -2.0 | 13.2 | 35.9 | 113 | 277 | 40 | 23 jolts, 1 whip 286 |
| no LOS, no anticip, lead room 0 | 0.0 | 1.0 | 20.3 | 863 | 1210 | 39 | 6 jolts |
(Files: `results/whole-x1.json` (first 7 rows), `whole-x2.json`, `whole-x3.json`; `scripts/wsum.py` prints them. Same terrain within a file; x1/x2/x3 are separate sessions but "old" repeats exactly: 8.8 / 28.4 / 38.0.)

FRAME-WISE LOWER BOUND (key result, `result.ideal` in `whole-x3.json`, arolla:ground, 2551 frames, every 2nd): smallest raise of the unlifted camera so that the app's `lineOfSightClearance` is at least a margin, on the real terrain, per frame:
- margin 0 m: gap median -2.8, p90 5.9, max 42.0
- margin 5 m: median -2.8, p90 6.7, max 42.7
- margin 10 m: median -2.7, p90 7.4, max 43.4
- camera with no lift at all: median -3.8, p90 0.0, max 16.0
So a rule that lifted only as needed would sit at p90 about 6 to 7 degrees over the asked tilt, against 28 for the old rule: the old rule over-lifts a lot. The maximum (42) shows some frames really are behind a ridge. This is a per-frame bound, not smooth; a real rule will be above it.

Fixtures (node, `scaffolding/zzMeasure.test.ts`, 60 s flights at 10 fps, 3 tracks, steep synthetic massif, `results/fix-base.json` old vs unchanged, `fix-c.json` minClear 5 + taper 0): old rule on fixtures: gap p90 11 to 34 degrees, 0 hidden frames out of 600 in every case. With minClear 5 + taper 0: hairpins ground 1 hidden, close 1, d043 1, plane 4/600 (0.7 %, would FAIL `markerVisible.test.ts` limit 0.5 %), and one `low` audit issue (hairpins d043, camera min 37 m). Fixture gaps improved only a few degrees (hairpins ground p90 28.0 to 24.1). The fixtures are a 39 degree slope massif: other rules also lift there.

NOT measured: the home page example, « Proche » and 0.43/15 on Arolla (the x3 run was stopped during the 0.43 case), the stills and contact sheets (stills.mjs written, never run), far presets (« Avion », « Satellite »), after-change numbers (no change exists).

## 5. What did not work, and why

- Lowering `LINE_OF_SIGHT_MIN_CLEARANCE_M` and/or flattening the taper, alone: the median drops but the p90 hardly moves (28.4 to 24.7) while hidden frames triple (19 to 60). The grids miss relief; the margin is partly an error budget. A smaller margin is not enough alone.
- `end` 150: biggest median gain, but hidden frames 19 to 47 (dense 60 to 265) for a margin of 20 kept; so the 100 to 150 m stretch is not free either (the sprite is cut by relief there, `pullMarkerForward`).
- Removing the anticipation: p90 28.4 to 18.5 but jolts (32), so it can only be eased, not removed.
- Note the OLD rule is not at 0 hidden against the final terrain: 19 frames (app test, min -37 m), 60 dense (min -43 m), probably grid versus finer terrain loaded after. The "must be 0" target cannot be shown with this check even for master; compare to old, say so.

## 6. Ideas not tried (JUDGEMENT)

1. Close the gap between grid floors and real terrain: add a per-frame refinement using the fine sampler along the line (like `lineOfSightClearance`) to size the margin, so the margin can be small where the line is clear and big only where it is close; keep the result smooth through the anticipation window.
2. Make the lift amplification bounded: margin that shrinks toward the marker (`m0 * (1 - f) + m1`) so a shortfall near the marker costs `m0 + m1/(1-f)`, with `end` matching the app's 150 m only if hidden frames stay at or below old.
3. Anticipation: replace the soft maximum over +-3 s by something that eases (e.g. a weighted mean of the raises, then max with the instant's own raise), checking `cameraSmoothness.test.ts` and the audit (the 32 jolts with no anticipation show how much smoothing it provides).
4. Accept and report if the evidence says only a detour or a closer camera would do (a stated stop condition).

## 7. Tests: run so far and expected

Run: only the temporary measurement test (`zzMeasure.test.ts`), green, two runs (outputs above). Nothing else run on this branch.
Expect to break if the rule is made less lifting: `markerVisible.test.ts` (hidden share < 0.005 per preset, < 0.001 overall, min clearance > -8: the minClear 5 variant already breaks the plane preset), `camera.test.ts` tests "keeps the camera above the terrain behind the marker" (wall 3000 m, expects height >= 3000 + 80 - 0.5: concerns the 80 m taper), "raises the camera until the sight line clears a ridge", "clears a crest narrower than a ground cell"; `filmAudit.test.ts` and `cameraSmoothness.test.ts` (jolt limits) if the anticipation is changed. Do not weaken them; change only an assertion that encodes the old height itself and list it.

## 8. Remaining work, in order

1. `git apply` the debug hooks; run `scripts/whole.mjs` for the cases still missing (see section 9) to complete the "before" table; STEP_S 4 takes about 7 min per case on a cold tile cache.
2. Pick and implement the smallest rule change (section 6), iterating with variants in `whole.mjs` (variants are JSON files of `__rule` overrides; add hooks for new parameters) and with the node fixtures test.
3. Revert the hooks; unit tests next to existing ones in `src/flyover/camera.test.ts` (marker behind a ridge: camera still rises; old rose for nothing: now does not).
4. After numbers for all cases, then sheets with `stills.mjs` (before uses a Vite plugin that redirects `filmView.ts` to `src/flyoverOld/filmCamera.ts`), ffmpeg `hstack/vstack` with drawtext as in the study's `sheets2.py` (in `scratchpad/camera-study`, not copied).
5. Docs (ARCHITECTURE.md, handbook if relevant, CHANGELOG 8.0.0 entry), remove `handover/`, run typecheck, lint, full vitest under heavy lock, build; one commit `feat(caméra) : …`.

## 9. How to run (needs a real GPU; the cloud has none)

Layout: scripts take the repo path and an output folder. Copy `scaffolding/flyoverOld` to `src/flyoverOld` (it is a copy of `src/flyover` at c7f228ed minus its tests; delete again before committing) and apply `debug-hooks.patch`.
- `node scripts/whole.mjs <repo> <outDir> arolla:ground,arolla:close,arolla:d043,example:ground,example:close [variants.json] <tag>` (env `STEP_S`, default 1.5; cases `track:camera`, cameras ground, close, d043, helicopter, plane, satellite). Writes `<outDir>/whole-<tag>.json`; variants `old` and `base` always included; `lead` key sets `leadRoomPct`. Needs Chrome at `/usr/bin/google-chrome`, WSL GPU env (`MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA GALLIUM_DRIVER=d3d12 LD_LIBRARY_PATH=/usr/lib/wsl/lib`) already set in the script. Example run was one case per page; each case clears the site storage via CDP, otherwise the second page restores the first project.
- `node scripts/stills.mjs <repo> <outDir> <before|after> <ground|d043>`: 15 stills, JSON with measured axis pitch.
- `python3 scripts/wsum.py results/whole-x3.json`, `python3 scripts/fixsum.py results/fix-base.json` print the tables.
- Fixtures (no GPU): copy `scaffolding/zzMeasure.test.ts` to `src/flyover/`, run `RULE='{"minClear":5}' MEASURE_OUT=out.json node node_modules/vitest/vitest.mjs run src/flyover/zzMeasure.test.ts` (needs the debug hooks for RULE; the "old" side uses `src/flyoverOld`).
- Without a GPU you can check: all pure camera functions, `auditFilmCamera`, `lineOfSightClearance`, unit tests, fixtures. You cannot check: real terrain (Arolla, example), stills, contact sheets, the hidden-marker check against loaded tiles.

## 10. Open doubts

- Sweep fidelity: terrain was loaded by a sweep with the new camera at STEP_S 3 to 4 s, then all frames replayed against the final engine state; frames close in time reuse tiles at whatever LOD remained. Old and variants share the same data, so comparisons hold, absolute hidden counts depend on it.
- The hidden check does not cover: tiles at coarser LOD than the screen showed, the last 3 % (dense) or 150 m (app test) of the line, the marker sprite's own height and size, buildings, and the real depth test on the GPU. 0 hidden is not even reached by master here.
- The Arolla track is a stand-in (450 m/s of ground speed); the real flights may differ.
- Untested: whether easing the anticipation alone (idea 3) gets near the lower bound without jolts.

## 11. Left out of the handover

`scratchpad/camera-tilt/profile` (Chrome profile with cached tiles, large, regenerable), `v0.json` (empty variants), and the study's images and `results*.json` in `scratchpad/camera-study` (earlier study: 15 sampled states, quoted in the goal). No images were produced in this session.
