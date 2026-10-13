# Implementation guide: multi-track timeline (junctions, reorder, light, magnet)

Companion of [`timeline-multitrack.md`](timeline-multitrack.md) (the *why* and the decisions). This file is the *how*: it is written so
that you can implement the work yourself, phase by phase, without rediscovering the code. File and function names are real (checked on
master at `3e54ac9`/`189d701`); **line numbers drift, search by name**. Anything I could not verify is marked **(verify)**.

Conventions (from `CLAUDE.md`): strict TypeScript, `import type`, no `enum`, no constructor parameter properties; UI strings in French,
code / comments / commits in English; two targets (website + Tauri), no new npm dependency; an export frame is a **pure function of
film time** (no frame-to-frame state); old projects must open unchanged (`withXDefaults` / `isValidX`, `SETTING_UPGRADES` in
`src/project/document.ts`, no version bump); tests next to the code (`npx vitest run --maxWorkers=1`), then `npm run typecheck`,
`npm run lint`, and `OPENFLYOVER_E2E_SKIP_EXPORT=1 OPENFLYOVER_E2E_ONLY=accueil,<id> npm run e2e` for UI scenarios.

---

## 0. Decisions you are implementing

| Topic | Decision |
|---|---|
| Transitions | Add time to the film (held on the clock). Kinds: `coupe`, `fondu-noir`, `fondu-blanc`, `nuit`, `survol` (last). |
| Duration | One **hold** duration per junction, resizable on the timeline; global default + *Apply to all*. Default fondu noir. |
| Stage card | Editable block in « Textes », shown inside the dip. |
| Stage duration | A duration **per stage** (unset = today's share proportional to distance). |
| Light | Each stage at its real hour; smooth blend (fade) at the junction. |
| Chaining | « Enchaîner en un seul parcours » stays (one track, continuous profile); « À la suite » stays (separate stages). |
| Reorder | Track list **and** timeline, mouse + touch; everything anchored in metres follows its stage; undoable. |
| Magnet | All lanes, edges + centres, labelled alignment guides, hysteresis, toggle. |

Open (assumed): default 1.5 s dip; no trimming of stages; phases order 0 → 1 → 2 → 3 → 4. Phase 0 is already a PR (#101).

---

## 1. How the code works today (map)

### 1.1 Stages and the sequence

- `settings.race` (`src/flyover/race.ts`): `sequence?: boolean` (« À la suite »), `stageCards?: boolean` (absent = on),
  `stageTransition?: 'coupe' | 'fondu-noir' | 'fondu-blanc'` (absent = fondu noir). Validation `isValidRace` (wired in `SETTING_CHECKS`,
  `src/project/document.ts`). These are **global**: one value for all junctions.
- `buildSequence(tracks, …)` (`src/flyover/sequence.ts`): concatenates `tracks.flatMap(t => t.segments)` into one virtual `Track` (id
  `suite:<ids>`). `Stage = { track, index, startM, endM, from, to }` (`from`/`to` = progress fractions). `Sequence = { track, stages,
  cutsM }` where `cutsM = stages.slice(1).map(s => s.startM)`. `playsInSequence(race, trackCount)`: `race.sequence && !race.enabled &&
  trackCount >= 2`. `sequenceOf` is cached on ids / segments / names. `stageAt(sequence, progress)`: **a cut belongs to the stage it
  starts** (`progress >= stages[k+1].from` ⇒ stage k+1). `trackUnderMarker` feeds sun, clouds, weather.
- A stage has **no id of its own**: use the track id (`stage.track.id`). The jump between two tracks is **not** counted in the sequence length.

### 1.2 The film clock (`src/film/clock.ts`)

- `buildFilmClock(input)` → `FilmClock`. Phases: opening `[0,O)`, flight `[O,O+F)`, closing. **Pauses** (stops, nights) are inserted
  in the flight by `flightPacing(lengthM, highlightsM, durationS, pacing, pauses, speeds, curve)` (`src/flyover/pacing.ts`) where a pause is
  `FlightStop { atM, durationS, extra?: boolean }`. `extra: true` = **added to the film whatever `keepDuration`, never shortened** (this is
  what nights use: `nightPauseS(night) = duskS + nightS + dawnS`, `pauses.push({ atM, durationS, extra: true, night })`).
- The result has `pauses: PacingPause[] = { progress, startS, holdStartS, holdEndS, endS, durationS }`: `startS → holdStartS` is the
  **ease-in** (the marker slows to a stop, length `e = PAUSE_EASE_S = DEFAULT_PACING.transitionS` (1.5 s) unless limited by neighbours),
  `holdStartS → holdEndS` the hold (`durationS`), `holdEndS → endS` the ease-out. `buildFilmClock` maps them back to the `stops` and
  `nights` by index (`pauses[k]`) and adds the opening offset.
- `flightTimeOf(atM) = openingS + flight.timeAtProgress(min(1, atM / lengthM))`; **`timeAtProgress` of a paused position is the start of
  its hold** (doc comment of `timeAtProgress`). It is used for speeds, camera / param / marker keys and `cuts`.
- `cuts: ClockCut[] = [{ atM, timeS }]` from `FilmClockInput.cutsM`: **read-only markers, no time added**. `filmClockInputFor` receives
  `cutsM` from `useFilmSource()` / `getFilmSource()` (`src/scene/usePacing.ts`); `Timeline.tsx` now passes it too (phase 0).
- Everything the film anchors: **metres along the sequence** → stops (`atM`), speeds (`fromM/toM`), `cameraKeys`, `paramKeys`,
  `markerKeys`; **film seconds** → `texts`, `media`, `audio` (and `overlay.title.end`, `overlay.end.start` as fractions of the flight). Texts
  / media with `stopId` follow their stop (`followStops`, `src/film/timeline.ts`).

### 1.3 Overlay: card and dip (both are layers over the flight)

- `stageCardAt(sequence, time)` (`src/overlay/data.ts`): starts = `[time.openingS, ...time.cutsS]`; picks the last start ≤ `timeS`; null once
  `timeS >= start + STAGE_CARD_S (5)`. Returns `StageCard { name, index, count, distanceM, startS, durationS, startTime?, ascentM? }`.
  Drawn by `stageWidget` in `src/overlay/draw.ts` (centred, title scale 0.6, « Étape k sur n · date », Distance, Dénivelé +).
- `stageDipAt(race, time)` (`src/overlay/exportOverlay.ts`): for `stageTransition !== 'coupe'`, `max(dipAlpha(timeS, cutS, DIP_DEFAULT_S))`
  over `time.cutsS`; returns `TransitionDip { color: 'black' | 'white', alpha }`. `dipAlpha(timeS, cutS, lengthS)` and `transitionDipAt` are in
  `src/film/model.ts` (shot transitions: `FilmShot.transition`, `dipS` 0.3–2 s, `DIP_DEFAULT_S = 1`). `drawDip` runs last in `drawOverlay` (covers
  everything except the credits).
- `overlayExtras(time, progress)` (`exportOverlay.ts`) is what preview **and** export call; `OverlayTime = { timeS, openingS, flightS, cutsS?, … }`
  (`src/overlay/draw.ts`, `overlayTime(clock, progress, timeS)`). The export's held-frame key (`ExportController.tsx`, search `dip.alpha`)
  includes the dip alpha and the stage-card opacity: **anything new that changes the picture must enter that key** or the export will reuse a
  stale frame.

### 1.4 Timeline UI

- `src/ui/Timeline.tsx` (≈1340 lines): lanes « Plans » (`opening`, flight bar, camera keys, `closing`), « Vitesse », one lane per keyed param,
  « Marqueur », « Arrêts », « Textes », « Médias », « Musique ». Stage spans: search `film-tl__stage` (display only: `pointer-events: none` in
  `src/ui/app.css`, `border-bottom: 3px solid var(--stage-color)`, a white `border-left` between two spans). Blocks come from the `block(item, startS,
  endS, label, title, className, grips)` helper; gestures from `dragFilm(film, item, grip, deltaS, ctx)` (`src/film/timeline.ts`) with
  `Grip = 'move' | 'start' | 'end'`; `TimelineItem = 'opening' | 'closing' | string` (an id). Commit = one undo step through
  `getSettingsHistory().transaction(...)`.
- Selection: `useAppStore.filmSelection` (string id or null); `FilmInspector.tsx` renders by `item` (`'opening'`, `'closing'`, `isCardItem(item)`,
  or the id of a stop / speed / key / text / media / music). `hasFilmItem(film, stops, item)` (`timeline.ts`) decides whether an id still exists.
- Cards precedent: `src/film/cards.ts` — `TITLE_CARD_ID = 'card-title'`, `END_CARD_ID = 'card-end'`, `cardWindow`, `dragCard`, `withoutCard`. **The cards
  have no data of their own: the overlay settings stay the source of truth** and the timeline only shows their window. Copy this pattern.
- Snapping: `snapTargets(clock, film, highlights, playheadS, except?)` returns a plain `number[]`; `snapTime(t, targets, distance)`. Snap distance 8 px
  in the component; Alt disables it.

### 1.5 Track list and reorder today

- `src/ui/TrackList.tsx`: `RacePanel` (« Plusieurs traces »: mode radio, « Entre deux étapes » `<select>`, « Carton au début de chaque étape » switch),
  track cards with a ▲ button (`moveTrack(track.id, index - 1)`, sequence mode only).
- `moveTrack` / `replaceTracks` (`src/state/store.ts`): reset playback, **not in the undo history, no film remap**.
- The settings history (`src/project/history.ts`, `getSettingsHistory()`) snapshots **`settings` only** and ignores settings changes made together with a
  `tracks` change (`state.tracks === previous.tracks` guard).

### 1.6 Tests that pin today's behaviour (update, do not delete)

`src/flyover/sequence.test.ts`, `src/film/clock.test.ts` (« cuts between stages »), `src/overlay/exportOverlay.test.ts` (dip at the cut, `coupe`/`stageCards:false`),
`src/overlay/data.test.ts` (`stageCardAt` windows), `src/overlay/draw.test.ts` (stage card), `src/project/document.test.ts` (`race` fields round-trip),
`src/film/timeline.test.ts`, `src/film/markerKeys.test.ts` (`junctionsM`).

---

## 2. Phase 1 — junctions (type, held duration, cards as blocks, « Étapes » lane)

### 2.1 Data model

Add to `Film` (`src/film/model.ts`, with `DEFAULT_FILM`, `isValidFilm`, `withFilmDefaults`):

```ts
export const JUNCTION_KINDS = ['coupe', 'fondu-noir', 'fondu-blanc', 'nuit' /* phase 3-4: 'survol' */] as const
export type JunctionKind = (typeof JUNCTION_KINDS)[number]

/** The junction after the stage of track `afterTrackId` in the sequence (keyed by the track, so it survives a reorder). */
export interface FilmJunction {
  id: string                 // 'junction-<afterTrackId>' (stable, derived: no counter to keep)
  afterTrackId: string
  kind: JunctionKind         // absent field = the global default below
  holdS: number              // seconds held on the clock, 0 for 'coupe'; range JUNCTION_HOLD_RANGE
  card?: JunctionCard        // the stage card of the NEXT stage (see 2.5)
}
export const JUNCTION_HOLD_RANGE = { min: 0, max: 10, step: 0.1 } as const   // 'coupe' ⇒ 0
// film.junctions?: FilmJunction[]   // optional, absent = all defaults; film.junctionDefault?: { kind: JunctionKind; holdS: number }
```

- **Defaults and migration** (no version bump): `withFilmDefaults` gives `junctions: []` and `junctionDefault` from the **old** `race.stageTransition`
  (`coupe` → `{coupe, 0}`, `fondu-noir`/absent → `{fondu-noir, 0.8}`, `fondu-blanc` → `{fondu-blanc, 0.8}`; hold 0.8 s + two eases of ≈1.5 s ≈ 3.8 s of
  fade, tune it) and card on iff `race.stageCards !== false`. After migrating, keep reading but **stop writing** `race.stageCards` / `stageTransition`
  (leave them valid in `isValidRace` for old files; drop them from the panel). A junction whose track pair no longer exists is ignored (not an error).
- `junctionOf(film, afterTrackId)` helper returns the stored junction or the default one — **the rest of the code never reads the optional fields directly**.
- A **film with one stage** has no junction (nothing to show).

### 2.2 Clock: hold at the junction

In `buildFilmClock`: add, next to the nights, one pause per cut that is not `coupe`:

```ts
// pauses array in buildFilmClock
...(input.junctions ?? []).filter((j) => j.holdS > 0).map((j) => ({ atM: j.atM, durationS: j.holdS, extra: true, junction: j })),
```

- `FilmClockInput` gets `junctions?: { id: string; atM: number; kind: JunctionKind; holdS: number }[]` (built in `filmClockInputFor` from `film`, the
  sequence `cutsM` and the stage track ids — extend `FilmClockFor` with `stageIds?: readonly string[]` next to `cutsM`; update `getFilmSource`/`useFilmSource`).
- Map the result back like `stops`/`nights`: `ClockJunction { id, atM, kind, holdS, progress, startS, holdStartS, holdEndS, endS }` and expose `clock.junctions`.
  Keep `clock.cuts` (used by `sameShot`, markers, overlay) — its `timeS` is already the **start of the hold** (`timeAtProgress` of a paused position).
- **Sort order at the same `atM`**: the existing rule is « a stop first » (`pauses.sort((a,b) => a.atM - b.atM || (a.stop ? 0 : 1) - (b.stop ? 0 : 1))`).
  A junction hold goes **after** a stop at the same place? A stop at the cut position would hold on stage B's first frame **before** the dip: put the
  junction first (fade out of A, then the stop on B). Decide, write a test.
- `keepDuration`: `extra: true` pauses are added on top of `flyoverDurationS` (like nights) → the total film length grows by `Σ(holdS)` (+ eases are *inside*
  the flight, they do not add). Document it in the « Durée du vol » hint: « durée du vol, sans les transitions ».
- Nights vs junction at the same place: the nights feature already creates a pause at recording gaps, **including** the jump between stages that are on
  different days (**verify** with the reference project: the clock for `cutsM` + `flightNights` at the same `atM`). Rule: if a junction exists at a
  night's position and its kind is `nuit`, it **replaces** the automatic night (single pause with dusk/night/dawn parts); if its kind is not `nuit`,
  the automatic night is suppressed **only if the owner turns « Jours et nuits » off for the junction** — simplest first version: a stage junction's
  position excludes the automatic night (`flightNights` filtered by `|night.atM - cutM| > tolerance`) and the junction kind decides.

### 2.3 Dip alpha from the clock (replaces `stageDipAt`)

The stage switch happens when `progress` reaches the cut, i.e. **at `holdStartS`** (`stageAt`: progress ≥ `stages[k+1].from` ⇒ next stage). So the screen
must be fully covered **by `holdStartS`** and uncovered after `holdEndS`:

```ts
// pure, in src/film/model.ts or a new src/film/junctions.ts
export function junctionDipAt(j: ClockJunction, timeS: number): { color: 'black'|'white'; alpha: number } | null {
  if (j.kind !== 'fondu-noir' && j.kind !== 'fondu-blanc') return null
  const up   = smoothstep(j.startS, j.holdStartS, timeS)         // ease-in of the pause: the marker slows while the screen fades out
  const down = 1 - smoothstep(j.holdEndS, j.endS, timeS)         // ease-out: the next stage fades in
  const alpha = Math.min(up, down)  // hold: 1
  return alpha > 0 ? { color: j.kind === 'fondu-blanc' ? 'white' : 'black', alpha } : null
}
```

`startS..holdStartS` is the ease (≈1.5 s): if you want a shorter fade, fade over the last `min(e, 0.8 s)` of it. **Test**: alpha is 1 at `holdStartS`, 0 at
`startS` and `endS`; monotone; a `coupe` junction has no pause and no dip. `OverlayTime` gains `junctions: ClockJunction[]` (extend
`overlayTime(clock, progress, timeS)`), `overlayExtras` calls `strongerDip(shotDip, junctionDip)`. **Update the export held-frame key** (it already includes
`dip.alpha`: confirm it covers the new source).

### 2.4 Scene during the hold

During the hold the marker does not move and `stageAt` already returns stage B → the scene shows B's first frame under the opaque dip — nothing to draw
specially. **(verify)** the sun/weather/cloud switch at the cut (`trackUnderMarker`) is hidden by the dip; the **camera hard-cut** is hidden too. Motion blur:
`sameShot` (`src/scene/lens.ts`) already stops blur across a cut using `clock.cuts` (keep `cuts`).

### 2.5 Stage card as a block

- Selected by id `card-stage-<afterTrackId>` for the card shown **after** that junction (the first stage's card uses `card-stage-first` and shares the opening
  title's window rules: today it gives way to the title card when both are on, `draw.ts` `drawOverlay`, keep).
- `JunctionCard = { enabled: boolean; durationS: number (1–15, default 5); text?: string; subtitle?: string; anchor; size; color?; font? }` — same fields as
  `FilmText` (`src/film/model.ts`) so the inspector and the draw code are shared. **Default content** = what `stageWidget` draws today (name, « Étape k sur n · date »,
  distance, D+): `text` absent means « automatic ». Add variables to explicit text: `{name} {n} {count} {date} {distance} {ascent}` (a tiny pure `fillTemplate`, tested).
- Window: starts at `holdStartS` (centre of the dip) and lasts `durationS` (so the card appears under the opaque dip and stays after it). Put it in `src/film/cards.ts`
  style: `stageCardWindow(clock, junction)`; `STAGE_CARD_S` stays the default.
- Lane: **« Textes »** (it is text). The block label « Étape 2 · <name> », grips `['start','end']` change `durationS` and the start offset relative to the hold (clamped to
  `[startS, holdEndS + …]`).

### 2.6 The « Étapes » lane

- New lane **above « Plans »**, only in sequence mode: one block per stage (`stage:<trackId>`, label « Étape k · name · distance », colour = track colour, `[start, end]`
  from `clock.cuts` / `junctions`), and between two blocks a **junction block** (`junction:<id>`) spanning `[startS, endS]` of its pause (so it shows the fade + hold).
- Junction block gestures: right grip drags `holdS` (`dragJunction(film, id, deltaS, ctx)` in `src/film/timeline.ts`, pure, tested like `dragFilm`; clamps to
  `JUNCTION_HOLD_RANGE`; ripple is automatic because the clock is rebuilt from `film`). Keyboard ±0.1 s / ±1 s (reuse the blocks' key handler).
- Stage blocks: not draggable in phase 1 (phase 2); clicking selects (`stage:<id>`) and seeks to the stage start.
- Remove `pointer-events: none` from `.film-tl__stage`, or replace the spans by the new lane; keep the colour underline in « Plans » only if you want a fallback.
- **Selection plumbing**: extend `hasFilmItem` (`timeline.ts`) with `junction:` / `stage:` / `card-stage-` ids; `FilmInspector.tsx` branches (junction: kind select
  with `TRANSITION_HINTS`-style hints, « Durée » RangeField (look at how the shot inspector does « Durée du fondu »: `DIP_DURATION_RANGE`), card on/off, « Appliquer à toutes
  les jonctions »; stage: name (read-only: it is the track name), colour, « Aller au début »).
- **Settings panel** (`TrackList.tsx` `RacePanel`): replace the two global controls by « Transition par défaut » (kind + durée) and keep « Carton au début de chaque étape »
  as the default of `junctionDefault.card` (no per-stage override there: it lives on the timeline).

### 2.7 Edit helpers and undo

All edits go through the film: `editFilm((f) => ({ film: withJunction(f, id, patch), id: selectionId }))` (`src/scene/usePacing.ts`) → one undo step. Pure helpers in
`src/film/junctions.ts`: `junctionOf`, `withJunction`, `applyToAllJunctions`, `junctionCardWindow`, `dragJunction`, `fillTemplate`.

### 2.8 Tests to write (phase 1)

- `junctions.test.ts`: defaults from old `race`, `junctionOf`, `withJunction`, `applyToAllJunctions`, clamp, `dragJunction`.
- `clock.test.ts`: a `fondu-noir` junction adds `holdS` to `totalTime()`, `clock.junctions[0]` has `startS < holdStartS < holdEndS < endS`, `coupe` adds nothing,
  `keepDuration` true/false, a stop at the same `atM`, `cuts[0].timeS === junctions[0].holdStartS`.
- `exportOverlay.test.ts` / `data.test.ts`: dip alpha curve, card window, `stageCards` default migrated.
- `model.test.ts`: `withFilmDefaults` on an old film (no `junctions`) and on a project with `race.stageTransition: 'fondu-blanc'`, `isValidFilm` accepts both.
- `Timeline.test.tsx`: the lane shows N stage blocks and N−1 junction blocks in sequence mode, none otherwise; dragging the grip changes `holdS`.
- UI/e2e: a scenario « Plusieurs traces » (load the sample twice via the store, like the existing multi-track e2e if any — **verify**) selecting a junction and changing its duration.
- **Manual with the reference project**: open it, the three stages and two junctions are visible; resize one junction; the film grows; export 5 s around a junction and check the dip.

### 2.9 Pitfalls

- `timeAtProgress(1)` returns `total` (end of the film), not the end of the flight: do not use it for the last stage.
- `cutsM` can be unsorted / duplicated (two zero-length stages): `clock.cuts` sorts, **junction ids must come from the stage list, not from the cut index**.
- A stage shorter than the card (5 s) or than `startS → endS` of its junctions: clamp the card to the next junction's `startS`.
- Don't read `race.stageCards` / `stageTransition` anywhere after the migration (grep to be sure).
- The overlay is also drawn **with the overlay off** for stage cards today (`draw.ts` «A stage card is drawn even when the overlay is off») — keep or change on purpose.

---

## 3. Phase 2 — reorder (list + timeline, remapping, undo)

### 3.1 Where the order lives (decide first)

`moveTrack` changes `tracks[]`, which is outside the undo history. Options:
- **A (recommended): `settings.race.order?: string[]`** (track ids). The sequence uses `orderedTracks(tracks, race)` (a pure helper next to `buildSequence`), the list displays in that
  order **in sequence mode**, other modes keep `tracks[]` (`flyTrack`). The reorder is then a **settings change** → `history.transaction(() => { setSetting('race', …); setSetting('film', remapped) })`, undoable and atomic;
  the project file stores `race.order` and the original `tracks` order. Cost: every reader of « first track » in sequence mode must go through `orderedTracks` (grep `tracks[0]`,
  `filmTrackOf`, `sequenceOf`, `buildSequence` callers).
- B: extend the history snapshot to `{ settings, trackIds }` (`createHistory<T>` is generic: `getSettingsHistory` would watch a combined object and `apply` would reorder `tracks`).
  Cleaner semantics, bigger blast radius (the `tracks === previous.tracks` guard, import side-effects).

### 3.2 `reorderStages` (pure, `src/film/reorder.ts`)

```ts
export function reorderStages(film: Film, before: readonly StageSpan[], after: readonly StageSpan[]): Film
// StageSpan = { trackId: string; startM: number; endM: number }   (from buildSequence before / after the move)
```

For every item anchored in metres, find the stage it belongs to **before** (`atM` in `[startM, endM)`; the last stage includes its end), then `atM' = atM − oldStart + newStart`:
`stops[].atM`, `cameraKeys[].atM`, `paramKeys[].atM`, `markerKeys[].atM`, `speeds[]` (`fromM/toM`). Rules:
- a **speed section spanning a boundary**: split it in two (one per stage, same factor) before remapping; drop pieces shorter than `MIN_SPEED_SPAN_M` (`src/film/model.ts`).
- items exactly at a boundary belong to the **next** stage (as `stageAt`).
- **texts / media / audio** keep their film seconds, except those with `stopId` (they follow via `followStops(before, after, clockOf)` — call it, as `editFilm` does).
- `film.junctions` keyed by `afterTrackId`: a junction survives if both tracks around it are still neighbours in the same order; otherwise it falls back to `junctionDefault`.
  (Moving B before A turns « after A » into « after B ».) Write the rule and test it.
- `autoStops` films regenerate their stops from landmarks along the new sequence — nothing to remap, but **`stops` written out** (`autoStops: false`) are remapped like any item.
- `pois` are lon/lat: untouched. `landmarks.hiddenIds`/`rank`: ids, untouched.
- **Test** a 3-stage fixture: a stop in stage 3 moves with it when it becomes stage 1; a speed spanning stages 1–2 is split; round-trip (A→B→A) restores the film; idempotence.

### 3.3 UI

- **Track list**: a drag handle (`⠿`, `aria-label` « Déplacer la trace »), pointer events (`pointerdown` on the handle, `setPointerCapture`, `pointermove` computes the target index from the card centres,
  an insertion line, `pointerup` commits). **Touch**: start after a **350 ms long-press** (`touch-action: none` on the handle only, so the list still scrolls), vibrate if `navigator.vibrate`;
  auto-scroll the panel when the pointer is within 40 px of its top/bottom edge (rAF loop, cancel on end). **Keyboard**: focus the card, `Alt+↑/↓` moves one place (announce through an
  `aria-live` region: « Trace déplacée en position 2 »). Add « Ordonner par date » (sort by `stats.startTime`, untimed ones last, stable) and keep the ▲ button as a fallback if you like.
- **Timeline** (stage blocks of « Étapes »): same ghost + insertion marker; the dragged block follows the pointer, the others shift; commit on release; Esc cancels. Not in the centred phone layout (the list is the way there).
- Both call one function `reorderTracks(trackId, toIndex)` (store action that builds the two `StageSpan` lists, calls `reorderStages`, wraps in `history.transaction`).

### 3.4 Tests

`reorder.test.ts` (above); `orderedTracks` with and without `race.order` (ids that no longer exist, new tracks appended); store action undo/redo restores both `race.order` and `film`; component test of the list
(keyboard move + « Ordonner par date »); a pointer-drag test with jsdom pointer events is optional (e2e instead).

---

## 4. Phase 3 — duration per stage and light blend

### 4.1 Duration per stage

- Model: `film.stageDurations?: Record<trackId, number>` (seconds of flight for that stage, 5–600). Unset ⇒ proportional share (today).
- Clock: today `flightPacing(lengthM, …, durationS, …)` spreads `durationS` over the whole length. With per-stage durations the base speed is piecewise: stage k flies `L_k` metres in `D_k` s.
  Implement as a **per-metre base-speed weight** passed to `flightPacing`: weight `w(x) = (L_k / D_k) / (L / D)` on stage k (so a stage given 2× its proportional time flies at half speed), with eased
  junctions (the cut is a hold anyway). **(verify)** how `flightPacing` builds its moving-time integral (`speedNodes`, `SpeedCurve`, `curve.knotsM`): the `SpeedCurve` that `paramKeys speed` already uses is the
  natural vehicle — multiply it by the stage weight. Keep `keepDuration` meaning: the sum of unset stages' shares + set stages = the film.
- UI: the stage inspector (« Étape 2 ») has « Durée du vol » (− / + and field, « Auto » to unset); the timeline shows the stage block with that width (a drag of its right edge sets it, with the junction rippling).
- Tests: a 2-stage clock where stage 2 is set to twice its share; `D_k` sums; unset = byte-identical to today (snapshot the old output).

### 4.2 Light blend at junctions (fade)

- Today: `trackUnderMarker(tracks, race, progress)` returns the stage under the marker; the sun hour/date comes from `settings.sunHour/sunDate/sunFromTrack` and that stage's recorded time;
  nights add pauses. Sun is evaluated per frame from `(progress)` in `AtmosphereLayer` / `FlyoverRig` / `SunLight` (**verify** the exact hooks: grep `sunFromTrack`, `sunDateAt`, `trackUnderMarker`).
- Add `film.lightBlend?: boolean` (default on in sequence mode) and compute the **sun state during a junction hold as a blend** of the previous stage's end sun and the next stage's start sun:
  `sunDirection = slerp(sunA, sunB, smoothstep(startS, endS, timeS))`, hour-angle interpolated the **short way** (a day→night change must pass through dusk, not flip), colour/intensity from the interpolated elevation.
  The pure function lives next to `src/flyover/sun.ts` (`blendSun(a, b, t)`), tested (noon→midnight passes the horizon; same sun ⇒ identity). The scene reads `clock.junctions` + `timeS` (deterministic).
- « Lumière » tab simplification (`src/ui/GradingPanel.tsx` / `NightSettings.tsx` / `SettingsPanel.tsx` — **verify the right panel**): a single « Source de la lumière » (*Heure de la trace* / *Heure fixe*), « Heure » + « Date » only
  when fixed, « Jours et nuits » reduced to one switch (its durations move to the junction `nuit` kind). `paramKeys` of `sunHour` keep working and override the blend.
- Tests: sun at `holdStartS` = blend(0.5), outside the junction = the stage's own sun; export determinism (same time ⇒ same sun).

---

## 5. Phase 4 — « Survol » transition (sketch)

The camera pulls up to an overview of both stages, travels, dives into the next stage. Reuse the opening `situation` shot machinery (`FilmShot.style === 'situation'`, `src/flyover/filmCamera.ts`,
`startHeight`, `highlight`, `regionId`, `holdS`): a junction of kind `survol` is a **shot** between two stages: its camera path is a Bézier between the last camera pose of stage A and the first of stage B, apex above the midpoint,
height from the distance between the two places. Needs: (1) terrain tiles between the stages (prefetch along the straight line; `engine.prefetch` exists — see the export tile wait in `ExportController`), (2) the
clock hold with a flying camera instead of a still (the pause `durationS` = travel time, derived from the distance, clamp 3–12 s), (3) the marker hidden or pulsing during the travel. Treat it as its own design review.

---

## 6. Magnet and alignment aids (phase 1b, applies to all lanes)

Current: `snapTargets` → `number[]`, `snapTime(t, targets, distance)`; one 8 px snap; Alt disables. Change to **labelled targets** and a drag-local state:

```ts
export interface SnapTarget { timeS: number; label: string; kind: 'edge' | 'centre' | 'playhead' | 'junction' | 'ruler' | 'highlight' | 'end' }
export function snapTargets(...): SnapTarget[]                   // + centres, junctions, cards, keys, ruler ticks; excludes the dragged items
export function snapTime(t: number, targets: SnapTarget[], pullS: number, current?: SnapTarget): { timeS: number; hits: SnapTarget[] }
//   hysteresis: keep `current` while |t − current.timeS| ≤ releaseS (≈ 14 px), catch a new one within pullS (≈ 8 px); `hits` = every target at the same time (±1 ms)
```

- Pull/release distances in **pixels** converted with the zoom (`pxPerS`).
- **Guides**: while a drag is active, render `<div class="film-tl__guide" style={{ left: xOf(hit.timeS) }}>` spanning all lanes (absolute, `pointer-events: none`, 1 px accent line) + a tag with `hit.label`; several hits ⇒ one line, tags
  stacked. Hide on drop.
- **Items to include**: edges and centres of stops, speeds, texts, media, music, cards, junction blocks and card blocks; keys (camera/param/marker diamonds); playhead; ruler ticks (`rulerTicks`); film ends; highlights. Exclude the selection being dragged.
- **Resize handles** and **new items dropped from the toolbar** use the same function.
- **Control**: a magnet toggle button in the timeline bar (state in `Preferences`/`usePreferences`, device-level), `Alt` inverts while held (replaces « Alt disables »). Update the shortcuts help (`HelpDialog`, `shortcuts.ts`).
- Tests: pure `snapTime` hysteresis, label/kind of targets, multiple hits; component test that a guide appears during a drag (jsdom pointer events) — optional.

---

## 7. Order of work and slicing

1. **#101** (phase 0) — merge.
2. **1a** model + clock hold + dip + migration (no UI): `junctions.ts`, `clock.ts`, `exportOverlay.ts`, `model.ts`, tests. Shippable: a film with `junctionDefault` behaves as before **plus** the hold.
3. **1b** UI: « Étapes » lane, junction inspector, default in `RacePanel`, stage cards as blocks.
4. **1c** magnet + guides (labelled targets) — independent of 1a/1b, can go first.
5. **2** reorder (`orderedTracks`, `reorderStages`, store action, list drag, timeline drag).
6. **3** per-stage duration, light blend, « Lumière » simplification.
7. **4** « Survol ».

Each PR: CHANGELOG bullet, `ARCHITECTURE.md` (section « Several tracks » + « Film and timeline » + « Film overlay »), `docs/user-guide.html`, manual test procedure in the PR body, old-project test.

## 8. Wireframes (ASCII)

```
Étapes   | Étape 1 · Col d'Ezpegui · 104,8 km        |▓▓▓ fondu ▓▓▓| Étape 2 · Gros tour · 144 km            |▓▓▓|  Étape 3 ·…
Plans    | Ouverture | Survol ───────────────────────────────────────────────────────────────────────────────── | Clôture
Vitesse  |
Arrêts   |        [Ispéguy]   [Gorramakil]        [Itxassou]                      [Ibardin]
Textes   | [Titre d'ouverture]          [Carte · Étape 2 ──]                       [Carte · Étape 3 ──]        [Carte de clôture]
                                        ^ junction 1: grip on the right edge drags the hold (ripple)
Guide while dragging a text:   ┊ (vertical accent line across all lanes) ┊  tag: « Jonction 1 »
```

Junction inspector (right dock): **Transition** [Fondu noir ▾] · **Durée** [− 0,8 s +] · **Carton** [on] · **Appliquer à toutes les jonctions** · hint « Le film s'arrête ici le temps indiqué, en fondu. »

Track card in the list: `[⠿] ● Col d'Ezpegui – … 104,8 km · D+ 2172 m · 5 h 53   [×]` — the handle is the only touch-draggable area.

## 9. Review checklist

- Old project (no `junctions`, `race.stageTransition: 'coupe'`): the film is **identical** (same `totalTime()`); with the default fondu noir the total grows by the holds only.
- Export determinism: same film time ⇒ same pixels (dip, card, light blend); the held-frame key includes every new source.
- Undo/redo of every edit is one step; reorder undo restores order **and** items.
- One stage / two stages / three stages; first or last stage tiny (< 5 s); stops or keys exactly at a boundary; speed section across a boundary.
- Phone portrait (centred timeline): lanes render, the drag of stage blocks is disabled, the track-list reorder works by long-press.
- Keyboard: every new block is focusable with arrows ±0.1/±1 s; screen reader labels in French.
