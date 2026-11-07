# The project file format

What a saved OpenFlyover project holds, which version of the format introduced what, what is promised to the people who
saved one, and how to change the format without breaking that promise. The code is in `src/project/document.ts` (the
document, its checks and its migrations) and `src/project/file.ts` (the file around it).

## The promise

**A project saved by a version of OpenFlyover opens in every later version.** What the file says is kept: the film
looks and plays as it did, or, when an option was removed, the file still opens and a message says what is gone
(`project.doc.pacingRemoved`). A file written by a newer version than the application opens nowhere: it gets one clear
message, "This project uses format v{version}, newer than the one of this version of OpenFlyover (v{target}). Update
the application to open it." (`project.doc.versionNewer`), and nothing is read or changed.

This is checked in CI: `src/project/frozen.test.ts` opens one frozen file per format version (`src/project/__fixtures__/`)
and fails when a version has none.

## The container (`file.ts`)

A project is saved as `<name>.opnflvr`, with the MIME type `application/x-opnflvr`.

| Bytes | Content |
| --- | --- |
| 0 to 6 | the ASCII signature `OPNFLVR` |
| 7 | the file version: `1` = a gzip stream follows, `2` = the JSON text follows as is (written where `CompressionStream` does not exist) |
| 8 on | the exact JSON text of `serializeProject`, gzip-compressed or not |

Both file versions are read by every reader. A file with no signature is read as plain JSON text: that is the older
`.openflyover.json` and the documents of « Mes projets ». The file version (the byte) is not the format version below:
it only says how the JSON text is wrapped.

## The document (JSON)

`serializeProject` writes, in this order:

| Field | Content |
| --- | --- |
| `format` | always `"openflyover-project"`; anything else is refused ("not an OpenFlyover project") |
| `version` | the format version, an integer from 1 (`PROJECT_VERSION`, 8 today) |
| `name` | the project name, trimmed; empty gives the default name |
| `settings` | every setting of the store, see below |
| `playback` | `{ "speed": 0.5 \| 1 \| 2 \| 4 }`, the playback speed multiplier; another value is replaced by x1 with a warning |
| `tracks` | the tracks, one line each, see below |
| `media` | pictures, clips and sound files of the film by id (`film.media[].src`, `film.audio[].src`), omitted when the film has none; each is stored as data, and one whose file is missing or unreadable is dropped from the film with a warning |

### Tracks

A track is column-oriented: `{ id, name, source, color, segments, ... }`.

- `id` is a unique non-empty string; a duplicate is an error. `source` is `gpx`, `fit` or `strava`. `color` is `#rrggbb`.
- `segments` is a list of `{ lon: [], lat: [], ele?: [], time?: [], hr?: [], cad?: [], power?: [], temp?: [] }`. A column
  entry is a number or `null` where the point has no value; every column has as many entries as `lon`.
- Units: `lon` and `lat` in degrees (WGS84, 7 decimals, about 1 cm); `ele` in metres (2 decimals); `time` in
  milliseconds since the epoch, UTC (whole numbers); `hr` in beats per minute, `cad` in revolutions or steps per
  minute, `power` in watts, `temp` in degrees Celsius.
- Optional fields, omitted when they say nothing: `activityType`, `waypoints` (`{ lon, lat, name, ele? }`),
  `utcOffsetMin` (minutes), `timesEstimated`, `elevationEstimated` (`all` or `gaps`) with `elevationFilled`, `flights`
  (paraglider flights as distance ranges along the track, in metres), `statsOverride` (corrected figures).
- Statistics and bounds are never stored: they are recomputed on load.

### Settings

`settings` is one object holding every key of `Settings` (`src/state/store.ts`), each checked on load by `SETTING_CHECKS`
and filled in by `SETTING_UPGRADES` when its shape grew. A key that is absent or invalid is replaced by its default, and
the names of the replaced ones are listed in one warning; a key the application does not know is ignored. This is why
adding a setting needs no new version. The blocks, with their units:

| Block | Holds |
| --- | --- |
| `terrainSourceId`, `demClean`, `imagerySourceId`, `imageryDate`, `imageryZoomOffset`, `imageryVivid`, `exaggeration` | terrain and imagery sources by id (a removed source opens in its successor), the date of the photos, the extra imagery zoom (0, 1 or 2 levels), vivid colours (0 to 1), vertical exaggeration (a factor above 0) |
| `atmosphere`, `shadows`, `cloudShadows`, `sunHour`, `sunDate`, `sunFromTrack`, `exposureEv`, `nightLightEv`, `grading`, `lens` | light and picture: local mean solar time in hours (0 to 24), `YYYY-MM-DD`, exposure in stops (-4 to 4), night light in stops (0 to 4), colour grading, lens effects |
| `trackColorBy`, `trackLegendAnchor`, `trackLegendShown`, `trackLegendFree`, `trackStyle`, `marker`, `markerValue`, `trackTail`, `trackRibbon` | how the tracks and the progress marker are drawn |
| `camera`, `flyoverDurationS`, `pacing`, `film` | the flight: camera style (distances as a multiplier, angles in degrees, smoothing in seconds); the duration at x1 in seconds; the transitions (`pacing`, seconds); the film on the timeline |
| `labels`, `landmarks`, `race` | 3D labels (`kmStep` in km, `rangeKm` in km from the camera), OpenStreetMap landmarks (`maxDistanceM` in metres), ghost race and stages |
| `weather`, `weatherScene`, `clouds`, `water`, `snow`, `contours`, `forest` | weather and its scene (strengths from 0 to 1), clouds, water, snow line, contour lines, trees |
| `overlay`, `video`, `poster` | the film's overlay and its widgets (free positions as a share of the safe area since v8, sizes as a multiplier), the export (aspect, resolution, frame rate, quality), the poster |

The film (`settings.film`) is the one block with its own lists, all positions along the track in metres of distance
(`atM`, `fromM`, `toM`) and all durations in seconds (`durationS`, `startS`): `stops`, `speeds`, `texts`, `cameraKeys`,
`paramKeys`, `markerKeys`, `media`, `audio`, `pois`, `junctions` and `junctionDefault` (stage transitions), `nights`,
`opening` and `closing`. Every list has an `id` per item.

## Which version introduced what

| Version | Since | What changed in the format | Migration (`MIGRATIONS[n - 1]`) |
| --- | --- | --- | --- |
| 1 | first project file (`44d836b3`) | the document above, with pacing ("Ralentir aux temps forts") and no film | none |
| 2 | the timeline (`11812f73`) | `settings.film`: shots, stops, speeds, texts | a v1 file without a film gets `{ autoMode: 'rythme' }`, so it keeps the stops its pacing made |
| 3 | stage transitions (`36a84973`) | `film.junctionDefault`, the default transition between stages; a junction left to the default no longer turns into a night by itself | writes the default junction explicitly, as v1 and v2 read an absent one, and keeps the night where the nights were on |
| 4 | common stage card (`7158a78d`) | a stage card stores only what it changes over the common card | drops the fields equal to the default card |
| 5 | titles and stops on their own (`549b2d06`) | the opening title and closing card show with the overlay off; the automatic stops no longer read the pacing | switches the cards off where the overlay was off, keeps the stops and their grouping |
| 6 | night and high view on their own (`9a00ae30`) | a junction's night (`night`) and "Revoir l'étape finie" (`recap`) are choices next to its passage; `nuit` is no longer a kind of junction | `nuit` becomes a fade to black that passes the night, the high view of the day cards becomes `recap` |
| 7 | "Ralentir aux temps forts" removed (`4b6fa3c1`) | the pacing keeps only `keepDuration` and `transitionS`; automatic stops are few | films saved before the timeline start without generated stops; the file opens with the message `project.doc.pacingRemoved` |
| 8 | overlay by format (`eabe3e5e`) | a widget's free position is a share of the safe area (`free`), not pixels (`offset`) | converts the pixels with the file's own format and resolution, so the film in its own format stays where it was |

Many things were added between these versions without a new version, because a missing key takes its default and a
grown block is completed by its `SETTING_UPGRADES` line: the overlay widgets, the camera options, the lens, clouds,
snow, contours, forest, poster, landmark density, `labels`, `trackStyle`, `marker`. Removed options follow the same
rule (`landmarkTitles` simply goes; a removed imagery source opens in its successor).

## Changing the format

Most changes need no new version: add a key with a default and a `SETTING_CHECKS` line, and, if an existing block grows,
complete it in its `SETTING_UPGRADES` function (see the recipe "Add a setting, end to end" of the
[developer handbook](handbook/index.html)). A new version is for a change that older files cannot answer with a default:
a key renamed or removed, a unit changed, a meaning changed.

Then, in the same pull request:

1. **Bump** `PROJECT_VERSION` in `src/project/document.ts`.
2. **Write the migration** `MIGRATIONS[n - 1]` from version n - 1 to n, a pure function of the raw document, with a
   comment that says what changed and why the film stays the same. It never reads today's defaults (they move on):
   freeze what it needs in the migration, as `V3_JUNCTION` does.
3. **Freeze a file.** Add `src/project/__fixtures__/v<n>.json`, a project as the app wrote it at the commit that makes
   the bump, by running that commit's own `serializeProject` (extract its sources with `git archive`). Never regenerate
   an old file from later code, never reformat one. Add its row to `src/project/__fixtures__/README.md`.
4. **Test.** `frozen.test.ts` opens every file, migrates it to the current version and checks the film; add the checks
   that are specific to the change next to those of `legacy.test.ts`. The guard test in `frozen.test.ts` fails when
   `PROJECT_VERSION` was raised without a file for the new version.
5. **Document.** Add a row to the table above, and a line to the changelog.

A change that makes an older file not open, or open to a different film, breaks the promise: it is not made, or it
comes with a migration.
