# Handover: « Allumé par défaut » (feat/default-look)

Branch `feat/default-look`, based on `fee9bbd7` (« Focale » removed, base of the 8.0 work). Commit `49049d9a` is the
default-look change; the commit that adds this folder sits on top. Nothing is pushed, no pull request exists.

## 1. Goal and owner's decision

The owner decided « Allumé par défaut »: every NEW project starts with the track halo on (« Halo de la trace »,
`trackStyle.glow`) and the grading « Contrasté » (`contraste` preset: contrast 0.4, saturation 0.1, warmth 0,
vignette 0.25). No new button, no new setting, no new interface text. Saved projects must look exactly as before.
Product rules: simple and straightforward (no duplicated setting, no silent override, no false hint), realistic but
pretty (gentle), light on an ordinary computer. A competitor's films show a glowing line and graded colours.
Not in scope: the bloom (`lens.bloom`) stays off.

## 2. What commit 49049d9a does (22 files, +139 -30)

- `src/scene/grading.ts`: `DEFAULT_GRADING` is now the `contraste` preset (`gradingOfPreset`-equivalent values).
- `src/scene/markerSettings.ts`: `DEFAULT_TRACK_STYLE.glow = true` (intensity 0.75 and width 24 px unchanged, so the
  halo is visible against the 4 px line and the `glowTooNarrow` hint does not fire). New `LEGACY_TRACK_GLOW`
  (`glow:false, glowIntensity:0.75, glowWidth:24, glowColor:''`, frozen: never reads today's defaults) and
  `withTrackStyleDefaults` is now a function that completes a saved track style with those frozen halo values first.
- `src/project/document.ts`: `LEGACY_GRADING` (frozen « Naturel ») and `withLookOfItsTime(raw)`, called in
  `parseProject` just before `sanitizeSettings`. A project file without `grading` gets « Naturel », without
  `trackStyle` gets `{...DEFAULT_TRACK_STYLE, ...LEGACY_TRACK_GLOW}`.
- No `PROJECT_VERSION` bump (stays 8): the app writes every setting, so a missing `grading` or `trackStyle` can only
  come from a file older than both, never from a new project. `sanitizeSettings` itself is untouched on purpose:
  presets and partial objects keep completing from the CURRENT settings (a preset without `grading` keeps the user's).
  Documented in `docs/project-format.md` (new paragraph before "Changing the format"), handbook, ARCHITECTURE.md.
- Tests: `frozen.test.ts` (every `v*.json` opens ungraded, no halo; v1 has neither key), `legacy.test.ts` (v1, v2
  check the old look; new describe « the new default look »: new project defaults, file without keys, track style
  without halo fields, saved grading kept), `document.test.ts`, `store.test.ts`, `grading.test.ts`,
  `paramKeys.test.ts`, `SettingsPanel.test.tsx`, `TrackLines.test.tsx` adapted to the new defaults.
- `bench/computer.opnflvr` and `bench/phone.opnflvr` regenerated (`BENCH_WRITE=1 npx vitest run
  src/project/bench.test.ts`). Decoded diff: only `grading` -> contraste and `trackStyle.glow` false -> true
  (`scripts/benchdiff.mjs <repo>` redoes the check against the old files kept in `scripts/old-*.bin`).
- Docs: CHANGELOG entry under 8.0.0, ARCHITECTURE.md, handbook, `docs/project-format.md`, the five user guides
  (`node scripts/check-user-guides.mjs` passes). No `whatsNew.ts` entry (written at release).
- Checks at that commit: typecheck OK, lint exit 0 (old warnings only), full vitest 242 files / 3840 tests green,
  build OK, bundle 588 kB gzip (budget 594). This handover commit changes no source, so these still hold.

## 3. Coherence checks made (by reading code and by tests)

The « Étalonnage » select, its summary, the section reset and the "modifié / Par défaut" markers all read
`DEFAULT_SETTINGS`, so they follow the new defaults (store, SettingsPanel and TrackMarkerSection tests pass). Débutant
« Ambiance » chips only set clouds, sun and weatherScene, never grading or halo. The « Film automatique » gabarit
(`AUTO_FILM_TRACK`) already forces a lighter halo (0.4 / 16 px) and leaves grading alone: it does not restore the old
look, but its halo is gentler than the new default (judgement: acceptable, could be aligned). Resets go to
`DEFAULT_SETTINGS`. NOT run: `npm run e2e`.

## 4. Cost (MEASURED, but noisy)

Home page example, real GPU (GTX 1060 via WSL), 1920x1080 preview, export 1280x720 10 fps 3 s = 30 frames. The GPU
was shared with other agents: frames were about 80 ms whatever the setting, so differences under ~15 % are noise.
Mean ms per preview frame / export seconds, two repetitions each:

| | preview | export |
|---|---|---|
| atmosphere on, before | 65, 84 | 48, 63 |
| atmosphere on, after | 69, 79 | 77, 57 |
| atmosphere off, before | 76, 73 | 60, 60 |
| atmosphere off, after | 77, 79 | 59, 59 |
| bloom 0.3, atmosphere on (0: 83 / 68) | 83 | 67 |
| bloom 0.3, atmosphere off (0: 81 / 69) | 75 | 73 |

Reading (judgement): atmosphere off about +5 % preview, -2 % export, under the 10 % threshold; atmosphere on not
measurable. "Before" is emulated in the same build by setting grading to « Naturel » and `glow` false in the page.
Raw: `results/perf-results.json`, `results/perf.log`.

## 5. Stills and the blank-frame problem

`images/avant-apres-{atm,noatm}-{1,2,3}.jpg`: before | after, same three film moments (progress 0.08, 0.5, 0.92).
- atmosphere off: the halo is clearly visible and the colours are contrasted, darker corners (works).
- atmosphere on: the halo is visible; **grading shows no difference** (see section 6).
Blank frames: toggling the atmosphere inside a running page and screenshotting gave a blank canvas (the page
background) in several noatm images, before and after alike, even with nudged frames. A fresh page per variant
(`scripts/fresh.mjs`, run by `scripts/run-stills.sh`) fixed it. Cause unknown: probably the harness (canvas of a
demand-driven scene, or the canvas remounting on the atmosphere toggle), possibly an app issue that exists on master;
the exports with the atmosphere off all completed. Label placement differs a little between before and after stills
(labels settle at their own pace): not an effect of the change.

## 6. OPEN ISSUE: grading seems to have no effect with the atmosphere on

Reported by the coordinator: in `avant-apres-atm-*` the corner luminance (top-left eighth) is identical before and
after (58.24 / 148.34 / 47.25) while with the atmosphere off it drops 13 to 25 %. Suspected place:
`src/scene/AtmosphereLayer.tsx` ~line 132, `antialiasPass = useMemo(() => new EffectPass(camera, smaa,
...lens.effects, ...(grading.active ? [grading.effect] : [])), [...grading.active, grading.effect])`, rendered in the
`<EffectComposer>` as `<primitive object={antialiasPass} />`; the effect comes from `useGradingEffect`
(`src/scene/GradingComposer.tsx`), which calls `effect.setGrading(grading)` in a `useLayoutEffect`.

What I found (MEASURED with `scripts/stats.py`, which prints corner / centre luminance and mean saturation):
- Fresh page, atmosphere on, grading loaded from the start (« Contrasté », the new default) vs « Naturel » set in the
  page: identical (corner 49.18 vs 49.18, centre 82.21 vs 82.22, saturation 113.46 vs 113.48). Same in the first run.
  So: grading ACTIVE AT PAGE LOAD with the atmosphere on has no visible effect.
- One page, atmosphere on, start on « Naturel » then switch in the page (`scripts/grade3.mjs`,
  `images/grade-atm-*.jpg`): « Noir et blanc » gives mean saturation 0.01 (grey: it DOES apply), « Contrasté » gives
  saturation 81 -> 110 and corner 156.5 -> 149.9 (-4 %, a weak vignette compared with atmosphere off).
- Hypothesis (NOT verified): the pass or effect built at mount is not the one that renders (React Suspense/StrictMode
  double creation, effect disposed then reused, or uniforms set before the composer uses the effect), while a rebuild
  triggered by `grading.active` flipping works. If true it also affects master for any saved project that has a
  grading and the atmosphere on at load. Also possible: the vignette is much weaker in this path because grading runs
  after the ToneMapping in the same pass; compare with the atmosphere-off values (corner 65 -> 49).
- NOT done: the check on master with « Noir et blanc » loaded at page start (the page-switch case works on this
  branch, `AtmosphereLayer.tsx` is unchanged by my commit).

Remaining steps, in order:
1. On origin/master (second checkout, link `node_modules`), atmosphere on, load a project whose grading is
   « Noir et blanc » (or set it at startup, before the scene mounts) and take one still: grey or not. Then
   « Contrasté » vs « Naturel » corners. GPU needed.
2. If confirmed, fix in the smallest way (look at when `antialiasPass` and `grading.effect` are created vs when the
   composer reads the children; try keying the pass on the effect, or setting the grading in `useMemo`), as a SEPARATE
   commit `fix(étalonnage) : ...` placed BEFORE 49049d9a (rebase), with a unit test if the cause is testable without a
   GPU (e.g. the pass list must contain the effect, uniforms set at creation) and a CHANGELOG entry under 8.0.0.
3. Re-check with one still each: noir et blanc grey, contrasté darker corners, atmosphere on and off.
4. typecheck, lint, targeted tests, then the full suite under the heavy lock.

## 7. Judgement items and doubts

- Atmosphere off: « Contrasté » darkens the whole frame by about 14 % (centre 70 -> 60, 94 -> 87, 77 -> 68 in the
  noatm stills; corner 65 -> 49 at moment 2) on an image already darker than with the atmosphere on. To my eye the
  noatm after-stills look somewhat dark and heavy in the shadows (JUDGEMENT, not measured): the owner may prefer a
  lighter default grading or to review the noatm exposure. I changed nothing.
- If the atmosphere-on bug is real, today the default « Contrasté » would change nothing for most people (default is
  atmosphere on): then the cost table "atmosphere on, after" measured a grading that was not rendering, and must be
  redone after the fix (the atmosphere-on cost may be a little higher than reported).
- Performance figures are noisy (shared GPU); the export includes tile waiting.
- The halo values were kept at 0.75 / 24 px; in the stills it is soft, not neon (judgement).
- `npm run e2e` not run; the cloud cannot render.

## 8. Files here and how to run

- `images/`: JPEGs (<= 2000 px wide). Left out: the PNGs (about 2920 px wide, too big), the first-run `stills/` and
  `stills2/` (blank frames), per-shot stills3 PNGs (the hstacked JPEGs contain them).
- `results/`: `perf-results.json`, `perf.log` (vite chatter removed).
- `scripts/`: `bench.mjs <repo> <outdir> <stills|perf|both> [reps]` (preview fps and export time, variants
  before/after x atmosphere on/off, plus bloom 0 / 0.3), `fresh.mjs <repo> <outdir> <variant>`, `run-stills.sh <repo>
  <outdir>` (the four variants and the side by side), `grade3.mjs <repo> <outdir> <atm 0|1> <naturel,bw,contraste>`,
  `stats.py <png...>` (corner / centre luminance, saturation; needs Pillow), `benchdiff.mjs <repo>`.
  Run them with the repo's node (`~/.nvm/versions/node/v24.22.0/bin` here) from anywhere: they resolve
  puppeteer-core and vite from the repo path given. They start their own Vite server on port 5303, force French
  (`navigator.language`) and launch `/usr/bin/google-chrome` headless shell on a REAL GPU (here WSL: env
  `MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA GALLIUM_DRIVER=d3d12 LD_LIBRARY_PATH=/usr/lib/wsl/lib`, set in the scripts;
  adapt flags elsewhere). Never SwiftShader for the figures.
- Without a GPU one can still check: typecheck, lint, vitest (including `frozen.test.ts`, `legacy.test.ts`,
  `bench.test.ts`), `benchdiff.mjs`, the user-guide check, and read the code of section 6; not the pixels.
