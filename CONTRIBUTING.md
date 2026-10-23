# Contributing to OpenFlyover

Thank you for helping. Bug reports, ideas, translations and pull requests are all welcome.

## Before you start

- Read the conventions in the [README](README.md#contributing), then [`ARCHITECTURE.md`](ARCHITECTURE.md) for the
  code you touch.
- The [developer handbook](docs/handbook/index.html) explains the setup, the commands, the recipes (add a setting, a
  translation key, a data source…) and the path « From an issue to a pull request ».
- For a security problem, do not open an issue: follow [`SECURITY.md`](SECURITY.md).
- Be kind: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) applies everywhere in the project.

## Set up

Node 24 (`.nvmrc`) and, for the desktop application only, Rust and the Tauri prerequisites.

```
npm ci
npm run dev        # the website on http://127.0.0.1:5173
npm run tauri:dev  # the desktop application
```

## Before you push

```
npm run typecheck
npm run lint
npx vitest run --maxWorkers=1
npm run build
```

The CI runs the same checks on each pull request, plus `cargo test` when `src-tauri/` changes.

## Pull requests

- One pull request per change, small enough to read. Say why, what changes for the person using the app, and how to
  test it by hand (the template asks for it).
- Commit messages and pull request titles follow the history: `type(scope): what changes, in plain words`, in English
  (`fix(export): the render queue preset overrides the project format`). Pull requests are squash-merged.
- Every visible change gets a line in [`CHANGELOG.md`](CHANGELOG.md).
- Every interface text goes through `t('domain.key')`, with a message in the five languages (`src/i18n/`).
- An exported film must stay the same frame for frame unless the change is about the film itself: say so in the
  pull request when it changes.

## Reporting a bug or asking for a feature

Use the issue forms: they ask for the version, the system and the steps. The « Diagnostic » report (« Réglages ›
Diagnostic › Afficher le rapport ») helps a lot with export and display problems; it holds no position nor track name.
