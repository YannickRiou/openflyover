# Roadmap

What comes next, in the order it will be done, and what waits. Each item names the promise of [VISION.md](VISION.md)
it serves and how it will be checked. The [changelog](CHANGELOG.md) says what each version brought.

## 8.x: a film that looks like a pro shot, and an export that holds

- **8.0** (November 2026): the camera keeps the tilt you ask for in the mountains, relief shadows are sharp when the
  camera flies low, a new project starts graded, one lens for every film.
- **8.0.1**: a ridge hides the marker no longer than before 8.0; the « Nouveautés » are in plainer French.
- **8.1** (November 2026): the export holds on long films and bad networks: tiles that stall give up and are tried again, a
  graphics card reset is recovered, « Annuler » always works, a failed export can resume from the kept frames.
- **8.1.2**: the 3D labels grow on their own in a vertical film (×1.5 in 9:16) and « Taille des étiquettes » goes up to ×3; new screenshots in the user guide.
- **8.1.1**: a « situation » opening or closing no longer stalls the export, even on a modest computer; the « Nouveautés » are rewritten in plain words.
- **Still open**: the 7.0 items below that are not marked done, and the points of « To decide ».

## 7.0: a beautiful film by default, an export that finishes, projects that keep opening

7.0 adds few features. It makes the existing ones reachable without learning the tool, makes the export reliable on
every device, and fixes the promise of the project file.

### 1. A beautiful film by default

Promise 1. The activity of a track only chooses the marker's figure today (`figureOfActivity`, from the FIT sport or
the GPX type, hiker when unknown).

- **Débutant on a first visit: done.** The first launch asks « Combien de réglages voulez-vous voir ? » with Débutant
  preselected (`ui/ModeChoice.tsx`); the answer is kept on the device and can be changed in « Réglages ».
- **The activity, proposed at import.** After the first import, a short choice shows the 17 activities of the
  markers (hiker, mountaineer, runner, trail runner, cyclist, e-bike, bikepacking, mountain bike, skier, ski touring,
  swimmer, kayak, rider, paraglider, motorbike, car, light aircraft). The activity read from the file is selected; the
  person confirms, picks another or skips. Nothing is imposed: skipping keeps today's film.
- **What an activity sets.** One film per activity: camera style and height, marker, overlay style, duration and
  format. It works like a preset of settings (`project/presets.ts`), so every value stays editable afterwards and Expert shows
  it as a change from the default.
- **Check.** Two or three people who do not know the tool export a film from their own track, on a phone and on a
  computer, without opening « Réglages ». The goal: under 5 minutes from opening the app to the export starting, and a
  film they say they would share.

### 2. An export that finishes

Promise 3. On an iPhone, a minute of film took between 9 and 38 minutes in November 2026 (388 to 1 572 ms per frame),
depending on the format and the clouds, and a locked screen or a closed tab loses it.

- **Targets.** For one minute of film with the device's default export settings: **10 minutes at most on a phone,
  30 minutes at most on a computer**. That is about 415 ms per frame on a phone at 24 frames per second, and 1 s per
  frame on a computer at 30 frames per second.
- **Reference projects.** One or two projects kept in the repository (a vertical phone film with weather clouds, a
  16:9 film with forests and water), measured with « Mesurer le coût des couches » at each minor version, on an iPhone
  and on a Windows computer. The results go in the release pull request. The projects are in `bench/` and the
  procedure and the results table in [`docs/benchmark.md`](docs/benchmark.md).
- **The length, said before the start.** The export panel estimates the time from the history of past renders
  (`export/history.ts`) and the size of the film. Above the target, it says so and offers what makes it faster: a lower
  quality, a smaller size, lighter clouds.
- **An export that resumes.** The frames already encoded are kept on the device (origin private file system) as the
  export runs. After a locked screen, a closed tab or a crash, the next visit offers to resume from the last frame kept.
  The film is the same as one made in one go.
- **Check.** The reference projects within the targets; an export interrupted at mid-length and resumed gives a file
  of the same length whose frames match.

### 3. Projects that keep opening

Promise 4. The project file already has a version (`PROJECT_VERSION`, 8 in 6.1) and a migration for each step, and
`project/legacy.test.ts` opens files written by earlier versions, frozen.

- **The promise, written.** From 7.0, a project saved by a version opens in every later version. A file from a newer
  version gets a clear message, as today (`project.doc.versionNewer`).
- **A frozen file per format version.** Each change of `PROJECT_VERSION` adds a project written by the version before
  it to the frozen files, never regenerated, with a test that opens it and checks its film.
- **The format, described.** A page lists the fields of the project file, their units and since which version they
  exist, so that a change of format is a visible decision.
- **Check.** The frozen files of every version open in CI; a change that breaks one fails.

Done: a frozen file per version 1 to 8, a test that fails when `PROJECT_VERSION` is raised without one, and the format
described in [`docs/project-format.md`](docs/project-format.md).

## To decide

- **Release rhythm.** A minor version every two to four weeks, with a test channel for checks on devices, instead of
  several versions a day.
- **A budget of settings.** A maximum number of rows per tab in Expert; adding one means merging or removing another.
- **Preferences across devices.** Without an account, the mode chosen does not follow from one device to another. An
  export and import of the preferences would let it.
- **Features to remove or merge.** Case by case, with the three questions of VISION.md. No list is decided yet.

## Not now

- **Haptic feedback on a phone.** Only Android supports it in the browser; it does not serve a promise of 7.0.
- **« Celle de la trace » in « À la suite »** and **« Enchaîner en un seul parcours » in « Bilan »**: waiting for a
  decision on how they are used.
