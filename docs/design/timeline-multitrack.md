# Design proposal: a clearer, more complete timeline for multi-track films

Status: **proposal, for discussion** (no code in this PR). The step-by-step implementation guide is [`timeline-multitrack-implementation.md`](timeline-multitrack-implementation.md). Language of the UI labels quoted below is French, as in the app.

## 1. Why

The multi-track film (« Plusieurs traces » › « À la suite ») is one of the strongest features of OpenFlyover, but the timeline
does not tell its story. Feedback from the owner, on a real 3-day project:

1. The transitions between tracks are not readable on the timeline, cannot be resized, and a transition cannot be placed or
   configured for one given junction.
2. The opening card of the next stages (« Carton au début de chaque étape ») is not on the timeline, so it cannot be configured.
3. For journeys over several days, the day/night lighting of one stage conflicts with the next; the user must be able to choose
   what is shown. Dusk and dawn should be smooth, and the « Lumière » settings simpler.
4. Tracks must be reorderable by drag and drop, with the mouse or a finger.
5. Overall: a timeline that is more complete and more professional.

## 2. Evidence: what the reference project shows

The project supplied by the owner (3 Strava tracks, 3 consecutive days, 99–144 km each, `race.sequence = true`) shows the pain
points in practice:

- **The list order is not chronological**: the tracks are flown day 2, day 3, day 1 (the owner has no quick way to order them; the
  only tool is a ▲ button per track, one step at a time, which resets the playhead and is not undoable).
- The owner wrote three **hand-made texts « Jour 1 / Jour 2 / Jour 3 »** at fixed film seconds (6 s, 31 s, 53 s). They do not follow
  the stages: reorder a track and they are wrong. The automatic stage cards (5 s, not editable, not on the timeline) are not used
  for that need.
- « Jours et nuits » is on (dusk 8.5 s, night 5 s, dawn 5.5 s): night pauses are generated automatically at recording gaps, with no
  way to say « not here » or to choose what the viewer sees at this junction.
- The stage blocks on the « Plans » lane are display only (`pointer-events: none`), separated by a white line.

## 3. How it works today (from the code)

- A stage is **not an entity**: « À la suite » is `settings.race.sequence`; `buildSequence` concatenates the tracks' segments in
  list order into a virtual track; a stage is a track plus its metre range `[startM, endM]` (`src/flyover/sequence.ts`).
- `race.stageCards` (on/off) and `race.stageTransition` (`coupe` / `fondu-noir` / `fondu-blanc`) are **one global value** for all
  junctions. The card lasts a constant 5 s (`STAGE_CARD_S`), the dip a constant 1 s centred on the cut (`DIP_DEFAULT_S`).
- Both are **overlays over a flight that keeps running**: the transition adds no time to the film clock; the camera hard-cuts
  under the dip. The only thing that inserts time at a junction is the nights feature (`film.nights`, pauses on the clock).
- Everything in the film is anchored in **metres along the sequence** (stops, speed sections, camera / parameter / marker keys);
  texts, media and music are anchored in **film seconds**. Reordering tracks leaves all metre-anchored items at the same metres,
  so they land on another stage.
- `Timeline.tsx` builds its clock input without `cutsM`, so the stage spans probably collapse while any drag is in progress
  (read in the code, not run).
- « Enchaîner en un seul parcours » is a second multi-track path: it merges the tracks into one real track (destructive, undo only
  through a toast), with no stage and no cut.

## 4. What the reference editors do

| | Where a transition lives | Duration | Placement | Applying |
|---|---|---|---|---|
| Premiere Pro | on the edit point between two clips | default 1 s (Preferences › Timeline), drag the edge to change both sides, Shift-drag one side | drag the icon to move it relative to the cut, keeping its length; needs « handles » (unused media at the clip ends) | drag onto a cut, or *Apply Default Transitions* (Shift+D) on a selection |
| DaVinci Resolve | on the edit point | standard duration in Preferences, drag the edges | left / centred / right of the edit point | Ctrl+T applies the standard transition to the selected edit point; drag from the Effects Library lands it centred |
| CapCut | a small square between two clips on the same track | slider (typical advice 0.5–1 s) | between the clips | *Apply to all* to give every cut the same transition |

Sources: Adobe Help Center (« Set and apply default transitions in Premiere », « Change transition duration in Premiere »,
« Modifying and customizing transitions »); Blackmagic Design forum and guides for Resolve; CapCut tutorials (low-quality sources:
the *Apply to all* behaviour after a later duration change is not confirmed). Final Cut and others were not checked.

What to keep from them: a transition is an **item at the junction** (selectable, with its own duration, default value in
the preferences, *apply to all*); a default transition applied in one gesture; snapping to the junction. What does **not** carry over:
their « handles » (our stage's flight is generated from the distance, there is no spare footage), layered multi-tracks (Premiere:
V1/V2/A1…) and cross-dissolves (see §6.2).

## 5. Principles (where I challenge the brief)

1. **A route is not a clip.** OpenFlyover's time is derived from distance; there is one flight, played in order. Copy the
   *storyline* model of CapCut (one main line + items on top), not the layered multi-track of Premiere. Fewer concepts, fewer errors.
2. **One junction = one object.** Today the junction is split in four unrelated places (global transition type, global card
   switch, global night pauses, a marker option). A junction should hold: transition (type, duration), card (content, duration),
   light (what the viewer sees: day / night / blend). Select it, configure it, done.
3. **Don't build two features for one need** (the lesson of « Ralentir aux repères » vs « Arrêt »): « Enchaîner en un seul parcours »
   and « À la suite » overlap. Decide which one the timeline serves (question Q9).
4. **Time inserted, not hidden.** A 3 s dip that eats 1.5 s of each flight is wrong in a film whose length is a deliberate choice.
   Junction time should be explicit and visible on the clock.
5. **Everything the user sees must be on the timeline** (as for the opening title and closing card, #65), and everything on the
   timeline must follow its stage when stages move.

## 6. Proposal

### 6.1 Model

- New film-level list of **junctions** (`film.junctions[]`, keyed by the pair of track ids around it, so it survives reorder):
  `{ id, afterTrackId, transition: { kind, durationS }, card: { enabled, … }, light: … }`. Absent = defaults taken from the former
  `race.stageTransition` / `stageCards` (migration in the existing defaults helpers, no version bump; old projects look the same).
- A **stage item** per track (derived from the track list, not stored): name, colour, distance, duration, shown on a new
  **« Étapes »** lane above « Plans ».
- The **stage card** becomes an ordinary card block in « Textes » (like `card-title` / `card-end`): editable text with variables
  (`{name} {n}/{count} {date} {distance} {ascent}`), style, size, anchor, duration (default 5 s). The owner's hand-made « Jour N » texts
  become unnecessary.

### 6.2 Transition kinds and time model

| Kind | What the viewer sees | Cost |
|---|---|---|
| Coupe | hard cut (today's default for `coupe`) | none |
| Fondu noir / blanc | dip through black / white, **held for `durationS` on the clock** (the card lives inside the dip) | small: the existing pause mechanism of the nights (`extra` hold) + the existing dip layer |
| Nuit | dusk → night → dawn (today's nights feature, per junction, on demand instead of automatic) | small: already exists, becomes a junction option |
| Survol (phase 4) | the camera pulls up to an overview of both stages, travels, dives into the next stage (as the `situation` opening already does at the start) | medium–high: camera path between distant places, terrain tiles to load between them, export tile waiting |

Not proposed: **cross-dissolve** between two live 3D scenes. It needs two renders per frame (double cost, double tile budget in
export) for a result the dip-through-black or the flyover transition give more cheaply; revisit only if users ask.

Duration: a global default (« Réglages ») with a per-junction override and an *Apply to all* action, resizable on the timeline by
dragging the edge of the transition block (ripple: the film gets longer or shorter by the difference), keyboard ±0.1 s / ±1 s like
the other blocks, snapping to the junction.

### 6.3 Reordering stages

- **Track list**: a drag handle on each track card (mouse, and finger with a long-press so that it does not fight the list scroll),
  an insertion line, auto-scroll at the edges; keyboard alternative (Alt+↑/↓) and « Ordonner par date » (the owner's list is not
  chronological). Replaces the ▲ button. (Related: issue #39, study of drag and drop.)
- **Timeline**: stage blocks on the « Étapes » lane are draggable with the same ghost and insertion marker.
- **Semantics**: a pure `reorderStages` remaps every metre-anchored item (stops, speeds, camera / parameter / marker keys, landmark
  stops) with its stage (`atM += newStartM − oldStartM` per stage; items that span a junction are clamped to their stage),
  keeps texts and media at their film time unless attached to a stop, keeps each junction object with its pair of tracks
  (a junction between tracks that are no longer neighbours falls back to the default). One undo step, playhead kept.
- On the portrait phone layout (centred playhead) reorder from the track list only.

### 6.4 Light per junction (day / night)

Today the sun comes from the track under the marker (`trackUnderMarker`) and from `sunHour` / `sunFromTrack`; nights add pauses at
recording gaps. For multi-day journeys the two interact badly. Proposal:

- Per stage, a **light source**: *Heure de la trace* (default), *Heure fixe* (hour and date), *Continue* (continue the previous
  stage's hour).
- At each junction, a **blend** (the junction's duration, smoothstep on the sun position) from the previous stage's light to the
  next one, so dusk and dawn are smooth instead of switching at the cut; the « Nuit » transition kind (above) is the explicit
  dusk → night → dawn version.
- « Lumière » tab simplified to: *Source de la lumière* (trace / fixe), *Heure / date* (only if fixe), *Nuits* (a single switch +
  the three durations moved into the junction). Existing `paramKeys sunHour` keys keep working and override the blend.

### 6.5 UI summary

« Étapes » lane (stage blocks with colour, name, distance, duration; junction badges between them) · junction inspector
(transition type, duration with − / +, card, light) · stage inspector (name, colour, later trim and speed) · stage cards as blocks
in « Textes » · snap targets on junctions, card edges and nights, with alignment guides (§6.6) · drag handle on track cards.

### 6.6 Magnet and alignment aids (owner comment on the PR)

Requirement: the timeline should feel magnetic, with alignment aids when an object is placed on one lane near an object of
another lane.

Today (`snapTargets`, `snapTime`): one global snap at 8 px to the film ends, shot edges, stop and speed edges, text / media / music
edges, highlights and the playhead; Alt disables it; nothing is drawn while snapping. Proposal:

- **Targets across all lanes**: every edge **and centre** of every item (stops, speeds, texts, media, music, cards, junctions, transitions,
  keys), the playhead, the ruler ticks, and later the music beats. Items of the selection being dragged are excluded.
- **Alignment guides**: while dragging, a thin vertical guide line spans the lanes at the snapped time, with a small tag naming what
  it aligns to (« Fin de Itxassou », « Jonction », « Tête de lecture »); when several targets share the time, they all light up.
- **Magnet feel**: a pull distance (≈ 8 px) to catch and a larger release distance (≈ 14 px) to leave (hysteresis, so it does not
  flicker), a short ease into the target, and the same behaviour for resize handles and for dropping a new item from the toolbar.
- **Control**: a magnet toggle in the timeline bar (and a key to hold to temporarily invert it); the existing Alt override stays.
- **Cross-lane rule**: moving an item **vertically is not needed** (lanes are typed), so alignment is about time only; for the
  « Étapes » lane, items also snap to the stage boundaries (junction start / end of the held transition).
- **Phase**: this belongs to phase 1 for the new items (junctions, cards) and is extended to all items in the same PR if the snap
  code stays pure (`snapTargets` returns labelled targets `{ timeS, label }`, tested), otherwise a phase 1b.

## 7. Phasing and expected impact

| Phase | Content | Why it is worth it (impact) |
|---|---|---|
| 0 — hygiene (small PR) | pass `cutsM` to the timeline's clock input (no collapse during a drag); junctions as snap targets; `moveTrack` in the undo history; check nights × cut at the same position (untested today) | removes visible glitches, no new concept |
| 1 — junctions | `film.junctions`, « Étapes » lane, junction inspector, held dip with duration (resizable), stage cards as blocks, migration of `race.stageCards` / `stageTransition` | makes the multi-track story readable and configurable; the owner's 3 hand-made « Jour N » texts and the global transition disappear. Target: building a 3-stage film with titles and transitions needs no manual text and no leaving the timeline |
| 2 — reorder | drag in list and timeline, `reorderStages` remapping, « Ordonner par date », undo | list order is currently wrong on the reference project and fixing it breaks the film; target: reorder never moves a stop / key off its stage |
| 3 — light | per-stage light source, junction blend, simpler « Lumière » | multi-day journeys without day/night conflicts; fewer settings than today |
| 4 — optional | « Survol » transition, trim in / out per stage, per-stage duration (« équitable » vs « proportionnelle à la distance ») | the cinematic step; only if 1–3 land well |

Each phase is one or two PRs, each reversible, each with old projects opening unchanged. Tests: pure functions first (`reorderStages`,
junction defaults and migration, clock holds, light blend), then UI tests of the lane and the drag.

## 8. Risks and open points

- **Anchoring** is the real cost: metres vs seconds, and items that span a junction. Phase 2 must not ship without `reorderStages`
  and its tests.
- **Held transitions change the film length** (like nights today): the « flyoverDurationS » semantics must be documented (flight time,
  transitions extra).
- **Export determinism** is kept if every junction item is a pure function of the film time (the dip, the card and the blend are).
- **Night pauses × junction**: not verified today; phase 0 adds a test.
- **Weather, poster and sunrise / sunset still read the first track** (documented limit); not changed here.
- **Mobile**: long-press drag, no timeline drag in the centred-playhead layout.

## 9. Decisions (owner answers, 12 Oct)

| # | Question | Decision |
|---|---|---|
| Q1 | Transition adds time to the film? | **Yes.** Transitions are held on the clock; the flyover duration means flight time, transitions come on top. |
| Q3 | Which transitions? | **Yes to all four**: coupe, fondu noir / blanc, nuit, survol (the camera transition stays last, phase 4). |
| Q5 | Duration share between stages | **A duration per stage** (set on the stage; unset = today's proportional share). Brought forward to phase 3. |
| Q7 | Light at a junction | **Smooth blend at the junction** (each stage at its real hour, fade between). |
| Q9 | « Enchaîner en un seul parcours » | **Kept** (clearer for the owner); « À la suite » stays too. Both are documented as different: chaining = one track with one continuous profile and statistics, sequence = separate stages. |

Assumed until answered (shout if wrong): **Q2** default transition fondu noir, 1.5 s, in « Réglages » with *Apply to all*; **Q4** stage
card = editable block in « Textes », shown inside the dip, variables name / day / date / distance / ascent; **Q6** no trimming
(not requested); **Q8** reorder both in the track list and on the timeline; **Q10** phases as below, with per-stage duration moved
into phase 3.

Phases after the decisions: 0 hygiene → 1 junctions (type, held duration, cards as blocks, « Étapes » lane, inspector, migration) →
2 reorder (drag, remap, undo, « Ordonner par date ») → 3 per-stage duration + light blend → 4 « Survol » transition.
