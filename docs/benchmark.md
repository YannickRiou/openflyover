# Export benchmark

The export has a target: **one minute of film in 10 minutes at most on a phone, 30 minutes at most on a computer**
([ROADMAP.md](../ROADMAP.md), « An export that finishes »). To see whether a version gets closer, each minor version
measures the same two projects the same way, and the figures go in the table at the end of this page and in the
release pull request.

## The reference projects

Both are in [`bench/`](../bench/). They are real project files (`.opnflvr`, the format of « Enregistrer »), opened with
« Ouvrir un projet ». They use the same track: the first day of the Tour du Mont-Blanc
(`src/import/__fixtures__/tour-du-mont-blanc-j1.gpx`, 351 points, dated 12 July 2025, so the weather asked for is
always the one of that day).

| | `phone.opnflvr` | `computer.opnflvr` |
|---|---|---|
| Format | 9:16, 1080 × 1920, 24 images per second | 16:9, 1080p (1920 × 1080), 30 images per second |
| Export quality | « Haute » | « Haute » |
| Clouds | by hand, medium quality, 55 % cover | none |
| Shadows | on (with the shadows of the clouds) | on |
| Water | on | on |
| Forests | off | on (density 60) |
| Landmarks | off | on (default kinds) |
| Overlay | title, figures, profile, map | title, figures, profile, map |
| Length of the film | 60 s | 60 s |

The weather of the outing and the tiles (terrain, photos, forests, landmarks) are downloaded when the project is
opened and exported, so a run needs a network and the figures depend a little on the servers. Run it twice if a figure
looks odd.

The files are built by `bench/projects.ts` with the app's own serializer, and
`src/project/bench.test.ts` fails when a file no longer matches (for instance after a new `PROJECT_VERSION`) or does not
open. To write them again:

```bash
BENCH_WRITE=1 npx vitest run src/project/bench.test.ts
```

## Measuring

Do the same on every device, in this order.

1. **Open the app.**
   - iPhone: Safari, <https://yannickriou.github.io/openflyover/>. Get the project onto the phone first: open
     `https://github.com/YannickRiou/openflyover/raw/master/bench/phone.opnflvr` (or the file of the version being
     tested, from the repository), choose « Enregistrer dans Fichiers ». Then, in the app, « Ouvrir un projet »
     and pick the file.
   - Computer, website: the same address in Chrome or Edge, then « Ouvrir un projet » and pick `bench/computer.opnflvr`
     from a checkout of the repository.
   - Computer, desktop application: install the version from the
     [Releases](https://github.com/YannickRiou/openflyover/releases) page, then « Ouvrir un projet » (or double click
     the file).
2. **Reload once** (close and open the tab, or restart the application) and open the project again, so the first run
   does not pay for the start-up of the page.
3. **Warm up once**: « Réglages » › « Diagnostic » › « Mesurer le coût des couches », and wait until it ends (a few
   minutes, more on a phone). Keep the screen on and the app in front.
4. **Run it again and keep this second run.** Open « Afficher le rapport » and read the section « Coût des couches »
   (and « Attente de la carte graphique » in the export lines).
5. Write down the figures, with the version (« À propos ») and the device.

## Reading the report

| Line | Meaning |
|---|---|
| `référence` | Milliseconds per image of the project as it is: this is the figure to keep. |
| `référence refaite à la fin` | The same measure again after all the layers. A gap with the first one means the device slowed down on the way (heat): the run is not comparable, let the device cool down and start again. |
| each layer (« sans nuages », « sans ombres »…) | Milliseconds per image without that layer, and what it saves: where the time goes. |

**The wait for the graphics card.** A phone or a tablet waits for the graphics card before composing each frame, a
computer does not. To compare both settings on a phone (it has no console), add `?export-gpu-wait=off` (or `=on`) to
the address of the page, for example `https://yannickriou.github.io/openflyover/?export-gpu-wait=off`. The choice is kept
for that tab only (session storage): open a new tab to go back to the default, or use `?export-gpu-wait=default`. The
report says what the tab asks for in « Attente de la carte graphique ». The figures below say which setting each used.

## From milliseconds per image to minutes per minute of film

One minute of film has `fps × 60` images, so:

```
minutes per minute of film = ms per image × fps × 60 / 60000 = ms per image × fps / 1000
```

For instance 1 572 ms at 24 images per second: 1 572 × 24 / 1000 = 37.7 minutes. The targets are therefore, in
milliseconds per image:

| | Target | At 24 i/s | At 30 i/s |
|---|---|---|---|
| Phone (10 min) | 600 000 / (60 × fps) | 417 ms | 333 ms |
| Computer (30 min) | 1 800 000 / (60 × fps) | 1 250 ms | 1 000 ms |

The measure leaves out the encoding and the start-up of the export (tiles, forests), a few percent of a real export:
the real time is a little above the figure.

## Results

One row per version and device. Fill it in the release pull request.

| Version | Device | Project | ms per image | Minutes per minute of film | Notes |
|---|---|---|---|---|---|
| 6.0.0 | iPhone | 1080 × 1920, « Haute », medium clouds | 1 572 | 37.7 (at 24 i/s) | November 2026. Layer cost run, GPU wait off for the second run. Before the reference projects existed. |
| 6.0.0 | iPhone | 1080 × 1080, « Standard », fast clouds at 55 % cover, forests, motion blur 10 % | 388 | 9.3 (at 24 i/s) | November 2026. Layer cost run, GPU wait off for the second run. The frame rate was not noted: 24 i/s assumed. |
