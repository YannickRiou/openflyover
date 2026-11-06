# Frozen project files

One project file per format version (`PROJECT_VERSION`), written by the app of that version. They must never be
regenerated, reformatted or "updated" from today's code: their value is that they are what users really saved.

`frozen.test.ts` opens each `v<N>.json`, migrates it to the current version and fails when a version has no file.

| File | Written by the code of commit |
| --- | --- |
| `v1.json` | `11812f73^`, the last commit before the timeline (format v1) |
| `v2.json` | `36a84973^`, the last commit before the stage transitions (format v2) |
| `v3.json` | `36a84973` |
| `v4.json` | `7158a78d` |
| `v5.json` | `549b2d06` |
| `v6.json` | `9a00ae30` |
| `v7.json` | `4b6fa3c1` |
| `v8.json` | `eabe3e5e` |

Each one was produced by running the `serializeProject` of that commit (its sources extracted with `git archive`, never
today's serializer) on one track of three points with a waypoint, with one stop and one text in the film.

`legacy-v1.json` and `legacy-v2.json` are older, richer files (pacing on, a film with its lanes) that `legacy.test.ts`
checks value by value. They were written by hand in a test from the format of their time (`3d5e8334`), not by the app,
which is why `v1.json` and `v2.json` exist next to them.

To add one when `PROJECT_VERSION` is raised: do the same with the commit that makes the bump, and add a row here.
See `docs/project-format.md`.
