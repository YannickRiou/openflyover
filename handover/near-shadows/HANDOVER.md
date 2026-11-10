# Near shadows: handover

> Rebased on master c7f228ed on 2026-11-11 (the « Focale » commit fee9bbd7 was squash-merged as #524): the feature commit `1d594dc0` is now `ed573175` on `feat/near-shadows`, and the prototype `f1790b72` is now `f252043f` on `proto/shadows-two-maps` (on top of `3782b154`, the same feature commit). The old hashes below refer to the same changes. Pull request: see the PR of `feat/near-shadows`. Related: the camera that keeps its tilt (PR #526) makes the view look towards the horizon, the case this rule must hold for; the camera study is PR #525.


Branch `feat/near-shadows`, commit `1d594dc0` (the feature), plus one WIP commit on top (this note, scripts, results, a one-line debug hook). Nothing pushed. Branch `proto/shadows-two-maps` (commit `f1790b72`) is a throwaway measurement, do not merge.

Legend: **[M]** measured, **[J]** judgement (my reading of images or reasoning).

## 1. Goal and owner constraints

Relief shadows should read as sharp near a low camera as in a competitor's films. Constraints:

- The app must not need a powerful graphics card: no extra GPU cost, so one shadow map (no cascades, no second map).
- The result is a pure function of the view and the terrain (no state between frames: each export frame is rendered alone and preview must equal export).
- No crawl or shimmer: the map origin snaps to its texel grid, the extent is quantised (steps of 2^(1/8), about 9 %). Both already existed in `fitShadowFrustum`.
- No acne, no peter-panning.
- Far views (overview, region shots, "Avion", "Satellite") must look as before. No new setting, no new text.
- Docs in the same commit: `ARCHITECTURE.md` (Terrain cast shadows bullet) and one `CHANGELOG.md` entry under `## 8.0.0 (unreleased)`. Base: `fee9bbd7` (`origin/feat/remove-focal`).

## 2. What `1d594dc0` does

Before: shadows drawn over `max(30 km, 5 x (camera y - lowest drawn tile y))`, one 4096 map on a desktop, texel 6 to 12 m.

After (`src/scene/terrainShadow.ts`):

- `FULL_SHADOW_AIM_M = 2000` (line 23), `NEAR_SHADOW_DISTANCE_M = 3000` (line 25).
- `shadowDistance(cameraY, terrainMinY, aimDistance = Infinity)` (line 92): `far = old rule`, `near = 30000 * (aim / 2000)^2`, result `min(far, max(3000, near))`. Aim of 2 km or more, or `Infinity`: exactly the old distance.
- `groundDistance(eye, forward, groundY, maxM)` (line 105): marches the view axis, first step 25 m, steps growing by 8 %, returns the first t whose point is under the ground, `Infinity` if none within `maxM`. **This is the open issue (section 6).**
- `TerrainShadow` takes a third constructor argument `groundUnder` (line 245); `fit` (line 325) calls `groundDistance(_eye, _forward, groundUnder, FULL_SHADOW_AIM_M)`.
- `src/scene/AtmosphereLayer.tsx` (about line 282): builds `groundUnder(point)` = local y of the exaggerated ground under a local point, through `frame.toLonLat`, `engine.sampleHeight`, `frame.toLocal` (exaggeration read from the store at call time). The layout effect now depends on `frame` too.
- Biases unchanged (normalBias 1.5 texel, depth bias 2 m constant). The images show no acne and no detachment [J].
- Why aim distance and not height: the sample's terrain box reaches -490 m (sea) while the ground is at 1.5 to 2.2 km, so height over the lowest tile was useless [M]. Why squared: it keeps "Avion" (aim 2.0 to 2.2 km) at the full 30 km, a linear law would have cut it to 10 km [M].
- Tests in `src/scene/terrainShadow.test.ts` (23 pass): `shadowDistance`, `groundDistance`, texel ratio, quantisation, texel grid, class with `groundUnder`.
- Checks on `1d594dc0` [M]: typecheck clean, lint exit 0 (warnings only, pre-existing), full vitest 242 files / 3843 tests pass, build OK.

## 3. Measurements on the real app (GPU, 1920x1080, home page example, atmosphere on, sun 17h, 4096 map)

Texel (m), before then after, aim = distance from camera to ground along the view axis [M]:

| View | Aim (m) | Before | After |
|---|---|---|---|
| Au ras (distance 0.5, pitch 20) | 440 to 500 | 10.4, 12.3, 6.2 | 1.09, 1.30, 1.09 (D = 3 km floor) |
| Proche (distance 1, pitch 30) | 700 to 870 | 10.4, 12.3, 10.4 | 1.41, 2.0, 2.0 (D = 3.7 to 4.3 km) |
| 300 m | | about 11 | about 1.1 |
| 1 km | | about 11 | about 2.8 (estimated, texel about D / 2700 calibrated on the above) |
| 5 km, 30 km | | about 11 | unchanged |

Survey with an earlier linear rule (K = 5), not delivered, for context: Avion aim 2.0 to 2.2 km gave D 10 to 11 km; Satellite aim 6 km gave D 30 to 32 km [M]. With the delivered squared rule Avion stays at 30 km [reasoning, not re-rendered].

Frame time, `gl.render` x 30 then pixel read, 5 runs, GPU shared with other agents so noisy [M]:

- Before: 11.4, 9.7, 10.2, 10.1, 8.9 ms (median 10.1) and in a second survey 12.6 to 8.1.
- After: 9.8, 8.0, 8.2, 7.8, 7.8 ms (median 8.0).
- Reading: no added cost, probably slightly less (fewer tiles in the shadow pass) [J]. `src/export/layerCost.ts` was not used.

Crawl check, 90 consecutive frames (3 s at 30 fps, film progress 0.5, Au ras, `results/img-results-after.json` and the PNG burst, which is not copied) [M]:

- Map origin on the texel grid in 90 of 90 frames.
- Extent changed in 18 of 89 frame pairs, each a 9 % quantisation step (width 4096 to 6889 m over the burst).
- Mean abs luminance step between consecutive frames: 22.19 with shadows, 22.43 without (ratio 0.990); no frame with step above 1.5x the shadowless one; mean abs step of log(on/off) 0.027, p95 0.066, max 0.121.
- There is no "before" burst, so no baseline for crawl [limit].

Stills, before | after: `images/img-sbs-*.jpg`, `images/img-crop-*.jpg` (2x crops). In `crop-ground-0.5` the before shows a speckled blob with a dotted pattern, the after a crisp edge [J].

## 4. Horizon views (the camera that keeps its tilt)

Free camera at the chase pose of three places (film progress 0.15, 0.45, 0.75), axis 15 and 20 degrees below horizontal, about 780 m to the ground, horizon in the top 14 to 26 % of the frame. Before = master rule, after = commit. Shadow distance D and texel [M]:

| Place / pitch | Aim | D before | D after | Texel before | Texel after |
|---|---|---|---|---|---|
| 0.15 / 15 | 783 | 30 km | 4.6 km | 8 to 12.3 | 1.5 to 2.0 |
| 0.15 / 20 | 704 | 30 km | 3.7 km | 8.7 to 12.3 | 1.3 to 1.5 |
| 0.45 / 15 | 869 | 30 km | 5.7 km | 10.4 to 12.3 | 1.8 to 2.4 |
| 0.45 / 20 | 783 | 30 km | 4.6 km | 10.4 to 12.3 | 1.5 to 2.0 |
| 0.75 / 15 | none within 2 km | 30 km | 30 km | 9.5 to 12.3 | same (no gain) |
| 0.75 / 20 | 1853 | 30 km | 25.7 km | 10.4 to 12.3 | 8.7 to 10.4 |

(the ranges are the three suns 8h, 12h, 17h). At place 0.75 the camera is high above the ground so the rule gives no sharpening [M].

Pixel statistics, after minus before in luminance, per third of the frame height (`scripts/hdiff.py`), suns 8h / 12h / 17h [M]:

- Share of pixels darker by more than 8 levels: 0.0 to 9.9 %, mostly 1 to 6 %; at 12h almost nothing (0.0 to 0.8 %).
- Share lighter by more than 8 levels: at most 0.1 % in all 18 views.
- Mean difference per third: -0.0 to -3.1 (darker after).

Stress suns (6.5h, 7.5h, 18h, 19h, places 0.15 and 0.45, 15 degrees; `images/hor2-*`) [M]:

- Lighter-than-before pixels in the top third: 0.4 % (0.15, 6.5h), 0.2 % (0.15, 18h), 0.8 % (0.15, 19h), 0.5 % (0.45, 19h), 0.1 % elsewhere; middle and bottom thirds at most 0.3 %.
- The 19h case, place 0.15 / 15 degrees: far right slopes beyond about 5 km are lit where the old map shaded them (white patches in `images/hor2-diff-h0.15-p15-s19.jpg`). This is the loss of far shadows beyond D, no fade.
- Reading [J]: at 8h, 12h, 17h I could not see where the shadows stop (no line, no tone change) and distant slopes do not look flatter; the diff images show only sharper near shadows (darker) and small sharper streaks in the far ridges. The sample has few long cast shadows beyond 4 km, a valley with long cross shadows may show the loss more. Only the 19h case showed the cutoff, on under 1 % of the frame.
- A fade would need a shader patch and would only soften the line; a higher floor trades the near texel for range (4096 texels at 2 m cover about 8 km). On one map you cannot have both a texel under 2 m and far shadows at 4 to 6 km and beyond [reasoning].

## 5. Two-map prototype (branch `proto/shadows-two-maps`, commit `f1790b72`) and the decision

A second `DirectionalLight` at intensity 0.0005, same direction as the sun, carries a far map (old 30 km rule); the sun keeps the near map (new rule); both 2048. It measures cost only, there is no image of the combined shading (that needs a custom shader). Place 0.15 / 15 degrees, 17h, 4 interleaved repetitions, median of 5 runs of 40 frames [M]:

| | ms/frame (medians of the 4 repetitions) | draw calls | triangles |
|---|---|---|---|
| Single 4096 | 8.18, 8.41, 9.63, 9.31 | 579 | 4.96 M |
| Two 2048 | 11.33, 11.51, 12.62, 12.42 | 980 | 8.45 M |

About +3.1 ms, roughly +35 %; the gap held in all 4 repetitions; the GPU was shared with other agents so absolute values are noisy. Memory: two 2048 maps are 8 Mpx against 16 Mpx for one 4096, so about half, not equal (the brief had assumed equal).

**Decision taken by the coordinator: keep the single map** (+35 % frame time is too much for the owner's rule, and the far-shadow loss is small).

## 6. OPEN issue: shadow distance can jump between frames

The risk (coordinator's, from reading the code, not yet observed) [J]: `groundDistance` marches ONE ray and returns the first hit. Looking towards the horizon over broken relief the ray grazes crests: one frame it hits a ridge at 500 m, the next it passes over and hits the valley at 1.9 km, or hits nothing within 2 km. The aim goes from about 0.5 km to 2 km or `Infinity`, D from 3 km to 27 or 30 km, the texel from 1.5 m to 10 m in one frame: a visible pop. The 9 % extent quantisation does not help against a factor of 5. A second, certain effect: the march steps are 8 % apart, so the aim itself is quantised and `D` (square of the aim) moves in steps of about 17 % even on smooth ground [reasoning from the code].

What I measured so far: nothing usable. The first replay of the home-page example at Au ras (1801 frames) finished, but the results file is only written at the end and the script crashed on the next flight (the example page does not show its home screen twice in one browser context); I then fixed the script (one browser context per flight, results written after each flight) and the next run was stopped by the hand-over. **No jump counts exist yet.** The 90-frame burst of section 3 was a smooth stretch and says nothing about this.

### The uncommitted-then-committed WIP edit

`src/scene/AtmosphereLayer.tsx`, one line, marked `// TEMP`:
`;(globalThis as any).__groundUnder = groundUnder`
It only exposes the sampler to the replay script `scripts/jumps.mjs`. Remove it before the PR. I did not re-run typecheck, lint or tests with it; it is a debug global (lint may warn on `as any`), `1d594dc0` passed everything without it.

### Remaining steps, in order

1. Run `scripts/jumps.mjs` (needs a GPU, see section 7) on whole flights at 30 images per second (1800 frames): example Au ras, example Proche, Arolla Au ras (`scripts/arolla.gpx`), and the emulated coming camera (the script's `low15` pose: same place, 250 m above the ground under it, axis 15 degrees below the heading; it is an approximation of the coming camera, not that camera). For each pose it records, per frame, four candidate inputs already converted to a shadow distance: `A` current first-hit ray, `B` height over the ground under the camera divided by the sine of the tilt, `C25` and `C50` the 25th percentile and the median of 25 rays (5 azimuths x 5 elevations over the lower half of the frame). `scripts/jumpstats.py` prints, per input, the frame pairs with a change above 9 %, 25 % and a factor 2, and the largest ratio.
2. If A has jumps above 25 %: replace the input by one that is continuous in position and direction, still pure (no state between frames). Candidates: B, a low percentile or mean of several rays, or a blend (for instance the min of B and a multi-ray value). Make the result move at a bounded rate by construction (a smooth saturating law), not by time filtering. The near texel must stay under about 2 m at Au ras and Proche, Avion and Satellite must keep the old distance.
3. Re-measure step 1 with the new input; re-check the texels (section 3 table) and Avion/Satellite distances (unit tests: `shadowDistance` far cases).
4. Render a 3 s burst (`scripts/shots.mjs` with `BURST=1`) where the old input jumped, before and after, and describe the pop.
5. Amend the feature commit (tests for continuity in `terrainShadow.test.ts`, `ARCHITECTURE.md` bullet and the changelog entry in step, remove the TEMP line), then typecheck, lint, targeted tests, full `npx vitest run`, build.

## 7. Scripts, results, images

All scripts take `<repo path> <output folder>` (puppeteer-core from the repo's `node_modules`, own Vite server on port 5302, `cacheDir node_modules/.vite-shadows`). They need a real GPU, Chrome at `/usr/bin/google-chrome`, French `navigator.language` (set by the script). They launch Chrome with `--ignore-gpu-blocklist --use-gl=angle --use-angle=gl`; on WSL add the env `MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA GALLIUM_DRIVER=d3d12 LD_LIBRARY_PATH=/usr/lib/wsl/lib` (already in the scripts; remove on other machines). Do not use SwiftShader for timings. The cloud has no GPU, so none of them runs there as is.

- `shots.mjs <repo> <out> <tag>`: stills at three film moments for Au ras and Proche, shadow fit numbers, frame time, and with `BURST=1` the 90-frame burst with shadows on and off (`SUN` env, default 17h).
- `survey.mjs`: same for six camera heights (needs the `__shadowDbg` temp hook, no longer in the commit).
- `horizon.mjs <repo> <out> <tag>`: horizon views (`PLACES`, `PITCHES`, `SUNS` env). It reads two temp hooks that are NOT in the commit: `globalThis.__OLD` (skip `groundDistance`, giving the master rule) and `globalThis.__shadowDbg = { distance, aim }` set in `TerrainShadow.fit`. Re-add them (3 lines) to use it.
- `timing.mjs`: single against two maps, needs the `proto/shadows-two-maps` branch checked out (reads `window.__ONEMAP`).
- `jumps.mjs <repo> <outFile.json> [flight ids]`: the replay of section 6 (needs the `__groundUnder` hook; env `AROLLA_GPX`, default `arolla.gpx` in the current folder). Writes after each flight.
- `sbs.py`, `crop.py`, `crawl.py`, `hsbs.py`, `hdiff.py`, `jumpstats.py`: post-processing, set `NS_DIR` to the folder that holds the images and results (they expect the layout `img/`, `hor/`, `hor2/` of the original work folder).

What can be checked WITHOUT a GPU: `shadowDistance` and `groundDistance` (`terrainShadow.test.ts`); and the continuity of any candidate input by replaying the flight camera with `filmViewAt` (`src/scene/filmView.ts`) plus a terrain sampler. `engine.sampleHeight` needs loaded tiles; a headless replay would need either tiles fetched over the network (the real engine in jsdom is not set up for it) or a synthetic height field (a sum of sines or a downloaded DEM) fed to `groundDistance`: that tests continuity of the input as a function of pose, not on the real terrain. Real-terrain jump counts need the GPU run.

`images/` (JPEG, at most 2000 px wide): `img-sbs-*` before|after stills (3 moments, Au ras and Proche); `img-crop-*` 2x crops; `hor-sbs-*` 18 horizon views (before|after); `hor-band-*`, `hor-diff-*` for 0.45/20 at 8h and 0.45/15 at 17h; `hor2-sbs-*`, `hor2-diff-*` the stress suns, `hor2-band-h0.15-p15-s19` the 19h loss; `hor3-prototwo-*` the two-map prototype. File names: `h<progress>-p<pitch>-s<sun hour>`.

Left out: the 180 burst PNGs (`burst-after-*`, `burstoff-after-*`), the single stills `<cam>-<p>-before|after.png`, the 12 other horizon bands and diffs, the survey images; the numbers they gave are in `results/`. `results/`: `*-results-*.json` (per view fit numbers, burst per-frame fit), logs, `two-maps-timing.log`.

## 8. Doubts

- The squared law is a judgement call tuned so that Avion keeps 30 km on this sample; other terrain and other camera heights may behave differently.
- "Au ras" and "Proche" were checked with today's camera, which is pushed up by the relief; the coming kept-tilt camera was only emulated by an axis override.
- The horizon views were judged on three places of one sample hike and a few suns; the far-shadow loss is small here, not proven small elsewhere.
- The 1 km texel is an estimate. The crawl check has no baseline. The frame times are noisy (shared GPU).
- The aim is a march against loaded tiles: with different tiles loaded (preview against export) the aim could differ slightly; the old fit already depends on the loaded tile box in the same way [J].
- Typecheck, lint and tests were not re-run with the WIP edit.
